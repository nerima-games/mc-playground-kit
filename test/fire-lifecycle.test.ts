import { blockIdOf, type BlockId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  FIRE_BURN_DURATION_TICKS,
  FIRE_DAMAGE_INTERVAL_TICKS,
  FIRE_FRAME_TICK_BUDGET,
  FIRE_LIFECYCLE_SNAPSHOT_VERSION,
  FIRE_NATURAL_LIFETIME_TICKS,
  FIRE_TICK_INTERVAL_SECS,
  FIRE_UNLOADED_RETRY_LIMIT,
  FIRE_UNAVAILABLE_BLOCK,
  FIRE_WORK_BUDGET,
  WATER_BLOCK_ID,
  advanceFireLifecycle,
  extinguishFire,
  fireDamageFor,
  isFireLifecycleSnapshot,
  makeFireLifecycleSnapshot,
  makeFireLifecycleState,
  restoreFireLifecycleSnapshot,
} from '../src/domain/fire-lifecycle'
import { atIndex, firstOf } from './support/require-present'

const air = blockIdOf('air')
const fire = blockIdOf('fire')
const stone = blockIdOf('stone')
const log = blockIdOf('oak_log')

const at = (x: number, y = 0, z = 0) => ({ x, y, z })
const cell = (
  position: ReturnType<typeof at>,
  block: BlockId | typeof FIRE_UNAVAILABLE_BLOCK,
  exposedToSky?: boolean,
) => ({ position, block, ...(exposedToSky === undefined ? {} : { exposedToSky }) })
const burningFire = (position = at(0), ageTicks = 0, unloadedRetries?: number) => ({
  position,
  ageTicks,
  ...(unloadedRetries === undefined ? {} : { unloadedRetries }),
})
const supportedCells = (position = at(0), exposedToSky?: boolean) => [
  cell(position, fire, exposedToSky),
  cell(at(position.x, position.y - 1, position.z), stone),
]

describe('fire lifecycle', () => {
  it('normalizes fire state, seed, and snapshots without sharing positions', () => {
    const state = makeFireLifecycleState([at(2), at(1), at(2)], 0)
    expect(state).toEqual({
      fires: [burningFire(at(1)), burningFire(at(2))],
      seed: 1,
    })
    expect(makeFireLifecycleState([], Number.NaN).seed).toBe(1)
    expect(extinguishFire(state, at(1))).toEqual({
      fires: [burningFire(at(2))],
      seed: 1,
    })

    const burningActors = [{
      id: 'player',
      kind: 'player' as const,
      position: at(3),
      remainingTicks: 4,
      damageCooldownTicks: 0,
    }]
    const snapshot = makeFireLifecycleSnapshot(
      { ...state, burningActors },
      FIRE_TICK_INTERVAL_SECS * (FIRE_FRAME_TICK_BUDGET + 1),
    )
    expect(snapshot).toEqual({
      version: FIRE_LIFECYCLE_SNAPSHOT_VERSION,
      fires: state.fires,
      burningActors,
      seed: 1,
      tickAccumulatorSecs: FIRE_TICK_INTERVAL_SECS * FIRE_FRAME_TICK_BUDGET,
    })
    const snapshotFire = firstOf(snapshot.fires, 'the snapshot fire')
    const snapshotActor = firstOf(snapshot.burningActors, 'the snapshot burning actor')
    expect(snapshotFire.position).not.toBe(firstOf(state.fires, 'the state fire').position)
    expect(snapshotActor.position).not.toBe(
      firstOf(burningActors, 'the state burning actor').position,
    )
    expect(snapshotFire.position.x).toBe(1)
    expect(snapshotActor.position.x).toBe(3)
    expect(makeFireLifecycleSnapshot(state, Number.NaN).tickAccumulatorSecs).toBe(0)

    const restored = restoreFireLifecycleSnapshot({
      ...snapshot,
      seed: 0,
      tickAccumulatorSecs: -1,
    })
    expect(restored.state.seed).toBe(1)
    expect(restored.tickAccumulatorSecs).toBe(0)
    expect(firstOf(restored.state.fires, 'the restored fire').position)
      .not.toBe(snapshotFire.position)
    expect(firstOf(restored.state.fires, 'the restored fire').position.x).toBe(1)
  })

  it('validates snapshot boundaries before restoring them', () => {
    const valid = makeFireLifecycleSnapshot(
      {
        fires: [burningFire(at(0), 1, 0)],
        burningActors: [{
          id: 'zombie',
          kind: 'entity',
          position: at(1),
          remainingTicks: 1,
          damageCooldownTicks: 0,
        }],
        seed: 1,
      },
      0,
    )
    expect(isFireLifecycleSnapshot(valid)).toBe(true)
    expect(isFireLifecycleSnapshot(null)).toBe(false)
    expect(isFireLifecycleSnapshot({ ...valid, version: 0 })).toBe(false)
    expect(isFireLifecycleSnapshot({ ...valid, fires: {} })).toBe(false)
    expect(isFireLifecycleSnapshot({ ...valid, fires: [null] })).toBe(false)
    expect(isFireLifecycleSnapshot({
      ...valid,
      fires: [{ ...valid.fires[0], position: null }],
    })).toBe(false)
    expect(isFireLifecycleSnapshot({
      ...valid,
      fires: [{ ...valid.fires[0], ageTicks: -1 }],
    })).toBe(false)
    expect(isFireLifecycleSnapshot({
      ...valid,
      fires: [{ ...valid.fires[0], unloadedRetries: -1 }],
    })).toBe(false)
    expect(isFireLifecycleSnapshot({
      ...valid,
      fires: [{ ...valid.fires[0], unloadedRetries: 0.5 }],
    })).toBe(false)
    expect(isFireLifecycleSnapshot({
      ...valid,
      burningActors: {},
    })).toBe(false)
    expect(isFireLifecycleSnapshot({ ...valid, burningActors: [null] })).toBe(false)
    expect(isFireLifecycleSnapshot({
      ...valid,
      burningActors: [{ ...valid.burningActors[0], id: 1 }],
    })).toBe(false)
    expect(isFireLifecycleSnapshot({
      ...valid,
      burningActors: [{ ...valid.burningActors[0], kind: 'player', position: null }],
    })).toBe(false)
    expect(isFireLifecycleSnapshot({
      ...valid,
      burningActors: [{ ...valid.burningActors[0], remainingTicks: 0 }],
    })).toBe(false)
    expect(isFireLifecycleSnapshot({
      ...valid,
      burningActors: [{ ...valid.burningActors[0], damageCooldownTicks: -1 }],
    })).toBe(false)
    expect(isFireLifecycleSnapshot({ ...valid, seed: Number.NaN })).toBe(false)
    expect(isFireLifecycleSnapshot({ ...valid, tickAccumulatorSecs: Number.NaN })).toBe(false)
    expect(isFireLifecycleSnapshot({ ...valid, tickAccumulatorSecs: -1 })).toBe(false)
  })

  it('applies natural expiry, support, rain, unloaded retries, and spread', () => {
    expect(fireDamageFor('peaceful')).toBeUndefined()
    expect(fireDamageFor('easy')).toEqual({ amount: 1, cause: 'fire' })
    expect(fireDamageFor('normal')).toEqual({ amount: 1, cause: 'fire' })
    expect(fireDamageFor('hard')).toEqual({ amount: 2, cause: 'fire' })

    const missing = advanceFireLifecycle(makeFireLifecycleState([at(0)], 1), [], 'clear')
    expect(missing.state.fires).toEqual([burningFire(at(0), 0, 1)])
    const exhausted = advanceFireLifecycle(
      { fires: [burningFire(at(0), 0, FIRE_UNLOADED_RETRY_LIMIT)], seed: 1 },
      [],
      'clear',
    )
    expect(exhausted.state.fires).toEqual([])
    const unavailable = advanceFireLifecycle(
      { fires: [burningFire(at(0), 0, 0)], seed: 1 },
      [cell(at(0), FIRE_UNAVAILABLE_BLOCK)],
      'clear',
    )
    expect(firstOf(unavailable.state.fires, 'the unavailable fire').unloadedRetries).toBe(1)

    const wrongBlock = advanceFireLifecycle(
      makeFireLifecycleState([at(0)], 1),
      [cell(at(0), stone)],
      'clear',
    )
    expect(wrongBlock.state.fires).toEqual([])
    const rainy = advanceFireLifecycle(
      makeFireLifecycleState([at(0)], 1),
      supportedCells(at(0), true),
      'rain',
    )
    expect(rainy.state.fires).toEqual([])
    expect(rainy.mutations).toEqual([{ position: at(0), block: air }])
    const thunder = advanceFireLifecycle(
      makeFireLifecycleState([at(0)], 1),
      supportedCells(at(0), true),
      'thunder',
    )
    expect(thunder.state.fires).toEqual([])

    const unsupported = advanceFireLifecycle(
      makeFireLifecycleState([at(0)], 1),
      [cell(at(0), fire), cell(at(0, -1), air)],
      'clear',
    )
    expect(unsupported.mutations).toEqual([{ position: at(0), block: air }])
    const waterSupportedByLog = advanceFireLifecycle(
      makeFireLifecycleState([at(0)], 1),
      [
        cell(at(0), fire),
        cell(at(0, -1), WATER_BLOCK_ID),
        cell(at(1), log),
      ],
      'clear',
    )
    expect(waterSupportedByLog.state.fires).toContainEqual(burningFire(at(0), 1))
    expect(waterSupportedByLog.state.seed).not.toBe(1)

    const natural = advanceFireLifecycle(
      { fires: [burningFire(at(0), FIRE_NATURAL_LIFETIME_TICKS - 1)], seed: 1 },
      supportedCells(),
      'clear',
    )
    expect(natural.state.fires).toEqual([])
    expect(natural.mutations).toEqual([{ position: at(0), block: air }])

    const missingBelow = advanceFireLifecycle(
      makeFireLifecycleState([at(5)], 1),
      [cell(at(5), fire)],
      'clear',
    )
    expect(missingBelow.state.fires).toEqual([burningFire(at(5), 1)])

    const sameX = advanceFireLifecycle(
      {
        fires: [
          burningFire(at(0, 0, 0), FIRE_NATURAL_LIFETIME_TICKS - 1),
          burningFire(at(0, 1, 0), FIRE_NATURAL_LIFETIME_TICKS - 1),
          burningFire(at(0, 1, 1), FIRE_NATURAL_LIFETIME_TICKS - 1),
        ],
        seed: 1,
      },
      [
        cell(at(0, 0, 0), fire),
        cell(at(0, -1, 0), stone),
        cell(at(0, 1, 0), fire),
        cell(at(0, 1, 1), fire),
      ],
      'clear',
    )
    expect(sameX.mutations).toEqual([
      { position: at(0, 0, 0), block: air },
      { position: at(0, 1, 0), block: air },
      { position: at(0, 1, 1), block: air },
    ])

    const noSpread = advanceFireLifecycle(
      makeFireLifecycleState([at(0)], 2_147_483_646),
      [...supportedCells(), cell(at(1), log)],
      'clear',
    )
    expect(noSpread.state.fires).toEqual([burningFire(at(0), 1)])
    expect(noSpread.mutations).toEqual([])

    const twoSources = advanceFireLifecycle(
      makeFireLifecycleState([at(0), at(2)], 1),
      [
        ...supportedCells(at(0)),
        ...supportedCells(at(2)),
        cell(at(1), log),
      ],
      'clear',
    )
    expect(twoSources.state.fires).toContainEqual(burningFire(at(1)))
    expect(twoSources.mutations.filter(({ position }) => position.x === 1)).toHaveLength(1)
  })

  it('bounds work per frame and preserves deferred fires', () => {
    const fires = Array.from({ length: FIRE_WORK_BUDGET + 1 }, (_, x) => burningFire(at(x)))
    const result = advanceFireLifecycle({ fires, seed: 1 }, [], 'clear')
    expect(result.state.fires).toHaveLength(FIRE_WORK_BUDGET + 1)
    expect(firstOf(result.state.fires, 'the burned fire').unloadedRetries).toBe(1)
    expect(atIndex(result.state.fires, FIRE_WORK_BUDGET, 'the deferred fires').unloadedRetries)
      .toBeUndefined()
  })

  it('tracks player and entity fire contacts with difficulty and cooldown rules', () => {
    const player = {
      id: 'player',
      kind: 'player' as const,
      position: at(0),
    }
    const entity = {
      id: 'zombie',
      kind: 'entity' as const,
      position: at(0),
    }
    const first = advanceFireLifecycle(
      { fires: [burningFire()], seed: 1 },
      supportedCells(),
      'clear',
      [at(0), player, entity],
      'hard',
    )
    expect(first.damages).toEqual([{ _tag: 'FireContact', at: at(0), damage: { amount: 2, cause: 'fire' } }])
    expect(first.entityDamages).toEqual([{ actorId: 'zombie', at: at(0), damage: { amount: 2, cause: 'fire' } }])
    expect(first.state.burningActors).toEqual([
      { id: 'player', kind: 'player', position: at(0), remainingTicks: FIRE_BURN_DURATION_TICKS - 1, damageCooldownTicks: FIRE_DAMAGE_INTERVAL_TICKS - 1 },
      { id: 'zombie', kind: 'entity', position: at(0), remainingTicks: FIRE_BURN_DURATION_TICKS - 1, damageCooldownTicks: FIRE_DAMAGE_INTERVAL_TICKS - 1 },
    ])

    const cooldown = advanceFireLifecycle(
      {
        fires: [burningFire()],
        burningActors: [{ id: 'player', kind: 'player', position: at(0), remainingTicks: 3, damageCooldownTicks: 2 }],
        seed: 1,
      },
      supportedCells(),
      'clear',
      [player],
      'normal',
    )
    expect(cooldown.damages).toEqual([])
    expect(cooldown.state.burningActors?.[0]?.damageCooldownTicks).toBe(1)

    const noDamage = advanceFireLifecycle(
      {
        fires: [burningFire()],
        burningActors: [{ id: 'player', kind: 'player', position: at(0), remainingTicks: 2, damageCooldownTicks: 0 }],
        seed: 1,
      },
      supportedCells(),
      'clear',
      [player],
      'peaceful',
    )
    expect(noDamage.damages).toEqual([])
    expect(noDamage.state.burningActors?.[0]?.damageCooldownTicks).toBe(0)

    const retainedWithoutContact = advanceFireLifecycle(
      {
        fires: [],
        burningActors: [{ id: 'player', kind: 'player', position: at(4), remainingTicks: 2, damageCooldownTicks: 1 }],
        seed: 1,
      },
      [],
      'clear',
    )
    expect(retainedWithoutContact.state.burningActors).toEqual([
      { id: 'player', kind: 'player', position: at(4), remainingTicks: 2, damageCooldownTicks: 1 },
    ])

    const dead = advanceFireLifecycle(
      {
        fires: [],
        burningActors: [
          { id: 'dead', kind: 'entity', position: at(1), remainingTicks: 2, damageCooldownTicks: 0 },
          { id: 'wet', kind: 'entity', position: at(2), remainingTicks: 2, damageCooldownTicks: 0 },
          { id: 'rain', kind: 'entity', position: at(3), remainingTicks: 2, damageCooldownTicks: 0 },
          { id: 'expires', kind: 'entity', position: at(4), remainingTicks: 1, damageCooldownTicks: 0 },
        ],
        seed: 1,
      },
      [],
      'rain',
      [
        { id: 'dead', kind: 'entity', position: at(1), alive: false },
        { id: 'wet', kind: 'entity', position: at(2), inWater: true },
        { id: 'rain', kind: 'entity', position: at(3), exposedToSky: true },
        { id: 'expires', kind: 'entity', position: at(4) },
      ],
    )
    expect(dead.state.burningActors).toEqual([])

    const explicitEmpty = advanceFireLifecycle(
      { fires: [], burningActors: [], seed: 1 },
      [],
      'clear',
      [{ id: 'outside', kind: 'player', position: at(9) }],
    )
    expect(explicitEmpty.state).toEqual({ fires: [], burningActors: [], seed: 1 })
  })
})
