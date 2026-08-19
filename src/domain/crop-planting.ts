import {
  AIR_BLOCK_ID,
  blockIdOf,
  blockPosition,
  blockTypeOfId,
  canBlockStaySupported,
} from '@nerima-games/mc-kernel'
import {
  type CropInteractionState,
  appendCrop,
  cropStateAt,
} from './crop-state.js'
import {
  type CropLocation,
  type CropState,
  type CropType,
  type ItemStack,
  canPlantCrop,
  cropDefinitionFor,
  removeItemAt,
  slotAt,
} from '@nerima-games/mc-sim'
import { blockAt, setBlockAt } from './block-world.js'

const ITEMS_TO_CONSUME = 1
const INITIAL_CROP_GROWTH_SECS = 0
const SUPPORT_BLOCK_OFFSET = 1

const isSupportedCrop = (
  state: CropInteractionState,
  location: CropLocation,
  crop: CropType,
): boolean => {
  const supportId = blockAt(
    state.world,
    blockPosition(
      location.position.x,
      location.position.y - SUPPORT_BLOCK_OFFSET,
      location.position.z,
    ),
  )
  const support = blockTypeOfId(supportId)
  if (!support) {
    return false
  }
  if (!canPlantCrop(crop, support, location.dimension)) {
    return false
  }
  return canBlockStaySupported(blockIdOf(crop), supportId)
}

export type PlantCropRequest = {
  readonly crop: CropType
  readonly inventorySlot: number
  readonly location: CropLocation
}

export type PlantCropOutcome =
  | 'planted'
  | 'occupied'
  | 'empty-slot'
  | 'wrong-seed'
  | 'unsupported'
  | 'invalid-slot'
  | 'insufficient-seed'

export type PlantCropResult = {
  readonly location: CropLocation
  readonly outcome: PlantCropOutcome
  readonly state: CropInteractionState
}

type PlantingFailure = Exclude<PlantCropOutcome, 'occupied' | 'planted'>

type PlantingValidation = PlantingFailure | { readonly selected: ItemStack }

const validatePlanting = (
  state: CropInteractionState,
  request: PlantCropRequest,
): PlantingValidation => {
  const selected = slotAt(state.inventory, request.inventorySlot)
  if (!selected) {
    return 'empty-slot'
  }
  if (selected.item !== cropDefinitionFor(request.crop).seed) {
    return 'wrong-seed'
  }
  if (!isSupportedCrop(state, request.location, request.crop)) {
    return 'unsupported'
  }
  return { selected }
}

const plantingFailureFor = (
  result: ReturnType<typeof removeItemAt>['result'],
): PlantingFailure => {
  if (result._tag === 'Insufficient') {
    return 'insufficient-seed'
  }
  return 'invalid-slot'
}

const plantValidatedCrop = (
  state: CropInteractionState,
  request: PlantCropRequest,
  selected: ItemStack,
): PlantCropResult => {
  const removal = removeItemAt(
    state.inventory,
    request.inventorySlot,
    selected.item,
    ITEMS_TO_CONSUME,
  )
  if (removal.result._tag !== 'Removed') {
    return {
      location: request.location,
      outcome: plantingFailureFor(removal.result),
      state,
    }
  }

  const crop: CropState = {
    ...request.location,
    crop: request.crop,
    growthSecs: INITIAL_CROP_GROWTH_SECS,
  }
  return {
    location: request.location,
    outcome: 'planted',
    state: {
      crops: appendCrop(state.crops, crop),
      inventory: removal.inventory,
      world: setBlockAt(state.world, request.location.position, blockIdOf(request.crop)),
    },
  }
}

export const plantCrop = (
  state: CropInteractionState,
  request: PlantCropRequest,
): PlantCropResult => {
  const existingCrop = cropStateAt(state.crops, request.location)
  if (blockAt(state.world, request.location.position) !== AIR_BLOCK_ID || existingCrop) {
    return { location: request.location, outcome: 'occupied', state }
  }

  const validation = validatePlanting(state, request)
  if (typeof validation === 'string') {
    return { location: request.location, outcome: validation, state }
  }
  return plantValidatedCrop(state, request, validation.selected)
}
