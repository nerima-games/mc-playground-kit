import {
  type AABB,
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type CollisionShape,
  aabb,
  aabbIntersects,
  aabbOfBlock,
  blockPositionOfKey,
  isKnownBlockId,
  propertyOfBlockId,
  position as worldPosition,
} from '@nerima-games/mc-kernel'
import { type BlockSource, type BlockWorld, readBlockAt } from './block-world.js'

export type BlockCollision = {
  readonly blockId: BlockId
  readonly bounds: AABB
  readonly position: BlockPosition
  readonly shape: CollisionShape
}

const BLOCK_HEIGHT = 1
const BLOCK_SIZE = 1
const SLAB_HEIGHT = 0.5
const SIXTEENTH = 16
const CACTUS_INSET = BLOCK_SIZE / SIXTEENTH
const PRESSURE_PLATE_HEIGHT = BLOCK_SIZE / SIXTEENTH

type BlockBoundsFactory = (blockPosition: BlockPosition) => AABB | null

const boundsByShape: Record<CollisionShape, BlockBoundsFactory> = {
  cactus: (blockPosition) =>
    aabb(
      worldPosition(
        blockPosition.x + CACTUS_INSET,
        blockPosition.y,
        blockPosition.z + CACTUS_INSET,
      ),
      worldPosition(
        blockPosition.x + BLOCK_SIZE - CACTUS_INSET,
        blockPosition.y + BLOCK_HEIGHT,
        blockPosition.z + BLOCK_SIZE - CACTUS_INSET,
      ),
    ),
  full: (blockPosition) => aabbOfBlock(blockPosition),
  none: () => null,
  pressurePlate: (blockPosition) =>
    aabb(
      worldPosition(blockPosition.x, blockPosition.y, blockPosition.z),
      worldPosition(
        blockPosition.x + BLOCK_SIZE,
        blockPosition.y + PRESSURE_PLATE_HEIGHT,
        blockPosition.z + BLOCK_SIZE,
      ),
    ),
  slab: (blockPosition) =>
    aabb(
      worldPosition(blockPosition.x, blockPosition.y, blockPosition.z),
      worldPosition(
        blockPosition.x + BLOCK_SIZE,
        blockPosition.y + SLAB_HEIGHT,
        blockPosition.z + BLOCK_SIZE,
      ),
    ),
}

export const blockCollisionFor = (
  blockId: BlockId,
  blockPosition: BlockPosition,
): BlockCollision | null => {
  if (blockId === AIR_BLOCK_ID || !isKnownBlockId(blockId)) {
    return null
  }

  const shape = propertyOfBlockId(blockId, 'collisionShape')
  const bounds = boundsByShape[shape](blockPosition)
  if (!bounds) {
    return null
  }

  return { blockId, bounds, position: blockPosition, shape }
}

export const blockCollisionAt = (
  source: BlockSource,
  blockPosition: BlockPosition,
): BlockCollision | null => blockCollisionFor(readBlockAt(source, blockPosition), blockPosition)

export const blockCollisionsIn = (
  world: BlockWorld,
  bounds: AABB,
): ReadonlyArray<BlockCollision> => {
  const collisions: BlockCollision[] = []

  for (const [key, blockId] of world) {
    const collision = blockCollisionFor(blockId, blockPositionOfKey(key))
    if (collision && aabbIntersects(collision.bounds, bounds)) {
      collisions.push(collision)
    }
  }

  return collisions
}
