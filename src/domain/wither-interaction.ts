import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type Position,
  blockPosition,
  blockTypeOfId,
} from '@nerima-games/mc-kernel'
import { type BlockWorld, blockAt, emptyBlockWorld, setBlockAt } from './block-world.js'
import {
  type WitherDamageKind,
  type WitherDamageResult,
  type WitherState,
  type WitherStep,
  type WitherSummonMatch,
  createWither,
  damageWither,
  matchWitherSummon,
  stepWither,
} from '@nerima-games/mc-sim'

export type WitherInteractionState = {
  readonly wither?: WitherState
  readonly world: BlockWorld
}

export const makeWitherInteractionState = (
  world: BlockWorld = emptyBlockWorld(),
  wither?: WitherState,
): WitherInteractionState => {
  if (!wither) {
    return { world }
  }
  return { wither, world }
}

const summonMaterialOfBlockId = (blockId: BlockId) => {
  if (blockId === AIR_BLOCK_ID) {
    return 'air' as const
  }

  return blockTypeOfId(blockId) ?? 'unknown'
}

const summonMatchInWorld = (
  world: BlockWorld,
  base: BlockPosition,
): WitherSummonMatch | undefined =>
  matchWitherSummon(
    base,
    (cell) => summonMaterialOfBlockId(blockAt(world, blockPosition(cell.x, cell.y, cell.z))),
  )

const consumeSummonBlocks = (world: BlockWorld, match: WitherSummonMatch): BlockWorld =>
  match.consumedBlocks.reduce(
    (next, cell) => setBlockAt(next, blockPosition(cell.x, cell.y, cell.z), AIR_BLOCK_ID),
    world,
  )

export type SummonWitherResult = {
  readonly match?: WitherSummonMatch
  readonly outcome: 'summoned' | 'invalid' | 'already-present'
  readonly state: WitherInteractionState
}

export const summonWitherInBlockWorld = (
  state: WitherInteractionState,
  base: BlockPosition,
): SummonWitherResult => {
  if (state.wither) {
    return { outcome: 'already-present', state }
  }

  const match = summonMatchInWorld(state.world, base)
  if (!match) {
    return { outcome: 'invalid', state }
  }

  return {
    match,
    outcome: 'summoned',
    state: {
      wither: createWither(match.spawnPosition),
      world: consumeSummonBlocks(state.world, match),
    },
  }
}

export type AdvanceWitherResult = {
  readonly outcome: 'advanced' | 'absent'
  readonly spawnExplosion?: Exclude<WitherStep['spawnExplosion'], undefined>
  readonly state: WitherInteractionState
}

export const advanceWitherInBlockWorld = (
  state: WitherInteractionState,
  deltaTimeSecs: number,
  targetPosition?: Position,
): AdvanceWitherResult => {
  if (!state.wither) {
    return { outcome: 'absent', state }
  }

  const step = stepWither(state.wither, deltaTimeSecs, targetPosition)
  const nextState = { ...state, wither: step.state }
  if (!step.spawnExplosion) {
    return { outcome: 'advanced', state: nextState }
  }
  return { outcome: 'advanced', spawnExplosion: step.spawnExplosion, state: nextState }
}

export type DamageWitherInteractionResult = Omit<WitherDamageResult, 'death' | 'state'> & {
  readonly death?: Exclude<WitherDamageResult['death'], undefined>
  readonly outcome: 'damaged' | 'absent'
  readonly state: WitherInteractionState
}

export const damageWitherInBlockWorld = (
  state: WitherInteractionState,
  amount: number,
  kind: WitherDamageKind,
): DamageWitherInteractionResult => {
  if (!state.wither) {
    return {
      appliedDamage: 0,
      ignored: true,
      outcome: 'absent',
      state,
    }
  }

  const result = damageWither(state.wither, amount, kind)
  const nextState = { ...state, wither: result.state }
  if (!result.death) {
    return {
      appliedDamage: result.appliedDamage,
      ignored: result.ignored,
      outcome: 'damaged',
      state: nextState,
    }
  }
  return {
    appliedDamage: result.appliedDamage,
    death: result.death,
    ignored: result.ignored,
    outcome: 'damaged',
    state: nextState,
  }
}
