import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  craftGrid,
  CropService,
  EntityKind,
  entityManagerTag,
  EquipmentService,
  InventoryService,
  PlayerService,
  SettingsService,
  StatisticsService,
  TimeService,
  VehicleService,
  VitalsService,
  WeatherService,
} from '@nerima-games/mc-sim'
import {
  GameplayServicesLayer,
  gameplayServicesLayerWithEntities,
} from '../src/application/gameplay-services'

type TestBehaviour = {
  readonly kind: 'passive'
}

describe('GameplayServicesLayer', () => {
  it.effect('provides the standard simulation services as one boundary', () =>
    Effect.gen(function* () {
      const inventory = yield* InventoryService
      const equipment = yield* EquipmentService
      const player = yield* PlayerService
      const settings = yield* SettingsService
      const statistics = yield* StatisticsService
      const time = yield* TimeService
      const vehicle = yield* VehicleService
      const vitals = yield* VitalsService
      const weather = yield* WeatherService
      const crops = yield* CropService

      expect(yield* inventory.add('dirt', 3)).toBe(0)
      expect((yield* inventory.snapshot).slots[0]).toStrictEqual({ item: 'dirt', count: 3 })
      expect(yield* equipment.snapshot).toBeDefined()
      expect(yield* player.pose).toBeDefined()
      expect(yield* player.dimension).toBe('overworld')
      expect(yield* settings.snapshot).toBeDefined()
      expect(yield* statistics.snapshot).toBeDefined()
      expect(yield* time.snapshot).toBeDefined()
      expect(yield* vehicle.vehicles).toStrictEqual([])
      expect(yield* vitals.snapshot).toBeDefined()
      expect(yield* weather.snapshot).toBeDefined()
      expect(yield* crops.snapshot).toStrictEqual({ crops: [] })
    }).pipe(Effect.provide(GameplayServicesLayer)),
  )

  it.effect('exposes upstream crafting as an atomic inventory transition', () =>
    Effect.gen(function* () {
      const inventory = yield* InventoryService

      expect(yield* inventory.add('oak_log', 1)).toBe(0)
      expect(yield* inventory.craft(craftGrid(1, 1, ['oak_log']))).toStrictEqual({
        _tag: 'Crafted',
        recipeId: 'mc-sim:oak-planks',
        output: { item: 'oak_planks', count: 4 },
      })
      expect((yield* inventory.snapshot).slots[0]).toStrictEqual({
        item: 'oak_planks',
        count: 4,
      })
    }).pipe(Effect.provide(GameplayServicesLayer)),
  )

  it.effect('exposes upstream container transfers as an atomic inventory transition', () =>
    Effect.gen(function* () {
      const inventory = yield* InventoryService
      const containerId = 'overworld:0,64,0'

      expect((yield* inventory.createContainer(containerId))._tag).toBe('Created')
      expect(yield* inventory.add('dirt', 3)).toBe(0)
      expect(yield* inventory.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId,
        playerSlot: 0,
        containerSlot: 0,
        count: 3,
      })).toStrictEqual({
        _tag: 'Transferred',
        item: 'dirt',
        count: 3,
        direction: 'PlayerToContainer',
      })

      const container = yield* inventory.containerSnapshot(containerId)
      expect(container?.slots[0]?.item).toBe('dirt')
      expect(container?.slots[0]?.count).toBe(3)
      expect((yield* inventory.snapshot).slots[0]).toBeUndefined()
    }).pipe(Effect.provide(GameplayServicesLayer)),
  )

  it.effect('composes a host-typed entity manager with the standard services', () =>
    Effect.gen(function* () {
      const entities = yield* entityManagerTag<TestBehaviour>()
      const entity = yield* entities.spawn({
        kind: EntityKind('test:dummy'),
        feetPosition: { x: 0, y: 64, z: 0 },
        healthPoints: 20,
        behaviour: { kind: 'passive' },
      })

      expect(entity).toMatchObject({
        id: 'e:0',
        kind: 'test:dummy',
        feetPosition: { x: 0, y: 64, z: 0 },
        healthPoints: 20,
        behaviour: { kind: 'passive' },
      })
      expect(yield* entities.count).toBe(1)
      expect((yield* entities.snapshot).entities).toHaveLength(1)

      yield* entities.reset

      expect(yield* entities.count).toBe(0)
    }).pipe(Effect.provide(gameplayServicesLayerWithEntities<TestBehaviour>())),
  )
})
