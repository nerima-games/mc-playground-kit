import {
  BlockId,
  aabb,
  blockIdOf,
  blockPosition,
  position,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  blockLightSourceAt,
  blockLightSourcesIn,
  blockLightAt,
  blockReaderOf,
  emptyBlockWorld,
  propagateBlockLight,
  setBlockAt,
} from '../src/domain/block-interaction'

const at = (x: number) => blockPosition(x, 0, 0)

describe('block light source occupancy', () => {
  it('projects kernel light emission into full-cell records', () => {
    const torch = blockIdOf('torch')
    const glowstone = blockIdOf('glowstone')
    const stone = blockIdOf('stone')
    const world = setBlockAt(
      setBlockAt(
        setBlockAt(emptyBlockWorld(), at(0), torch),
        at(1),
        glowstone,
      ),
      at(2),
      stone,
    )

    expect(blockLightSourceAt(world, at(0))).toEqual({
      blockId: torch,
      bounds: aabb(position(0, 0, 0), position(1, 1, 1)),
      level: 14,
      position: at(0),
    })
    expect(blockLightSourceAt(world, at(1))).toEqual({
      blockId: glowstone,
      bounds: aabb(position(1, 0, 0), position(2, 1, 1)),
      level: 15,
      position: at(1),
    })
    expect(blockLightSourceAt(world, at(2))).toBeNull()
    expect(blockLightSourceAt(world, at(3))).toBeNull()
    expect(
      blockLightSourceAt(setBlockAt(world, at(3), BlockId(255)), at(3)),
    ).toBeNull()
  })

  it('finds light sources through a block reader and range query', () => {
    const torch = blockIdOf('torch')
    const lava = blockIdOf('lava')
    const world = setBlockAt(
      setBlockAt(emptyBlockWorld(), at(0), torch),
      at(1),
      lava,
    )
    const reader = blockReaderOf(world)
    const bounds = aabb(position(0.1, 0.1, 0.1), position(2.1, 0.9, 0.9))

    expect(blockLightSourcesIn(reader, bounds)).toEqual([
      {
        blockId: torch,
        bounds: aabb(position(0, 0, 0), position(1, 1, 1)),
        level: 14,
        position: at(0),
      },
      {
        blockId: lava,
        bounds: aabb(position(1, 0, 0), position(2, 1, 1)),
        level: 15,
        position: at(1),
      },
    ])
  })

  it('does not count empty ranges or face-only overlap', () => {
    const torch = blockIdOf('torch')
    const world = setBlockAt(emptyBlockWorld(), at(0), torch)
    const edgeBounds = aabb(position(1, 0, 0), position(2, 1, 1))

    expect(blockLightSourcesIn(world, edgeBounds)).toEqual([])
    expect(
      blockLightSourcesIn(world, aabb(position(1, 1, 1), position(1, 1, 1))),
    ).toEqual([])
    expect(
      blockLightSourcesIn(
        emptyBlockWorld(),
        aabb(position(0, 0, 0), position(1, 1, 1)),
      ),
    ).toEqual([])
  })

  it('propagates block light through transmissive cells and respects blockers', () => {
    const torch = blockIdOf('torch')
    const stone = blockIdOf('stone')
    const world = setBlockAt(
      setBlockAt(
        setBlockAt(emptyBlockWorld(), at(-1), torch),
        at(2),
        stone,
      ),
      at(4),
      BlockId(255),
    )
    const reader = blockReaderOf(world)
    const source = (sourcePosition: Parameters<typeof reader>[0]) =>
      sourcePosition.x === 2 ? stone : reader(sourcePosition)
    const bounds = aabb(position(0, 0, 0), position(5, 1, 1))
    const field = propagateBlockLight(source, bounds)

    expect(blockLightAt(field, at(-1))).toBe(0)
    expect(blockLightAt(field, at(0))).toBe(13)
    expect(blockLightAt(field, at(1))).toBe(12)
    expect(blockLightAt(field, at(2))).toBe(0)
    expect(blockLightAt(field, at(3))).toBe(0)
    expect(blockLightAt(field, at(4))).toBe(0)
  })

  it('keeps the stronger source when paths meet and returns an empty field without sources', () => {
    const torch = blockIdOf('torch')
    const glowstone = blockIdOf('glowstone')
    const world = setBlockAt(
      setBlockAt(emptyBlockWorld(), at(0), torch),
      at(1),
      glowstone,
    )
    const field = propagateBlockLight(
      world,
      aabb(position(0, 0, 0), position(3, 1, 1)),
    )

    expect(blockLightAt(field, at(0))).toBe(14)
    expect(blockLightAt(field, at(1))).toBe(15)
    expect(blockLightAt(field, at(2))).toBe(14)
    expect(
      propagateBlockLight(
        emptyBlockWorld(),
        aabb(position(0, 0, 0), position(1, 1, 1)),
      ),
    ).toEqual(new Map())
  })
})
