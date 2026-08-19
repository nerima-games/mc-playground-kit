import {
  AIR_BLOCK_ID,
  type BlockId,
  blockPosition,
  isKnownBlockId,
} from '@nerima-games/mc-kernel'
import {
  type BlockSource,
  readBlockAt,
} from './block-world.js'
import {
  type BlockTarget,
  type PlayerPose,
  targetBlockFromPlayerPose,
} from '@nerima-games/mc-sim'
import { Option } from 'effect'

export type BlockTargetingRequest = {
  readonly maxDistance: number
  readonly playerPose: PlayerPose
}

type BlockCoordinates = readonly [blockX: number, blockY: number, blockZ: number]

const blockIdAt = (source: BlockSource, coordinates: BlockCoordinates): BlockId =>
  readBlockAt(source, blockPosition(...coordinates))

const isTargetableBlock = (source: BlockSource, coordinates: BlockCoordinates): boolean => {
  const blockId = blockIdAt(source, coordinates)
  return blockId !== AIR_BLOCK_ID && isKnownBlockId(blockId)
}

export const targetBlock = (
  source: BlockSource,
  request: BlockTargetingRequest,
): Option.Option<BlockTarget> =>
  targetBlockFromPlayerPose(
    request.playerPose,
    request.maxDistance,
    (...coordinates: BlockCoordinates) => isTargetableBlock(source, coordinates),
  )

export type { BlockTarget, PlayerPose }
