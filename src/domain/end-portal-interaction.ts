import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type BlockPositionKey,
  type Dimension,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
} from '@nerima-games/mc-kernel'
import { type BlockWorld, blockAt, setBlockAt } from './block-world.js'
import {
  type CompletedEndPortal,
  type EndPortalFrameFacing,
  detectCompletedEndPortal,
} from '@nerima-games/mc-worldgen'
import { Option } from 'effect'

export type EndPortalFrameState = {
  readonly block: BlockId
  readonly facing: EndPortalFrameFacing
}

export type EndPortalFrameReader = (position: BlockPosition) => EndPortalFrameState | undefined

export type EndPortalActivation = {
  readonly portal: CompletedEndPortal
  readonly world: BlockWorld
}

export type EndPortalActivationRequest = {
  readonly world: BlockWorld
  readonly dimension: Dimension
  readonly center: BlockPosition
  readonly readFrame: EndPortalFrameReader
}

export const endPortalFrameReaderOf = (
  world: BlockWorld,
  facings: ReadonlyMap<BlockPositionKey, EndPortalFrameFacing>,
): EndPortalFrameReader => (position) => {
  const facing = facings.get(blockPositionKeyOf(position))
  return facing && { block: blockAt(world, position), facing }
}

const materializeEndPortal = (world: BlockWorld, portal: CompletedEndPortal): BlockWorld =>
  portal.materialization.reduce(
    (next, mutation) => setBlockAt(next, mutation.at, blockIdOf('end_portal')),
    world,
  )

const hasOccupiedInterior = (world: BlockWorld, portal: CompletedEndPortal): boolean =>
  portal.materialization.some(({ at }) => blockAt(world, at) !== AIR_BLOCK_ID)

export const activateEndPortal = ({
  world,
  dimension,
  center,
  readFrame,
}: EndPortalActivationRequest): Option.Option<EndPortalActivation> => {
  const portal = detectCompletedEndPortal(
    (...coordinates: [number, number, number]) => readFrame(blockPosition(...coordinates)),
    dimension,
    center,
  )

  if (Option.isNone(portal) || hasOccupiedInterior(world, portal.value)) {
    return Option.none()
  }

  return Option.some({
    portal: portal.value,
    world: materializeEndPortal(world, portal.value),
  })
}
