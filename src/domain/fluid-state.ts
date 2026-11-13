import {
  type BlockPosition,
  type BlockPositionKey,
  blockPositionKeyOf,
} from '@nerima-games/mc-kernel'
import {
  FLUID_LEVEL_MAX,
  FLUID_LEVEL_MIN,
  type FlowingFluidKind,
} from './fluid-data.js'
import { Brand } from 'effect'

export type FluidLevel = number & Brand.Brand<'FluidLevel'>

type FluidLevelResult =
  | { readonly _tag: 'Valid'; readonly value: FluidLevel }
  | { readonly _tag: 'Invalid'; readonly error: ReturnType<typeof Brand.error> }

const fluidLevelBrand = Brand.nominal<FluidLevel>()

const safeValueLabel = (value: unknown): string => {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    return typeof value
  }
  return String(value)
}

const isFluidLevel = (value: unknown): value is FluidLevel =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= FLUID_LEVEL_MIN &&
  value <= FLUID_LEVEL_MAX

export const fluidLevel = (value: unknown): FluidLevelResult => {
  if (!isFluidLevel(value)) {
    return {
      _tag: 'Invalid',
      error: Brand.error(`Fluid level must be an integer between ${FLUID_LEVEL_MIN} and ${FLUID_LEVEL_MAX}, received ${safeValueLabel(value)}`),
    }
  }

  return { _tag: 'Valid', value: fluidLevelBrand(value) }
}

export type FluidCell = {
  readonly falling: boolean
  readonly kind: FlowingFluidKind
  readonly level: FluidLevel
}

export type FluidState = {
  readonly cells: ReadonlyMap<BlockPositionKey, FluidCell>
  readonly scheduled: ReadonlySet<BlockPositionKey>
}

export const emptyFluidState = (): FluidState => ({
  cells: new Map(),
  scheduled: new Set(),
})

export const fluidCellAt = (
  state: FluidState,
  position: BlockPosition,
): FluidCell | null => state.cells.get(blockPositionKeyOf(position)) ?? null

export const setFluidCell = (
  state: FluidState,
  position: BlockPosition,
  cell: FluidCell,
): FluidState => {
  const cells = new Map(state.cells)
  cells.set(blockPositionKeyOf(position), cell)

  return {
    cells,
    scheduled: state.scheduled,
  }
}

export const clearFluidCell = (
  state: FluidState,
  position: BlockPosition,
): FluidState => {
  const key = blockPositionKeyOf(position)
  if (!state.cells.has(key) && !state.scheduled.has(key)) {
    return state
  }

  const cells = new Map(state.cells)
  cells.delete(key)
  const scheduled = new Set(state.scheduled)
  scheduled.delete(key)

  return {
    cells,
    scheduled,
  }
}

export const scheduleFluidAt = (
  state: FluidState,
  position: BlockPosition,
): FluidState => {
  const key = blockPositionKeyOf(position)
  if (state.scheduled.has(key)) {
    return state
  }

  const scheduled = new Set(state.scheduled)
  scheduled.add(key)

  return {
    cells: state.cells,
    scheduled,
  }
}

export const unscheduleFluidAt = (
  state: FluidState,
  position: BlockPosition,
): FluidState => {
  const key = blockPositionKeyOf(position)
  if (!state.scheduled.has(key)) {
    return state
  }

  const scheduled = new Set(state.scheduled)
  scheduled.delete(key)

  return {
    cells: state.cells,
    scheduled,
  }
}
