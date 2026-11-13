/**
 * The boot budget.
 *
 * The repository's startup requirement is a time — one second —
 * and says 全プレビューの開発体験がここの起動速度と安定性に依存する. A requirement
 * that is a number needs a test that is an assertion about that number, or it is
 * an aspiration.
 *
 * Per `docs/testing.md`, budget figures are asserted as LITERALS. A test whose
 * both sides read `BOOT_BUDGET_MILLIS` stays green while somebody raises it to
 * five seconds, which is the only change this file exists to notice.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import * as fc from 'fast-check'
import assert from 'node:assert/strict'
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

const durationValue = (value: number) => {
  const result = DurationMillis(value)
  assert(result._tag === 'Valid')
  return result.value
}

const timing = (phase: BootPhase, durationMillis: number): PhaseTiming => ({
  phase,
  durationMillis: durationValue(durationMillis),
})

const verdictOf = (timings: ReadonlyArray<PhaseTiming>) => {
  const result = classifyBootTimings(timings)
  assert(result._tag === 'Valid')
  return result.value
}

/** A complete boot in which every phase costs exactly its allowance. */
const exactlyOnBudget: ReadonlyArray<PhaseTiming> = BOOT_PHASE_ORDER.map((phase) =>
  timing(phase, BOOT_PHASE_BUDGET_MILLIS[phase]),
)

/** A complete boot that is comfortably fast. */
const fastBoot: ReadonlyArray<PhaseTiming> = BOOT_PHASE_ORDER.map((phase) => timing(phase, 1))

describe('the budget itself', () => {
  it.effect('is one second — the public startup target 「1秒で起動」', () =>
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

  it.effect('input is a phase of its own, however cheap', () =>
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
      // The reference loading screen used a 2500 ms minimum.
      //   const MIN_LOADING_SCREEN_DURATION_MS = 2500
      // A longer loading-screen or frame-rate gate would exceed this harness's
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
      expect(elapsedMillis(10, 10.25)).toStrictEqual({ _tag: 'Valid', value: 250 })
      expect(elapsedMillis(0, 1)).toStrictEqual({ _tag: 'Valid', value: 1000 })
      expect(elapsedMillis(5, 5)).toStrictEqual({ _tag: 'Valid', value: 0 })
    }),
  )

  it.effect('returns a typed failure for a backwards interval', () =>
    Effect.sync(() => {
      const result = elapsedMillis(10, 9)
      expect(result._tag).toBe('Invalid')
      if (result._tag === 'Invalid') {
        expect(result.error[0]?.message).toBe(
          'DurationMillis must be a finite, non-negative number of milliseconds, received -1000',
        )
      }
    }),
  )

  it.effect('returns a typed failure for non-finite clock readings', () =>
    Effect.sync(() => {
      // `elapsedMillis` takes bare `number`s, not `MonotonicTimeSecs`, and
      // an invalid runtime clock can still provide non-finite values.
      for (const [from, to] of [
        [0, Number.NaN],
        [Number.NaN, 0],
        [0, Number.POSITIVE_INFINITY],
        [Number.NEGATIVE_INFINITY, 0],
        [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      ] as const) {
        expect(elapsedMillis(from, to)._tag).toBe('Invalid')
      }
    }),
  )
})

describe('classifyBootTimings', () => {
  it.effect('property-checks finite input and schema-decodes every valid verdict', () =>
    Effect.sync(() => {
      const overrunSchema = Schema.Struct({
        budgetMillis: Schema.Number,
        durationMillis: Schema.Number,
        overByMillis: Schema.Number,
        phase: Schema.String,
      })
      const verdictSchema = Schema.Struct({
        missingPhases: Schema.Array(Schema.String),
        overBudgetMillis: Schema.Number,
        overrunPhases: Schema.Array(overrunSchema),
        totalMillis: Schema.Number,
        withinBudget: Schema.Boolean,
      })

      fc.assert(fc.property(
        fc.array(fc.tuple(fc.constantFrom(...BOOT_PHASE_ORDER), fc.integer({ min: 0, max: 100_000 })), {
          maxLength: 15,
        }),
        (entries) => {
          const result = classifyBootTimings(entries.map(([phase, duration]) => timing(phase, duration)))
          expect(result._tag).toBe('Valid')
          if (result._tag === 'Valid') {
            expect(Schema.decodeUnknownOption(verdictSchema)(result.value)._tag).toBe('Some')
          }
        },
      ))

      fc.assert(fc.property(fc.integer({ min: 2, max: 8 }), (count) => {
        const maximum = durationValue(Number.MAX_VALUE)
        const result = classifyBootTimings(
          Array.from({ length: count }, () => ({ phase: 'world' as const, durationMillis: maximum })),
        )
        expect(result._tag).toBe('Invalid')
      }))
    }),
  )

  it.effect('returns a typed failure when accepted finite timings overflow their aggregate', () =>
    Effect.sync(() => {
      const maximum = durationValue(Number.MAX_VALUE)
      const result = classifyBootTimings([
        { phase: 'world', durationMillis: maximum },
        { phase: 'world', durationMillis: maximum },
      ])

      expect(result._tag).toBe('Invalid')
      if (result._tag === 'Invalid') {
        expect(result.error[0]?.message).toBe(
          'DurationMillis must be a finite, non-negative number of milliseconds, received Infinity',
        )
      }
    }),
  )

  it.effect('rejects each invalid duration before it can cancel another phase', () =>
    Effect.sync(() => {
      for (const invalid of [-1000, Number.NaN, Number.POSITIVE_INFINITY]) {
        const timings: ReadonlyArray<{ readonly phase: BootPhase; readonly durationMillis: number }> = [
          { phase: 'world', durationMillis: durationValue(2000) },
          { phase: 'renderer', durationMillis: invalid },
        ]
        // @ts-expect-error Raw numbers are not branded DurationMillis values.
        const result = classifyBootTimings(timings)

        expect(result._tag).toBe('Invalid')
      }
    }),
  )

  it.effect('a complete, fast boot is within budget', () =>
    Effect.sync(() => {
      const verdict = verdictOf(fastBoot)

      expect(verdict.withinBudget).toBe(true)
      expect(verdict.totalMillis).toBe(7)
      expect(verdict.overBudgetMillis).toBe(0)
      expect(verdict.missingPhases).toStrictEqual([])
      expect(verdict.overrunPhases).toStrictEqual([])
    }),
  )

  it.effect('spending exactly the allowance is within budget — the bound is inclusive', () =>
    Effect.sync(() => {
      const verdict = verdictOf(exactlyOnBudget)

      expect(verdict.totalMillis).toBe(1000)
      expect(verdict.withinBudget).toBe(true)
      expect(verdict.overrunPhases).toStrictEqual([])
    }),
  )

  it.effect('one millisecond more is over', () =>
    Effect.sync(() => {
      const verdict = verdictOf([
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
      const verdict = verdictOf(fastBoot.filter((entry) => entry.phase !== 'renderer'))

      expect(verdict.totalMillis).toBe(6)
      expect(verdict.withinBudget).toBe(false)
      expect(verdict.missingPhases).toStrictEqual(['renderer'])
    }),
  )

  it.effect('an empty timing list is every phase missing, not a perfect boot', () =>
    Effect.sync(() => {
      const verdict = verdictOf([])

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
      const verdict = verdictOf([
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
      const verdict = verdictOf([
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
      const verdict = verdictOf([
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
      const line = describeBootVerdict(verdictOf(fastBoot))

      expect(line).toContain('OK')
      expect(line).toContain('7.0ms / 1000ms budget')
    }),
  )

  it.effect('says OVER and names both the missing and the overrunning phases', () =>
    Effect.sync(() => {
      // The budget only changes behaviour if somebody sees it, so this string is
      // logged on every boot (application/playground-service.ts) rather than waiting to
      // be asked for.
      const line = describeBootVerdict(
        verdictOf([timing('world', 2000), timing('resolve-options', 1)]),
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
      expect(DurationMillis(-1)._tag).toBe('Invalid')
      expect(DurationMillis(Number.NaN)._tag).toBe('Invalid')
      expect(DurationMillis(Number.POSITIVE_INFINITY)._tag).toBe('Invalid')
      expect(DurationMillis(0)._tag).toBe('Valid')
      expect(DurationMillis(0.5)._tag).toBe('Valid')
    }),
  )

  it.effect('returns typed failures outside the boundary and branded schema values at the boundary', () =>
    Effect.sync(() => {
      expect(DurationMillis(0)._tag).toBe('Valid')
      expect(DurationMillis(Number.MIN_VALUE)._tag).toBe('Valid')
      expect(DurationMillis(-Number.MIN_VALUE)._tag).toBe('Invalid')
      expect(DurationMillis(Number.NEGATIVE_INFINITY)._tag).toBe('Invalid')
      const invalid = DurationMillis(-1)
      expect(invalid._tag).toBe('Invalid')
      if (invalid._tag === 'Invalid') {
        expect(invalid.error[0]?.message).toBe(
          'DurationMillis must be a finite, non-negative number of milliseconds, received -1',
        )
      }
      const invalidObject = DurationMillis({ toString: '' })
      expect(invalidObject._tag).toBe('Invalid')
      if (invalidObject._tag === 'Invalid') {
        expect(invalidObject.error[0]?.message).toBe(
          'DurationMillis must be a finite, non-negative number of milliseconds, received object',
        )
      }
    }),
  )

  it.effect('validates generated valid and invalid inputs without changing valid values', () =>
    Effect.sync(() => {
      const validInputs = fc.double({ min: 0, max: 1_000_000, noNaN: true }).map((input) => ({
        expected: 'Valid' as const,
        input,
      }))
      const invalidInputs = fc.oneof(
        fc.double({ min: -1_000_000, max: -Number.MIN_VALUE }),
        fc.constantFrom<unknown>(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, '1', {}, true),
      ).map((input) => ({
        expected: 'Invalid' as const,
        input,
      }))

      fc.assert(fc.property(fc.oneof(validInputs, invalidInputs), ({ expected, input }) => {
        const result = DurationMillis(input)
        expect(result._tag).toBe(expected)
        if (expected === 'Valid' && result._tag === 'Valid') {
          expect(result.value).toBe(input)
        }
      }))
    }),
  )
})
