import {
  type CropInteractionState,
  cropAt,
  isCropBlockAt,
  replaceCrop,
} from './crop-state.js'
import {
  type CropLocation,
  type CropState,
  type ItemStack,
  advanceCrop,
  advanceCropByBoneMeal,
  matureYieldsFor,
  removeItemAt,
  slotAt,
} from '@nerima-games/mc-sim'

const ITEMS_TO_CONSUME = 1

export const advanceCrops = (
  state: CropInteractionState,
  deltaTimeSecs: number,
): CropInteractionState => ({
  crops: {
    crops: state.crops.crops
      .filter((crop) => isCropBlockAt(state, crop))
      .map((crop) => advanceCrop(crop, deltaTimeSecs)),
  },
  inventory: state.inventory,
  world: state.world,
})

export type BoneMealRequest = {
  readonly inventorySlot: number
  readonly location: CropLocation
}

export type BoneMealOutcome =
  | 'advanced'
  | 'missing'
  | 'stale'
  | 'mature'
  | 'empty-slot'
  | 'wrong-item'
  | 'invalid-slot'
  | 'insufficient-bone-meal'

export type BoneMealResult = {
  readonly location: CropLocation
  readonly outcome: BoneMealOutcome
  readonly state: CropInteractionState
}

type BoneMealFailure = Exclude<BoneMealOutcome, 'advanced'>

type BoneMealValidation =
  | BoneMealFailure
  | { readonly crop: CropState; readonly selected: ItemStack }

type BoneMealCropValidation =
  | 'missing'
  | 'stale'
  | 'mature'
  | { readonly crop: CropState }

const validateBoneMealCrop = (
  state: CropInteractionState,
  location: CropLocation,
): BoneMealCropValidation => {
  const crop = cropAt(state, location)
  if (!crop) {
    return 'missing'
  }
  if (!isCropBlockAt(state, crop)) {
    return 'stale'
  }
  if (matureYieldsFor(crop) !== null) {
    return 'mature'
  }
  return { crop }
}

const validateBoneMeal = (
  state: CropInteractionState,
  request: BoneMealRequest,
): BoneMealValidation => {
  const cropValidation = validateBoneMealCrop(state, request.location)
  if (typeof cropValidation === 'string') {
    return cropValidation
  }

  const selected = slotAt(state.inventory, request.inventorySlot)
  if (!selected) {
    return 'empty-slot'
  }
  if (selected.item !== 'bone_meal') {
    return 'wrong-item'
  }
  return { crop: cropValidation.crop, selected }
}

const boneMealFailureFor = (
  result: ReturnType<typeof removeItemAt>['result'],
): BoneMealFailure => {
  if (result._tag === 'Insufficient') {
    return 'insufficient-bone-meal'
  }
  return 'invalid-slot'
}

export const advanceCropWithBoneMeal = (
  state: CropInteractionState,
  request: BoneMealRequest,
): BoneMealResult => {
  const validation = validateBoneMeal(state, request)
  if (typeof validation === 'string') {
    return { location: request.location, outcome: validation, state }
  }

  const removal = removeItemAt(
    state.inventory,
    request.inventorySlot,
    validation.selected.item,
    ITEMS_TO_CONSUME,
  )
  if (removal.result._tag !== 'Removed') {
    return {
      location: request.location,
      outcome: boneMealFailureFor(removal.result),
      state,
    }
  }

  return {
    location: request.location,
    outcome: 'advanced',
    state: {
      crops: replaceCrop(state.crops, advanceCropByBoneMeal(validation.crop)),
      inventory: removal.inventory,
      world: state.world,
    },
  }
}
