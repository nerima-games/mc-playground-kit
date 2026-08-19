import {
  type CropInteractionState,
  cropAt,
  isCropBlockAt,
  removeCrop,
} from './crop-state.js'
import {
  type CropLocation,
  type CropState,
  type Inventory,
  type ItemStack,
  addItem,
  itemStack,
  matureYieldsFor,
} from '@nerima-games/mc-sim'
import { AIR_BLOCK_ID } from '@nerima-games/mc-kernel'
import { setBlockAt } from './block-world.js'

const NO_LEFTOVER = 0

type YieldAddition = {
  readonly inventory: Inventory
  readonly leftovers: ReadonlyArray<ItemStack>
}

const addYield = (addition: YieldAddition, yieldStack: ItemStack): YieldAddition => {
  const added = addItem(addition.inventory, yieldStack.item, yieldStack.count)
  if (added.leftover === NO_LEFTOVER) {
    return { inventory: added.inventory, leftovers: addition.leftovers }
  }
  return {
    inventory: added.inventory,
    leftovers: [...addition.leftovers, itemStack(yieldStack.item, added.leftover)],
  }
}

const addYields = (
  inventory: Inventory,
  yields: ReadonlyArray<ItemStack>,
): YieldAddition =>
  yields.reduce<YieldAddition>(addYield, { inventory, leftovers: [] })

export type HarvestCropRequest = {
  readonly location: CropLocation
}

export type HarvestCropOutcome = 'harvested' | 'missing' | 'stale' | 'immature'

export type HarvestCropResult = {
  readonly crop?: CropState
  readonly drops: ReadonlyArray<ItemStack>
  readonly leftovers: ReadonlyArray<ItemStack>
  readonly location: CropLocation
  readonly outcome: HarvestCropOutcome
  readonly state: CropInteractionState
}

export const harvestCrop = (
  state: CropInteractionState,
  request: HarvestCropRequest,
): HarvestCropResult => {
  const crop = cropAt(state, request.location)
  if (!crop) {
    return {
      drops: [],
      leftovers: [],
      location: request.location,
      outcome: 'missing',
      state,
    }
  }
  if (!isCropBlockAt(state, crop)) {
    return {
      crop,
      drops: [],
      leftovers: [],
      location: request.location,
      outcome: 'stale',
      state,
    }
  }

  const yields = matureYieldsFor(crop)
  if (yields === null) {
    return {
      crop,
      drops: [],
      leftovers: [],
      location: request.location,
      outcome: 'immature',
      state,
    }
  }

  const added = addYields(state.inventory, yields)
  return {
    crop,
    drops: yields,
    leftovers: added.leftovers,
    location: request.location,
    outcome: 'harvested',
    state: {
      crops: removeCrop(state.crops, request.location),
      inventory: added.inventory,
      world: setBlockAt(state.world, request.location.position, AIR_BLOCK_ID),
    },
  }
}
