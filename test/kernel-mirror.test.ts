/**
 * The kernel mirror is pinned against kernel's documented shape.
 *
 * ---------------------------------------------------------------------------
 * What this file is defending against
 * ---------------------------------------------------------------------------
 *
 * `domain/kernel-vocabulary.ts` is a temporary local copy of
 * `@nerima-games/mc-kernel`, and its header promises that deleting it and
 * repointing every import at the published package will typecheck. Nothing
 * enforced that promise, and mc-sim's copy of the same mirror had already
 * broken it: its `ClockService` carried ONE field where kernel's
 * (`mc-kernel/domain/clock.ts:43-48`) carries two.
 *
 * That divergence is invisible to `tsc` and fatal at runtime, because
 * `ClockPort` is a `Context.Tag` and Effect resolves Tags BY THEIR TEXTUAL KEY.
 * Every mirror uses `'@nerima-games/mc-kernel/ClockPort'`, so in a bundle
 * holding two of them — and this repository depends on mc-sim — the narrow
 * mirror's `Layer` satisfies the wide mirror's tag and `wallClockEpochMillis`
 * reads `undefined`. The two classes are nominally distinct types denoting one
 * service, so the type checker has nothing to say about it.
 *
 * The shape is therefore asserted here in both directions, at compile time and
 * at runtime, and the tag key literally. A future narrowing OR widening of the
 * mirror fails CI instead of a frame.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  fixedClock,
  MonotonicTimeSecs,
  monotonicSecs,
  StageId,
  wallClockEpochMillis,
  WorldId,
  type ClockService,
  type FrameServices,
} from '../src/domain/kernel-vocabulary'

/**
 * Kernel's `ClockService`, restated from `mc-kernel/domain/clock.ts:43-48`.
 *
 * Written out rather than imported because mc-kernel is not published — which
 * is the same reason the mirror exists at all. When it is published this alias
 * becomes an import and the assertions below keep their meaning unchanged.
 */
type KernelClockService = {
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

/** Kernel's documented `FixedClockLayer` signature, same source, lines 68-71. */
type KernelFixedClockLayer = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}) => Layer.Layer<ClockPort>

const instant = {
  monotonicSecs: MonotonicTimeSecs(1_234.5),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
}

const CLOCK_SERVICE_FIELDS = ['monotonicSecs', 'wallClockEpochMillis'] as const

describe('the ClockPort mirror is kernel’s ClockPort', () => {
  // REGRESSION: the tag key is the whole hazard. Two classes built from this
  // string are one service at runtime, so every mirror must agree on the SHAPE.
  it.effect('uses kernel’s tag key verbatim, which is why the shape has to match', () =>
    Effect.sync(() => {
      expect(ClockPort.key).toBe('@nerima-games/mc-kernel/ClockPort')
    }),
  )

  it.effect('REGRESSION: the mirrored ClockService is not NARROWER than kernel’s', () =>
    Effect.sync(() => {
      const asKernel: KernelClockService = fixedClock(instant)
      expect(Object.keys(asKernel).sort()).toStrictEqual([...CLOCK_SERVICE_FIELDS])
    }),
  )

  it.effect('REGRESSION: the mirrored ClockService is not WIDER than kernel’s', () =>
    Effect.sync(() => {
      // An object literal, so excess-property checking applies in one direction
      // and missing-property checking in the other.
      const asMirror: ClockService = {
        monotonicSecs: Effect.succeed(instant.monotonicSecs),
        wallClockEpochMillis: Effect.succeed(instant.wallClockEpochMillis),
      }
      expect(Object.keys(asMirror).sort()).toStrictEqual([...CLOCK_SERVICE_FIELDS])
    }),
  )

  it.effect('REGRESSION: FixedClockLayer takes kernel’s object argument, not a bare reading', () =>
    Effect.gen(function* () {
      const asKernel: KernelFixedClockLayer = FixedClockLayer
      const asMirror: typeof FixedClockLayer = asKernel

      const readings = yield* Effect.all({
        monotonic: monotonicSecs,
        wall: wallClockEpochMillis,
      }).pipe(Effect.provide(asMirror(instant)))

      expect(readings.monotonic).toBe(1_234.5)
      expect(readings.wall).toBe(1_700_000_000_000)
    }),
  )

  // kernel aliases `FrameServices` to `ClockPort` (mc-kernel/domain/frame.ts:44)
  // and this mirror follows it, unlike the mx-* repositories' `frame-contract.ts`
  // which alias it to `never` on purpose. Pinning it here records which of the
  // two this repository is.
  it.effect('mirrors kernel’s FrameServices alias rather than narrowing it to never', () =>
    Effect.gen(function* () {
      const stage: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices> = () =>
        Effect.asVoid(monotonicSecs)

      yield* stage(DeltaTimeSecs(0.016)).pipe(Effect.provide(FixedClockLayer(instant)))
    }),
  )
})

describe('the mirrored brands are kernel’s brands', () => {
  // plan.md §3.4's [0.001, 0.05] clamp is a FRAME-LOOP concern, applied at the
  // boundary by whoever produces the delta (mc-sim's `domain/frame-timing.ts`,
  // mc-physics' `clampDeltaTime`). Kernel's brand stays loose, so this mirror's
  // must too: a stricter mirror would reject values kernel calls valid while
  // being nominally indistinguishable from kernel's own brand.
  it.effect('DeltaTimeSecs is finite and non-negative — kernel’s refinement, not the clamp', () =>
    Effect.sync(() => {
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(0.0001)).toBe(0.0001)
      expect(DeltaTimeSecs(30)).toBe(30)
      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('MonotonicTimeSecs is finite and non-negative', () =>
    Effect.sync(() => {
      expect(MonotonicTimeSecs(0)).toBe(0)
      expect(() => MonotonicTimeSecs(-1)).toThrow()
      expect(() => MonotonicTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('EpochMillis is a safe integer, so a fractional millisecond cannot be persisted', () =>
    Effect.sync(() => {
      expect(EpochMillis(0)).toBe(0)
      expect(EpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000)
      expect(() => EpochMillis(1.5)).toThrow()
      expect(() => EpochMillis(Number.MAX_SAFE_INTEGER + 2)).toThrow()
    }),
  )

  it.effect('StageId and WorldId reject blank strings, as kernel’s identifiers do', () =>
    Effect.sync(() => {
      expect(StageId('sim:physics')).toBe('sim:physics')
      expect(() => StageId('   ')).toThrow()
      expect(WorldId('overworld')).toBe('overworld')
      expect(() => WorldId('')).toThrow()
    }),
  )
})
