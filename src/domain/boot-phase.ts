/**
 * The boot budget: ordered phases, a per-phase millisecond allowance, and a
 * pure classifier for a set of measured durations.
 *
 * ---------------------------------------------------------------------------
 * Why a boot budget is a domain concept here and nowhere else
 * ---------------------------------------------------------------------------
 *
 * The playground's startup target is a time budget:
 *
 *   「ミニ平地ワールド + カメラ + レンダラ + 入力」を**1秒で起動**する糊。
 *   全プレビューの開発体験がここの起動速度と安定性に依存する —
 *   最も丁寧に作る部品
 *
 * Startup speed is not a nice-to-have attribute of this repository; it is the
 * requirement. A number that is the requirement belongs in `domain/`, expressed
 * as data with a function that judges against it, not as a comment somebody
 * remembers to honour.
 *
 * ---------------------------------------------------------------------------
 * What "one second" is being compared against
 * ---------------------------------------------------------------------------
 *
 * A preview must make the first interaction quick and repeatable. This budget
 * is intentionally independent from any loading-screen or frame-rate policy in
 * a shipped game; the playground measures its own phases instead.
 *
 * ---------------------------------------------------------------------------
 * Why per-phase budgets and not just a total
 * ---------------------------------------------------------------------------
 *
 * A total tells you that boot got slower. A per-phase breakdown tells you which
 * repository to go and look at, which matters because the phases belong to
 * different repositories and a regression in any of the four parents surfaces
 * here first. The classifier therefore reports both, and reports overrunning
 * phases even when the total is fine — a `world` phase at 3x its allowance that
 * happens to fit because `renderer` was fast is a regression that will bite as
 * soon as the world grows.
 */
import { Brand } from 'effect'

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/** Additive identity for boot timing arithmetic. */
const ZERO_DURATION_MILLIS = 0
/** Conversion factor between `MonotonicTimeSecs`'s seconds and `DurationMillis`'s milliseconds. */
const MILLIS_PER_SECOND = 1000
/** The value of an empty `ReadonlyArray`'s `.length`, named so the "nothing missing / nothing over" checks read as intent rather than arithmetic. */
const EMPTY_COUNT = 0
/** Decimal places shown by `describeBootVerdict`'s millisecond readings. */
const DISPLAY_DECIMAL_PLACES = 1

/**
 * A measured or budgeted duration, in milliseconds. Finite and non-negative.
 *
 * Milliseconds, not the seconds that `MonotonicTimeSecs` reads in: a boot budget
 * is discussed, written down and compared in milliseconds, and expressing it as
 * `0.4` seconds invites exactly the decimal-point error the number exists to
 * prevent. `elapsedMillis` below is the single conversion point.
 *
 * NOT mirrored from mc-kernel — kernel has no duration brand. If it grows one,
 * this is the declaration to delete.
 */
export type DurationMillis = number & Brand.Brand<'DurationMillis'>

type ValidationResult<A> =
  | { readonly _tag: 'Valid'; readonly value: A }
  | { readonly _tag: 'Invalid'; readonly error: ReturnType<typeof Brand.error> }

type DurationMillisResult = ValidationResult<DurationMillis>

const durationMillisBrand = Brand.nominal<DurationMillis>()

const safeValueLabel = (value: unknown): string => {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    return typeof value
  }
  return String(value)
}

const isDurationMillis = (value: unknown): value is DurationMillis =>
  typeof value === 'number' && Number.isFinite(value) && value >= ZERO_DURATION_MILLIS

export const DurationMillis = (value: unknown): DurationMillisResult => {
  if (!isDurationMillis(value)) {
    return {
      _tag: 'Invalid',
      error: Brand.error(`DurationMillis must be a finite, non-negative number of milliseconds, received ${safeValueLabel(value)}`),
    }
  }

  return { _tag: 'Valid', value: durationMillisBrand(value) }
}

// Internal duration values come from fixed non-negative budgets. Untrusted
// Numbers go through `DurationMillis`.
const durationMillisFromInvariant = (value: number): DurationMillis => durationMillisBrand(value)

/**
 * Convert an interval between two monotonic readings (seconds) into a validated
 * duration (milliseconds).
 *
 * `MonotonicTimeSecs` promises not to go backwards, but a test clock, a
 * replayed trace or a mis-stamped worker message can hand over a pair in the
 * wrong order. A negative or non-finite duration is invalid because it cannot
 * be used as a measurement.
 *
 * This function takes bare `number`s, not `MonotonicTimeSecs`: a NARROWER
 * mirror of the Clock Port satisfies the same Tag at run time with fields
 * reading `undefined`, and `undefined - undefined` is `NaN`. `DurationMillis`
 * reports invalid values in a typed result, so a broken reading is propagated
 * instead of being recorded as a fabricated measurement.
 */
export const elapsedMillis = (fromSecs: number, toSecs: number): DurationMillisResult => {
  const millis = (toSecs - fromSecs) * MILLIS_PER_SECOND
  return DurationMillis(millis)
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * The ordered boot phases.
 *
 * The order is causal, not stylistic — each phase needs the previous one's
 * output — and each phase is owned by a different repository, which is why the
 * breakdown is worth measuring at all:
 *
 *   resolve-options  this repository (pure; domain/launch-options.ts)
 *   world            mc-worldgen   generate the mini flat plate
 *   simulation       mc-sim        stand up state, spawn the player
 *   renderer         mc-render     renderer, camera, first attach
 *   input            mc-render     the RUNTIME input service — see below
 *   modules          the caller    install the preview's own frame stages
 *   first-frame      everyone      one frame end to end, so the preview is live
 *
 * `input` is a phase of its own despite being the cheapest, because its
 * ownership is part of the repository boundary: the runtime input service
 * belongs to mc-render, and this harness only asks for it.
 * A phase that is visibly a line item, with a name and a number, is harder to
 * quietly reimplement locally than a step folded into `renderer`.
 */
export type BootPhase =
  | 'resolve-options'
  | 'world'
  | 'simulation'
  | 'renderer'
  | 'input'
  | 'modules'
  | 'first-frame'

export const BOOT_PHASE_ORDER: ReadonlyArray<BootPhase> = [
  'resolve-options',
  'world',
  'simulation',
  'renderer',
  'input',
  'modules',
  'first-frame',
]

/**
 * The per-phase allowance, in milliseconds. Sums to `BOOT_BUDGET_MILLIS`.
 *
 * These are ALLOCATIONS, not measurements: nothing is implemented behind the
 * ports yet, so no phase has ever been timed for real. They are recorded now
 * because a budget agreed before the work starts is a design constraint,
 * whereas a budget derived afterwards is a description of whatever happened.
 * `test/boot-phase.test.ts` pins the sum, so a later reallocation has to stay
 * within one second rather than quietly grow it.
 *
 * The shape of the allocation reflects where the time provably goes:
 *
 * - `world` (400) is the largest. Generating a 3x3 chunk plate is real work.
 * - `renderer` (300) is next. Compiling shaders and uploading a chunk mesh is
 *   the other unavoidable cost; post-processing is deliberately NOT in a
 *   preview's default path.
 * - `first-frame` (100) is one frame's worth of everything, generously. The
 *   runtime clamps a frame at 50 ms, so 100 ms allows the cold-path frame to
 *   be twice the worst legal warm frame.
 * - `resolve-options` (5) is a pure function over a small record. It is listed
 *   at all so that "the options bag got expensive" is a visible event rather
 *   than a rounding error inside another phase.
 */
const RESOLVE_OPTIONS_BUDGET_MILLIS = 5
const WORLD_BUDGET_MILLIS = 400
const SIMULATION_BUDGET_MILLIS = 120
const RENDERER_BUDGET_MILLIS = 300
const INPUT_BUDGET_MILLIS = 25
const MODULES_BUDGET_MILLIS = 50
const FIRST_FRAME_BUDGET_MILLIS = 100

export const BOOT_PHASE_BUDGET_MILLIS: Readonly<Record<BootPhase, DurationMillis>> = {
  'first-frame': durationMillisFromInvariant(FIRST_FRAME_BUDGET_MILLIS),
  input: durationMillisFromInvariant(INPUT_BUDGET_MILLIS),
  modules: durationMillisFromInvariant(MODULES_BUDGET_MILLIS),
  renderer: durationMillisFromInvariant(RENDERER_BUDGET_MILLIS),
  'resolve-options': durationMillisFromInvariant(RESOLVE_OPTIONS_BUDGET_MILLIS),
  simulation: durationMillisFromInvariant(SIMULATION_BUDGET_MILLIS),
  world: durationMillisFromInvariant(WORLD_BUDGET_MILLIS),
}

/** The public one-second startup target, represented as a number. */
export const BOOT_BUDGET_MILLIS: DurationMillis = durationMillisFromInvariant(MILLIS_PER_SECOND)

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type PhaseTiming = {
  readonly phase: BootPhase
  readonly durationMillis: DurationMillis
}

export type PhaseTimingInput = {
  readonly phase: BootPhase
  readonly durationMillis: number
}

export type PhaseOverrun = {
  readonly phase: BootPhase
  readonly durationMillis: DurationMillis
  readonly budgetMillis: DurationMillis
  readonly overByMillis: DurationMillis
}

export type BootBudgetVerdict = {
  /** Total <= budget AND every phase was reported. See `missingPhases`. */
  readonly withinBudget: boolean
  readonly totalMillis: DurationMillis
  /** `total - BOOT_BUDGET_MILLIS`, clamped at zero. */
  readonly overBudgetMillis: DurationMillis
  /** Phases in `BOOT_PHASE_ORDER` with no timing. Order preserved. */
  readonly missingPhases: ReadonlyArray<BootPhase>
  /** Phases over their OWN allowance, in `BOOT_PHASE_ORDER`. Reported regardless of the total. */
  readonly overrunPhases: ReadonlyArray<PhaseOverrun>
}

type BootBudgetResult = ValidationResult<BootBudgetVerdict>

const measureTimings = (timings: ReadonlyArray<PhaseTimingInput>) => {
  const measured = new Map<BootPhase, number>()
  for (const timing of timings) {
    const durationResult = DurationMillis(timing.durationMillis)
    if (durationResult._tag === 'Invalid') {
      return { measured, totalResult: durationResult }
    }
    measured.set(timing.phase, (measured.get(timing.phase) ?? ZERO_DURATION_MILLIS) + durationResult.value)
  }
  const totalResult = DurationMillis(
    [...measured.values()].reduce((sum, value) => sum + value, ZERO_DURATION_MILLIS),
  )
  return { measured, totalResult }
}

const phaseOverrunOf = (
  phase: BootPhase,
  durationMillis: number,
  budgetMillis: DurationMillis,
): PhaseOverrun => ({
  budgetMillis,
  durationMillis: durationMillisFromInvariant(durationMillis),
  overByMillis: durationMillisFromInvariant(durationMillis - budgetMillis),
  phase,
})

const phaseOverrunAt = (
  measured: ReadonlyMap<BootPhase, number>,
  phase: BootPhase,
): PhaseOverrun | null => {
  const budgetMillis = BOOT_PHASE_BUDGET_MILLIS[phase]
  const durationMillis = measured.get(phase)
  if (typeof durationMillis === 'undefined' || durationMillis <= budgetMillis) {
    return null
  }
  return phaseOverrunOf(phase, durationMillis, budgetMillis)
}

const phaseOverrunsOf = (measured: ReadonlyMap<BootPhase, number>): ReadonlyArray<PhaseOverrun> => {
  const overrunPhases: Array<PhaseOverrun> = []
  for (const phase of BOOT_PHASE_ORDER) {
    const overrun = phaseOverrunAt(measured, phase)
    if (overrun !== null) {
      overrunPhases.push(overrun)
    }
  }
  return overrunPhases
}

const classifyMeasuredPhases = (measured: ReadonlyMap<BootPhase, number>) => {
  const missingPhases = BOOT_PHASE_ORDER.filter((phase) => !measured.has(phase))
  const overrunPhases = phaseOverrunsOf(measured)
  return { missingPhases, overrunPhases }
}

/**
 * Judge a set of measured phase durations against the budget.
 *
 * Pure, so that the interesting arithmetic is testable without booting anything
 * — which is the same inversion `mc-sim/domain/frame-timing.ts` applies to the
 * delta-time clamp, and for the same reason: the concurrent code that produces
 * the numbers is awkward to test, and the judgement that uses them is not.
 *
 * ---------------------------------------------------------------------------
 * Why a missing phase makes `withinBudget` false
 * ---------------------------------------------------------------------------
 *
 * A boot that never ran the renderer is very fast. Without this rule the fastest
 * possible boot is the one that does nothing, and the metric rewards deleting
 * work rather than speeding it up. A total is only meaningful over a complete
 * boot, so an incomplete one is not "under budget", it is unjudged — and the
 * honest way to say "I cannot tell you this is fine" in a boolean is `false`.
 *
 * Duplicate timings for a phase are SUMMED. A phase that ran twice really did
 * cost twice, and hiding a retry inside a first-wins rule would be the same
 * error as ignoring a missing phase, in the other direction.
 */
export const classifyBootTimings = (timings: ReadonlyArray<PhaseTimingInput>): BootBudgetResult => {
  const { measured, totalResult } = measureTimings(timings)
  if (totalResult._tag === 'Invalid') {
    return totalResult
  }

  const phases = classifyMeasuredPhases(measured)

  const overBudgetMillis = durationMillisFromInvariant(
    Math.max(ZERO_DURATION_MILLIS, totalResult.value - BOOT_BUDGET_MILLIS),
  )

  return {
    _tag: 'Valid',
    value: {
      missingPhases: phases.missingPhases,
      overBudgetMillis,
      overrunPhases: phases.overrunPhases,
      totalMillis: totalResult.value,
      withinBudget: totalResult.value <= BOOT_BUDGET_MILLIS && phases.missingPhases.length === EMPTY_COUNT,
    },
  }
}

/**
 * A one-line rendering of a verdict, for a console or a preview's dev overlay.
 *
 * The budget only changes behaviour if somebody sees it. A number that has to be
 * asked for is a number nobody has ever looked at, so `launchPlayground` logs
 * this on every boot (application/playground-service.ts).
 */
const formatBootStatus = (verdict: BootBudgetVerdict): string => {
  if (verdict.withinBudget) {
    return 'OK'
  }
  return 'OVER'
}

const formatMissingPhases = (verdict: BootBudgetVerdict): string => {
  if (verdict.missingPhases.length === EMPTY_COUNT) {
    return ''
  }
  return ` missing=[${verdict.missingPhases.join(', ')}]`
}

const formatOverrunPhases = (verdict: BootBudgetVerdict): string => {
  if (verdict.overrunPhases.length === EMPTY_COUNT) {
    return ''
  }
  return ` over=[${verdict.overrunPhases
    .map((overrun) => `${overrun.phase}+${overrun.overByMillis.toFixed(DISPLAY_DECIMAL_PLACES)}ms`)
    .join(', ')}]`
}

export const describeBootVerdict = (verdict: BootBudgetVerdict): string => {
  const headline = `boot ${verdict.totalMillis.toFixed(DISPLAY_DECIMAL_PLACES)}ms / ${String(BOOT_BUDGET_MILLIS)}ms budget`
  const status = formatBootStatus(verdict)
  const missing = formatMissingPhases(verdict)
  const overruns = formatOverrunPhases(verdict)

  return `${status} ${headline}${missing}${overruns}`
}
