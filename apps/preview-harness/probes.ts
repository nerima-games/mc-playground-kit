/**
 * `--stats`: the numeric report.
 *
 * A dev application, not shipped API.
 *
 * **Nothing here asserts.** These probes print. Anything in here that turns out
 * to be a real invariant belongs in `test/`, where it can fail CI; each FINDING
 * says which test should exist and why the existing suite cannot see it.
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
    '   FINDING KIT-1. application/playground.ts:397-402 guards the two shared Ref slots against',
    '   exactly this, with the comment:',
    '',
    '       // Only clear the shared slots if THIS generation is still the current',
    '       // one. A relaunch has already replaced it, and a late stop() on the old',
    '       // handle must not unregister the new preview.',
    '',
    '   The guard is correct and covers `generationRef` and `handleRef` — which is why',
    '   isRunning and current above are still healthy. But the four PORT teardowns two lines',
    '   earlier (playground.ts:389-393) run unconditionally, and `services` (playground.ts:312-318)',
    '   is resolved from the same Layer, so they are the SAME objects the live preview is using.',
    '',
    '   The result is the worst shape a teardown bug can take: the live preview\'s input listeners',
    '   are unregistered, its renderer is detached, its simulation is stopped and its world is',
    '   closed, while every reading the harness offers says it is fine. Frames keep being accepted',
    '   and keep reaching a renderer that has been told to let go of its context.',
    '',
    '   This is not hypothetical for this repository. The whole reason `stop` is best-effort and',
    '   `launch` is re-entrant (playground.ts:120-127) is that the reference\'s quit step could be',
    '   cut off by its timeout and finish late — i.e. after the next world had started. That is',
    '   precisely the sequence above.',
    '',
    '   test/playground.test.ts:485 is named `REGRESSION: a late stop() on a superseded handle does',
    '   not kill the live preview` and asserts liveHandle.isRunning (:498) and playground.current',
    '   (:499). It never inspects fakes.events, which is where the four calls appear. The test is',
    '   about the right thing and looks at the two fields the guard already protects.',
    '   test/playground.test.ts:506 `two Layer builds are two independent harnesses` has the same',
    '   blind spot: left.stop detaches ports right is using, and only right.isRunning is checked.',
    '   Reproduce: pnpm preview --scenario stale-stop --at 5 --view ledger --once --ascii',
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
  const stateful: PreviewModule = {
    frameStages: Effect.gen(function* () {
      const generation = yield* Ref.updateAndGet(evaluations, (seen) => seen + 1)
      return [
        {
          id: StageId(`preview:stage-of-registration-${String(generation)}`),
          run: () => Effect.void,
        },
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
    '   FINDING KIT-2. playground.ts:344 evaluates the modules inside phase(\'modules\'):',
    '',
    '       const stages = yield* phase(\'modules\', flattenStages(resolved.modules))',
    '',
    '   and playground.ts:352 then evaluates them again:',
    '',
    '       const warnings = yield* stageOrderViolations(resolved.modules)',
    '',
    '   because stageOrderViolations calls flattenStages itself (launch-options.ts:333). Two',
    '   consequences, and the second is the one that bites:',
    '',
    '   1. The `modules` phase under-reports. Half the module registration cost falls outside',
    '      phase(), contradicting playground.ts:322 — "Every phase in BOOT_PHASE_ORDER goes',
    '      through here" — in the one repository whose product is a boot budget.',
    '',
    '   2. `stageOrderWarnings` describes stages the pump will never run. A module whose',
    '      registration Effect is not idempotent — `Ref.make` inside it, which is the shape the',
    '      Effect exists to permit — yields a second, distinct set of StageRegistrations, and the',
    '      warnings on the handle are computed over those. The module above stamps its own',
    `      registration number into its stage id, and the two evaluations produced`,
    `      preview:stage-of-registration-1 (which the pump runs) and`,
    `      preview:stage-of-registration-2 (which stageOrderWarnings was derived from).`,
    '',
    '   Every module in test/playground.test.ts (:132, :289, :536, :559) and',
    '   test/launch-options.test.ts (:33-35) is `Effect.succeed([...])`, which is idempotent and',
    '   free. The double evaluation is invisible by construction.',
    '   Reproduce: pnpm preview --scenario relaunch --view stages --at 6 --once --ascii',
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
    ['0 -> -5 (the documented case)', 0, -5],
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
    '   FINDING KIT-3. boot-phase.ts:99-100 takes two bare `number`s and clamps only the negative',
    '   case, while its doc (boot-phase.ts:90-98) discusses only that case. `DurationMillis` is a',
    '   Brand.refined constructor requiring `Number.isFinite(value) && value >= 0`, so a non-finite',
    '   reading THROWS — inside `phase()`, inside a `launch` whose signature is',
    '   `Effect<PlaygroundHandle, never, ...>`. The error channel says a launch cannot fail; a',
    '   defect is not in the error channel, and the launch dies.',
    '',
    '   How reachable this is depends on the clock. `MonotonicTimeSecs` is itself refined, so a',
    '   well-formed ClockPort cannot produce Infinity — but `elapsedMillis` does not take',
    '   `MonotonicTimeSecs`, it takes `number`, and domain/kernel-vocabulary.ts:30-45 documents at',
    '   length that a NARROWER mirror of the Clock Port satisfies the same Tag at run time with',
    '   fields reading `undefined`. `undefined - undefined` is NaN. The mirror hazard and this',
    '   unguarded conversion are one step apart.',
    '',
    '   test/boot-phase.test.ts:121 covers the negative clamp and :281 tests DurationMillis.option',
    '   directly; nothing calls elapsedMillis with a non-finite reading.',
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
  'Nothing here asserts. Every line is a quantity, and every FINDING names what should become a',
  'test in test/ — that is where a claim can fail CI. Run with --ascii for a pasteable copy.',
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
