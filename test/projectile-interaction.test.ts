import { BlockId, blockIdOf, blockPosition } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { emptyBlockWorld, setBlockAt } from '../src/domain/block-interaction'
import { blockReaderOfChunkWorld, emptyChunkWorld, writeBlockAtChunkWorld } from '../src/domain/chunk-world'
import { raycastArrowInWorld } from '../src/domain/projectile-interaction'

describe('projectile interaction', () => {
  it('resolves the first known blocking block on an arrow segment', () => {
    const world = setBlockAt(
      emptyBlockWorld(),
      blockPosition(0, 0, -2),
      blockIdOf('dirt'),
    )

    const result = raycastArrowInWorld(world, {
      from: { x: 0.5, y: 0.5, z: 0.5 },
      to: { x: 0.5, y: 0.5, z: -3.5 },
    })

    expect(Option.isSome(result)).toBe(true)
    if (Option.isNone(result)) {
      return
    }

    expect(result.value.distance).toBeGreaterThan(0)
    expect(result.value.point.z).toBe(-1)
  })

  it('treats unknown blocks as transparent and preserves the world', () => {
    const world = setBlockAt(
      setBlockAt(
        emptyBlockWorld(),
        blockPosition(0, 0, -1),
        BlockId(255),
      ),
      blockPosition(0, 0, -2),
      blockIdOf('dirt'),
    )

    const result = raycastArrowInWorld(world, {
      from: { x: 0.5, y: 0.5, z: 0.5 },
      to: { x: 0.5, y: 0.5, z: -3.5 },
    })

    expect(Option.isSome(result)).toBe(true)
    expect(world.size).toBe(2)
  })

  it('returns none when the arrow segment misses every known block', () => {
    const world = setBlockAt(
      emptyBlockWorld(),
      blockPosition(1, 0, -2),
      blockIdOf('dirt'),
    )

    const result = raycastArrowInWorld(world, {
      from: { x: 0.5, y: 0.5, z: 0.5 },
      to: { x: 0.5, y: 0.5, z: -3.5 },
    })

    expect(Option.isNone(result)).toBe(true)
  })

  it('raycasts against a finite chunk world point reader', () => {
    const written = writeBlockAtChunkWorld(
      emptyChunkWorld(384, -64),
      blockPosition(0, 0, -2),
      blockIdOf('dirt'),
    )

    if (written.outcome !== 'updated') {
      throw new Error(`Expected chunk update, got ${written.outcome}`)
    }

    const result = raycastArrowInWorld(blockReaderOfChunkWorld(written.world), {
      from: { x: 0.5, y: 0.5, z: 0.5 },
      to: { x: 0.5, y: 0.5, z: -3.5 },
    })

    expect(Option.isSome(result)).toBe(true)
    if (Option.isNone(result)) {
      throw new Error('Expected an impact in the chunk world')
    }

    expect(result.value.point.z).toBe(-1)
  })
})
