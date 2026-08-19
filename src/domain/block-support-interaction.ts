import {
  AIR_BLOCK_ID,
  type BlockDrop,
  type BlockId,
  type BlockPosition,
  adjacentBlockPosition,
  canBlockStaySupported,
  capabilityOfBlockId,
  dropOfBlockId,
  isKnownBlockId,
  isSupportSensitiveBlockId,
} from '@nerima-games/mc-kernel'
import { type BlockWorld, blockAt, setBlockAt } from './block-world.js'

type RemovedBlockBase = {
  readonly blockId: BlockId
  readonly position: BlockPosition
}

export type UnsupportedBlock =
  | (RemovedBlockBase & {
      readonly drop?: BlockDrop
      readonly transition: 'detached'
    })
  | (RemovedBlockBase & {
      readonly transition: 'falling'
    })

export type BlockSupportResult = {
  readonly removed: ReadonlyArray<UnsupportedBlock>
  readonly world: BlockWorld
}

const nextPositionAbove = (position: BlockPosition): BlockPosition | null => {
  if (position.y === Number.MAX_SAFE_INTEGER) {
    return null
  }

  return adjacentBlockPosition(position, 'up')
}

const fallingBlockAt = (
  blockId: BlockId,
  supportBelow: BlockId,
  position: BlockPosition,
): UnsupportedBlock | null => {
  if (
    !capabilityOfBlockId(blockId, 'fallsWhenUnsupported') ||
    capabilityOfBlockId(supportBelow, 'canSupportAttachments')
  ) {
    return null
  }

  return { blockId, position, transition: 'falling' }
}

const detachedBlockAt = (
  blockId: BlockId,
  position: BlockPosition,
): UnsupportedBlock => {
  const block = { blockId, position, transition: 'detached' as const }
  const drop = dropOfBlockId(blockId)
  if (!drop) {
    return block
  }

  return { ...block, drop }
}

const unsupportedBlockAt = (
  world: BlockWorld,
  belowPosition: BlockPosition,
  position: BlockPosition,
): UnsupportedBlock | null => {
  const blockId = blockAt(world, position)
  const supportBelow = blockAt(world, belowPosition)

  if (blockId === AIR_BLOCK_ID || !isKnownBlockId(blockId)) {
    return null
  }

  const falling = fallingBlockAt(blockId, supportBelow, position)
  if (falling) {
    return falling
  }

  if (
    !isSupportSensitiveBlockId(blockId) ||
    canBlockStaySupported(blockId, supportBelow)
  ) {
    return null
  }

  return detachedBlockAt(blockId, position)
}

type SupportStep = {
  readonly belowPosition: BlockPosition | null
  readonly removed: UnsupportedBlock | null
  readonly world: BlockWorld
}

const removeNextUnsupported = (
  world: BlockWorld,
  belowPosition: BlockPosition,
): SupportStep => {
  const positionAbove = nextPositionAbove(belowPosition)
  if (!positionAbove) {
    return { belowPosition: null, removed: null, world }
  }

  const unsupported = unsupportedBlockAt(world, belowPosition, positionAbove)
  if (!unsupported) {
    return { belowPosition: null, removed: null, world }
  }

  return {
    belowPosition: positionAbove,
    removed: unsupported,
    world: setBlockAt(world, positionAbove, AIR_BLOCK_ID),
  }
}

const appendRemoved = (
  removed: UnsupportedBlock[],
  unsupported: UnsupportedBlock | null,
): void => {
  if (unsupported) {
    removed.push(unsupported)
  }
}

export const removeUnsupportedBlocksAbove = (
  world: BlockWorld,
  supportPosition: BlockPosition,
): BlockSupportResult => {
  let nextWorld = world
  let belowPosition: BlockPosition | null = supportPosition
  const removed: UnsupportedBlock[] = []

  while (belowPosition) {
    const step = removeNextUnsupported(nextWorld, belowPosition)
    const {
      belowPosition: nextBelowPosition,
      removed: unsupported,
      world: stepWorld,
    } = step
    nextWorld = stepWorld
    appendRemoved(removed, unsupported)
    belowPosition = nextBelowPosition
  }

  return { removed, world: nextWorld }
}
