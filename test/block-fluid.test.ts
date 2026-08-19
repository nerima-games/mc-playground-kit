import {
  BlockId,
  aabb,
  blockIdOf,
  blockPosition,
  position,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  blockFluidAt,
  blockFluidsIn,
  blockReaderOf,
  emptyBlockWorld,
  emptyFluidState,
  fluidLevel,
  fluidStateFromWorld,
  fluidVolumeAt,
  fluidVolumesIn,
  setBlockAt,
  setFluidCell,
} from '../src/domain/block-interaction'

const at = (x: number) => blockPosition(x, 0, 0)

describe('block fluid occupancy', () => {
  it('projects kernel fluid properties into full-cell records', () => {
    const water = blockIdOf('water')
    const lava = blockIdOf('lava')
    const stone = blockIdOf('stone')
    const world = setBlockAt(
      setBlockAt(
        setBlockAt(emptyBlockWorld(), at(0), water),
        at(1),
        lava,
      ),
      at(2),
      stone,
    )

    expect(blockFluidAt(world, at(0))).toEqual({
      blockId: water,
      bounds: aabb(position(0, 0, 0), position(1, 1, 1)),
      kind: 'water',
      position: at(0),
    })
    expect(blockFluidAt(world, at(1))).toEqual({
      blockId: lava,
      bounds: aabb(position(1, 0, 0), position(2, 1, 1)),
      kind: 'lava',
      position: at(1),
    })
    expect(blockFluidAt(world, at(2))).toBeNull()
    expect(blockFluidAt(world, at(3))).toBeNull()
    expect(blockFluidAt(setBlockAt(world, at(3), BlockId(255)), at(3))).toBeNull()
  })

  it('finds fluid cells through a block reader and range query', () => {
    const water = blockIdOf('water')
    const lava = blockIdOf('lava')
    const world = setBlockAt(
      setBlockAt(emptyBlockWorld(), at(0), water),
      at(1),
      lava,
    )
    const reader = blockReaderOf(world)
    const bounds = aabb(position(0.1, 0.1, 0.1), position(2.1, 0.9, 0.9))

    expect(blockFluidsIn(reader, bounds)).toEqual([
      {
        blockId: water,
        bounds: aabb(position(0, 0, 0), position(1, 1, 1)),
        kind: 'water',
        position: at(0),
      },
      {
        blockId: lava,
        bounds: aabb(position(1, 0, 0), position(2, 1, 1)),
        kind: 'lava',
        position: at(1),
      },
    ])
  })

  it('does not count empty ranges or face-only overlap', () => {
    const water = blockIdOf('water')
    const world = setBlockAt(emptyBlockWorld(), at(0), water)
    const edgeBounds = aabb(position(1, 0, 0), position(2, 1, 1))

    expect(blockFluidsIn(world, edgeBounds)).toEqual([])
    expect(blockFluidsIn(world, aabb(position(1, 1, 1), position(1, 1, 1)))).toEqual([])
    expect(blockFluidsIn(emptyBlockWorld(), aabb(position(0, 0, 0), position(1, 1, 1)))).toEqual([])
  })

  it('projects flowing and falling state into partial fluid volumes', () => {
    const water = blockIdOf('water')
    const lava = blockIdOf('lava')
    const world = setBlockAt(
      setBlockAt(emptyBlockWorld(), at(0), water),
      at(1),
      lava,
    )
    let state = fluidStateFromWorld(world)
    state = setFluidCell(state, at(0), {
      falling: false,
      kind: 'water',
      level: fluidLevel(3),
    })
    state = setFluidCell(state, at(1), {
      falling: true,
      kind: 'lava',
      level: fluidLevel(1),
    })

    expect(fluidVolumeAt(world, state, at(0))).toEqual({
      blockId: water,
      bounds: aabb(position(0, 0, 0), position(1, 0.375, 1)),
      falling: false,
      kind: 'water',
      level: fluidLevel(3),
      position: at(0),
    })
    expect(fluidVolumeAt(world, state, at(1))).toEqual({
      blockId: lava,
      bounds: aabb(position(1, 0, 0), position(2, 1, 1)),
      falling: true,
      kind: 'lava',
      level: fluidLevel(1),
      position: at(1),
    })
    expect(fluidVolumeAt(world, emptyFluidState(), at(0))).toBeNull()
    expect(
      fluidVolumesIn(
        blockReaderOf(world),
        state,
        aabb(position(0.1, 0.4, 0.1), position(2.1, 0.9, 0.9)),
      ),
    ).toEqual([
      {
        blockId: lava,
        bounds: aabb(position(1, 0, 0), position(2, 1, 1)),
        falling: true,
        kind: 'lava',
        level: fluidLevel(1),
        position: at(1),
      },
    ])
  })
})
