import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type ItemType,
  type PlaceableItemType,
  blockIdOf,
  blockOfPlaceableItem,
  blockPosition,
  canBlockStaySupported,
  capabilityOfBlockId,
  isKnownBlockId,
  isPlaceableItem,
} from '@nerima-games/mc-kernel'
import { type PlayerStorage, removeItemAt, slotAt, withInventory } from '@nerima-games/mc-sim'
import { blockAt, setBlockAt } from './block-world.js'
import { type BlockInteractionState } from './block-interaction-state.js'

export type PlaceBlockRequest = {
  readonly position: BlockPosition
  readonly inventorySlot: number
}

export type PlaceBlockOutcome =
  | 'placed'
  | 'occupied'
  | 'empty-slot'
  | 'not-placeable'
  | 'invalid-slot'
  | 'unsupported'

export type PlaceBlockResult = {
  readonly blockId?: BlockId
  readonly item?: ItemType
  readonly outcome: PlaceBlockOutcome
  readonly position: BlockPosition
  readonly replacedBlockId?: BlockId
  readonly state: BlockInteractionState
}

const canReplaceBlock = (blockId: BlockId): boolean =>
  blockId === AIR_BLOCK_ID || (isKnownBlockId(blockId) && capabilityOfBlockId(blockId, 'replaceable'))

type PlacementRejection =
  | {
      readonly blockId: BlockId
      readonly outcome: 'occupied'
      readonly position: BlockPosition
      readonly state: BlockInteractionState
    }
  | {
      readonly outcome: 'empty-slot'
      readonly position: BlockPosition
      readonly state: BlockInteractionState
    }
  | {
      readonly item: ItemType
      readonly outcome: 'invalid-slot' | 'not-placeable' | 'unsupported'
      readonly position: BlockPosition
      readonly state: BlockInteractionState
    }

const rejectedPlacement = (rejection: PlacementRejection): PlaceBlockResult => {
  if (rejection.outcome === 'occupied') {
    return {
      blockId: rejection.blockId,
      outcome: rejection.outcome,
      position: rejection.position,
      state: rejection.state,
    }
  }

  if ('item' in rejection) {
    return {
      item: rejection.item,
      outcome: rejection.outcome,
      position: rejection.position,
      state: rejection.state,
    }
  }

  return {
    outcome: rejection.outcome,
    position: rejection.position,
    state: rejection.state,
  }
}

const replacementOf = (blockId: BlockId): BlockId | null => {
  if (blockId === AIR_BLOCK_ID) {
    return null
  }

  return blockId
}

const ITEMS_TO_PLACE = 1
const BLOCK_BELOW_OFFSET = 1

type ItemSelection =
  | {
      readonly _tag: 'rejected'
      readonly rejection: PlacementRejection
    }
  | {
      readonly _tag: 'selected'
      readonly item: PlaceableItemType
    }

const selectItem = (state: BlockInteractionState, request: PlaceBlockRequest): ItemSelection => {
  const selected = slotAt(state.playerStorage.inventory, request.inventorySlot)
  if (!selected) {
    return {
      _tag: 'rejected',
      rejection: {
        outcome: 'empty-slot',
        position: request.position,
        state,
      },
    }
  }

  if (!isPlaceableItem(selected.item)) {
    return {
      _tag: 'rejected',
      rejection: {
        item: selected.item,
        outcome: 'not-placeable',
        position: request.position,
        state,
      },
    }
  }

  return { _tag: 'selected', item: selected.item }
}

const isSupportedPlacement = (
  state: BlockInteractionState,
  position: BlockPosition,
  blockId: BlockId,
): boolean =>
  canBlockStaySupported(
    blockId,
    blockAt(state.world, blockPosition(position.x, position.y - BLOCK_BELOW_OFFSET, position.z)),
  )

type PlacementSelection =
  | {
      readonly _tag: 'rejected'
      readonly rejection: PlacementRejection
    }
  | {
      readonly _tag: 'selected'
      readonly blockId: BlockId
      readonly item: ItemType
      readonly playerStorage: PlayerStorage
    }

const selectPlacement = (
  state: BlockInteractionState,
  request: PlaceBlockRequest,
): PlacementSelection => {
  const selected = selectItem(state, request)
  if (selected._tag === 'rejected') {
    return selected
  }

  const blockId = blockIdOf(blockOfPlaceableItem(selected.item))
  if (!isSupportedPlacement(state, request.position, blockId)) {
    return {
      _tag: 'rejected',
      rejection: {
        item: selected.item,
        outcome: 'unsupported',
        position: request.position,
        state,
      },
    }
  }

  const removal = removeItemAt(
    state.playerStorage.inventory,
    request.inventorySlot,
    selected.item,
    ITEMS_TO_PLACE,
  )
  if (removal.result._tag !== 'Removed') {
    return {
      _tag: 'rejected',
      rejection: {
        item: selected.item,
        outcome: 'invalid-slot',
        position: request.position,
        state,
      },
    }
  }

  return {
    _tag: 'selected',
    blockId,
    item: selected.item,
    playerStorage: withInventory(state.playerStorage, removal.inventory),
  }
}

type PlacedBlockContext = {
  readonly blockId: BlockId
  readonly item: ItemType
  readonly position: BlockPosition
  readonly replacedBlockId: BlockId | null
  readonly state: BlockInteractionState
}

const placedBlockResult = ({
  blockId,
  item,
  position,
  replacedBlockId,
  state,
}: PlacedBlockContext): PlaceBlockResult => {
  if (replacedBlockId === null) {
    return {
      blockId,
      item,
      outcome: 'placed',
      position,
      state,
    }
  }

  return {
    blockId,
    item,
    outcome: 'placed',
    position,
    replacedBlockId,
    state,
  }
}

export const placeBlock = (
  state: BlockInteractionState,
  request: PlaceBlockRequest,
): PlaceBlockResult => {
  const existingBlockId = blockAt(state.world, request.position)
  if (!canReplaceBlock(existingBlockId)) {
    return rejectedPlacement({
      blockId: existingBlockId,
      outcome: 'occupied',
      position: request.position,
      state,
    })
  }
  const replacedBlockId = replacementOf(existingBlockId)

  const selection = selectPlacement(state, request)
  if (selection._tag === 'rejected') {
    return rejectedPlacement(selection.rejection)
  }

  return placedBlockResult({
    blockId: selection.blockId,
    item: selection.item,
    position: request.position,
    replacedBlockId,
    state: {
      playerStorage: selection.playerStorage,
      world: setBlockAt(state.world, request.position, selection.blockId),
    },
  })
}
