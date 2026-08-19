import { type BlockWorld, emptyBlockWorld } from './block-world.js'
import { type PlayerStorage, emptyPlayerStorage } from '@nerima-games/mc-sim'

export type BlockInteractionState = {
  readonly playerStorage: PlayerStorage
  readonly world: BlockWorld
}

export const makeBlockInteractionState = (
  world: BlockWorld = emptyBlockWorld(),
  playerStorage: PlayerStorage = emptyPlayerStorage(),
): BlockInteractionState => ({ playerStorage, world })
