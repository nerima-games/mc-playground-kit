import {
  AIR_BLOCK_ID,
  type PortalAxis,
  blockIdOf,
  blockPosition,
  generatePortalLayout,
} from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { blockAt, emptyBlockWorld, setBlockAt } from '../src/domain/block-interaction.js'
import { activateNetherPortal } from '../src/domain/nether-portal-interaction.js'
import { firstOf } from './support/require-present'

const makePortalFrame = (axis: PortalAxis) => {
  const layout = generatePortalLayout(blockPosition(4, 10, -3), axis, 2, 3)
  const world = layout.frame.reduce(
    (next, position) => setBlockAt(next, position, blockIdOf('obsidian')),
    emptyBlockWorld(),
  )

  return { layout, world }
}

describe('nether portal interaction', () => {
  it.each(['x', 'z'] as const)('activates a valid %s-axis frame', (axis) => {
    const { layout, world } = makePortalFrame(axis)
    const interior = firstOf(layout.interior, 'the portal interior')
    const activation = activateNetherPortal(world, interior)

    expect(Option.isSome(activation)).toBe(true)
    if (Option.isNone(activation)) {
      return
    }

    expect(activation.value.frame.axis).toBe(axis)
    expect(activation.value.frame.width).toBe(2)
    expect(activation.value.frame.height).toBe(3)
    expect(activation.value.world).not.toBe(world)
    expect(layout.interior.every((position) => blockAt(activation.value.world, position) === blockIdOf('nether_portal'))).toBe(true)
    expect(layout.frame.every((position) => blockAt(activation.value.world, position) === blockIdOf('obsidian'))).toBe(true)
    expect(layout.interior.every((position) => blockAt(world, position) === AIR_BLOCK_ID)).toBe(true)
  })

  it('rejects a frame with a missing non-corner block', () => {
    const { layout, world } = makePortalFrame('x')
    const interior = firstOf(layout.interior, 'the portal interior')
    const incomplete = setBlockAt(world, blockPosition(4, 9, -3), AIR_BLOCK_ID)

    expect(Option.isNone(activateNetherPortal(incomplete, interior))).toBe(true)
  })

  it('rejects a non-air ignition cell', () => {
    const { layout, world } = makePortalFrame('x')
    const interior = firstOf(layout.interior, 'the portal interior')
    const occupied = setBlockAt(world, interior, blockIdOf('stone'))

    expect(Option.isNone(activateNetherPortal(occupied, interior))).toBe(true)
    expect(blockAt(occupied, interior)).toBe(blockIdOf('stone'))
  })

  it('does not relight an already active portal', () => {
    const { layout, world } = makePortalFrame('x')
    const interior = firstOf(layout.interior, 'the portal interior')
    const activation = activateNetherPortal(world, interior)

    expect(Option.isSome(activation)).toBe(true)
    if (Option.isNone(activation)) {
      return
    }

    expect(Option.isNone(activateNetherPortal(activation.value.world, interior))).toBe(true)
  })
})
