import {
  AIR_BLOCK_ID,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  MonotonicTimeSecs,
  position,
} from '@nerima-games/mc-kernel'
import { PlayerService, SIM_STAGE_IDS, TimeService } from '@nerima-games/mc-sim'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Ref } from 'effect'
import { GameplayServicesLayer } from '../src/application/gameplay-services'
import {
  GAMEPLAY_STAGE_IDS,
  gameplayPhysicsConfigFor,
  makeGameplayPreview,
  makeGameplayPreviewFromWorldRuntime,
} from '../src/application/gameplay-preview'
import {
  GeneratedWorldProviderLayer,
  WorldRuntimePort,
} from '../src/application/generated-world-provider'
import { WorldProviderPort } from '../src/application/preview-ports'
import {
  blockAt,
  emptyBlockWorld,
  setBlockAt,
} from '../src/domain/block-interaction'
import { DEFAULT_FLAT_WORLD, flattenStages } from '../src/domain/launch-options'
import { firstOf } from './support/require-present'

const at = (x: number, y = 0, z = 0) => blockPosition(x, y, z)

describe('gameplay preview', () => {
  it('keeps physics collision reads connected to a live block source', () => {
    let world = emptyBlockWorld()
    const config = gameplayPhysicsConfigFor((point) => blockAt(world, point))

    expect(config.resolve.blockPropertiesAt(0, 0, 0)).toBeNull()
    world = setBlockAt(world, at(0), blockIdOf('stone'))
    expect(config.resolve.blockPropertiesAt(0, 0, 0)?.collisionShape).toBe('full')
  })

  it.effect('composes mc-sim and local mechanics into one deterministic frame boundary', () =>
    Effect.gen(function* () {
      const world = setBlockAt(emptyBlockWorld(), at(0), blockIdOf('water'))
      const preview = yield* makeGameplayPreview(world)
      expect(yield* preview.world).toEqual(world)
      const stages = yield* flattenStages([preview.module])

      expect(stages.map((stage) => stage.id)).toEqual([
        SIM_STAGE_IDS.physics,
        GAMEPLAY_STAGE_IDS.worldMechanics,
      ])
      expect(preview.simulation.stages).toHaveLength(2)
      expect(preview.simulation.stages[0]?.id).toBe(SIM_STAGE_IDS.physics)
      expect(preview.simulation.stages[1]?.id).toBe(GAMEPLAY_STAGE_IDS.worldMechanics)
      expect(stages[1]?.after).toEqual([SIM_STAGE_IDS.physics])

      const clock = {
        monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
        wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
      }
      for (const stage of stages) {
        yield* stage.run(DeltaTimeSecs(0.05)).pipe(
          Effect.provideService(ClockPort, clock),
        )
      }

      const time = yield* TimeService
      expect(yield* time.timeOfDay).toBeGreaterThan(0)
      expect((yield* Ref.get(preview.mechanics)).world.get(
        blockPositionKeyOf(at(0, -1)),
      )).toBe(blockIdOf('water'))
    }).pipe(Effect.provide(GameplayServicesLayer)),
  )

  it.effect('resolves the player against the supplied block world', () =>
    Effect.gen(function* () {
      const world = setBlockAt(emptyBlockWorld(), at(0), blockIdOf('stone'))
      const preview = yield* makeGameplayPreview(world)
      const player = yield* PlayerService
      yield* player.moveTo(position(0, 3, 0))

      const physicsStage = firstOf(preview.simulation.stages, 'the preview physics stage')

      const clock = {
        monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
        wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
      }
      for (let frame = 0; frame < 40; frame += 1) {
        yield* physicsStage.run(DeltaTimeSecs(0.05)).pipe(
          Effect.provideService(ClockPort, clock),
        )
      }

      const pose = yield* player.pose
      expect(pose.feetPosition.y).toBeCloseTo(1)
      expect(yield* Ref.get(preview.simulation.state.isGrounded)).toBe(true)
      }).pipe(Effect.provide(GameplayServicesLayer)),
  )

  it.effect('builds gameplay against a generated world runtime snapshot', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      yield* provider.openFlatWorld({
        ...DEFAULT_FLAT_WORLD,
        radiusChunks: 0,
        surfaceY: 4,
      })

      const opened = yield* runtime.current
      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const preview = yield* makeGameplayPreviewFromWorldRuntime(opened.value)
      const player = yield* PlayerService
      yield* player.moveTo(position(0, 8, 0))

      const physicsStage = firstOf(preview.simulation.stages, 'the preview physics stage')
      const clock = {
        monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
        wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
      }
      for (let frame = 0; frame < 40; frame += 1) {
        yield* physicsStage.run(DeltaTimeSecs(0.05)).pipe(
          Effect.provideService(ClockPort, clock),
        )
      }

      const pose = yield* player.pose
      expect(pose.feetPosition.y).toBeCloseTo(5)
      expect(yield* Ref.get(preview.simulation.state.isGrounded)).toBe(true)
      yield* preview.close
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          GameplayServicesLayer,
          GeneratedWorldProviderLayer({ terrain: { decorate: false } }),
        ),
      ),
    ),
  )

  it.effect('merges dirty generated chunks with local gameplay edits', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      yield* provider.openFlatWorld({
        ...DEFAULT_FLAT_WORLD,
        radiusChunks: 0,
        surfaceY: 4,
      })

      const opened = yield* runtime.current
      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const preview = yield* makeGameplayPreviewFromWorldRuntime(opened.value)
      yield* preview.syncWorld

      const remotePosition = at(0, 20, 0)
      const localPosition = at(1, 20, 0)
      yield* opened.value.chunks.setBlock(remotePosition, blockIdOf('stone'))
      yield* preview.syncWorld
      const firstMerged = yield* preview.world
      expect(blockAt(firstMerged, remotePosition)).toBe(blockIdOf('stone'))

      yield* Ref.update(preview.mechanics, (state) => ({
        ...state,
        world: setBlockAt(state.world, localPosition, blockIdOf('dirt')),
      }))
      yield* opened.value.chunks.setBlock(remotePosition, blockIdOf('water'))
      yield* preview.syncWorld

      let merged = yield* preview.world
      expect(blockAt(merged, localPosition)).toBe(blockIdOf('dirt'))
      expect(blockAt(merged, remotePosition)).toBe(blockIdOf('water'))

      const [coord] = yield* opened.value.chunks.loadedCoords
      if (coord === undefined) {
        throw new Error('generated world had no loaded chunk')
      }
      expect(yield* opened.value.chunks.unload(coord)).toBe(true)
      yield* preview.syncWorld
      merged = yield* preview.world
      expect(blockAt(merged, localPosition)).toBe(blockIdOf('dirt'))
      expect(blockAt(merged, remotePosition)).toBe(AIR_BLOCK_ID)
      yield* preview.close
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          GameplayServicesLayer,
          GeneratedWorldProviderLayer({ terrain: { decorate: false } }),
        ),
      ),
    ),
  )
})
