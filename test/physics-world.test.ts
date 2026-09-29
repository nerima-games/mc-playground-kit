import {
  BlockId,
  blockIdOf,
  blockPosition,
} from '@nerima-games/mc-kernel'
import { HalfHeight } from '@nerima-games/mc-physics'
import { type SimPhysicsConfig } from '@nerima-games/mc-sim'
import { describe, expect, it } from 'vitest'
import {
  emptyBlockWorld,
  setBlockAt,
} from '../src/domain/block-interaction'
import { blockReaderOf, readBlockAt } from '../src/domain/block-world'
import { resolveOptionsForBlockSource } from '../src/domain/physics-world'

const halfHeight = HalfHeight(0.9)
type RelativeBounds = Exclude<
  ReturnType<NonNullable<SimPhysicsConfig['resolve']['blockShapeAt']>>,
  null
>

const options = (source: Parameters<typeof resolveOptionsForBlockSource>[0]) =>
  resolveOptionsForBlockSource(source, {
    halfHeight,
    halfWidth: 0.3,
    stepHeight: 0.6,
  })

const shape = (
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): RelativeBounds => ({ minX, minY, minZ, maxX, maxY, maxZ })

describe('block physics options', () => {
  it('adapts kernel collision hulls to the upstream cell-relative callbacks', () => {
    const world = setBlockAt(
      setBlockAt(
        setBlockAt(
          setBlockAt(emptyBlockWorld(), blockPosition(4, 8, -2), blockIdOf('stone')),
          blockPosition(5, 8, -2),
          blockIdOf('stone_slab'),
        ),
        blockPosition(6, 8, -2),
        blockIdOf('cactus'),
      ),
      blockPosition(7, 8, -2),
      blockIdOf('water'),
    )
    const physics = options(world)

    expect(physics.halfWidth).toBe(0.3)
    expect(physics.halfHeight).toBe(halfHeight)
    expect(physics.stepHeight).toBe(0.6)
    expect(physics.blockPropertiesAt(4, 8, -2)?.collisionShape).toBe('full')
    expect(physics.blockPropertiesAt(7, 8, -2)?.collisionShape).toBe('none')
    expect(physics.blockPropertiesAt(8, 8, -2)).toBeNull()
    expect(physics.blockShapeAt?.(4, 8, -2)).toEqual(shape(0, 0, 0, 1, 1, 1))
    expect(physics.blockShapeAt?.(5, 8, -2)).toEqual(shape(0, 0, 0, 1, 0.5, 1))
    expect(physics.blockShapeAt?.(6, 8, -2)).toEqual(
      shape(1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16),
    )
    expect(physics.blockShapeAt?.(7, 8, -2)).toBeNull()
  })

  it('accepts a point reader without copying the sparse world', () => {
    const stone = blockIdOf('stone')
    const world = setBlockAt(emptyBlockWorld(), blockPosition(-3, 2, 5), stone)
    const physics = options(blockReaderOf(world))

    expect(physics.blockShapeAt?.(-3, 2, 5)).toEqual(shape(0, 0, 0, 1, 1, 1))
    expect(physics.blockPropertiesAt(-2, 2, 5)).toBeNull()
    expect(readBlockAt(world, blockPosition(-3, 2, 5))).toBe(stone)
  })

  it('does not treat unknown ids as solid', () => {
    const world = setBlockAt(
      emptyBlockWorld(),
      blockPosition(0, 0, 0),
      BlockId(255),
    )
    const physics = options(world)

    expect(physics.blockPropertiesAt(0, 0, 0)).toBeNull()
    expect(physics.blockShapeAt?.(0, 0, 0)).toBeNull()
  })

})
