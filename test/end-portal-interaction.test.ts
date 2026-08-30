import {
  AIR_BLOCK_ID,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  type BlockPositionKey,
} from '@nerima-games/mc-kernel'
import {
  END_PORTAL_FRAME_OFFSETS,
  type EndPortalFrameFacing,
} from '@nerima-games/mc-worldgen'
import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { blockAt, emptyBlockWorld, setBlockAt } from '../src/domain/block-interaction.js'
import {
  activateEndPortal,
  endPortalFrameReaderOf,
} from '../src/domain/end-portal-interaction.js'

const CENTER = blockPosition(0, 64, 0)

const makeEndPortalFrame = () => {
  let world = emptyBlockWorld()
  const facings = new Map<BlockPositionKey, EndPortalFrameFacing>()

  for (const offset of END_PORTAL_FRAME_OFFSETS) {
    const position = blockPosition(CENTER.x + offset.dx, CENTER.y, CENTER.z + offset.dz)
    world = setBlockAt(world, position, blockIdOf('end_portal_frame_filled'))
    facings.set(blockPositionKeyOf(position), offset.facing)
  }

  return { facings, world }
}

describe('end portal interaction', () => {
  it('activates a complete overworld portal and preserves its frames', () => {
    const { facings, world } = makeEndPortalFrame()
    const activation = activateEndPortal({
      world,
      dimension: 'overworld',
      center: CENTER,
      readFrame: endPortalFrameReaderOf(world, facings),
    })

    expect(Option.isSome(activation)).toBe(true)
    if (Option.isNone(activation)) {
      return
    }

    expect(activation.value.portal.frames).toHaveLength(12)
    expect(activation.value.portal.materialization).toHaveLength(9)
    expect(activation.value.world).not.toBe(world)
    expect(activation.value.portal.materialization.every(({ at }) => blockAt(activation.value.world, at) === blockIdOf('end_portal'))).toBe(true)
    expect(activation.value.portal.frames.every((at) => blockAt(activation.value.world, at) === blockIdOf('end_portal_frame_filled'))).toBe(true)
    expect(activation.value.portal.materialization.every(({ at }) => blockAt(world, at) === AIR_BLOCK_ID)).toBe(true)
  })

  it('rejects portal frames outside the overworld', () => {
    const { facings, world } = makeEndPortalFrame()

    expect(Option.isNone(activateEndPortal({
      world,
      dimension: 'nether',
      center: CENTER,
      readFrame: endPortalFrameReaderOf(world, facings),
    }))).toBe(true)
  })

  it('rejects a frame with a missing or incorrectly facing eye', () => {
    const { facings, world } = makeEndPortalFrame()
    const missingFacing = new Map(facings)
    missingFacing.delete(blockPositionKeyOf(blockPosition(-1, CENTER.y, -2)))

    expect(Option.isNone(activateEndPortal({
      world,
      dimension: 'overworld',
      center: CENTER,
      readFrame: endPortalFrameReaderOf(world, missingFacing),
    }))).toBe(true)

    const incorrectlyFacing = new Map(facings)
    incorrectlyFacing.set(blockPositionKeyOf(blockPosition(-1, CENTER.y, -2)), 'north')

    expect(Option.isNone(activateEndPortal({
      world,
      dimension: 'overworld',
      center: CENTER,
      readFrame: endPortalFrameReaderOf(world, incorrectlyFacing),
    }))).toBe(true)
  })

  it('does not replace an occupied or already active interior', () => {
    const { facings, world } = makeEndPortalFrame()
    const occupied = setBlockAt(world, CENTER, blockIdOf('stone'))

    expect(Option.isNone(activateEndPortal({
      world: occupied,
      dimension: 'overworld',
      center: CENTER,
      readFrame: endPortalFrameReaderOf(occupied, facings),
    }))).toBe(true)

    const activation = activateEndPortal({
      world,
      dimension: 'overworld',
      center: CENTER,
      readFrame: endPortalFrameReaderOf(world, facings),
    })

    expect(Option.isSome(activation)).toBe(true)
    if (Option.isNone(activation)) {
      return
    }

    expect(Option.isNone(activateEndPortal({
      world: activation.value.world,
      dimension: 'overworld',
      center: CENTER,
      readFrame: endPortalFrameReaderOf(activation.value.world, facings),
    }))).toBe(true)
  })
})
