import {
  AIR_BLOCK_ID,
  BlockId,
  blockIdOf,
  blockPosition,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  advanceWitherInBlockWorld,
  damageWitherInBlockWorld,
  makeWitherInteractionState,
  summonWitherInBlockWorld,
  type WitherInteractionState,
} from '../src/domain/wither-interaction'
import { blockAt, emptyBlockWorld, setBlockAt, type BlockWorld } from '../src/domain/block-world'

type CellSpec = readonly [number, number, number, BlockId]

const base = blockPosition(10, 20, -3)
const soulSand = blockIdOf('soul_sand')
const soulSoil = blockIdOf('soul_soil')
const skull = blockIdOf('wither_skeleton_skull')

const cellsFor = (
  axis: 'x' | 'z',
  body: BlockId,
  skullBlock: BlockId,
): ReadonlyArray<CellSpec> => {
  const side = axis === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 }
  return [
    [0, 0, 0, body],
    [0, 1, 0, body],
    [side.x, 1, side.z, body],
    [-side.x, 1, -side.z, body],
    [-side.x, 2, -side.z, skullBlock],
    [0, 2, 0, skullBlock],
    [side.x, 2, side.z, skullBlock],
  ]
}

const worldWithCells = (origin: BlockPosition, cells: ReadonlyArray<CellSpec>): BlockWorld =>
  cells.reduce(
    (world, [x, y, z, blockId]) =>
      setBlockAt(world, blockPosition(origin.x + x, origin.y + y, origin.z + z), blockId),
    emptyBlockWorld(),
  )

const summonableState = (axis: 'x' | 'z' = 'x', body = soulSand): WitherInteractionState => {
  const world = worldWithCells(base, cellsFor(axis, body, skull))
  return summonWitherInBlockWorld(makeWitherInteractionState(world), base).state
}

describe('wither interaction', () => {
  it('matches a kernel-backed structure and consumes only its seven cells', () => {
    const cells = cellsFor('x', soulSand, skull)
    const outside = blockPosition(base.x + 3, base.y, base.z)
    const originalWorld = setBlockAt(
      worldWithCells(base, cells),
      outside,
      blockIdOf('dirt'),
    )
    const result = summonWitherInBlockWorld(makeWitherInteractionState(originalWorld), base)

    expect(result.outcome).toBe('summoned')
    expect(result.match?.axis).toBe('x')
    expect(result.match?.consumedBlocks).toHaveLength(7)
    expect(result.state.wither).toMatchObject({
      phase: 'charging',
      feetPosition: { x: 10.5, y: 21, z: -2.5 },
    })
    for (const [x, y, z] of cells) {
      const position = blockPosition(base.x + x, base.y + y, base.z + z)
      expect(blockAt(originalWorld, position)).not.toBe(AIR_BLOCK_ID)
      expect(blockAt(result.state.world, position)).toBe(AIR_BLOCK_ID)
    }
    expect(blockAt(result.state.world, outside)).toBe(blockIdOf('dirt'))
    expect(result.state.world).not.toBe(originalWorld)
  })

  it('accepts the z-axis and soul-soil variants while rejecting unknown structure cells', () => {
    const valid = summonWitherInBlockWorld(
      makeWitherInteractionState(worldWithCells(base, cellsFor('z', soulSoil, skull))),
      base,
    )
    expect(valid.outcome).toBe('summoned')
    expect(valid.match?.axis).toBe('z')

    const unknownCell = blockPosition(base.x, base.y, base.z)
    const invalidWorld = setBlockAt(
      worldWithCells(base, cellsFor('x', soulSand, skull)),
      unknownCell,
      BlockId(255),
    )
    const invalid = summonWitherInBlockWorld(makeWitherInteractionState(invalidWorld), base)
    expect(invalid.outcome).toBe('invalid')
    expect(invalid.match).toBeUndefined()
    expect(invalid.state.world).toBe(invalidWorld)

    const alreadyPresent = summonWitherInBlockWorld(valid.state, base)
    expect(alreadyPresent.outcome).toBe('already-present')
    expect(alreadyPresent.state).toBe(valid.state)
  })

  it('preserves an existing upstream wither when composing interaction state', () => {
    const summoned = summonableState()
    const state = makeWitherInteractionState(summoned.world, summoned.wither)

    expect(state.world).toBe(summoned.world)
    expect(state.wither).toBe(summoned.wither)
  })

  it('returns absent, charge, spawn explosion, and target-following transitions', () => {
    const absent = advanceWitherInBlockWorld(makeWitherInteractionState(), 1)
    expect(absent.outcome).toBe('absent')
    expect(absent.spawnExplosion).toBeUndefined()

    const charging = summonableState()
    const waiting = advanceWitherInBlockWorld(charging, 9)
    expect(waiting.outcome).toBe('advanced')
    expect(waiting.spawnExplosion).toBeUndefined()
    expect(waiting.state.wither).toMatchObject({ phase: 'charging', chargeRemainingSecs: 1 })
    expect(waiting.state.world).toBe(charging.world)

    const airborne = advanceWitherInBlockWorld(waiting.state, 1)
    expect(airborne.state.wither?.phase).toBe('airborne')
    expect(airborne.spawnExplosion).toEqual({ power: 7, position: { x: 10.5, y: 21, z: -2.5 } })

    const following = advanceWitherInBlockWorld(airborne.state, 1, { x: 15, y: 21, z: -2.5 })
    expect(following.spawnExplosion).toBeUndefined()
    expect(following.state.wither?.feetPosition.x).toBeGreaterThan(10.5)
  })

  it('delegates damage phases and preserves death payloads', () => {
    const absent = damageWitherInBlockWorld(makeWitherInteractionState(), 10, 'melee')
    expect(absent.outcome).toBe('absent')
    expect(absent.ignored).toBe(true)

    const charging = summonableState()
    const ignoredWhileCharging = damageWitherInBlockWorld(charging, 10, 'melee')
    expect(ignoredWhileCharging.outcome).toBe('damaged')
    expect(ignoredWhileCharging.appliedDamage).toBe(0)
    expect(ignoredWhileCharging.ignored).toBe(true)

    const airborne = advanceWitherInBlockWorld(charging, 10).state
    const armoured = damageWitherInBlockWorld(airborne, 200, 'melee')
    expect(armoured.state.wither).toMatchObject({ phase: 'armoured', healthPoints: 100 })

    const ranged = damageWitherInBlockWorld(armoured.state, 10, 'ranged')
    expect(ranged.appliedDamage).toBe(0)
    expect(ranged.ignored).toBe(true)

    const killed = damageWitherInBlockWorld(armoured.state, 100, 'explosion')
    expect(killed.state.wither?.phase).toBe('dead')
    expect(killed.death).toEqual({
      despawn: { kind: 'wither', reason: 'killed' },
      drop: { item: 'nether_star', count: 1, position: { x: 10.5, y: 21, z: -2.5 } },
    })
  })
})
