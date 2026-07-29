/**
 * `--stats`: the numeric report.
 *
 * A dev application, not shipped API.
 *
 * **Nothing here asserts.** These probes print. Anything in here that turns out
 * to be a real invariant belongs in `test/`, where it can fail CI; each note
 * says which test holds the claim and what the number used to be.
 */
import { Effect, Layer, Option, Ref } from 'effect'
import { Playground, PlaygroundLayer, type PlaygroundHandle } from '../../application/playground'
import {
  InputPort,
  RendererPort,
  SimulationPort,
  WorldProviderPort,
} from '../../application/preview-ports'
import {
  BOOT_BUDGET_MILLIS,
  BOOT_PHASE_BUDGET_MILLIS,
  BOOT_PHASE_ORDER,
  classifyBootTimings,
  describeBootVerdict,
  DurationMillis,
  elapsedMillis,
} from '../../domain/boot-phase'
import {
  DEFAULT_FLAT_WORLD,
  DEFAULT_SPAWN_KIT,
  flattenStages,
  normalizeLaunchOptions,
  stageOrderViolations,
  type PreviewModule,
} from '../../domain/launch-options'
import {
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  MonotonicTimeSecs,
  position,
  StageId,
} from '../../domain/kernel-vocabulary'
import { fixed, pad, padStart } from './style'

const section = (title: string, why: string): ReadonlyArray<string> => ['', `== ${title}`, `   ${why}`, '']

const cell = (text: string, width: number): string => pad(text, width)

/** Fake ports that record every call, over a clock the probe advances. */
const makeFakes = Effect.gen(function* () {
  const events = yield* Ref.make<ReadonlyArray<string>>([])
  const millis = yield* Ref.make(0)
  const record = (what: string): Effect.Effect<void> => Ref.update(events, (all) => [...all, what])

  const layer = Layer.mergeAll(
    Layer.succeed(ClockPort, {
      monotonicSecs: Ref.get(millis).pipe(Effect.map((value) => MonotonicTimeSecs(value / 1000))),
      wallClockEpochMillis: Effect.succeed(EpochMillis(1_700_000_000_000)),
    }),
    Layer.succeed(WorldProviderPort, {
      openFlatWorld: () => record('world.openFlatWorld'),
      closeWorld: record('world.closeWorld'),
    }),
    Layer.succeed(SimulationPort, {
      spawn: () => record('simulation.spawn'),
      tick: () => record('simulation.tick'),
      cameraPose: Effect.succeed({
        position: position(0, 50, 0),
        yawRadians: 0,
        pitchRadians: 0,
        capturedAtSecs: MonotonicTimeSecs(0),
      }),
      stop: record('simulation.stop'),
    }),
    Layer.succeed(RendererPort, {
      attach: record('renderer.attach'),
      renderFrame: () => record('renderer.renderFrame'),
      detach: record('renderer.detach'),
    }),
    Layer.succeed(InputPort, { attach: record('input.attach'), detach: record('input.detach') }),
    PlaygroundLayer,
  )

  return { events, millis, layer }
})

// ---------------------------------------------------------------------------
// KIT-1 — the stale handle
// ---------------------------------------------------------------------------

const staleStopProbe = Effect.gen(function* () {
  const fakes = yield* makeFakes

  const result = yield* Effect.gen(function* () {
    const playground = yield* Playground

    const stale: PlaygroundHandle = yield* playground.launch()
    const live: PlaygroundHandle = yield* playground.launch()

    // Everything from here belongs to the LIVE preview.
    yield* Ref.set(fakes.events, [])
    yield* stale.stop
    const causedByStale = yield* Ref.get(fakes.events)

    const stillRunning = yield* live.isRunning
    const current = yield* playground.current

    yield* Ref.set(fakes.events, [])
    yield* live.submitFrame(DeltaTimeSecs(0.016))
    yield* Effect.yieldNow()
    yield* Effect.yieldNow()
    const afterFrame = yield* Ref.get(fakes.events)
    const framesRendered = yield* live.framesRendered

    yield* playground.stop
    return { causedByStale, stillRunning, current: Option.isSome(current), afterFrame, framesRendered }
  }).pipe(Effect.provide(fakes.layer))

  return [
    ...section(
      'STALE-STOP',
      'launch, launch again, then stop() the FIRST handle. What does it touch?',
    ),
    `   ${cell('port calls caused by the superseded stop()', 46)}${result.causedByStale.join(', ') || '(none)'}`,
    '',
    `   ${cell('live.isRunning afterwards', 46)}${String(result.stillRunning)}`,
    `   ${cell('playground.current is Some', 46)}${String(result.current)}`,
    `   ${cell('live.framesRendered after one more frame', 46)}${String(result.framesRendered)}`,
    `   ${cell('what that frame did to the ports', 46)}${result.afterFrame.join(', ') || '(none)'}`,
    '',
    '   The first row is the one to read. `services` (playground.ts:312-318) is resolved from the',
    '   caller\'s Layer, so a superseded handle holds the SAME four objects the live preview is',
    '   using — and the four port teardowns used to run unconditionally, two lines above the guard',
    '   that already protected `generationRef` and `handleRef`. The live preview\'s input listeners',
    '   were unregistered, its renderer detached, its simulation stopped and its world closed,',
    '   while isRunning, current and framesRendered all kept reading healthy, because none of them',
    '   is derived from a port.',
    '',
    '   The ports are now inside the same guard, and the guard is a single atomic Ref.modify, so',
    '   two concurrent stops on one handle cannot both win the teardown either.',
    '',
    '   Pinned by test/playground.test.ts `REGRESSION: a late stop() on a superseded handle does',
    '   not kill the live preview`, which now asserts fakes.events across the stale stop — the',
    '   only place those four calls are visible — and submits a frame afterwards. `two Layer builds',
    '   are two independent harnesses` gives each harness its own fakes and checks the two event',
    '   logs separately, because four Ports are four objects and sharing them is a caller\'s',
    '   decision, not the harness\'s.',
    '   Watch it: pnpm preview --scenario stale-stop --at 5 --view ledger --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// KIT-2 — frameStages evaluated twice
// ---------------------------------------------------------------------------

const doubleRegistrationProbe = Effect.gen(function* () {
  const fakes = yield* makeFakes
  const evaluations = yield* Ref.make(0)

  /**
   * A module that allocates per-launch state in its registration Effect.
   *
   * This is the shape `frameStages` became an `Effect` in order to allow — "a
   * module has to be able to acquire a service in order to BUILD its stages",
   * launch-options.ts:296-299 — and it is the shape the double evaluation
   * actually damages, because each run produces a DIFFERENT stage set.
   */
  const ran = yield* Ref.make<ReadonlyArray<string>>([])
  const stateful: PreviewModule = {
    frameStages: Effect.gen(function* () {
      const generation = yield* Ref.updateAndGet(evaluations, (seen) => seen + 1)
      const id = `preview:stage-of-registration-${String(generation)}`
      return [
        {
          id: StageId(id),
          // Declares an `after` on an id only THIS registration has, so the
          // warning names the registration the warnings were derived from.
          after: [StageId(`preview:sentinel-of-registration-${String(generation)}`)],
          run: () => Ref.update(ran, (seen) => (seen.includes(id) ? seen : [...seen, id])),
        },
        { id: StageId(`preview:sentinel-of-registration-${String(generation)}`), run: () => Effect.void },
      ]
    }),
  }

  const handle = yield* Effect.gen(function* () {
    const playground = yield* Playground
    const built = yield* playground.launch({ modules: [stateful] })
    yield* playground.stop
    return built
  }).pipe(Effect.provide(fakes.layer))

  const perLaunch = yield* Ref.get(evaluations)

  // And the two functions, called directly.
  const direct = yield* Ref.make(0)
  const counted: PreviewModule = {
    frameStages: Ref.updateAndGet(direct, (seen) => seen + 1).pipe(Effect.as([])),
  }
  yield* flattenStages([counted])
  const afterFlatten = yield* Ref.get(direct)
  yield* stageOrderViolations([counted])
  const afterViolations = yield* Ref.get(direct)

  const modulesTiming = handle.timings.find((timing) => timing.phase === 'modules')

  return [
    ...section(
      'DOUBLE-REGISTRATION',
      'How many times does one launch evaluate one module\'s `frameStages`?',
    ),
    `   ${cell('evaluations for ONE launch', 44)}${String(perLaunch)}`,
    `   ${cell('flattenStages() alone', 44)}${String(afterFlatten)}`,
    `   ${cell('...plus stageOrderViolations()', 44)}${String(afterViolations)}`,
    `   ${cell('the `modules` phase timing', 44)}${modulesTiming === undefined ? '(missing)' : `${fixed(modulesTiming.durationMillis, 3)} ms`}`,
    '',
    `   ${cell('the stage the PUMP ran', 44)}${(yield* Ref.get(ran)).join(', ') || '(none)'}`,
    `   ${cell('the stage stageOrderWarnings names', 44)}${handle.stageOrderWarnings.map((violation) => String(violation.stage)).join(', ') || '(none)'}`,
    `   ${cell('...the same registration?', 44)}${
      (yield* Ref.get(ran)).join(',') === handle.stageOrderWarnings.map((violation) => String(violation.stage)).join(',')
        ? 'yes'
        : 'NO — the warnings describe a preview that does not exist'
    }`,
    '',
    '   One evaluation per launch, and it happens inside phase(\'modules\'). The boot path used to',
    '   flatten twice — once there, and again in `stageOrderViolations(resolved.modules)`, which',
    '   flattens the modules itself. Two consequences, and the second was the one that bit:',
    '',
    '   1. The `modules` phase under-reported. Half the module registration cost fell outside',
    '      phase(), contradicting playground.ts:322 — "Every phase in BOOT_PHASE_ORDER goes',
    '      through here" — in the one repository whose product is a boot budget.',
    '',
    '   2. `stageOrderWarnings` described stages the pump would never run. A module whose',
    '      registration Effect is not idempotent — `Ref.make` inside it, which is the shape the',
    '      Effect exists to permit — yields a second, DISTINCT set of StageRegistrations, and the',
    '      warnings on the handle were computed over those. The module above stamps its own',
    '      registration number into its stage id; the two evaluations produced',
    '      preview:stage-of-registration-1 (which the pump ran) and',
    '      preview:stage-of-registration-2 (which the warnings came from).',
    '',
    '   `flattenedStageOrderViolations` is pure and takes the flattened array, so the warnings on',
    '   a handle are now derived from the exact stages that preview is running.',
    '   `stageOrderViolations` still exists for a caller who has modules and no stages, and its',
    '   doc says why anyone who has already flattened must not use it.',
    '',
    '   Every module in test/playground.test.ts and test/launch-options.test.ts was',
    '   `Effect.succeed([...])`, which is idempotent and free — the double evaluation was invisible',
    '   by construction. Two tests in test/playground.test.ts now use a module that allocates in',
    '   its registration Effect: `REGRESSION: one launch evaluates a module\'s frameStages exactly',
    '   ONCE` and `REGRESSION: the warnings describe the stages the PUMP runs`.',
    '   Watch it: pnpm preview --scenario relaunch --view stages --at 6 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

const budgetProbe = (): ReadonlyArray<string> => {
  const sum = BOOT_PHASE_ORDER.reduce((total, phase) => total + BOOT_PHASE_BUDGET_MILLIS[phase], 0)

  const onBudget = classifyBootTimings(
    BOOT_PHASE_ORDER.map((phase) => ({
      phase,
      durationMillis: DurationMillis(BOOT_PHASE_BUDGET_MILLIS[phase]),
    })),
  )
  const slowWorld = classifyBootTimings(
    BOOT_PHASE_ORDER.map((phase) => ({
      phase,
      durationMillis: DurationMillis(phase === 'world' ? 900 : 0),
    })),
  )
  const partial = classifyBootTimings([{ phase: 'world', durationMillis: DurationMillis(900) }])

  const nonFinite = [
    ['0 -> Infinity', 0, Number.POSITIVE_INFINITY],
    ['0 -> NaN', 0, Number.NaN],
    ['NaN -> NaN (a mirrored clock)', Number.NaN, Number.NaN],
    ['0 -> -5 (the documented case)', 0, -5],
    ['10 -> 10.25 (an ordinary one)', 10, 10.25],
  ] as const

  const nonFiniteRows = nonFinite.map(([label, from, to]) => {
    try {
      return `   ${cell(label, 34)}${String(elapsedMillis(from, to))}`
    } catch {
      return `   ${cell(label, 34)}THREW (DurationMillis rejected it)`
    }
  })

  return [
    ...section('BUDGET', `The per-phase shares, against the ${String(BOOT_BUDGET_MILLIS)} ms total.`),
    `   ${cell('phase', 18)}${padStart('budget', 10)}`,
    ...BOOT_PHASE_ORDER.map(
      (phase) => `   ${cell(phase, 18)}${padStart(`${String(BOOT_PHASE_BUDGET_MILLIS[phase])} ms`, 10)}`,
    ),
    `   ${cell('SUM', 18)}${padStart(`${String(sum)} ms`, 10)}   ${sum === BOOT_BUDGET_MILLIS ? '== the total, exactly' : '!= the total'}`,
    '',
    '   The shares summing to the total is what makes them mean something: a phase that overruns',
    '   can only be paid for by another phase underrunning, so "within budget overall while `world`',
    '   is over" is a real state the verdict has to be able to express.',
    '',
    `   ${cell('every phase exactly on budget', 44)}${describeBootVerdict(onBudget)}`,
    `   ${cell('world 900 ms, everything else free', 44)}${describeBootVerdict(slowWorld)}`,
    `   ${cell('only `world` reported, at 900 ms', 44)}${describeBootVerdict(partial)}`,
    '',
    `   the last one: withinBudget ${String(partial.withinBudget)}, totalMillis ${String(partial.totalMillis)}, `,
    `   overBudgetMillis ${String(partial.overBudgetMillis)}, ${String(partial.missingPhases.length)} missing phase(s).`,
    '   A missing phase is not "0 ms"; it is a boot that did not do something, and the verdict says',
    '   so separately from the arithmetic. That is the distinction a single number would lose.',
    '',
    ...section('ELAPSED-MILLIS', 'elapsedMillis clamps a backwards interval. What about a broken one?'),
    ...nonFiniteRows,
    '',
    '   elapsedMillis is TOTAL: every pair of `number`s maps to a DurationMillis, and no row above',
    '   can throw. It used to clamp only the negative case, which left `DurationMillis` — a',
    '   Brand.refined constructor requiring `Number.isFinite(value) && value >= 0` — to reject a',
    '   non-finite reading by THROWING, inside `phase()`, inside a `launch` whose signature is',
    '   `Effect<PlaygroundHandle, never, ...>`. The error channel says a launch cannot fail; a',
    '   defect is not in the error channel, and the launch died.',
    '',
    '   How reachable that was depends on the clock. `MonotonicTimeSecs` is itself refined, so a',
    '   well-formed ClockPort cannot produce Infinity — but `elapsedMillis` does not take',
    '   `MonotonicTimeSecs`, it takes `number`, and domain/kernel-vocabulary.ts:30-45 documents at',
    '   length that a NARROWER mirror of the Clock Port satisfies the same Tag at run time with',
    '   fields reading `undefined`. `undefined - undefined` is NaN — the third row above.',
    '',
    '   Zero rather than an invented large duration, because a fabricated number would make',
    '   classifyBootTimings name a specific phase as overrunning by a specific amount and send',
    '   somebody to optimise work that was never measured. Zero says only what the backwards clamp',
    '   already says. Pinned by test/boot-phase.test.ts `REGRESSION: a non-finite reading is a',
    '   zero, not a defect that kills the launch`.',
  ]
}

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

const optionsProbe = (): ReadonlyArray<string> => {
  const empty = normalizeLaunchOptions()
  const explicitUndefined = normalizeLaunchOptions({ world: { seed: undefined } })
  const partial = normalizeLaunchOptions({ world: { seed: 42 } })

  return [
    ...section('LAUNCH-OPTIONS', 'Every field optional, every default named and reachable.'),
    `   ${cell('normalizeLaunchOptions()', 40)}seed ${String(empty.world.seed)}, surfaceY ${String(empty.world.surfaceY)}, modules ${String(empty.modules.length)}`,
    `   ${cell('{ world: { seed: undefined } }', 40)}seed ${String(explicitUndefined.world.seed)}   (an explicit undefined falls back)`,
    `   ${cell('{ world: { seed: 42 } }', 40)}seed ${String(partial.world.seed)}, surfaceY ${String(partial.world.surfaceY)}   (the rest still defaults)`,
    '',
    `   ${cell('DEFAULT_FLAT_WORLD.surfaceY', 40)}${String(DEFAULT_FLAT_WORLD.surfaceY)}`,
    `   ${cell('DEFAULT_SPAWN_KIT.feetPosition.y', 40)}${String(DEFAULT_SPAWN_KIT.feetPosition.y)}   ${DEFAULT_SPAWN_KIT.feetPosition.y === DEFAULT_FLAT_WORLD.surfaceY + 1 ? '== surfaceY + 1: the player stands ON the ground' : '!= surfaceY + 1'}`,
    `   ${cell('DEFAULT_SPAWN_KIT.hotbar', 40)}${DEFAULT_SPAWN_KIT.hotbar.map((slot) => `${slot.item} x${String(slot.count)}`).join(', ')}`,
    '',
    '   The two constants agreeing is load-bearing and is not enforced by anything: they are',
    '   separate literals in separate declarations (launch-options.ts:101-116 and :153-167). A',
    '   preview that spawns one block inside its own flat world is the first thing every other',
    '   repository would see.',
  ]
}

// ---------------------------------------------------------------------------

const HEADER: ReadonlyArray<string> = [
  'mc-playground-kit --stats — the harness, measured against fake Ports',
  '',
  'Nothing here asserts. Every line is a quantity, and every note names the test in test/ that',
  'holds the claim to it — that is where it can fail CI. Run with --ascii for a pasteable copy.',
  '',
  'Every millisecond below comes from a ClockPort this report programs, so the numbers are the',
  'same on a laptop and in CI. That is deliberate: a boot budget measured against a wall clock',
  'would be a benchmark, and a benchmark that fails on a loaded CI machine gets deleted.',
]

const FOOTER: ReadonlyArray<string> = [
  '',
  '== what this report does NOT cover: the screenshot half',
  '',
  '   docs/testing.md names this repository\'s preview 「起動 → 操作 → スクリーンショット」.',
  '   The first two are above. The third needs four things that do not exist yet:',
  '',
  '     1. REAL PORT LAYERS. application/preview-ports.ts is four Context.Tags and their service',
  '        types, with deliberately no Layer.succeed anywhere — its header explains why a shipped',
  '        fake would be worse than none. Real ones need mc-worldgen, mc-sim and mc-render to be',
  '        published and pinned (plan.md §6 Step 3), and nothing is published.',
  '     2. A BROWSER. A screenshot is of pixels; mc-render ships no THREE.js and no lib.DOM.',
  '     3. @playwright/test. Not a dependency of any repository in the organisation, and adding',
  '        it is a decision about CI runtime, not a line in a package.json.',
  '     4. A BASELINE POLICY. A screenshot test without an agreed answer to "what counts as the',
  '        same picture" is a test that fails on a font update. plan.md §3.10 records that',
  '        Playwright runs on SwiftShader, so the baselines cannot come from a developer machine.',
  '',
  '   None of that blocks the property §3.10 says matters most — "starts in about a second,',
  '   reliably" — which is what this report measures, and which is measurable BECAUSE the ports',
  '   are injected. When the four Layers exist, this app is where they get plugged in: the',
  '   fixtures in apps/preview-harness/harness.ts are the shape they have to satisfy.',
]

export const statsReport = Effect.gen(function* () {
  return [
    ...HEADER,
    ...(yield* staleStopProbe),
    ...(yield* doubleRegistrationProbe),
    ...budgetProbe(),
    ...optionsProbe(),
    ...FOOTER,
  ]
})
