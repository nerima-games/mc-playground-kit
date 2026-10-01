import {
  AIR_BLOCK_ID,
  BlockId,
  blockIdOf,
  blockPosition,
  type ItemType,
} from '@nerima-games/mc-kernel'
import {
  emptyInventory,
  itemStack,
  maturitySecsFor,
  type CropLocation,
  type CropState,
  type Inventory,
} from '@nerima-games/mc-sim'
import { describe, expect, it } from 'vitest'
import {
  blockAt,
  emptyBlockWorld,
  setBlockAt,
  type BlockWorld,
} from '../src/domain/block-interaction'
import {
  advanceCrops,
  advanceCropWithBoneMeal,
  cropAt,
  harvestCrop,
  makeCropInteractionState,
  plantCrop,
} from '../src/domain/crop-interaction'

const firstLocation: CropLocation = {
  dimension: 'overworld',
  position: blockPosition(0, 1, 0),
}
const secondLocation: CropLocation = {
  dimension: 'overworld',
  position: blockPosition(2, 1, 0),
}
const missingLocation: CropLocation = {
  dimension: 'overworld',
  position: blockPosition(9, 1, 9),
}

const inventoryWith = (item: ItemType, count: number, slot = 0): Inventory => {
  const inventory = emptyInventory()
  const slots = [...inventory.slots]
  slots[slot] = count === 0 ? undefined : itemStack(item, count)
  return { slots }
}

const supportPosition = (location: CropLocation) =>
  blockPosition(location.position.x, location.position.y - 1, location.position.z)

const wheatCropAt = (
  location: CropLocation = firstLocation,
  growthSecs = 0,
): CropState => ({
  ...location,
  crop: 'wheat_crop',
  growthSecs,
})

const potatoCropAt = (
  location: CropLocation = secondLocation,
  growthSecs = 0,
): CropState => ({
  ...location,
  crop: 'potato_crop',
  growthSecs,
})

const farmlandWorld = (location: CropLocation = firstLocation): BlockWorld =>
  setBlockAt(emptyBlockWorld(), supportPosition(location), blockIdOf('farmland'))

const worldForCrops = (...crops: ReadonlyArray<CropState>): BlockWorld =>
  crops.reduce(
    (world, crop) => setBlockAt(
      setBlockAt(world, supportPosition(crop), blockIdOf('farmland')),
      crop.position,
      blockIdOf(crop.crop),
    ),
    emptyBlockWorld(),
  )

describe('crop interaction', () => {
  it('copies snapshots and advances only crops whose blocks are still present', () => {
    const liveCrop = wheatCropAt()
    const staleCrop = wheatCropAt(secondLocation)
    const snapshot = { crops: [liveCrop, staleCrop] }
    const state = makeCropInteractionState(
      worldForCrops(liveCrop),
      inventoryWith('wheat_seeds', 1),
      snapshot,
    )

    expect(state.crops).not.toBe(snapshot)
    expect(cropAt(state, firstLocation)).toEqual(liveCrop)
    expect(cropAt(state, firstLocation)).not.toBe(liveCrop)
    expect(cropAt(state, secondLocation)).toEqual(staleCrop)
    expect(cropAt(state, missingLocation)).toBeUndefined()

    const advanced = advanceCrops(state, 30)

    expect(cropAt(advanced, firstLocation)?.growthSecs).toBe(30)
    expect(cropAt(advanced, secondLocation)).toBeUndefined()
    expect(advanced.world).toBe(state.world)
    expect(advanced.inventory).toBe(state.inventory)
    expect(state.crops.crops).toEqual([liveCrop, staleCrop])

    const defaults = makeCropInteractionState()
    expect(defaults.crops.crops).toEqual([])
    expect(blockAt(defaults.world, firstLocation.position)).toBe(AIR_BLOCK_ID)
  })

  it('validates planting against occupancy, inventory, kernel support, and upstream crop rules', () => {
    const request = {
      crop: 'wheat_crop' as const,
      inventorySlot: 0,
      location: firstLocation,
    }
    const fertileState = makeCropInteractionState(
      farmlandWorld(),
      inventoryWith('wheat_seeds', 2),
    )
    const planted = plantCrop(fertileState, request)

    expect(planted.outcome).toBe('planted')
    expect(planted.state.inventory.slots[0]).toEqual(itemStack('wheat_seeds', 1))
    expect(blockAt(planted.state.world, firstLocation.position)).toBe(blockIdOf('wheat_crop'))
    expect(cropAt(planted.state, firstLocation)).toEqual(wheatCropAt())
    expect(fertileState.inventory.slots[0]).toEqual(itemStack('wheat_seeds', 2))
    expect(blockAt(fertileState.world, firstLocation.position)).toBe(AIR_BLOCK_ID)
    expect(fertileState.crops.crops).toEqual([])

    const occupiedWorld = plantCrop(
      makeCropInteractionState(
        setBlockAt(farmlandWorld(), firstLocation.position, blockIdOf('dirt')),
        inventoryWith('wheat_seeds', 1),
      ),
      request,
    )
    const occupiedSnapshot = plantCrop(
      makeCropInteractionState(
        farmlandWorld(),
        inventoryWith('wheat_seeds', 1),
        { crops: [wheatCropAt()] },
      ),
      request,
    )
    const emptySlot = plantCrop(makeCropInteractionState(farmlandWorld()), request)
    const wrongSeed = plantCrop(
      makeCropInteractionState(farmlandWorld(), inventoryWith('potato', 1)),
      request,
    )
    const unsupported = plantCrop(
      makeCropInteractionState(emptyBlockWorld(), inventoryWith('wheat_seeds', 1)),
      request,
    )
    const unknownSupport = plantCrop(
      makeCropInteractionState(
        setBlockAt(emptyBlockWorld(), supportPosition(firstLocation), BlockId(255)),
        inventoryWith('wheat_seeds', 1),
      ),
      request,
    )
    const wrongSoil = plantCrop(
      makeCropInteractionState(
        setBlockAt(emptyBlockWorld(), supportPosition(firstLocation), blockIdOf('soul_sand')),
        inventoryWith('wheat_seeds', 1),
      ),
      request,
    )
    const insufficient = plantCrop(
      makeCropInteractionState(farmlandWorld(), inventoryWith('wheat_seeds', 0)),
      request,
    )
    const invalidInventory: Inventory = {
      slots: [...emptyInventory().slots, itemStack('wheat_seeds', 1)],
    }
    const invalidSlot = plantCrop(
      makeCropInteractionState(farmlandWorld(), invalidInventory),
      { ...request, inventorySlot: 36 },
    )

    expect(occupiedWorld.outcome).toBe('occupied')
    expect(occupiedSnapshot.outcome).toBe('occupied')
    expect(emptySlot.outcome).toBe('empty-slot')
    expect(wrongSeed.outcome).toBe('wrong-seed')
    expect(unsupported.outcome).toBe('unsupported')
    expect(unknownSupport.outcome).toBe('unsupported')
    expect(wrongSoil.outcome).toBe('unsupported')
    expect(insufficient.outcome).toBe('empty-slot')
    const malformedSeed = structuredClone(itemStack('wheat_seeds', 1))
    Object.defineProperty(malformedSeed, 'count', { value: 0 })
    const malformedInsufficient = plantCrop(
      makeCropInteractionState(farmlandWorld(), { slots: [malformedSeed] }),
      request,
    )
    expect(invalidSlot.outcome).toBe('invalid-slot')
    expect(malformedInsufficient.outcome).toBe('insufficient-seed')
  })

  it('advances live crops with bone meal and preserves every rejection state', () => {
    const firstCrop = wheatCropAt()
    const secondCrop = potatoCropAt()
    const state = makeCropInteractionState(
      worldForCrops(firstCrop, secondCrop),
      inventoryWith('bone_meal', 2),
      { crops: [firstCrop, secondCrop] },
    )
    const advanced = advanceCropWithBoneMeal(state, {
      inventorySlot: 0,
      location: firstLocation,
    })

    expect(advanced.outcome).toBe('advanced')
    expect(cropAt(advanced.state, firstLocation)?.growthSecs).toBe(30)
    expect(cropAt(advanced.state, secondLocation)).toEqual(secondCrop)
    expect(advanced.state.inventory.slots[0]).toEqual(itemStack('bone_meal', 1))
    expect(cropAt(state, firstLocation)?.growthSecs).toBe(0)
    expect(state.inventory.slots[0]).toEqual(itemStack('bone_meal', 2))

    const missing = advanceCropWithBoneMeal(makeCropInteractionState(), {
      inventorySlot: 0,
      location: firstLocation,
    })
    const stale = advanceCropWithBoneMeal(
      makeCropInteractionState(
        farmlandWorld(),
        inventoryWith('bone_meal', 1),
        { crops: [firstCrop] },
      ),
      { inventorySlot: 0, location: firstLocation },
    )
    const mature = advanceCropWithBoneMeal(
      makeCropInteractionState(
        worldForCrops(wheatCropAt(firstLocation, maturitySecsFor('wheat_crop'))),
        inventoryWith('bone_meal', 1),
        { crops: [wheatCropAt(firstLocation, maturitySecsFor('wheat_crop'))] },
      ),
      { inventorySlot: 0, location: firstLocation },
    )
    const emptyState = makeCropInteractionState(
      worldForCrops(firstCrop),
      emptyInventory(),
      { crops: [firstCrop] },
    )
    const emptySlot = advanceCropWithBoneMeal(
      emptyState,
      { inventorySlot: 0, location: firstLocation },
    )
    const wrongItem = advanceCropWithBoneMeal(
      makeCropInteractionState(
        worldForCrops(firstCrop),
        inventoryWith('stick', 1),
        { crops: [firstCrop] },
      ),
      { inventorySlot: 0, location: firstLocation },
    )
    const insufficient = advanceCropWithBoneMeal(
      makeCropInteractionState(
        worldForCrops(firstCrop),
        inventoryWith('bone_meal', 0),
        { crops: [firstCrop] },
      ),
      { inventorySlot: 0, location: firstLocation },
    )
    const invalidInventory: Inventory = {
      slots: [...emptyInventory().slots, itemStack('bone_meal', 1)],
    }
    const invalidSlot = advanceCropWithBoneMeal(
      makeCropInteractionState(worldForCrops(firstCrop), invalidInventory, { crops: [firstCrop] }),
      { inventorySlot: 36, location: firstLocation },
    )

    expect(missing.outcome).toBe('missing')
    expect(stale.outcome).toBe('stale')
    expect(mature.outcome).toBe('mature')
    expect(emptySlot.outcome).toBe('empty-slot')
    expect(wrongItem.outcome).toBe('wrong-item')
    expect(insufficient.outcome).toBe('empty-slot')
    const malformedBoneMeal = structuredClone(itemStack('bone_meal', 1))
    Object.defineProperty(malformedBoneMeal, 'count', { value: 0 })
    const malformedInsufficient = advanceCropWithBoneMeal(
      makeCropInteractionState(worldForCrops(firstCrop), { slots: [malformedBoneMeal] }, { crops: [firstCrop] }),
      { inventorySlot: 0, location: firstLocation },
    )
    expect(invalidSlot.outcome).toBe('invalid-slot')
    expect(malformedInsufficient.outcome).toBe('insufficient-bone-meal')
    expect(emptySlot.state).toBe(emptyState)
  })

  it('harvests mature crops into inventory and reports drops that do not fit', () => {
    const missing = harvestCrop(makeCropInteractionState(), {
      location: firstLocation,
    })
    const immatureCrop = wheatCropAt()
    const stale = harvestCrop(
      makeCropInteractionState(farmlandWorld(), emptyInventory(), { crops: [immatureCrop] }),
      { location: firstLocation },
    )
    const immature = harvestCrop(
      makeCropInteractionState(
        worldForCrops(immatureCrop),
        emptyInventory(),
        { crops: [immatureCrop] },
      ),
      { location: firstLocation },
    )

    const matureCrop = wheatCropAt(firstLocation, maturitySecsFor('wheat_crop'))
    const otherMatureCrop = potatoCropAt(secondLocation, maturitySecsFor('potato_crop'))
    const harvested = harvestCrop(
      makeCropInteractionState(
        worldForCrops(matureCrop, otherMatureCrop),
        emptyInventory(),
        { crops: [matureCrop, otherMatureCrop] },
      ),
      { location: firstLocation },
    )

    const fullInventory: Inventory = {
      slots: Array.from({ length: 36 }, () => itemStack('stone', 64)),
    }
    const leftovers = harvestCrop(
      makeCropInteractionState(
        worldForCrops(matureCrop),
        fullInventory,
        { crops: [matureCrop] },
      ),
      { location: firstLocation },
    )

    expect(missing.outcome).toBe('missing')
    expect(missing.crop).toBeUndefined()
    expect(stale.outcome).toBe('stale')
    expect(immature.outcome).toBe('immature')
    expect(harvested.outcome).toBe('harvested')
    expect(harvested.drops).toEqual([
      itemStack('wheat', 1),
      itemStack('wheat_seeds', 1),
    ])
    expect(harvested.leftovers).toEqual([])
    expect(cropAt(harvested.state, firstLocation)).toBeUndefined()
    expect(cropAt(harvested.state, secondLocation)).toEqual(otherMatureCrop)
    expect(blockAt(harvested.state.world, firstLocation.position)).toBe(AIR_BLOCK_ID)
    expect(blockAt(harvested.state.world, secondLocation.position)).toBe(blockIdOf('potato_crop'))
    expect(harvested.state.inventory.slots[0]).toEqual(itemStack('wheat', 1))
    expect(harvested.state.inventory.slots[1]).toEqual(itemStack('wheat_seeds', 1))

    expect(leftovers.outcome).toBe('harvested')
    expect(leftovers.leftovers).toEqual([
      itemStack('wheat', 1),
      itemStack('wheat_seeds', 1),
    ])
    expect(leftovers.state.inventory).toStrictEqual(fullInventory)
  })
})
