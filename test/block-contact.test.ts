import {
  BlockId,
  aabb,
  blockIdOf,
  blockPosition,
  position,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  blockContactAt,
  blockContactDamageIn,
  blockContactsIn,
  blockReaderOf,
  emptyBlockWorld,
  setBlockAt,
} from '../src/domain/block-interaction'

const at = (x: number) => blockPosition(x, 0, 0)

describe('block contact damage', () => {
  it('projects kernel contact damage and collision bounds', () => {
    const cactus = blockIdOf('cactus')
    const lava = blockIdOf('lava')
    const stone = blockIdOf('stone')
    const world = setBlockAt(
      setBlockAt(
        setBlockAt(emptyBlockWorld(), at(0), cactus),
        at(1),
        lava,
      ),
      at(2),
      stone,
    )

    expect(blockContactAt(world, at(0))).toEqual({
      blockId: cactus,
      bounds: aabb(position(1 / 16, 0, 1 / 16), position(15 / 16, 1, 15 / 16)),
      damage: 1,
      position: at(0),
    })
    expect(blockContactAt(world, at(1))).toEqual({
      blockId: lava,
      bounds: aabb(position(1, 0, 0), position(2, 1, 1)),
      damage: 4,
      position: at(1),
    })
    expect(blockContactAt(world, at(2))).toBeNull()
    expect(blockContactAt(world, at(3))).toBeNull()
    expect(blockContactAt(world, at(4))).toBeNull()
    expect(blockContactAt(world, at(5))).toBeNull()
    expect(blockContactAt(setBlockAt(world, at(5), BlockId(255)), at(5))).toBeNull()
  })

  it('finds intersecting contacts through a block reader and aggregates damage', () => {
    const cactus = blockIdOf('cactus')
    const lava = blockIdOf('lava')
    const world = setBlockAt(
      setBlockAt(emptyBlockWorld(), at(0), cactus),
      at(1),
      lava,
    )
    const reader = blockReaderOf(world)
    const bounds = aabb(position(0.1, 0.1, 0.1), position(2.1, 0.9, 0.9))

    expect(blockContactsIn(reader, bounds).map(({ blockId }) => blockId)).toEqual([
      cactus,
      lava,
    ])
    expect(blockContactDamageIn(reader, bounds)).toEqual({
      amount: 5,
      cause: 'block_contact',
    })
  })

  it('does not count empty ranges or face-only contact', () => {
    const cactus = blockIdOf('cactus')
    const world = setBlockAt(emptyBlockWorld(), at(0), cactus)
    const edgeBounds = aabb(position(15 / 16, 0, 0), position(1, 1, 1))

    expect(blockContactsIn(world, edgeBounds)).toEqual([])
    expect(blockContactsIn(world, aabb(position(1, 1, 1), position(1, 1, 1)))).toEqual([])
    expect(blockContactDamageIn(world, edgeBounds)).toBeUndefined()
  })
})
