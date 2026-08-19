import {
  AIR_BLOCK_ID,
  type BlockId,
  blockPosition,
} from '@nerima-games/mc-kernel'
import { type BlockWorld, blockAt, setBlockAt } from './block-world.js'
import {
  type ExplosionBlock,
  type ExplosionBlockReader,
  type ExplosionPlan,
  type ExplosionRequest,
  type PrimedTntPlan,
  type PrimedTntRequest,
  planExplosion,
  planPrimedTnt,
} from '@nerima-games/mc-sim'

export type BlockExplosionProfile = (blockId: BlockId) => ExplosionBlock | undefined

export type BlockWorldExplosionRequest<S> = Omit<ExplosionRequest<S>, 'blocks'> & {
  readonly world: BlockWorld
  readonly profile: BlockExplosionProfile
}

const explosionReader = (
  world: BlockWorld,
  profile: BlockExplosionProfile,
): ExplosionBlockReader => (position) =>
  profile(
    blockAt(
      world,
      blockPosition(position.x, position.y, position.z),
    ),
  )

export const planBlockWorldExplosion = <S>(
  request: BlockWorldExplosionRequest<S>,
): ExplosionPlan => {
  const { profile, world, ...explosionRequest } = request
  return planExplosion({
    ...explosionRequest,
    blocks: explosionReader(world, profile),
  })
}

export const applyExplosionToBlockWorld = (
  world: BlockWorld,
  plan: Pick<ExplosionPlan, 'destroyedBlocks'>,
): BlockWorld =>
  plan.destroyedBlocks.reduce(
    (next, position) =>
      setBlockAt(next, blockPosition(position.x, position.y, position.z), AIR_BLOCK_ID),
    world,
  )

export type BlockWorldExplosionResult = {
  readonly plan: ExplosionPlan
  readonly world: BlockWorld
}

export const explodeBlockWorld = <S>(
  request: BlockWorldExplosionRequest<S>,
): BlockWorldExplosionResult => {
  const plan = planBlockWorldExplosion(request)
  return {
    plan,
    world: applyExplosionToBlockWorld(request.world, plan),
  }
}

export type BlockWorldPrimedTntRequest<S> = Omit<PrimedTntRequest<S>, 'blocks'> & {
  readonly world: BlockWorld
  readonly profile: BlockExplosionProfile
}

export const planBlockWorldPrimedTnt = <S>(
  request: BlockWorldPrimedTntRequest<S>,
): PrimedTntPlan => {
  const { profile, world, ...tntRequest } = request
  return planPrimedTnt({
    ...tntRequest,
    blocks: explosionReader(world, profile),
  })
}

export const applyPrimedTntPlanToBlockWorld = (
  world: BlockWorld,
  plan: Pick<PrimedTntPlan, 'explosion'>,
): BlockWorld => {
  if (!plan.explosion) {
    return world
  }
  return applyExplosionToBlockWorld(world, plan.explosion)
}

export type BlockWorldPrimedTntResult = {
  readonly plan: PrimedTntPlan
  readonly world: BlockWorld
}

export const advancePrimedTntInBlockWorld = <S>(
  request: BlockWorldPrimedTntRequest<S>,
): BlockWorldPrimedTntResult => {
  const plan = planBlockWorldPrimedTnt(request)
  return {
    plan,
    world: applyPrimedTntPlanToBlockWorld(request.world, plan),
  }
}
