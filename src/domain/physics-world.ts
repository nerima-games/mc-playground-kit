import { type BlockCollision, blockCollisionAt } from './block-collision.js'
import { type BlockSource, readBlockAt } from './block-world.js'
import { type SimPhysicsConfig } from '@nerima-games/mc-sim'
import { blockPosition } from '@nerima-games/mc-kernel'
import { blockPropertiesAtFromKernel } from '@nerima-games/mc-physics'

type ResolveOptions = SimPhysicsConfig['resolve']
type BlockShapeAt = NonNullable<ResolveOptions['blockShapeAt']>
type RelativeBounds = Exclude<ReturnType<BlockShapeAt>, null>
type BlockCoordinates = readonly [blockX: number, blockY: number, blockZ: number]

export type BlockPhysicsOptions = Pick<
  ResolveOptions,
  'halfWidth' | 'halfHeight' | 'stepHeight'
>

const collisionAt = (
  source: BlockSource,
  coordinates: BlockCoordinates,
): BlockCollision | null => blockCollisionAt(source, blockPosition(...coordinates))

const relativeBoundsOf = (
  collision: BlockCollision,
  coordinates: BlockCoordinates,
): RelativeBounds => {
  const [blockX, blockY, blockZ] = coordinates
  return {
    maxX: collision.bounds.max.x - blockX,
    maxY: collision.bounds.max.y - blockY,
    maxZ: collision.bounds.max.z - blockZ,
    minX: collision.bounds.min.x - blockX,
    minY: collision.bounds.min.y - blockY,
    minZ: collision.bounds.min.z - blockZ,
  }
}

export const resolveOptionsForBlockSource = (
  source: BlockSource,
  options: BlockPhysicsOptions,
): ResolveOptions => ({
  ...options,
  blockPropertiesAt: blockPropertiesAtFromKernel((blockX, blockY, blockZ) =>
    readBlockAt(source, blockPosition(blockX, blockY, blockZ)),
  ),
  blockShapeAt: (blockX, blockY, blockZ) => {
    const coordinates: BlockCoordinates = [blockX, blockY, blockZ]
    const collision = collisionAt(source, coordinates)
    if (collision === null) {
      return null
    }
    return relativeBoundsOf(collision, coordinates)
  },
})
