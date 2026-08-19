import {
  AIR_BLOCK_ID,
  type BlockId,
  type Position,
  blockPosition,
  isKnownBlockId,
} from '@nerima-games/mc-kernel'
import {
  type ArrowBlockImpact,
  raycastArrowBlock,
} from '@nerima-games/mc-sim'
import { type BlockSource, readBlockAt } from './block-world.js'
import { type Option } from 'effect'

export type ProjectileBlockRayRequest = {
  readonly from: Position
  readonly to: Position
}

type BlockCoordinates = readonly [blockX: number, blockY: number, blockZ: number]

const blockIdAt = (source: BlockSource, coordinates: BlockCoordinates): BlockId =>
  readBlockAt(source, blockPosition(...coordinates))

const isBlockingKnownBlock = (
  source: BlockSource,
  coordinates: BlockCoordinates,
): boolean => {
  const blockId = blockIdAt(source, coordinates)
  return blockId !== AIR_BLOCK_ID && isKnownBlockId(blockId)
}

export const raycastArrowInWorld = (
  source: BlockSource,
  request: ProjectileBlockRayRequest,
): Option.Option<ArrowBlockImpact> =>
  raycastArrowBlock(
    request.from,
    request.to,
    (...coordinates: BlockCoordinates) => isBlockingKnownBlock(source, coordinates),
  )

export type { ArrowBlockImpact, Position }
