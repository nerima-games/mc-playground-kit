/**
 * The boot budget.
 *
 * plan.md §3.10 states this repository's requirement as a time — one second —
 * and says 全プレビューの開発体験がここの起動速度と安定性に依存する. A requirement
 * that is a number needs a test that is an assertion about that number, or it is
 * an aspiration.
 *
 * Per `docs/testing.md`, budget figures are asserted as LITERALS. A test whose
 * both sides read `BOOT_BUDGET_MILLIS` stays green while somebody raises it to
 * five seconds, which is the only change this file exists to notice.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  BOOT_BUDGET_MILLIS,
  BOOT_PHASE_BUDGET_MILLIS,
  BOOT_PHASE_ORDER,
  DurationMillis,
  classifyBootTimings,
  describeBootVerdict,
  elapsedMillis,
  type BootPhase,
  type PhaseTiming,
} from '../src/domain/boot-phase'

const timing = (phase: BootPhase, durationMillis: number): PhaseTiming => ({
  phase,
  durationMillis: DurationMillis(durationMillis),
})

/** A complete boot in which every phase costs exactly its allowance. */
const exactlyOnBudget: ReadonlyArray<PhaseTiming> = BOOT_PHASE_ORDER.map((phase) =>
  timing(phase, BOOT_PHASE_BUDGET_MILLIS[phase]),
)

/** A complete boot that is comfortably fast. */
const fastBoot: ReadonlyArray<PhaseTiming> = BOOT_PHASE_ORDER.map((phase) => timing(phase, 1))

describe('the budget itself', () => {
  it.effect('is one second — plan.md §3.10 「1秒で起動」', () =>
    Effect.sync(() => {
      expect(BOOT_BUDGET_MILLIS).toBe(1000)
    }),
  )

  it.effect('the per-phase allowances sum to exactly the total', () =>
    Effect.sync(() => {
      // Without this, a phase can be given more room by nobody in particular and
      // the total quietly becomes advisory.
      const sum = BOOT_PHASE_ORDER.reduce((total, phase) => total + BOOT_PHASE_BUDGET_MILLIS[phase], 0)

      expect(sum).toBe(1000)
    }),
  )

  it.effect('every phase has an allowance, and every allowance has a phase', () =>
    Effect.sync(() => {
      expect(Object.keys(BOOT_PHASE_BUDGET_MILLIS).sort()).toStrictEqual([...BOOT_PHASE_ORDER].sort())
      expect(BOOT_PHASE_ORDER).toHaveLength(7)
    }),
  )

  it.effect('the order is causal: options, then world, then sim, then render, then input', () =>
    Effect.sync(() => {
      expect([...BOOT_PHASE_ORDER]).toStrictEqual([
        'resolve-options',
        'world',
        'simulation',
        'renderer',
        'input',
        'modules',
        'first-frame',
      ])
    }),
  )

  it.effect('input is a phase of its own, however cheap — plan.md §2.3-2', () =>
    Effect.sync(() => {
      // Ownership of the runtime input service is the constitutional rule of
      // this repository. A line item with a name and a number is harder to
      // quietly reimplement locally than a step folded into `renderer`.
      expect(BOOT_PHASE_ORDER).toContain('input')
      expect(BOOT_PHASE_BUDGET_MILLIS.input).toBeGreaterThan(0)
    }),
  )

  it.effect('the two heavyweight phases are world and renderer', () =>
    Effect.sync(() => {
      expect(BOOT_PHASE_BUDGET_MILLIS.world).toBe(400)
      expect(BOOT_PHASE_BUDGET_MILLIS.renderer).toBe(300)
      expect(BOOT_PHASE_BUDGET_MILLIS['resolve-options']).toBe(5)
    }),
  )

  it.effect('REGRESSION: the whole budget is smaller than the reference session could ever be', () =>
    Effect.sync(() => {
      // ts-minecraft/packages/app/application/main/session-loading-gates-state.ts:1
      //   const MIN_LOADING_SCREEN_DURATION_MS = 2500
      // and session-lifecycle-startup.ts:104-105 waits on a frame-rate gate
      // (10 consecutive 100ms samples at 120fps, 8s timeout) BEFORE hiding the
      // loading screen. A preview cannot inherit that path and be relaunched
      // dozens of times an hour, which is the entire reason this repository is
      // separate from the shipped session bootstrap.
      const REFERENCE_MIN_LOADING_SCREEN_MS = 2500

      expect(BOOT_BUDGET_MILLIS).toBeLessThan(REFERENCE_MIN_LOADING_SCREEN_MS)
    }),
  )
})

describe('elapsedMillis', () => {
  it.effect('converts an interval in seconds to a duration in milliseconds', () =>
    Effect.sync(() => {
      expect(elapsedMillis(10, 10.25)).toBe(250)
      expect(elapsedMillis(0, 1)).toBe(1000)
      expect(elapsedMillis(5, 5)).toBe(0)
    }),
  )

  it.effect('clamps a backwards interval to zero rather than reporting a negative boot', () =>
    Effect.sync(() => {
      // MonotonicTimeSecs promises not to go backwards, but a test clock, a
      // replayed trace or a mis-stamped worker message can hand over a pair in
      // the wrong order. A negative duration makes a slow boot look fast, which
      // is worse than reporting zero.
      expect(elapsedMillis(10, 9)).toBe(0)
    }),
  )

  it.effect('REGRESSION: a non-finite reading is a zero, not a defect that kills the launch', () =>
    Effect.sync(() => {
      // `elapsedMillis` takes bare `number`s, not `MonotonicTimeSecs`, and
      // domain/kernel-vocabulary.ts documents at length that a NARROWER mirror
      // of the Clock Port satisfies the same Tag at run time with fields
      // reading `undefined` — and `undefined - undefined` is NaN. Since
      // `DurationMillis` is a Brand.refined constructor requiring
      // `Number.isFinite(value) && value >= 0` (see the DurationMillis
      // describe below), an unguarded conversion THREW, inside `phase()`,
      // inside a `launch` typed `Effect<PlaygroundHandle, never, ...>`. The
      // error channel says a launch cannot fail; a defect is not in the error
      // channel, so the launch died instead of reporting a number.
      expect(elapsedMillis(0, Number.NaN)).toBe(0)
      expect(elapsedMillis(Number.NaN, 0)).toBe(0)
      expect(elapsedMillis(0, Number.POSITIVE_INFINITY)).toBe(0)
      expect(elapsedMillis(Number.NEGATIVE_INFINITY, 0)).toBe(0)
      expect(elapsedMillis(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0)

      // Zero and not an invented large duration: a fabricated number would make
      // `classifyBootTimings` name a specific phase as overrunning by a
      // specific amount, sending somebody to optimise work that was never
      // measured. Zero says only what the backwards clamp above already says.
      expect(() => elapsedMillis(0, Number.NaN)).not.toThrow()
    }),
  )
})

describe('classifyBootTimings', () => {
  it.effect('a complete, fast boot is within budget', () =>
    Effect.sync(() => {
      const verdict = classifyBootTimings(fastBoot)

      expect(verdict.withinBudget).toBe(true)
      expect(verdict.totalMillis).toBe(7)
      expect(verdict.overBudgetMillis).toBe(0)
      expect(verdict.missingPhases).toStrictEqual([])
      expect(verdict.overrunPhases).toStrictEqual([])
    }),
  )

  it.effect('spending exactly the allowance is within budget — the bound is inclusive', () =>
    Effect.sync(() => {
      const verdict = classifyBootTimings(exactlyOnBudget)

      expect(verdict.totalMillis).toBe(1000)
      expect(verdict.withinBudget).toBe(true)
      expect(verdict.overrunPhases).toStrictEqual([])
    }),
  )

  it.effect('one millisecond more is over', () =>
    Effect.sync(() => {
      const verdict = classifyBootTimings([
        ...exactlyOnBudget.filter((entry) => entry.phase !== 'world'),
        timing('world', 401),
      ])

      expect(verdict.withinBudget).toBe(false)
      expect(verdict.totalMillis).toBe(1001)
      expect(verdict.overBudgetMillis).toBe(1)
      expect(verdict.overrunPhases.map((overrun) => overrun.phase)).toStrictEqual(['world'])
    }),
  )

  it.effect('REGRESSION: a missing phase is NOT "under budget" — it is unjudged', () =>
    Effect.sync(() => {
      // Without this rule the fastest boot is the one that does nothing, and the
      // metric rewards deleting work instead of speeding it up. A boot that
      // never attached a renderer is very fast and completely uninformative.
      const verdict = classifyBootTimings(fastBoot.filter((entry) => entry.phase !== 'renderer'))

      expect(verdict.totalMillis).toBe(6)
      expect(verdict.withinBudget).toBe(false)
      expect(verdict.missingPhases).toStrictEqual(['renderer'])
    }),
  )

  it.effect('an empty timing list is every phase missing, not a perfect boot', () =>
    Effect.sync(() => {
      const verdict = classifyBootTimings([])

      expect(verdict.withinBudget).toBe(false)
      expect(verdict.totalMillis).toBe(0)
      expect(verdict.missingPhases).toStrictEqual([...BOOT_PHASE_ORDER])
    }),
  )

  it.effect('reports a phase over ITS OWN allowance even when the total is fine', () =>
    Effect.sync(() => {
      // The case the total cannot see: `world` at more than double its
      // allowance, absorbed by a renderer that happened to be fast. It fits
      // today and will not fit as soon as the world grows, and the per-phase
      // line is the only place that is visible.
      const verdict = classifyBootTimings([
        timing('resolve-options', 1),
        timing('world', 900),
        timing('simulation', 10),
        timing('renderer', 10),
        timing('input', 1),
        timing('modules', 1),
        timing('first-frame', 10),
      ])

      expect(verdict.totalMillis).toBe(933)
      expect(verdict.withinBudget).toBe(true)
      expect(verdict.overrunPhases).toHaveLength(1)
      expect(verdict.overrunPhases[0]?.phase).toBe('world')
      expect(verdict.overrunPhases[0]?.budgetMillis).toBe(400)
      expect(verdict.overrunPhases[0]?.overByMillis).toBe(500)
    }),
  )

  it.effect('lists overrunning phases in boot order, not in the order they were reported', () =>
    Effect.sync(() => {
      const verdict = classifyBootTimings([
        timing('first-frame', 500),
        timing('world', 500),
        timing('resolve-options', 500),
        timing('simulation', 500),
        timing('renderer', 500),
        timing('input', 500),
        timing('modules', 500),
      ])

      // 500 ms exceeds every phase's allowance (the largest is world's 400), so
      // all seven overrun and the list is BOOT_PHASE_ORDER exactly — which is
      // what makes this a test of the ordering rather than of the threshold.
      expect(verdict.overrunPhases.map((overrun) => overrun.phase)).toStrictEqual([...BOOT_PHASE_ORDER])
    }),
  )

  it.effect('sums duplicate timings for a phase rather than taking the first', () =>
    Effect.sync(() => {
      // A phase that ran twice really did cost twice. Hiding a retry behind a
      // first-wins rule is the same error as ignoring a missing phase, in the
      // other direction.
      const verdict = classifyBootTimings([
        ...fastBoot,
        timing('world', 700),
      ])

      expect(verdict.totalMillis).toBe(707)
      expect(verdict.missingPhases).toStrictEqual([])
      expect(verdict.overrunPhases[0]?.durationMillis).toBe(701)
    }),
  )
})

describe('describeBootVerdict', () => {
  it.effect('says OK and shows the total against the budget', () =>
    Effect.sync(() => {
      const line = describeBootVerdict(classifyBootTimings(fastBoot))

      expect(line).toContain('OK')
      expect(line).toContain('7.0ms / 1000ms budget')
    }),
  )

  it.effect('says OVER and names both the missing and the overrunning phases', () =>
    Effect.sync(() => {
      // The budget only changes behaviour if somebody sees it, so this string is
      // logged on every boot (application/playground.ts) rather than waiting to
      // be asked for.
      const line = describeBootVerdict(
        classifyBootTimings([timing('world', 2000), timing('resolve-options', 1)]),
      )

      expect(line).toContain('OVER')
      expect(line).toContain('missing=[')
      expect(line).toContain('renderer')
      expect(line).toContain('over=[world+1600.0ms]')
    }),
  )
})

describe('DurationMillis', () => {
  it.effect('rejects a negative or non-finite duration', () =>
    Effect.sync(() => {
      expect(DurationMillis.option(-1)._tag).toBe('None')
      expect(DurationMillis.option(Number.NaN)._tag).toBe('None')
      expect(DurationMillis.option(Number.POSITIVE_INFINITY)._tag).toBe('None')
      expect(DurationMillis.option(0)._tag).toBe('Some')
      expect(DurationMillis.option(0.5)._tag).toBe('Some')
    }),
  )
})
