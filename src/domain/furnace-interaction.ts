import {
  type FuelRule,
  type FurnaceCollectionResult,
  type FurnaceState,
  type FurnaceTransferResult,
  type FurnaceTransferSlot,
  type Inventory,
  type SmeltingRecipe,
  advanceFurnace as advanceFurnaceState,
  collectFurnaceOutput as collectFurnaceOutputState,
  emptyFurnaceState,
  transferToFurnace,
} from '@nerima-games/mc-sim'
import {
  type ItemType,
} from '@nerima-games/mc-kernel'

export type FurnaceInteractionState = {
  readonly furnace: FurnaceState
  readonly inventory: Inventory
}

export const makeFurnaceInteractionState = (
  inventory: Inventory,
  furnace: FurnaceState = emptyFurnaceState(),
): FurnaceInteractionState => ({ furnace, inventory })

export type FurnaceTransferRequest = {
  readonly count: number
  readonly item: ItemType
  readonly slot: FurnaceTransferSlot
}

export type FurnaceTransferTransition = {
  readonly result: FurnaceTransferResult
  readonly state: FurnaceInteractionState
}

export const transferItemsToFurnace = (
  state: FurnaceInteractionState,
  request: FurnaceTransferRequest,
): FurnaceTransferTransition => {
  const transition = transferToFurnace(
    state.inventory,
    state.furnace,
    request.slot,
    request.item,
    request.count,
  )

  return {
    result: transition.result,
    state: {
      furnace: transition.furnace,
      inventory: transition.inventory,
    },
  }
}

export type FurnaceCollectionTransition = {
  readonly result: FurnaceCollectionResult
  readonly state: FurnaceInteractionState
}

export const collectFurnaceOutput = (
  state: FurnaceInteractionState,
): FurnaceCollectionTransition => {
  const transition = collectFurnaceOutputState(state.inventory, state.furnace)

  return {
    result: transition.result,
    state: {
      furnace: transition.furnace,
      inventory: transition.inventory,
    },
  }
}

export type FurnaceAdvanceRequest = {
  readonly deltaTimeSecs: number
  readonly fuelRules?: ReadonlyArray<FuelRule>
  readonly recipes?: ReadonlyArray<SmeltingRecipe>
}

export type FurnaceAdvanceTransition = {
  readonly fuelConsumed: number
  readonly smelted: number
  readonly state: FurnaceInteractionState
}

export const advanceFurnace = (
  state: FurnaceInteractionState,
  request: FurnaceAdvanceRequest,
): FurnaceAdvanceTransition => {
  const transition = advanceFurnaceState(
    state.furnace,
    request.deltaTimeSecs,
    request.recipes,
    request.fuelRules,
  )

  return {
    fuelConsumed: transition.fuelConsumed,
    smelted: transition.smelted,
    state: {
      furnace: transition.state,
      inventory: state.inventory,
    },
  }
}
