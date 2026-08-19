import { BlockId, blockIdOf, blockPosition } from '@nerima-games/mc-kernel'
import { INITIAL_PLAYER_POSE } from '@nerima-games/mc-sim'
import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { emptyBlockWorld, setBlockAt } from '../src/domain/block-interaction'
import { blockReaderOfChunkWorld, emptyChunkWorld, writeBlockAtChunkWorld } from '../src/domain/chunk-world'
import { targetBlock } from '../src/domain/block-targeting'

describe('block targeting', () => {
  it('resolves the first known non-air block and its placement face', () => {
    const world = setBlockAt(
      setBlockAt(emptyBlockWorld(), blockPosition(0, 1, -2), blockIdOf('water')),
      blockPosition(0, 1, -3),
      blockIdOf('dirt'),
    )

    const result = targetBlock(world, {
      maxDistance: 6,
      playerPose: INITIAL_PLAYER_POSE,
    })

    expect(Option.isSome(result)).toBe(true)
    if (Option.isNone(result)) {
      return
    }

    expect(result.value.position).toEqual({ x: 0, y: 1, z: -2 })
    expect(result.value.adjacentPosition).toEqual({ x: 0, y: 1, z: -1 })
    expect(result.value.distance).toBe(1)
  })

  it('skips unknown ids and returns none when no target is in range', () => {
    const world = setBlockAt(
      emptyBlockWorld(),
      blockPosition(0, 1, -1),
      BlockId(255),
    )

    const noTarget = targetBlock(world, {
      maxDistance: 6,
      playerPose: INITIAL_PLAYER_POSE,
    })
    const tooNear = targetBlock(
      setBlockAt(world, blockPosition(0, 1, -3), blockIdOf('dirt')),
      {
        maxDistance: 0,
        playerPose: INITIAL_PLAYER_POSE,
      },
    )

    expect(Option.isNone(noTarget)).toBe(true)
    expect(Option.isNone(tooNear)).toBe(true)
  })

  it('does not mutate the sparse world while resolving a target', () => {
    const world = setBlockAt(emptyBlockWorld(), blockPosition(0, 1, -2), blockIdOf('dirt'))

    targetBlock(world, { maxDistance: 6, playerPose: INITIAL_PLAYER_POSE })

    expect(world.size).toBe(1)
  })

  it('accepts a finite chunk world through its point reader', () => {
    const result = writeBlockAtChunkWorld(
      emptyChunkWorld(384, -64),
      blockPosition(0, 1, -2),
      blockIdOf('dirt'),
    )

    if (result.outcome !== 'updated') {
      throw new Error(`Expected chunk update, got ${result.outcome}`)
    }

    const target = targetBlock(blockReaderOfChunkWorld(result.world), {
      maxDistance: 6,
      playerPose: INITIAL_PLAYER_POSE,
    })

    expect(Option.isSome(target)).toBe(true)
    if (Option.isNone(target)) {
      throw new Error('Expected a target in the chunk world')
    }

    expect(target.value.position).toEqual({ x: 0, y: 1, z: -2 })
  })
})
