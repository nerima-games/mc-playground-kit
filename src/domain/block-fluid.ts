import {
  type AABB,
  type BlockId,
  type BlockPosition,
  type FluidKind,
  aabb,
  aabbIntersects,
  aabbOfBlock,
  blockPosition,
  position as coordinatePosition,
  isKnownBlockId,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import { type BlockSource, readBlockAt } from './block-world.js'
import {
  type FluidCell,
  type FluidLevel,
  type FluidState,
  fluidCellAt,
} from './fluid-state.js'
import { FLUID_LEVEL_MAX } from './fluid-data.js'

const BLOCK_EDGE_LENGTH = 1
const GRID_STEP = BLOCK_EDGE_LENGTH
const NO_FLUID_KIND = 'none'

export type BlockFluid = {
  readonly blockId: BlockId
  readonly bounds: AABB
  readonly kind: Exclude<FluidKind, typeof NO_FLUID_KIND>
  readonly position: BlockPosition
}

export type FluidVolume = Omit<BlockFluid, 'bounds'> & {
  readonly bounds: AABB
  readonly falling: boolean
  readonly level: FluidLevel
}

const fluidHeightOf = (cell: FluidCell): number => {
  if (cell.falling) {
    return BLOCK_EDGE_LENGTH
  }
  return cell.level / FLUID_LEVEL_MAX
}

const fluidVolumeOf = (
  fluid: BlockFluid,
  cell: FluidCell,
): FluidVolume => ({
  ...fluid,
  bounds: aabb(
    coordinatePosition(fluid.position.x, fluid.position.y, fluid.position.z),
    coordinatePosition(
      fluid.position.x + BLOCK_EDGE_LENGTH,
      fluid.position.y + fluidHeightOf(cell),
      fluid.position.z + BLOCK_EDGE_LENGTH,
    ),
  ),
  falling: cell.falling,
  level: cell.level,
})

const coordinatesIn = (min: number, max: number): ReadonlyArray<number> => {
  const first = Math.floor(min)
  const exclusiveLast = Math.ceil(max)
  const coordinates: Array<number> = []

  for (
    let coordinate = first;
    coordinate < exclusiveLast;
    coordinate += GRID_STEP
  ) {
    coordinates.push(coordinate)
  }

  return coordinates
}

export const blockFluidAt = (
  source: BlockSource,
  blockPositionValue: BlockPosition,
): BlockFluid | null => {
  const blockId = readBlockAt(source, blockPositionValue)
  if (!isKnownBlockId(blockId)) {
    return null
  }

  const kind = propertyOfBlockId(blockId, 'fluid')
  if (kind === NO_FLUID_KIND) {
    return null
  }

  return {
    blockId,
    bounds: aabbOfBlock(blockPositionValue),
    kind,
    position: blockPositionValue,
  }
}

export const blockFluidsIn = (
  source: BlockSource,
  bounds: AABB,
): ReadonlyArray<BlockFluid> => {
  const fluids: Array<BlockFluid> = []

  for (const blockX of coordinatesIn(bounds.min.x, bounds.max.x)) {
    for (const blockY of coordinatesIn(bounds.min.y, bounds.max.y)) {
      for (const blockZ of coordinatesIn(bounds.min.z, bounds.max.z)) {
        const blockPositionValue = blockPosition(blockX, blockY, blockZ)
        const fluid = blockFluidAt(source, blockPositionValue)
        if (fluid && aabbIntersects(fluid.bounds, bounds)) {
          fluids.push(fluid)
        }
      }
    }
  }

  return fluids
}

export const fluidVolumeAt = (
  source: BlockSource,
  state: FluidState,
  fluidPosition: BlockPosition,
): FluidVolume | null => {
  const fluid = blockFluidAt(source, fluidPosition)
  const cell = fluidCellAt(state, fluidPosition)
  if (fluid === null || cell === null) {
    return null
  }

  return fluidVolumeOf(fluid, cell)
}

export const fluidVolumesIn = (
  source: BlockSource,
  state: FluidState,
  bounds: AABB,
): ReadonlyArray<FluidVolume> => {
  const fluids: Array<FluidVolume> = []

  for (const blockX of coordinatesIn(bounds.min.x, bounds.max.x)) {
    for (const blockY of coordinatesIn(bounds.min.y, bounds.max.y)) {
      for (const blockZ of coordinatesIn(bounds.min.z, bounds.max.z)) {
        const fluid = fluidVolumeAt(source, state, blockPosition(blockX, blockY, blockZ))
        if (fluid && aabbIntersects(fluid.bounds, bounds)) {
          fluids.push(fluid)
        }
      }
    }
  }

  return fluids
}
