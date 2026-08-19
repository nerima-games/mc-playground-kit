import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type BlockPositionKey,
  blockPositionKeyOf,
} from '@nerima-games/mc-kernel'

export type BlockWorld = ReadonlyMap<BlockPositionKey, BlockId>
export type BlockReader = (position: BlockPosition) => BlockId
export type BlockSource = BlockWorld | BlockReader

export const emptyBlockWorld = (): BlockWorld => new Map()

export const blockAt = (world: BlockWorld, position: BlockPosition): BlockId =>
  world.get(blockPositionKeyOf(position)) ?? AIR_BLOCK_ID

export const blockReaderOf = (world: BlockWorld): BlockReader =>
  (position) => blockAt(world, position)

export const readBlockAt = (source: BlockSource, position: BlockPosition): BlockId => {
  if (typeof source === 'function') {
    return source(position)
  }

  return blockAt(source, position)
}

export const setBlockAt = (world: BlockWorld, position: BlockPosition, blockId: BlockId): BlockWorld => {
  const next = new Map(world)
  const key = blockPositionKeyOf(position)

  if (blockId === AIR_BLOCK_ID) {
    next.delete(key)
  } else {
    next.set(key, blockId)
  }

  return next
}
