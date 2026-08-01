/**
 * The scenarios: fixtures for the four Ports, and what to do with them.
 *
 * A dev application, not shipped API.
 *
 * A scenario is DATA. Nothing here runs anything, which is what makes it
 * quotable in a bug report — the whole reproduction is
 * `--scenario <name> --at <step>`, and the reader can see what each step does
 * without running it.
 *
 * ---------------------------------------------------------------------------
 * Why the harness previews ITSELF
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md names this repository's preview 「自身の最小 E2E
 * （起動 → 操作 → スクリーンショット）」. Nothing in the organisation is
 * published, so kit's four parents — world, simulation, renderer, input — are
 * all injected Ports with no real implementations anywhere
 * (`application/preview-ports.ts` is types and four `Context.Tag`s, with
 * deliberately no `Layer.succeed` in sight).
 *
 * The screenshot half therefore needs a browser, a canvas and four real Layers,
 * and cannot be written today. See `apps/preview-harness/README.md` for exactly
 * what is missing.
 *
 * The launch-and-operate half needs none of them, and it is the half plan.md
 * §3.10 says matters most: kit is 「最も丁寧に作る」 because every other
 * repository's preview startup rides on it, and the property that has to hold is
 * **starts in about a second, reliably**. That is measurable right now, against
 * fake ports whose cost the operator programs — and measuring it against a
 * programmed clock is better than measuring it against a real one, because
 * "the world phase took 400 ms" then means the same thing on every machine.
 */
import type { BootPhase } from '../../src/domain/boot-phase'

/** How the fake ports behave for one scenario. */
export type PortFixture = {
  /** Simulated cost of each phase, in milliseconds, charged to the injected clock. */
  readonly costMillis: Readonly<Partial<Record<BootPhase, number>>>
  /** Ports whose teardown step fails. Teardown must still run the rest. */
  readonly failingTeardown: ReadonlyArray<'input' | 'renderer' | 'simulation' | 'world'>
  /** Modules to launch with. `contradiction` declares an `after` its order breaks. */
  readonly modules: 'none' | 'one' | 'contradiction' | 'stateful'
}

export type Command =
  | { readonly kind: 'launch' }
  /** Launch again on the same service, as a second world load does. */
  | { readonly kind: 'relaunch' }
  | { readonly kind: 'submitFrames'; readonly count: number }
  /** Stop through the CURRENT handle. */
  | { readonly kind: 'stop' }
  /**
   * Stop through a handle captured before the last relaunch.
   *
   * `application/playground.ts:397-402` guards the two shared `Ref` slots
   * against exactly this, with the comment "a late stop() on the old handle must
   * not unregister the new preview". The four port teardowns at :389-393 are not
   * guarded, and this is the step that shows what that costs.
   */
  | { readonly kind: 'stopStaleHandle' }
  | { readonly kind: 'note'; readonly text: string }

export type ScriptedStep = {
  readonly step: number
  readonly command: Command
  readonly why: string
}

export type Scenario = {
  readonly name: string
  readonly headline: string
  readonly detail: ReadonlyArray<string>
  readonly fixture: PortFixture
  readonly steps: ReadonlyArray<ScriptedStep>
}

const at = (step: number, why: string, command: Command): ScriptedStep => ({ step, command, why })

const FREE: PortFixture['costMillis'] = {}

/**
 * The baseline: a boot that costs nothing and a preview that runs.
 *
 * Everything the budget machinery says about this one is "OK", which is what
 * makes the other scenarios readable.
 */
const COLD_BOOT: Scenario = {
  name: 'cold-boot',
  headline: 'launch → operate → teardown, against four fake Ports',
  detail: [
    'The half of docs/testing.md\'s E2E that needs no browser. Watch the seven',
    'phases run in causal order, the port-call ledger fill in that order, frames',
    'go through the dropping queue, and teardown undo it all in REVERSE — input',
    'first, because a window listener outlives whatever added it, and the world',
    'last, because it is the only participant that persists.',
  ],
  fixture: { costMillis: FREE, failingTeardown: [], modules: 'one' },
  steps: [
    at(0, 'launchPlayground() with fake ports and one module', { kind: 'launch' }),
    at(1, 'the handle is a LIVE preview: the boot frame already ran', { kind: 'note', text: 'framesRendered starts at 1' }),
    at(2, 'drive some frames', { kind: 'submitFrames', count: 5 }),
    at(3, 'and more', { kind: 'submitFrames', count: 20 }),
    at(4, 'tear it down', { kind: 'stop' }),
    at(5, 'nothing is left: current is None, isRunning false, frames read 0', { kind: 'note', text: 'compare the ledger with the boot half' }),
  ],
}

/**
 * The budget, blown by one phase.
 *
 * `BOOT_PHASE_BUDGET_MILLIS` sums to exactly `BOOT_BUDGET_MILLIS`, so a phase
 * that overruns can only be paid for by another phase underrunning.
 */
const SLOW_WORLD: Scenario = {
  name: 'slow-world',
  headline: 'the world phase eats the whole budget',
  detail: [
    'world is allotted 400 ms of the 1000 ms budget — the largest single share,',
    'because opening a world is the one phase that touches storage. Here it takes',
    '900. The verdict names the phase and the overrun rather than reporting a',
    'single number, which is the difference between "boot is slow" and "boot is',
    'slow because openFlatWorld is slow".',
  ],
  fixture: {
    costMillis: { world: 900, renderer: 120, simulation: 40, 'first-frame': 30 },
    failingTeardown: [],
    modules: 'one',
  },
  steps: [
    at(0, 'launch', { kind: 'launch' }),
    at(1, 'read the phase table against the per-phase budget', { kind: 'note', text: 'BUDGET row' }),
    at(2, 'stop', { kind: 'stop' }),
  ],
}

/**
 * A module whose declaration order contradicts its own `after`.
 *
 * `stageOrderViolations` is a CHECKER, not a sort — `domain/launch-options.ts`
 * is emphatic that resolving the order here would let a preview disagree with
 * the shipped game. It answers the strictly weaker, local question: does the
 * order the author wrote already contradict a constraint the author declared?
 */
const STAGE_CONTRADICTION: Scenario = {
  name: 'stage-contradiction',
  headline: 'the declaration-order check reports a contradiction it will not fix',
  detail: [
    'The module declares `preview:draw` before `preview:camera`, and declares',
    'that `preview:draw` runs after `preview:camera`. Both cannot be what the',
    'author meant. The harness reports it, logs a warning, and runs the stages in',
    'declaration order anyway — because mc-compose owns the total order and a',
    'preview that quietly reordered them would be a preview that no longer',
    'previews the game.',
  ],
  fixture: { costMillis: FREE, failingTeardown: [], modules: 'contradiction' },
  steps: [
    at(0, 'launch with the contradictory module', { kind: 'launch' }),
    at(1, 'the violation is on the handle, not thrown', { kind: 'note', text: 'stageOrderWarnings' }),
    at(2, 'frames still run, in declaration order', { kind: 'submitFrames', count: 3 }),
    at(3, 'stop', { kind: 'stop' }),
  ],
}

/**
 * The second world load — plan.md §3.8's worst bug class, in the repository
 * whose entire job is relaunching.
 */
const RELAUNCH: Scenario = {
  name: 'relaunch',
  headline: 'launch, launch again, and again — on the same service',
  detail: [
    'launch is re-entrant by design: it calls stopCurrent first rather than',
    'failing with "already running", because a teardown that can be cut short',
    'makes "already running" a state the caller cannot reliably escape. Watch the',
    'ledger: every relaunch tears the previous preview down completely before',
    'standing the next one up, and framesRendered restarts at 1.',
  ],
  fixture: { costMillis: { world: 20, renderer: 15 }, failingTeardown: [], modules: 'stateful' },
  steps: [
    at(0, 'first world', { kind: 'launch' }),
    at(1, 'run it', { kind: 'submitFrames', count: 4 }),
    at(2, 'save & quit → load', { kind: 'relaunch' }),
    at(3, 'the second world runs its own frames', { kind: 'submitFrames', count: 2 }),
    at(4, 'and a third', { kind: 'relaunch' }),
    at(5, 'stop for real', { kind: 'stop' }),
    at(6, 'stop again: idempotent, as a best-effort quit needs it to be', { kind: 'stop' }),
  ],
}

/**
 * The regression this scenario watches.
 *
 * `application/playground.ts` guards the shared `Ref` slots against a late
 * `stop()` on a superseded handle. The four port teardowns used to sit OUTSIDE
 * that guard, and the ports are the SAME objects the live preview is using —
 * they come from one Layer. They are inside it now; this scenario is what
 * notices if they ever come back out.
 */
const STALE_STOP: Scenario = {
  name: 'stale-stop',
  headline: 'a late stop() on a superseded handle must not tear down the LIVE preview',
  detail: [
    'Step 0 launches, step 2 relaunches, step 3 calls stop() on the handle from',
    'step 0 — the shape of a slow quit finishing after the next world started.',
    'Watch the port-call ledger stay EMPTY across step 3: input.detach,',
    'renderer.detach, simulation.stop and world.closeWorld all belong to the',
    'live preview now, and a superseded handle owns none of them. isRunning,',
    'current and framesRendered go on reporting a healthy preview because it is',
    'healthy — before the fix they said the same thing while the world was shut.',
  ],
  fixture: { costMillis: FREE, failingTeardown: [], modules: 'one' },
  steps: [
    at(0, 'the first preview', { kind: 'launch' }),
    at(1, 'it runs', { kind: 'submitFrames', count: 3 }),
    at(2, 'a relaunch supersedes it', { kind: 'relaunch' }),
    at(3, 'the OLD handle\'s stop finally lands', { kind: 'stopStaleHandle' }),
    at(4, 'the live preview is fine, and its ports were never touched', {
      kind: 'note',
      text: 'read the INVARIANTS panel',
    }),
    at(5, 'and still accepts frames, into a world that is still open', { kind: 'submitFrames', count: 2 }),
    at(6, 'stop', { kind: 'stop' }),
  ],
}

/**
 * A teardown step that fails.
 *
 * `playground.ts:391` wraps each port teardown in `catchAllCause` so that one
 * failure cannot abandon the rest — the reference's timed-out quit step is what
 * made re-entrancy necessary in the first place. docs/testing.md lists this as
 * an unwritten test.
 */
const FAILING_TEARDOWN: Scenario = {
  name: 'failing-teardown',
  headline: 'one port\'s teardown throws; the other three must still run',
  detail: [
    'renderer.detach fails. The ledger should still show input.detach before it',
    'and simulation.stop / world.closeWorld after it, and the launch should still',
    'be relaunchable. docs/testing.md:290 records "a failing detach does not',
    'prevent the remaining teardown steps" as a test that does not exist yet;',
    'this is that test, run by hand.',
  ],
  fixture: { costMillis: FREE, failingTeardown: ['renderer'], modules: 'one' },
  steps: [
    at(0, 'launch', { kind: 'launch' }),
    at(1, 'stop, with a renderer that refuses to detach', { kind: 'stop' }),
    at(2, 'the harness is still usable', { kind: 'launch' }),
    at(3, 'run it', { kind: 'submitFrames', count: 3 }),
    at(4, 'stop', { kind: 'stop' }),
  ],
}

export const SCENARIOS: ReadonlyArray<Scenario> = [
  COLD_BOOT,
  SLOW_WORLD,
  STAGE_CONTRADICTION,
  RELAUNCH,
  STALE_STOP,
  FAILING_TEARDOWN,
]

export const SCENARIO_NAMES = [
  'cold-boot',
  'slow-world',
  'stage-contradiction',
  'relaunch',
  'stale-stop',
  'failing-teardown',
] as const

export type ScenarioName = (typeof SCENARIO_NAMES)[number]

export const scenarioFor = (name: ScenarioName): Scenario =>
  SCENARIOS.find((scenario) => scenario.name === name) ?? COLD_BOOT

export const stepAt = (scenario: Scenario, step: number): ScriptedStep | undefined =>
  scenario.steps.find((scripted) => scripted.step === step)

export const scenarioLength = (scenario: Scenario): number =>
  scenario.steps.reduce((longest, scripted) => Math.max(longest, scripted.step + 1), 0)

export const describeCommand = (command: Command): string => {
  switch (command.kind) {
    case 'launch':
      return 'launchPlayground()'
    case 'relaunch':
      return 'launch() again — the second world load'
    case 'submitFrames':
      return `submitFrame x ${String(command.count)}`
    case 'stop':
      return 'handle.stop'
    case 'stopStaleHandle':
      return 'stop() on the SUPERSEDED handle'
    case 'note':
      return command.text
    default:
      return 'unknown'
  }
}
