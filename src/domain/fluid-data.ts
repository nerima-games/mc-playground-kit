import {
  type BlockId,
  type FluidKind,
  blockIdOf,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'

export type FlowingFluidKind = Exclude<FluidKind, 'none'>

export const FLUID_BLOCK_IDS: Record<FlowingFluidKind, BlockId> = {
  lava: blockIdOf('lava'),
  water: blockIdOf('water'),
}

export const FLUID_MIX_BLOCK_IDS: { readonly cobblestone: BlockId; readonly obsidian: BlockId } = {
  cobblestone: blockIdOf('cobblestone'),
  obsidian: blockIdOf('obsidian'),
}

export const FLUID_LEVEL_MIN = 1
export const FLUID_LEVEL_MAX = 8
export const FLUID_LEVEL_STEP = 1
export const SOURCE_FLUID_LEVEL: number = FLUID_LEVEL_MAX
export const FLOWING_FLUID_LEVEL: number = SOURCE_FLUID_LEVEL - FLUID_LEVEL_STEP

export const blockIdOfFluidKind = (kind: FlowingFluidKind): BlockId =>
  FLUID_BLOCK_IDS[kind]

export const fluidKindOfBlockId = (
  blockId: BlockId,
): FlowingFluidKind | null => {
  const kind = propertyOfBlockId(blockId, 'fluid')
  if (kind === 'none') {
    return null
  }

  return kind
}
