import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPositionKey,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  FLUID_BLOCK_IDS,
  FLUID_LEVEL_MAX,
  FLUID_LEVEL_MIN,
  FLUID_LEVEL_STEP,
  FLUID_MIX_BLOCK_IDS,
  FLOWING_FLUID_LEVEL,
  SOURCE_FLUID_LEVEL,
  blockAt,
  blockIdOfFluidKind,
  canFluidReplace,
  clearFluidCell,
  emptyBlockWorld,
  emptyFluidState,
  fluidCellAt,
  fluidKindOfBlockId,
  fluidLevel,
  fluidStateFromWorld,
  scheduleFluidAt,
  setBlockAt,
  setFluidCell,
  unscheduleFluidAt,
  updateFluids,
} from '../src/domain/block-interaction'

const at = (x: number, y = 0, z = 0) => blockPosition(x, y, z)

const place = (
  world: ReadonlyMap<BlockPositionKey, BlockId>,
  position: ReturnType<typeof at>,
  blockId: BlockId,
): ReadonlyMap<BlockPositionKey, BlockId> =>
  setBlockAt(world, position, blockId)

const blockedAround = (
  world: ReadonlyMap<BlockPositionKey, BlockId>,
  source: ReturnType<typeof at>,
  blockId: BlockId,
): ReadonlyMap<BlockPositionKey, BlockId> => {
  let next = place(world, at(source.x - 1, source.y, source.z), blockId)
  next = place(next, at(source.x + 1, source.y, source.z), blockId)
  next = place(next, at(source.x, source.y, source.z - 1), blockId)
  next = place(next, at(source.x, source.y, source.z + 1), blockId)
  return next
}

const sourceCell = (kind: 'lava' | 'water') => ({
  falling: false,
  kind,
  level: fluidLevel(SOURCE_FLUID_LEVEL),
})

describe('fluid data and state', () => {
  it('maps kernel fluid blocks and validates immutable state transitions', () => {
    const water = blockIdOf('water')
    const lava = blockIdOf('lava')
    const stone = blockIdOf('stone')
    expect(FLUID_BLOCK_IDS.water).toBe(water)
    expect(FLUID_BLOCK_IDS.lava).toBe(lava)
    expect(FLUID_MIX_BLOCK_IDS.cobblestone).toBe(blockIdOf('cobblestone'))
    expect(FLUID_MIX_BLOCK_IDS.obsidian).toBe(blockIdOf('obsidian'))
    expect(blockIdOfFluidKind('water')).toBe(water)
    expect(blockIdOfFluidKind('lava')).toBe(lava)
    expect(fluidKindOfBlockId(water)).toBe('water')
    expect(fluidKindOfBlockId(lava)).toBe('lava')
    expect(fluidKindOfBlockId(stone)).toBeNull()

    expect(fluidLevel(FLUID_LEVEL_MIN)).toBe(FLUID_LEVEL_MIN)
    expect(fluidLevel(FLUID_LEVEL_MAX)).toBe(FLUID_LEVEL_MAX)
    expect(() => fluidLevel(FLUID_LEVEL_MIN - FLUID_LEVEL_STEP)).toThrow()
    expect(() => fluidLevel(FLUID_LEVEL_MAX + FLUID_LEVEL_STEP)).toThrow()
    expect(() => fluidLevel(1.5)).toThrow()

    const position = at(2)
    const otherPosition = at(3)
    const empty = emptyFluidState()
    const cell = sourceCell('water')
    expect(fluidCellAt(empty, position)).toBeNull()
    expect(clearFluidCell(empty, position)).toBe(empty)
    expect(unscheduleFluidAt(empty, position)).toBe(empty)

    const withCell = setFluidCell(empty, position, cell)
    expect(fluidCellAt(withCell, position)).toEqual(cell)
    expect(setFluidCell(withCell, position, cell)).not.toBe(withCell)

    const scheduled = scheduleFluidAt(withCell, position)
    expect(scheduleFluidAt(scheduled, position)).toBe(scheduled)
    expect(unscheduleFluidAt(scheduled, otherPosition)).toBe(scheduled)
    const unscheduled = unscheduleFluidAt(scheduled, position)
    expect(unscheduled.scheduled.has(blockPositionKeyOf(position))).toBe(false)

    const cleared = clearFluidCell(scheduled, position)
    expect(fluidCellAt(cleared, position)).toBeNull()
    expect(cleared.scheduled.has(blockPositionKeyOf(position))).toBe(false)

    const scheduledOnly = scheduleFluidAt(empty, otherPosition)
    const clearedScheduledOnly = clearFluidCell(scheduledOnly, otherPosition)
    expect(clearedScheduledOnly.scheduled.has(blockPositionKeyOf(otherPosition))).toBe(false)
  })

  it('derives source cells only from fluid blocks in the world', () => {
    const source = at(0)
    const stonePosition = at(1)
    const world = place(
      place(emptyBlockWorld(), source, blockIdOf('water')),
      stonePosition,
      blockIdOf('stone'),
    )

    const state = fluidStateFromWorld(world)

    expect(fluidCellAt(state, source)).toEqual(sourceCell('water'))
    expect(state.scheduled.has(blockPositionKeyOf(source))).toBe(true)
    expect(fluidCellAt(state, stonePosition)).toBeNull()
    expect(state.scheduled.has(blockPositionKeyOf(stonePosition))).toBe(false)
  })
})

describe('fluid update', () => {
  it('flows downward first and records a falling change', () => {
    const source = at(0)
    const below = at(0, -1)
    const water = blockIdOf('water')
    const result = updateFluids(place(emptyBlockWorld(), source, water))

    expect(blockAt(result.world, below)).toBe(water)
    expect(result.changes).toEqual([
      {
        after: water,
        before: AIR_BLOCK_ID,
        falling: true,
        fluid: 'water',
        kind: 'flow',
        level: fluidLevel(SOURCE_FLUID_LEVEL),
        position: below,
      },
    ])
    expect(fluidCellAt(result.state, below)).toEqual({
      falling: true,
      kind: 'water',
      level: fluidLevel(SOURCE_FLUID_LEVEL),
    })
    expect(result.state.scheduled.has(blockPositionKeyOf(below))).toBe(true)
    expect(result.state.scheduled.has(blockPositionKeyOf(source))).toBe(false)
  })

  it('flows horizontally with attenuated levels when downward flow is blocked', () => {
    const source = at(0)
    const stone = blockIdOf('stone')
    const water = blockIdOf('water')
    const world = place(
      place(emptyBlockWorld(), source, water),
      at(0, -1),
      stone,
    )
    const result = updateFluids(world)
    const neighbours = [at(-1), at(1), at(0, 0, -1), at(0, 0, 1)]

    expect(result.changes).toHaveLength(neighbours.length)
    for (const neighbour of neighbours) {
      expect(blockAt(result.world, neighbour)).toBe(water)
      expect(fluidCellAt(result.state, neighbour)).toEqual({
        falling: false,
        kind: 'water',
        level: fluidLevel(FLOWING_FLUID_LEVEL),
      })
      expect(result.state.scheduled.has(blockPositionKeyOf(neighbour))).toBe(true)
    }
  })

  it('stops horizontal flow at the minimum level', () => {
    const source = at(0)
    const stone = blockIdOf('stone')
    let world = place(emptyBlockWorld(), source, blockIdOf('water'))
    world = place(world, at(0, -1), stone)
    world = blockedAround(world, source, stone)
    let state = setFluidCell(emptyFluidState(), source, {
      falling: false,
      kind: 'water',
      level: fluidLevel(FLUID_LEVEL_MIN),
    })
    state = scheduleFluidAt(state, source)

    const result = updateFluids(world, state)

    expect(result.changes).toEqual([])
    expect(result.state.scheduled.size).toBe(0)
    expect(fluidCellAt(result.state, source)?.level).toBe(fluidLevel(FLUID_LEVEL_MIN))
  })

  it('respects replacement capabilities and water-breakable blocks', () => {
    const air = AIR_BLOCK_ID
    const stone = blockIdOf('stone')
    const torch = blockIdOf('torch')
    const water = blockIdOf('water')
    expect(canFluidReplace(air, 'lava')).toBe(true)
    expect(canFluidReplace(water, 'lava')).toBe(true)
    expect(canFluidReplace(torch, 'water')).toBe(true)
    expect(canFluidReplace(torch, 'lava')).toBe(false)
    expect(canFluidReplace(stone, 'water')).toBe(false)

    const source = at(0)
    const torchPosition = at(1)
    let world = place(emptyBlockWorld(), source, water)
    world = place(world, at(0, -1), stone)
    world = blockedAround(world, source, stone)
    world = place(world, torchPosition, torch)
    const result = updateFluids(world)

    expect(blockAt(result.world, torchPosition)).toBe(water)
    expect(result.changes).toContainEqual({
      after: water,
      before: torch,
      falling: false,
      fluid: 'water',
      kind: 'flow',
      level: fluidLevel(FLOWING_FLUID_LEVEL),
      position: torchPosition,
    })

    let lavaWorld = place(emptyBlockWorld(), source, blockIdOf('lava'))
    lavaWorld = place(lavaWorld, at(0, -1), stone)
    lavaWorld = blockedAround(lavaWorld, source, stone)
    lavaWorld = place(lavaWorld, torchPosition, torch)
    expect(updateFluids(lavaWorld).changes).toEqual([])
  })

  it('mixes source fluids into obsidian and flowing fluids into cobblestone', () => {
    const source = at(0)
    const target = at(1)
    const stone = blockIdOf('stone')
    let world = place(emptyBlockWorld(), source, blockIdOf('water'))
    world = place(world, at(0, -1), stone)
    world = blockedAround(world, source, stone)
    world = place(world, target, blockIdOf('lava'))
    const sourceMix = updateFluids(world)

    expect(blockAt(sourceMix.world, target)).toBe(FLUID_MIX_BLOCK_IDS.obsidian)
    expect(sourceMix.changes).toContainEqual({
      after: FLUID_MIX_BLOCK_IDS.obsidian,
      before: blockIdOf('lava'),
      falling: false,
      fluid: 'water',
      kind: 'mix',
      level: fluidLevel(SOURCE_FLUID_LEVEL),
      position: target,
    })

    let flowingState = setFluidCell(emptyFluidState(), source, sourceCell('water'))
    flowingState = scheduleFluidAt(flowingState, source)
    flowingState = setFluidCell(flowingState, target, {
      falling: true,
      kind: 'lava',
      level: fluidLevel(FLOWING_FLUID_LEVEL),
    })
    let flowingWorld = place(
      place(emptyBlockWorld(), source, blockIdOf('water')),
      target,
      blockIdOf('lava'),
    )
    flowingWorld = place(flowingWorld, at(0, -1), stone)
    flowingWorld = blockedAround(flowingWorld, source, stone)
    flowingWorld = place(flowingWorld, target, blockIdOf('lava'))
    const flowingMix = updateFluids(flowingWorld, flowingState)

    expect(blockAt(flowingMix.world, target)).toBe(FLUID_MIX_BLOCK_IDS.cobblestone)
    expect(flowingMix.changes).toContainEqual({
      after: FLUID_MIX_BLOCK_IDS.cobblestone,
      before: blockIdOf('lava'),
      falling: false,
      fluid: 'water',
      kind: 'mix',
      level: fluidLevel(FLOWING_FLUID_LEVEL),
      position: target,
    })
  })

  it('mixes a downward flowing target during propagation', () => {
    const source = at(0)
    const target = at(0, -1)
    const stone = blockIdOf('stone')
    let world = place(emptyBlockWorld(), source, blockIdOf('water'))
    world = blockedAround(world, source, stone)
    world = place(world, target, blockIdOf('lava'))

    let state = setFluidCell(emptyFluidState(), source, sourceCell('water'))
    state = scheduleFluidAt(state, source)

    const result = updateFluids(world, state)

    expect(blockAt(result.world, target)).toBe(FLUID_MIX_BLOCK_IDS.obsidian)
    expect(result.changes).toContainEqual({
      after: FLUID_MIX_BLOCK_IDS.obsidian,
      before: blockIdOf('lava'),
      falling: false,
      fluid: 'water',
      kind: 'mix',
      level: fluidLevel(SOURCE_FLUID_LEVEL),
      position: target,
    })
  })

  it('mixes lava with water into cobblestone and leaves same fluids unchanged', () => {
    const source = at(0)
    const target = at(1)
    const stone = blockIdOf('stone')
    let lavaWorld = place(emptyBlockWorld(), source, blockIdOf('lava'))
    lavaWorld = place(lavaWorld, at(0, -1), stone)
    lavaWorld = blockedAround(lavaWorld, source, stone)
    lavaWorld = place(lavaWorld, target, blockIdOf('water'))
    const lavaMix = updateFluids(lavaWorld)

    expect(blockAt(lavaMix.world, target)).toBe(FLUID_MIX_BLOCK_IDS.cobblestone)

    let sameWorld = place(emptyBlockWorld(), source, blockIdOf('water'))
    sameWorld = place(sameWorld, at(0, -1), stone)
    sameWorld = blockedAround(sameWorld, source, stone)
    sameWorld = place(sameWorld, target, blockIdOf('water'))
    sameWorld = place(sameWorld, at(1, -1), stone)
    sameWorld = place(sameWorld, at(2), stone)
    sameWorld = place(sameWorld, at(1, 0, -1), stone)
    sameWorld = place(sameWorld, at(1, 0, 1), stone)
    expect(updateFluids(sameWorld).changes).toEqual([])
  })

  it('clears stale schedules and ignores scheduled cells without state', () => {
    const stalePosition = at(0)
    const staleState = scheduleFluidAt(
      setFluidCell(emptyFluidState(), stalePosition, sourceCell('water')),
      stalePosition,
    )
    const staleResult = updateFluids(
      place(emptyBlockWorld(), stalePosition, blockIdOf('stone')),
      staleState,
    )
    expect(staleResult.changes).toEqual([])
    expect(fluidCellAt(staleResult.state, stalePosition)).toBeNull()
    expect(staleResult.state.scheduled.has(blockPositionKeyOf(stalePosition))).toBe(false)

    const scheduledOnlyPosition = at(1)
    const scheduledOnlyState = scheduleFluidAt(emptyFluidState(), scheduledOnlyPosition)
    const scheduledOnlyResult = updateFluids(emptyBlockWorld(), scheduledOnlyState)
    expect(scheduledOnlyResult.changes).toEqual([])
    expect(scheduledOnlyResult.state.scheduled.size).toBe(0)
  })

  it('honours stronger existing flow and replaces weaker state flow', () => {
    const source = at(0)
    const target = at(1)
    const stone = blockIdOf('stone')
    const water = blockIdOf('water')
    let world = place(emptyBlockWorld(), source, water)
    world = place(world, at(0, -1), stone)
    world = blockedAround(world, source, stone)
    world = place(world, target, AIR_BLOCK_ID)
    const strongerState = setFluidCell(
      scheduleFluidAt(
        setFluidCell(emptyFluidState(), source, sourceCell('water')),
        source,
      ),
      target,
      sourceCell('water'),
    )
    const strongerResult = updateFluids(world, strongerState)
    expect(strongerResult.changes).toEqual([])
    expect(fluidCellAt(strongerResult.state, target)?.level).toBe(
      fluidLevel(SOURCE_FLUID_LEVEL),
    )

    const weakerState = setFluidCell(
      scheduleFluidAt(
        setFluidCell(emptyFluidState(), source, sourceCell('water')),
        source,
      ),
      target,
      {
        falling: true,
        kind: 'water',
        level: fluidLevel(FLUID_LEVEL_MIN),
      },
    )
    const weakerResult = updateFluids(world, weakerState)
    expect(blockAt(weakerResult.world, target)).toBe(water)
    expect(fluidCellAt(weakerResult.state, target)?.level).toBe(
      fluidLevel(FLOWING_FLUID_LEVEL),
    )
    expect(weakerResult.changes).toContainEqual({
      after: water,
      before: AIR_BLOCK_ID,
      falling: false,
      fluid: 'water',
      kind: 'flow',
      level: fluidLevel(FLOWING_FLUID_LEVEL),
      position: target,
    })
  })
})
