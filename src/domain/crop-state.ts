import { type BlockWorld, blockAt, emptyBlockWorld } from './block-world.js'
import {
  type CropLocation,
  type CropSnapshot,
  type CropState,
  type Inventory,
  cropLocationKey,
  emptyInventory,
} from '@nerima-games/mc-sim'
import { blockIdOf } from '@nerima-games/mc-kernel'

export type CropInteractionState = {
  readonly crops: CropSnapshot
  readonly inventory: Inventory
  readonly world: BlockWorld
}

export const makeCropInteractionState = (
  world: BlockWorld = emptyBlockWorld(),
  inventory: Inventory = emptyInventory(),
  crops: CropSnapshot = { crops: [] },
): CropInteractionState => ({
  crops: {
    crops: crops.crops.map((crop) => ({ ...crop, position: { ...crop.position } })),
  },
  inventory,
  world,
})

const copyCrop = (crop: CropState): CropState => ({
  ...crop,
  position: { ...crop.position },
})

export const cropStateAt = (
  snapshot: CropSnapshot,
  location: CropLocation,
): CropState | undefined => {
  const key = cropLocationKey(location)
  return snapshot.crops.find((crop) => cropLocationKey(crop) === key)
}

export const cropAt = (
  state: CropInteractionState,
  location: CropLocation,
): CropState | undefined => {
  const crop = cropStateAt(state.crops, location)
  if (!crop) {
    return
  }
  return copyCrop(crop)
}

export const appendCrop = (snapshot: CropSnapshot, crop: CropState): CropSnapshot => ({
  crops: [...snapshot.crops.map(copyCrop), copyCrop(crop)],
})

const replaceCropState = (
  crop: CropState,
  replacementKey: string,
  replacement: CropState,
): CropState => {
  if (cropLocationKey(crop) === replacementKey) {
    return copyCrop(replacement)
  }
  return copyCrop(crop)
}

export const replaceCrop = (snapshot: CropSnapshot, replacement: CropState): CropSnapshot => {
  const key = cropLocationKey(replacement)
  return {
    crops: snapshot.crops.map((crop) => replaceCropState(crop, key, replacement)),
  }
}

export const removeCrop = (snapshot: CropSnapshot, location: CropLocation): CropSnapshot => {
  const key = cropLocationKey(location)
  return {
    crops: snapshot.crops
      .filter((crop) => cropLocationKey(crop) !== key)
      .map(copyCrop),
  }
}

export const isCropBlockAt = (state: CropInteractionState, crop: CropState): boolean =>
  blockAt(state.world, crop.position) === blockIdOf(crop.crop)
