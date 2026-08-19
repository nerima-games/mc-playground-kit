import {
  AIR_BLOCK_ID,
  type BlockDrop,
  type BlockId,
  type BlockPosition,
  type HarvestContext,
  dropOfBlockId,
  isKnownBlockId,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import {
  type DamageAtResult,
  type PlayerStorage,
  type StorageLocation,
  addItem,
  damageAt,
  withInventory,
} from '@nerima-games/mc-sim'
import {
  type UnsupportedBlock,
  removeUnsupportedBlocksAbove,
} from './block-support-interaction.js'
import { blockAt, setBlockAt } from './block-world.js'
import { type BlockInteractionState } from './block-interaction-state.js'

export type BreakBlockRequest = {
  readonly position: BlockPosition
  readonly harvestContext?: HarvestContext | undefined
  readonly toolLocation?: StorageLocation | undefined
}

export type BreakBlockOutcome = 'broken' | 'empty' | 'unknown'

export type BreakBlockResult = {
  readonly blockId: BlockId
  readonly detached?: ReadonlyArray<DetachedBlockResult>
  readonly drop?: BlockDrop
  readonly experience: number
  readonly leftover: number
  readonly outcome: BreakBlockOutcome
  readonly position: BlockPosition
  readonly state: BlockInteractionState
  readonly toolDamage?: DamageAtResult
}

export type DetachedBlockResult = UnsupportedBlock & {
  readonly leftover: number
}

type UnchangedBreakResultContext = {
  readonly blockId: BlockId
  readonly outcome: Exclude<BreakBlockOutcome, 'broken'>
  readonly position: BlockPosition
  readonly state: BlockInteractionState
}

const NO_EXPERIENCE = 0
const NO_DETACHED_BLOCKS = 0

const unchangedBreakResult = ({
  blockId,
  outcome,
  position,
  state,
}: UnchangedBreakResultContext): BreakBlockResult => ({
  blockId,
  experience: NO_EXPERIENCE,
  leftover: 0,
  outcome,
  position,
  state,
})

type DropAddition = {
  readonly playerStorage: PlayerStorage
  readonly leftover: number
}

const addDrop = (playerStorage: PlayerStorage, drop: BlockDrop | undefined): DropAddition => {
  if (!drop) {
    return { leftover: 0, playerStorage }
  }

  const added = addItem(playerStorage.inventory, drop.item, drop.count)
  return {
    leftover: added.leftover,
    playerStorage: withInventory(playerStorage, added.inventory),
  }
}

type DetachedDropAddition = {
  readonly detached: ReadonlyArray<DetachedBlockResult>
  readonly playerStorage: PlayerStorage
}

const addDetachedBlockDrop = (
  playerStorage: PlayerStorage,
  block: UnsupportedBlock,
): DropAddition => {
  if (block.transition === 'falling') {
    return { leftover: 0, playerStorage }
  }

  return addDrop(playerStorage, block.drop)
}

const addDetachedDrops = (
  playerStorage: PlayerStorage,
  detached: ReadonlyArray<UnsupportedBlock>,
): DetachedDropAddition => {
  let nextPlayerStorage = playerStorage
  const results: DetachedBlockResult[] = []

  for (const block of detached) {
    const added = addDetachedBlockDrop(nextPlayerStorage, block)
    nextPlayerStorage = added.playerStorage
    results.push({ ...block, leftover: added.leftover })
  }

  return { detached: results, playerStorage: nextPlayerStorage }
}

type ToolDamage = {
  readonly playerStorage: PlayerStorage
  readonly result?: DamageAtResult
}

const TOOL_DAMAGE = 1

const damageTool = (
  playerStorage: PlayerStorage,
  location: StorageLocation | undefined,
): ToolDamage => {
  if (!location) {
    return { playerStorage }
  }

  const damaged = damageAt(playerStorage, location, TOOL_DAMAGE)
  return { playerStorage: damaged.storage, result: damaged.result }
}

type BreakBlockBase = Omit<BreakBlockResult, 'detached' | 'drop' | 'toolDamage'>

const withToolDamage = (
  result: BreakBlockBase,
  toolDamage: DamageAtResult | undefined,
): Omit<BreakBlockResult, 'detached' | 'drop'> => {
  if (!toolDamage) {
    return result
  }

  return { ...result, toolDamage }
}

const withDetached = (
  result: Omit<BreakBlockResult, 'detached'>,
  detached: ReadonlyArray<DetachedBlockResult>,
): Omit<BreakBlockResult, 'drop'> => {
  if (detached.length === NO_DETACHED_BLOCKS) {
    return result
  }

  return { ...result, detached }
}

const withBreakDrop = (
  result: Omit<BreakBlockResult, 'drop'>,
  drop: BlockDrop | undefined,
): BreakBlockResult => {
  if (!drop) {
    return result
  }

  return { ...result, drop }
}

const experienceOfBreak = (
  blockId: BlockId,
  drop: BlockDrop | undefined,
  harvestContext: HarvestContext | undefined,
): number => {
  if (!drop || harvestContext?.silkTouch === true) {
    return NO_EXPERIENCE
  }

  return propertyOfBlockId(blockId, 'xpOnBreak')
}

const breakKnownBlock = (
  state: BlockInteractionState,
  request: BreakBlockRequest,
  blockId: BlockId,
): BreakBlockResult => {
  const drop = dropOfBlockId(blockId, request.harvestContext)
  const experience = experienceOfBreak(blockId, drop, request.harvestContext)
  const added = addDrop(state.playerStorage, drop)
  const clearedWorld = setBlockAt(state.world, request.position, AIR_BLOCK_ID)
  const support = removeUnsupportedBlocksAbove(clearedWorld, request.position)
  const detached = addDetachedDrops(added.playerStorage, support.removed)
  const damaged = damageTool(detached.playerStorage, request.toolLocation)
  const nextState: BlockInteractionState = {
    playerStorage: damaged.playerStorage,
    world: support.world,
  }

  const result: BreakBlockBase = {
    blockId,
    experience,
    leftover: added.leftover,
    outcome: 'broken',
    position: request.position,
    state: nextState,
  }

  return withBreakDrop(
    withDetached(withToolDamage(result, damaged.result), detached.detached),
    drop,
  )
}

export const breakBlock = (
  state: BlockInteractionState,
  request: BreakBlockRequest,
): BreakBlockResult => {
  const blockId = blockAt(state.world, request.position)

  if (blockId === AIR_BLOCK_ID) {
    return unchangedBreakResult({
      blockId,
      outcome: 'empty',
      position: request.position,
      state,
    })
  }

  if (!isKnownBlockId(blockId)) {
    return unchangedBreakResult({
      blockId,
      outcome: 'unknown',
      position: request.position,
      state,
    })
  }

  return breakKnownBlock(state, request, blockId)
}
