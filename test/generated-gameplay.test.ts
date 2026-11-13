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
  type HotbarSlot,
} from '../src/domain/launch-options'
import { firstOf } from './support/require-present'

const clock: ClockService = {
  monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
  wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
}

const resultOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.match(effect, {
    onFailure: (error) => ({ _tag: 'Failure' as const, error }),
    onSuccess: (value) => ({ _tag: 'Success' as const, value }),
  })

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
      const result = yield* resultOf(
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

      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(result.error).toBeInstanceOf(GeneratedGameplayWorldUnavailableError)
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
      const oversizedResult = yield* resultOf(inventoryOfSpawnKit(oversized))
      expect(oversizedResult._tag).toBe('Failure')
      if (oversizedResult._tag === 'Failure') {
        expect(oversizedResult.error.slotIndex).toBe(INVENTORY_SLOT_COUNT)
      }

      const invalidCount = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(
        firstOf(invalidCount.hotbar, 'the invalid-count spawn kit hotbar'),
        'count',
        { value: 65 },
      )
      const invalidCountResult = yield* resultOf(inventoryOfSpawnKit(invalidCount))
      expect(invalidCountResult._tag).toBe('Failure')
      if (invalidCountResult._tag === 'Failure') {
        expect(invalidCountResult.error.slotIndex).toBe(0)
      }

      const nonErrorCause = { reason: 'non-error coercion failure' }
      const nonErrorCauseKit = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(
        firstOf(nonErrorCauseKit.hotbar, 'the non-error-cause spawn kit hotbar'),
        'count',
        {
          value: {
            valueOf: (): never => {
              // oxlint-disable-next-line no-throw-literal -- this deliberately tests non-Error cause normalization.
              throw nonErrorCause
            },
          },
        },
      )
      const nonErrorCauseResult = yield* resultOf(
        inventoryOfSpawnKit(nonErrorCauseKit),
      )
      expect(nonErrorCauseResult._tag).toBe('Failure')
      if (nonErrorCauseResult._tag === 'Failure') {
        expect(nonErrorCauseResult.error.message).toContain(
          String(nonErrorCause),
        )
      }

      const primitiveCauseKit = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(
        firstOf(primitiveCauseKit.hotbar, 'the primitive-cause spawn kit hotbar'),
        'count',
        {
          value: {
            valueOf: (): never => {
              // oxlint-disable-next-line no-throw-literal -- this deliberately tests primitive cause normalization.
              throw 'primitive inventory failure'
            },
          },
        },
      )
      const primitiveCauseResult = yield* resultOf(
        inventoryOfSpawnKit(primitiveCauseKit),
      )
      expect(primitiveCauseResult._tag).toBe('Failure')
      if (primitiveCauseResult._tag === 'Failure') {
        expect(primitiveCauseResult.error.message).toBe('primitive inventory failure')
      }

      const functionCause = (): void => undefined
      const functionCauseKit = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(
        firstOf(functionCauseKit.hotbar, 'the function-cause spawn kit hotbar'),
        'count',
        {
          value: {
            valueOf: (): never => {
              // oxlint-disable-next-line no-throw-literal -- this deliberately tests function cause normalization.
              throw functionCause
            },
          },
        },
      )
      const functionCauseResult = yield* resultOf(
        inventoryOfSpawnKit(functionCauseKit),
      )
      expect(functionCauseResult._tag).toBe('Failure')
      if (functionCauseResult._tag === 'Failure') {
        expect(functionCauseResult.error.message).toBe('[object Object]')
      }

      const indexThrowKit = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(indexThrowKit.hotbar, '0', {
        get: () => {
          throw new Error('hotbar slot getter failed')
        },
      })
      const indexThrowResult = yield* resultOf(inventoryOfSpawnKit(indexThrowKit))
      expect(indexThrowResult._tag).toBe('Failure')
      if (indexThrowResult._tag === 'Failure') {
        expect(indexThrowResult.error.slotIndex).toBe(0)
        expect(indexThrowResult.error.message).toBe('hotbar slot getter failed')
      }

      const sparseHotbar = new Proxy(new Array(1), {
        get: (target, property, receiver) =>
          property === '0' ? undefined : Reflect.get(target, property, receiver),
        has: (target, property) =>
          property === '0' ? true : Reflect.has(target, property),
      })
      const sparseResult = yield* resultOf(inventoryOfSpawnKit({
        ...DEFAULT_SPAWN_KIT,
        hotbar: sparseHotbar,
      }))
      expect(sparseResult._tag).toBe('Failure')
      if (sparseResult._tag === 'Failure') {
        expect(sparseResult.error.slotIndex).toBe(0)
        expect(sparseResult.error.message).toBe('spawn kit hotbar slot is undefined')
      }

      const emptySlotResult = yield* resultOf(inventoryOfSpawnKit({
        ...DEFAULT_SPAWN_KIT,
        hotbar: new Array<HotbarSlot>(1),
      }))
      expect(emptySlotResult._tag).toBe('Success')
      if (emptySlotResult._tag === 'Success') {
        expect(emptySlotResult.value.slots[0]).toBeUndefined()
      }

      const lengthThrowHotbar = new Proxy([
        firstOf(DEFAULT_SPAWN_KIT.hotbar, 'the length-failure hotbar'),
      ], {
        get: (target, property, receiver) => {
          if (property === 'length') {
            throw new Error('hotbar length getter failed')
          }
          return Reflect.get(target, property, receiver)
        },
      })
      const lengthThrowResult = yield* resultOf(inventoryOfSpawnKit({
        ...DEFAULT_SPAWN_KIT,
        hotbar: lengthThrowHotbar,
      }))
      expect(lengthThrowResult._tag).toBe('Failure')
      if (lengthThrowResult._tag === 'Failure') {
        expect(lengthThrowResult.error.slotIndex).toBe(-1)
        expect(lengthThrowResult.error.message).toBe('hotbar length getter failed')
      }

      const hasThrowHotbar = new Proxy([
        firstOf(DEFAULT_SPAWN_KIT.hotbar, 'the membership-failure hotbar'),
      ], {
        has: (target, property) => {
          if (property === '0') {
            throw new Error('hotbar membership check failed')
          }
          return Reflect.has(target, property)
        },
      })
      const hasThrowResult = yield* resultOf(inventoryOfSpawnKit({
        ...DEFAULT_SPAWN_KIT,
        hotbar: hasThrowHotbar,
      }))
      expect(hasThrowResult._tag).toBe('Failure')
      if (hasThrowResult._tag === 'Failure') {
        expect(hasThrowResult.error.slotIndex).toBe(0)
        expect(hasThrowResult.error.message).toBe('hotbar membership check failed')
      }

      const hotbarGetterKit = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(hotbarGetterKit, 'hotbar', {
        get: () => {
          throw new Error('spawn kit hotbar getter failed')
        },
      })
      const hotbarGetterResult = yield* resultOf(inventoryOfSpawnKit(hotbarGetterKit))
      expect(hotbarGetterResult._tag).toBe('Failure')
      if (hotbarGetterResult._tag === 'Failure') {
        expect(hotbarGetterResult.error.slotIndex).toBe(-1)
        expect(hotbarGetterResult.error.message).toBe('spawn kit hotbar getter failed')
      }

      const malformed = structuredClone(DEFAULT_SPAWN_KIT)
      Object.defineProperty(malformed, 'hotbar', { value: undefined })
      const malformedResult = yield* resultOf(inventoryOfSpawnKit(malformed))
      expect(malformedResult._tag).toBe('Failure')
      if (malformedResult._tag === 'Failure') {
        expect(malformedResult.error.slotIndex).toBe(-1)
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
          Effect.andThen(
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
      const result = yield* resultOf(
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

      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(result.error).toBeInstanceOf(GeneratedGameplayWorldUnavailableError)
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
