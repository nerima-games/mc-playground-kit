import {
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  MonotonicTimeSecs,
  StageId,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref, Schema } from 'effect'
import * as fc from 'fast-check'
import assert from 'node:assert/strict'
import { flattenStages } from '../src/domain/launch-options'
import { firstOf } from './support/require-present'
import {
  advanceWorldMechanics,
  emptyBlockWorld,
  emptyFluidState,
  emptyRedstoneState,
  makeWorldMechanicsStage,
  makeWorldMechanicsPreview,
  setBlockAt,
  type WorldMechanicsState,
  worldMechanicsStateFromWorld,
} from '../src/domain/block-interaction'

const at = (x: number, y = 0, z = 0) => blockPosition(x, y, z)

const stageValue = (result: ReturnType<typeof makeWorldMechanicsStage>) => {
  assert(result._tag === 'Valid')
  return result.value
}

describe('world mechanics stage', () => {
  it('advances fluid and redstone updates through one immutable state boundary', () => {
    const source = at(0)
    const water = blockIdOf('water')
    const redstoneSource = at(4)
    const wire = at(5)
    const lamp = at(6)
    const world = setBlockAt(
      setBlockAt(
        setBlockAt(
          setBlockAt(emptyBlockWorld(), source, water),
          redstoneSource,
          blockIdOf('redstone_block'),
        ),
        wire,
        blockIdOf('redstone_wire'),
      ),
      lamp,
      blockIdOf('redstone_lamp'),
    )

    const current = worldMechanicsStateFromWorld(world)
    const result = advanceWorldMechanics(current)

    expect(result.fluids.changes).toContainEqual(
      expect.objectContaining({
        after: water,
        falling: true,
        position: at(0, -1),
      }),
    )
    expect(result.redstone.changes).toContainEqual(
      expect.objectContaining({
        after: blockIdOf('redstone_lamp_lit'),
        kind: 'lamp-state',
        position: lamp,
      }),
    )
    expect(result.state.world).toBe(result.redstone.world)
    expect(result.state.fluids).toBe(result.fluids.state)
    expect(result.state.redstone).toBe(result.redstone.state)
    expect(result.state.world.get(blockPositionKeyOf(lamp))).toBe(
      blockIdOf('redstone_lamp_lit'),
    )
    expect(current.world).toBe(world)
  })

  it.effect('runs atomically in the frame contract with optional ordering', () =>
    Effect.gen(function* () {
      const empty = emptyBlockWorld()
      const explicitFluids = emptyFluidState()
      const explicitRedstone = emptyRedstoneState()
      const explicit = worldMechanicsStateFromWorld(
        empty,
        explicitFluids,
        explicitRedstone,
      )
      expect(explicit.fluids).toBe(explicitFluids)
      expect(explicit.redstone).toBe(explicitRedstone)

      const withAfter = yield* Ref.make(worldMechanicsStateFromWorld(empty))
      const after = StageId('input:sample')
      const stage = stageValue(makeWorldMechanicsStage(withAfter, {
        after: [after],
        id: StageId('world:mechanics'),
      }))
      expect(stage.after).toEqual([after])
      yield* stage.run(DeltaTimeSecs(0)).pipe(
        Effect.provideService(ClockPort, {
          monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
          wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
        }),
      )
      expect((yield* Ref.get(withAfter)).world).toBe(empty)

      const withoutAfter = yield* Ref.make(worldMechanicsStateFromWorld(empty))
      const standalone = stageValue(makeWorldMechanicsStage(withoutAfter, {
        id: StageId('world:mechanics:standalone'),
      }))
      expect(standalone.after).toBeUndefined()
      yield* standalone.run(DeltaTimeSecs(0)).pipe(
        Effect.provideService(ClockPort, {
          monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
          wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
        }),
      )
      expect((yield* Ref.get(withoutAfter)).world).toBe(empty)
    }),
  )

  it.effect('accumulates frame time and advances by fixed ticks', () =>
    Effect.gen(function* () {
      const world = setBlockAt(
        emptyBlockWorld(),
        at(0),
        blockIdOf('water'),
      )
      const current = worldMechanicsStateFromWorld(world)
      const state = yield* Ref.make(current)
      let observed: WorldMechanicsState | undefined = undefined
      const stage = stageValue(makeWorldMechanicsStage(state, {
        id: StageId('world:mechanics:fixed'),
        onStateChange: (next) => {
          observed = next
        },
        tickIntervalSecs: 1,
      }))
      const clock = {
        monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
        wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
      }

      yield* stage.run(DeltaTimeSecs(0.4)).pipe(
        Effect.provideService(ClockPort, clock),
      )
      expect((yield* Ref.get(state)).world).toBe(world)

      yield* stage.run(DeltaTimeSecs(0.6)).pipe(
        Effect.provideService(ClockPort, clock),
      )
      const afterOneTick = yield* Ref.get(state)
      const expectedAfterOneTick = advanceWorldMechanics(current).state
      expect(afterOneTick).toEqual(expectedAfterOneTick)
      expect(observed).toBe(afterOneTick)

      yield* stage.run(DeltaTimeSecs(2)).pipe(
        Effect.provideService(ClockPort, clock),
      )
      const expectedAfterThreeTicks = advanceWorldMechanics(
        advanceWorldMechanics(expectedAfterOneTick).state,
      ).state
      expect(yield* Ref.get(state)).toEqual(expectedAfterThreeTicks)
    }),
  )

  it.effect('exposes the stage through the preview module contract', () =>
    Effect.gen(function* () {
      const world = setBlockAt(
        emptyBlockWorld(),
        at(0),
        blockIdOf('water'),
      )
      const preview = yield* makeWorldMechanicsPreview(world, {
        id: StageId('world:mechanics:preview'),
        tickIntervalSecs: 1,
      })
      const stages = yield* flattenStages([preview.module])
      expect(stages).toHaveLength(1)
      const stage = firstOf(stages, 'the flattened stage')
      expect(stage.id).toBe(StageId('world:mechanics:preview'))

      yield* stage.run(DeltaTimeSecs(1)).pipe(
        Effect.provideService(ClockPort, {
          monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
          wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
        }),
      )

      expect(yield* Ref.get(preview.state)).toEqual(
        advanceWorldMechanics(worldMechanicsStateFromWorld(world)).state,
      )
    }),
  )

  it('rejects a non-positive or non-finite tick interval', () => {
    const state = Ref.unsafeMake(worldMechanicsStateFromWorld(emptyBlockWorld()))
    const zero = makeWorldMechanicsStage(state, {
      id: StageId('world:mechanics:invalid-zero'),
      tickIntervalSecs: 0,
    })
    const nan = makeWorldMechanicsStage(state, {
      id: StageId('world:mechanics:invalid-nan'),
      tickIntervalSecs: Number.NaN,
    })

    expect(zero._tag).toBe('Invalid')
    expect(nan._tag).toBe('Invalid')
    if (zero._tag === 'Invalid') {
      expect(zero.error[0]?.message).toBe('tickIntervalSecs must be a finite positive number')
    }
    expect(makeWorldMechanicsStage(state, {
      id: StageId('world:mechanics:invalid-negative'),
      tickIntervalSecs: -Number.MIN_VALUE,
    })._tag).toBe('Invalid')
    expect(makeWorldMechanicsStage(state, {
      id: StageId('world:mechanics:invalid-infinity'),
      tickIntervalSecs: Number.POSITIVE_INFINITY,
    })._tag).toBe('Invalid')
    expect(makeWorldMechanicsStage(state, {
      id: StageId('world:mechanics:min-positive'),
      tickIntervalSecs: Number.MIN_VALUE,
    })._tag).toBe('Valid')
  })

  it('property-checks tick interval validation and schema-decodes valid stages', () => {
    const state = Ref.unsafeMake(worldMechanicsStateFromWorld(emptyBlockWorld()))
    const runSchema = Schema.declare<StageRegistration['run']>(
      (input): input is StageRegistration['run'] => typeof input === 'function',
    )
    const stageSchema = Schema.Struct({
      after: Schema.optional(Schema.Array(Schema.String)),
      id: Schema.String,
      run: runSchema,
    })

    fc.assert(fc.property(fc.double(), (interval) => {
      const result = makeWorldMechanicsStage(state, {
        id: StageId('world:mechanics:property'),
        tickIntervalSecs: interval,
      })
      const accepted = Number.isFinite(interval) && interval > 0

      expect(result._tag).toBe(accepted ? 'Valid' : 'Invalid')
      if (result._tag === 'Valid') {
        expect(Schema.decodeUnknownOption(stageSchema)(result.value)._tag).toBe('Some')
      }
    }))
  })
})
