import {
  BlockId,
  aabb,
  blockIdOf,
  blockPosition,
  position,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  blockAt,
  blockCollisionAt,
  blockCollisionsIn,
  emptyBlockWorld,
  setBlockAt,
} from '../src/domain/block-interaction'
import { blockReaderOfChunkWorld, emptyChunkWorld, writeBlockAtChunkWorld } from '../src/domain/chunk-world'

const at = (x: number) => blockPosition(x, 0, 0)

describe('block collision', () => {
  it('projects every kernel collision shape to a block hull', () => {
    const stone = blockIdOf('stone')
    const slab = blockIdOf('stone_slab')
    const cactus = blockIdOf('cactus')
    const pressurePlate = blockIdOf('pressure_plate')
    const water = blockIdOf('water')
    const unknown = BlockId(255)
    const world = setBlockAt(
      setBlockAt(
        setBlockAt(
          setBlockAt(
            setBlockAt(
              setBlockAt(emptyBlockWorld(), at(0), stone),
              at(1),
              slab,
            ),
            at(2),
            cactus,
          ),
          at(3),
          pressurePlate,
        ),
        at(4),
        water,
      ),
      at(5),
      unknown,
    )

    expect(blockCollisionAt(world, at(0))).toEqual({
      blockId: stone,
      bounds: aabb(position(0, 0, 0), position(1, 1, 1)),
      position: at(0),
      shape: 'full',
    })
    expect(blockCollisionAt(world, at(1))).toEqual({
      blockId: slab,
      bounds: aabb(position(1, 0, 0), position(2, 0.5, 1)),
      position: at(1),
      shape: 'slab',
    })
    expect(blockCollisionAt(world, at(2))).toEqual({
      blockId: cactus,
      bounds: aabb(position(2 + 1 / 16, 0, 1 / 16), position(3 - 1 / 16, 1, 15 / 16)),
      position: at(2),
      shape: 'cactus',
    })
    expect(blockCollisionAt(world, at(3))).toEqual({
      blockId: pressurePlate,
      bounds: aabb(position(3, 0, 0), position(4, 1 / 16, 1)),
      position: at(3),
      shape: 'pressurePlate',
    })
    expect(blockCollisionAt(world, at(4))).toBeNull()
    expect(blockCollisionAt(world, at(5))).toBeNull()
    expect(blockCollisionAt(world, at(6))).toBeNull()
  })

  it('returns sparse collisions that intersect a query hull', () => {
    const world = setBlockAt(
      setBlockAt(
        setBlockAt(
          setBlockAt(
            setBlockAt(
              setBlockAt(
                setBlockAt(emptyBlockWorld(), at(0), blockIdOf('stone')),
                at(1),
                blockIdOf('stone_slab'),
              ),
              at(2),
              blockIdOf('cactus'),
            ),
            at(3),
            blockIdOf('pressure_plate'),
          ),
          at(4),
          blockIdOf('water'),
        ),
        at(5),
        BlockId(255),
      ),
      at(6),
      blockIdOf('stone'),
    )
    const query = aabb(position(0, 0, 0), position(6, 1, 1))

    const result = blockCollisionsIn(world, query)

    expect(result.map(({ position: collisionPosition }) => collisionPosition)).toEqual([
      at(0),
      at(1),
      at(2),
      at(3),
    ])
    expect(result.map(({ shape }) => shape)).toEqual([
      'full',
      'slab',
      'cactus',
      'pressurePlate',
    ])
    expect(blockAt(world, at(6))).toBe(blockIdOf('stone'))
    expect(blockCollisionsIn(emptyBlockWorld(), query)).toEqual([])
  })

  it('resolves a single collision through a finite chunk world point reader', () => {
    const written = writeBlockAtChunkWorld(
      emptyChunkWorld(384, -64),
      at(0),
      blockIdOf('stone'),
    )

    if (written.outcome !== 'updated') {
      throw new Error(`Expected chunk update, got ${written.outcome}`)
    }

    expect(blockCollisionAt(blockReaderOfChunkWorld(written.world), at(0))?.shape).toBe('full')
    expect(blockCollisionAt(blockReaderOfChunkWorld(written.world), at(1))).toBeNull()
  })
})
