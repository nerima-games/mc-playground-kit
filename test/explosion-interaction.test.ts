import {
  AIR_BLOCK_ID,
  BlockId,
  blockIdOf,
  blockPosition,
  type BlockId as BlockIdType,
} from '@nerima-games/mc-kernel'
import {
  primeTnt,
  type ExplosionBlock,
  type PrimedTntState,
} from '@nerima-games/mc-sim'
import { describe, expect, it } from 'vitest'
import {
  blockAt,
  emptyBlockWorld,
  setBlockAt,
  type BlockWorld,
} from '../src/domain/block-interaction'
import {
  advancePrimedTntInBlockWorld,
  explodeBlockWorld,
  type BlockExplosionProfile,
} from '../src/domain/explosion-interaction'

const position = blockPosition(0, 0, 0)
const dirt = blockIdOf('dirt')
const bedrock = blockIdOf('bedrock')

const profileData = new Map<BlockIdType, ExplosionBlock>([
  [dirt, { resistance: 0, destructible: true }],
  [bedrock, { resistance: 0, destructible: false }],
])

const explosionProfile: BlockExplosionProfile = (blockId) =>
  blockId === AIR_BLOCK_ID
    ? { resistance: 0, destructible: false }
    : profileData.get(blockId)

const requestFor = (world: BlockWorld) => ({
  center: { x: 0.5, y: 0.5, z: 0.5 },
  entities: [],
  profile: explosionProfile,
  radius: 2,
  seed: 17,
  world,
})

const tntRequestFor = (
  world: BlockWorld,
  state: PrimedTntState,
  deltaTimeSecs: number,
) => ({
  ...requestFor(world),
  deltaTimeSecs,
  state,
})

describe('explosion interaction', () => {
  it('plans through a profile and applies only the planned blocks immutably', () => {
    const world = setBlockAt(emptyBlockWorld(), position, dirt)
    const result = explodeBlockWorld(requestFor(world))

    expect(result.plan.destroyedBlocks).toContainEqual({ x: 0, y: 0, z: 0 })
    expect(blockAt(world, position)).toBe(dirt)
    expect(blockAt(result.world, position)).toBe(AIR_BLOCK_ID)
  })

  it('keeps shielded and unloaded cells unchanged', () => {
    const shieldedWorld = setBlockAt(emptyBlockWorld(), position, bedrock)
    const shielded = explodeBlockWorld(requestFor(shieldedWorld))
    const unknownBlock = BlockId(255)
    const unloadedWorld = setBlockAt(emptyBlockWorld(), position, unknownBlock)
    const unloaded = explodeBlockWorld(requestFor(unloadedWorld))

    expect(shielded.plan.destroyedBlocks).toHaveLength(0)
    expect(shielded.world).toBe(shieldedWorld)
    expect(unloaded.plan.destroyedBlocks).toHaveLength(0)
    expect(unloaded.world).toBe(unloadedWorld)
  })

  it('advances primed TNT without mutating early and detonates exactly at its fuse', () => {
    const world = setBlockAt(emptyBlockWorld(), position, dirt)
    const waiting = advancePrimedTntInBlockWorld(
      tntRequestFor(world, primeTnt(2), 0.5),
    )
    const detonated = advancePrimedTntInBlockWorld(
      tntRequestFor(world, primeTnt(0.5), 0.5),
    )

    expect(waiting.plan.after).toEqual({
      kind: 'primed',
      remainingFuseSecs: 1.5,
    })
    expect(waiting.plan.explosion).toBeUndefined()
    expect(waiting.world).toBe(world)
    expect(detonated.plan.after).toEqual({ kind: 'detonated' })
    expect(detonated.plan.explosion).toBeDefined()
    expect(blockAt(detonated.world, position)).toBe(AIR_BLOCK_ID)
  })
})
