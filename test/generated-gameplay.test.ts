import {
  ClockPort,
  type ClockService,
  DeltaTimeSecs,
  EpochMillis,
  MonotonicTimeSecs,
  position,
} from '@nerima-games/mc-kernel'
import {
  INVENTORY_SLOT_COUNT,
  InventoryService,
  itemStack,
  PlayerService,
} from '@nerima-games/mc-sim'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Ref } from 'effect'
import { GameplayServicesLayer } from '../src/application/gameplay-services'
import {
  GeneratedGameplayWorldUnavailableError,
  inventoryOfSpawnKit,
  launchGeneratedPlayground,
  makeGeneratedSimulation,
} from '../src/application/generated-gameplay'
import {
  GeneratedWorldProviderLayer,
  WorldRuntimePort,
  type WorldRuntimeService,
} from '../src/application/generated-world-provider'
import { WorldRuntimeSnapshotError } from '../src/application/world-runtime-snapshot'
import { PlaygroundLayer } from '../src/application/playground-service'
import {
  InputPort,
  InvalidWorldSpecError,
  RendererPort,
  WorldProviderPort,
  type WorldProviderService,
} from '../src/application/preview-ports'
import {
  DEFAULT_FLAT_WORLD,
  DEFAULT_SPAWN_KIT,
} from '../src/domain/launch-options'
import { firstOf } from './support/require-present'

const clock: ClockService = {
  monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
  wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
}

const hostLayer = Layer.mergeAll(
  GameplayServicesLayer,
  GeneratedWorldProviderLayer({ terrain: { decorate: false } }),
  PlaygroundLayer,
  Layer.succeed(ClockPort, clock),
  Layer.succeed(InputPort, {
    attach: Effect.void,
    detach: Effect.void,
  }),
  Layer.succeed(RendererPort, {
    attach: Effect.void,
    detach: Effect.void,
    renderFrame: () => Effect.void,
  }),
)

describe('generated gameplay', () => {
  it.effect('launches, simulates, and closes a generated flat world', () =>
    Effect.gen(function* () {
      const runtime = yield* WorldRuntimePort
      const handle = yield* launchGeneratedPlayground({
        spawnKit: {
          ...DEFAULT_SPAWN_KIT,
          feetPosition: position(0, 8, 0),
        },
        world: {
          ...DEFAULT_FLAT_WORLD,
          radiusChunks: 0,
          surfaceY: 4,
        },
      })
      const player = yield* PlayerService
      const inventory = yield* InventoryService

      expect(yield* handle.isRunning).toBe(true)
      expect((yield* handle.cameraPose).position.y).toBeGreaterThan(7)
      expect((yield* player.pose).feetPosition.y).toBeGreaterThan(7)
      expect(yield* inventory.countOf('stone')).toBe(64)
      expect(Option.isSome(yield* runtime.current)).toBe(true)
      expect(yield* handle.persistWorld).toEqual({
        unchanged: 0,
        written: 0,
      })

      yield* handle.stop

      expect(yield* handle.isRunning).toBe(false)
      expect(yield* inventory.countOf('stone')).toBe(0)
      expect(Option.isNone(yield* runtime.current)).toBe(true)
    }).pipe(Effect.provide(hostLayer)),
  )

  it.effect('closes an opened world when no runtime is installed', () =>
    Effect.gen(function* () {
      const events = yield* Ref.make<ReadonlyArray<string>>([])
      const record = (event: string) =>
        Ref.update(events, (current) => [...current, event])
      const provider: WorldProviderService = {
        closeWorld: record('world.close'),
        openFlatWorld: () => record('world.open'),
      }
      const runtime: WorldRuntimeService = {
        current: Effect.succeed(Option.none()),
      }
      const result = yield* Effect.either(
        launchGeneratedPlayground().pipe(
          Effect.provide(
            Layer.mergeAll(
              GameplayServicesLayer,
              PlaygroundLayer,
              Layer.succeed(ClockPort, clock),
              Layer.succeed(InputPort, {
                attach: Effect.void,
                detach: Effect.void,
              }),
              Layer.succeed(RendererPort, {
                attach: Effect.void,
                detach: Effect.void,
                renderFrame: () => Effect.void,
              }),
              Layer.succeed(WorldProviderPort, provider),
              Layer.succeed(WorldRuntimePort, runtime),
            ),
          ),
        ),
      )

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(GeneratedGameplayWorldUnavailableError)
      }
      expect(yield* Ref.get(events)).toEqual(['world.open', 'world.close'])
    }),
  )

  it.effect('rejects oversized and malformed spawn kits', () =>
    Effect.gen(function* () {
      const oversized = {
        ...DEFAULT_SPAWN_KIT,
        hotbar: Array.from({ length: INVENTORY_SLOT_COUNT + 1 }, () =>
          firstOf(DEFAULT_SPAWN_KIT.hotbar, 'the default spawn kit hotbar'),
        ),
      }
      const oversizedResult = yield* Effect.either(inventoryOfSpawnKit(oversized))
      expect(oversizedResult._tag).toBe('Left')
      if (oversizedResult._tag === 'Left') {
        expect(oversizedResult.left.slotIndex).toBe(INVENTORY_SLOT_COUNT)
      }

      const invalidCount = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(
        firstOf(invalidCount.hotbar, 'the invalid-count spawn kit hotbar'),
        'count',
        { value: 65 },
      )
      const invalidCountResult = yield* Effect.either(inventoryOfSpawnKit(invalidCount))
      expect(invalidCountResult._tag).toBe('Left')
      if (invalidCountResult._tag === 'Left') {
        expect(invalidCountResult.left.slotIndex).toBe(0)
      }

      const nonErrorCause = { reason: 'non-error coercion failure' }
      const nonErrorCauseKit = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(nonErrorCauseKit, 'hotbar', {
        get: () => {
          // oxlint-disable-next-line no-throw-literal -- this deliberately tests non-Error cause normalization.
          throw nonErrorCause
        },
      })
      const nonErrorCauseResult = yield* Effect.either(
        inventoryOfSpawnKit(nonErrorCauseKit),
      )
      expect(nonErrorCauseResult._tag).toBe('Left')
      if (nonErrorCauseResult._tag === 'Left') {
        expect(nonErrorCauseResult.left.message).toContain(
          String(nonErrorCause),
        )
      }

      const malformed = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(malformed, 'hotbar', { value: undefined })
      const malformedResult = yield* Effect.either(inventoryOfSpawnKit(malformed))
      expect(malformedResult._tag).toBe('Left')
      if (malformedResult._tag === 'Left') {
        expect(malformedResult.left.slotIndex).toBe(-1)
      }
    }),
  )

  it.effect('preserves the launch failure when world cleanup also fails', () =>
    Effect.gen(function* () {
      const events = yield* Ref.make<ReadonlyArray<string>>([])
      const record = (event: string) =>
        Ref.update(events, (current) => [...current, event])
      const provider: WorldProviderService = {
        closeWorld: record('world.close').pipe(
          Effect.zipRight(
            Effect.fail(
              new InvalidWorldSpecError({
                field: 'worldId',
                message: 'close failed',
                value: 'test-world',
              }),
            ),
          ),
        ),
        openFlatWorld: () => record('world.open'),
      }
      const runtime: WorldRuntimeService = {
        current: Effect.succeed(Option.none()),
      }
      const result = yield* Effect.either(
        launchGeneratedPlayground().pipe(
          Effect.provide(
            Layer.mergeAll(
              GameplayServicesLayer,
              PlaygroundLayer,
              Layer.succeed(ClockPort, clock),
              Layer.succeed(InputPort, {
                attach: Effect.void,
                detach: Effect.void,
              }),
              Layer.succeed(RendererPort, {
                attach: Effect.void,
                detach: Effect.void,
                renderFrame: () => Effect.void,
              }),
              Layer.succeed(WorldProviderPort, provider),
              Layer.succeed(WorldRuntimePort, runtime),
            ),
          ),
        ),
      )

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(GeneratedGameplayWorldUnavailableError)
      }
      expect(yield* Ref.get(events)).toEqual(['world.open', 'world.close'])
    }),
  )

  it.effect('fails if the initial inventory cannot fit in the player inventory', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService
      const inventory = yield* InventoryService
      const initialInventory = {
        slots: Array.from({ length: INVENTORY_SLOT_COUNT + 1 }, (_, index) =>
          index === INVENTORY_SLOT_COUNT ? itemStack('dirt', 1) : itemStack('stone', 64),
        ),
      }
      const simulation = makeGeneratedSimulation({
        clock,
        closeWorldSync: Effect.void,
        dimension: 'overworld',
        initialInventory,
        inventory,
        player,
        syncWorld: Effect.void,
      })
      yield* simulation.tick(DeltaTimeSecs(0))
      const result = yield* Effect.exit(simulation.spawn(DEFAULT_SPAWN_KIT))

      expect(result._tag).toBe('Failure')
    }).pipe(Effect.provide(GameplayServicesLayer)),
  )

  it.effect('turns world synchronization failures into simulation defects', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService
      const inventory = yield* InventoryService
      const simulation = makeGeneratedSimulation({
        clock,
        closeWorldSync: Effect.void,
        dimension: 'overworld',
        initialInventory: { slots: [] },
        inventory,
        player,
        syncWorld: Effect.fail(
          new WorldRuntimeSnapshotError({ reason: 'loaded-set-changed' }),
        ),
      })

      const result = yield* Effect.exit(simulation.tick(DeltaTimeSecs(0)))

      expect(result._tag).toBe('Failure')
    }).pipe(Effect.provide(GameplayServicesLayer)),
  )
})
