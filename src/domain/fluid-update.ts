import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type BlockPositionKey,
  blockNeighbours,
  blockPosition,
  blockPositionOfKey,
  capabilityOfBlockId,
  horizontalBlockNeighbours,
} from '@nerima-games/mc-kernel'
import { type BlockWorld, blockAt, setBlockAt } from './block-world.js'
import {
  FLUID_LEVEL_MIN,
  FLUID_LEVEL_STEP,
  FLUID_MIX_BLOCK_IDS,
  type FlowingFluidKind,
  SOURCE_FLUID_LEVEL,
  blockIdOfFluidKind,
  fluidKindOfBlockId,
} from './fluid-data.js'
import {
  type FluidCell,
  type FluidLevel,
  type FluidState,
  clearFluidCell,
  fluidCellAt,
  fluidLevel,
  scheduleFluidAt,
  setFluidCell,
  unscheduleFluidAt,
} from './fluid-state.js'

const DOWNWARD_STEP = 1

export type FluidChange = {
  readonly after: BlockId
  readonly before: BlockId
  readonly falling: boolean
  readonly fluid: FlowingFluidKind
  readonly kind: 'flow' | 'mix'
  readonly level: FluidLevel
  readonly position: BlockPosition
}

export type FluidUpdate = {
  readonly changes: ReadonlyArray<FluidChange>
  readonly state: FluidState
  readonly world: BlockWorld
}

type MutableFluidUpdate = {
  changes: Array<FluidChange>
  state: FluidState
  world: BlockWorld
}

const sourceFluidCell = (kind: FlowingFluidKind): FluidCell => ({
  falling: false,
  kind,
  level: fluidLevel(SOURCE_FLUID_LEVEL),
})

const fluidCellForBlock = (
  state: FluidState,
  position: BlockPosition,
  blockId: BlockId,
): FluidCell | null => {
  const kind = fluidKindOfBlockId(blockId)
  if (kind === null) {
    return null
  }

  return fluidCellAt(state, position) ?? sourceFluidCell(kind)
}

export const fluidStateFromWorld = (world: BlockWorld): FluidState => {
  const cells = new Map<BlockPositionKey, FluidCell>()
  const scheduled = new Set<BlockPositionKey>()

  for (const [key, blockId] of world) {
    const kind = fluidKindOfBlockId(blockId)
    if (kind !== null) {
      cells.set(key, sourceFluidCell(kind))
      scheduled.add(key)
    }
  }

  return {
    cells,
    scheduled,
  }
}

export const canFluidReplace = (
  blockId: BlockId,
  kind: FlowingFluidKind,
): boolean =>
  blockId === AIR_BLOCK_ID ||
  capabilityOfBlockId(blockId, 'replaceable') ||
  (kind === 'water' && capabilityOfBlockId(blockId, 'brokenByWaterFlow'))

const mixingBlockId = (
  sourceKind: FlowingFluidKind,
  target: FluidCell,
): BlockId => {
  if (sourceKind === 'water' && target.kind === 'lava' && target.level === fluidLevel(SOURCE_FLUID_LEVEL)) {
    return FLUID_MIX_BLOCK_IDS.obsidian
  }

  return FLUID_MIX_BLOCK_IDS.cobblestone
}

type FluidChangeDetails = Omit<FluidChange, 'before' | 'position'>

const recordChange = (
  context: MutableFluidUpdate,
  position: BlockPosition,
  change: FluidChangeDetails,
): void => {
  const before = blockAt(context.world, position)
  context.world = setBlockAt(context.world, position, change.after)
  context.changes.push({
    ...change,
    before,
    position,
  })
}

const mixAt = (
  context: MutableFluidUpdate,
  source: FluidCell,
  position: BlockPosition,
): boolean => {
  const targetBlock = blockAt(context.world, position)
  const target = fluidCellForBlock(context.state, position, targetBlock)
  if (target === null || target.kind === source.kind) {
    return false
  }

  context.state = clearFluidCell(context.state, position)
  recordChange(
    context,
    position,
    {
      after: mixingBlockId(source.kind, target),
      falling: false,
      fluid: source.kind,
      kind: 'mix',
      level: target.level,
    },
  )
  return true
}

type FlowRequest = {
  readonly falling: boolean
  readonly level: FluidLevel
  readonly position: BlockPosition
  readonly source: FluidCell
}

const hasStrongerTargetFlow = (
  state: FluidState,
  request: FlowRequest,
): boolean => {
  const currentTarget = fluidCellAt(state, request.position)
  if (currentTarget === null) {
    return false
  }

  return (
    currentTarget.kind === request.source.kind &&
    currentTarget.level >= request.level
  )
}

const updateFlowState = (
  context: MutableFluidUpdate,
  request: FlowRequest,
): void => {
  context.state = setFluidCell(context.state, request.position, {
    falling: request.falling,
    kind: request.source.kind,
    level: request.level,
  })
  context.state = scheduleFluidAt(context.state, request.position)
}

const flowTo = (
  context: MutableFluidUpdate,
  request: FlowRequest,
): boolean => {
  const targetBlock = blockAt(context.world, request.position)
  const targetKind = fluidKindOfBlockId(targetBlock)
  if (targetKind !== null) {
    return false
  }

  if (
    !canFluidReplace(targetBlock, request.source.kind) ||
    hasStrongerTargetFlow(context.state, request)
  ) {
    return false
  }

  recordChange(
    context,
    request.position,
    {
      after: blockIdOfFluidKind(request.source.kind),
      falling: request.falling,
      fluid: request.source.kind,
      kind: 'flow',
      level: request.level,
    },
  )
  updateFlowState(context, request)
  return true
}

const mixNeighbours = (
  context: MutableFluidUpdate,
  source: FluidCell,
  position: BlockPosition,
): void => {
  for (const neighbour of blockNeighbours(position)) {
    mixAt(context, source, neighbour)
  }
}

const flowFrom = (
  context: MutableFluidUpdate,
  source: FluidCell,
  position: BlockPosition,
): void => {
  const below = blockPosition(
    position.x,
    position.y - DOWNWARD_STEP,
    position.z,
  )
  if (
    flowTo(context, {
      falling: true,
      level: source.level,
      position: below,
      source,
    })
  ) {
    return
  }

  if (source.level <= fluidLevel(FLUID_LEVEL_MIN)) {
    return
  }

  const horizontalLevel = fluidLevel(source.level - FLUID_LEVEL_STEP)
  for (const neighbour of horizontalBlockNeighbours(position)) {
    flowTo(context, {
      falling: false,
      level: horizontalLevel,
      position: neighbour,
      source,
    })
  }
}

const updateFluidAt = (
  context: MutableFluidUpdate,
  position: BlockPosition,
  source: FluidCell,
): void => {
  if (blockAt(context.world, position) !== blockIdOfFluidKind(source.kind)) {
    context.state = clearFluidCell(context.state, position)
    return
  }

  mixNeighbours(context, source, position)
  flowFrom(context, source, position)
}

export const updateFluids = (
  world: BlockWorld,
  state: FluidState = fluidStateFromWorld(world),
): FluidUpdate => {
  const context: MutableFluidUpdate = {
    changes: [],
    state,
    world,
  }
  const scheduled = [...state.scheduled]

  for (const key of scheduled) {
    const position = blockPositionOfKey(key)
    context.state = unscheduleFluidAt(context.state, position)
    const source = fluidCellAt(context.state, position)
    if (source !== null) {
      updateFluidAt(context, position, source)
    }
  }

  return {
    changes: context.changes,
    state: context.state,
    world: context.world,
  }
}
