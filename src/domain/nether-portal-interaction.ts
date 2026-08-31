import {
  type BlockPosition,
  type PortalFrame,
  blockIdOf,
  blockPosition,
  detectNetherPortal,
} from '@nerima-games/mc-kernel'
import { type BlockWorld, blockReaderOf, setBlockAt } from './block-world.js'
import { Option } from 'effect'

export type NetherPortalActivation = {
  readonly frame: PortalFrame
  readonly world: BlockWorld
}

const materializePortal = (world: BlockWorld, frame: PortalFrame): BlockWorld =>
  frame.interior.reduce(
    (next, position) => setBlockAt(next, position, blockIdOf('nether_portal')),
    world,
  )

export const activateNetherPortal = (
  world: BlockWorld,
  ignition: BlockPosition,
): Option.Option<NetherPortalActivation> => {
  const readBlock = blockReaderOf(world)
  const frame = detectNetherPortal(
    (blockX, blockY, blockZ) => readBlock(blockPosition(blockX, blockY, blockZ)),
    ignition,
  )

  if (!frame) {
    return Option.none()
  }

  return Option.some({
    frame,
    world: materializePortal(world, frame),
  })
}
