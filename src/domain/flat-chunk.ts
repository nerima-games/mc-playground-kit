import { AIR_BLOCK_ID, type BlockId, type Dimension, blockIdOf } from '@nerima-games/mc-kernel'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  type Chunk,
  blockIndex,
} from '@nerima-games/mc-worldgen'

/** The lowest block height accepted for a flat surface. */
export const MIN_FLAT_SURFACE_Y = 0

const SUBSURFACE_DEPTH = 2
const UNIT_STEP = 1

type FlatChunkMaterials = {
  readonly base: BlockId
  readonly filler: BlockId
  readonly subsurface: BlockId
  readonly surface: BlockId
}

const FLAT_CHUNK_MATERIALS: Readonly<Record<Dimension, FlatChunkMaterials>> = {
  end: {
    base: blockIdOf('bedrock'),
    filler: blockIdOf('end_stone'),
    subsurface: blockIdOf('end_stone'),
    surface: blockIdOf('end_stone'),
  },
  nether: {
    base: blockIdOf('bedrock'),
    filler: blockIdOf('netherrack'),
    subsurface: blockIdOf('netherrack'),
    surface: blockIdOf('netherrack'),
  },
  overworld: {
    base: blockIdOf('bedrock'),
    filler: blockIdOf('stone'),
    subsurface: blockIdOf('dirt'),
    surface: blockIdOf('grass_block'),
  },
}

const blockAtHeight = (height: number, surfaceY: number, materials: FlatChunkMaterials): BlockId => {
  if (height > surfaceY) {
    return AIR_BLOCK_ID
  }
  if (height === surfaceY) {
    return materials.surface
  }
  if (height === MIN_FLAT_SURFACE_Y) {
    return materials.base
  }
  if (height >= surfaceY - SUBSURFACE_DEPTH) {
    return materials.subsurface
  }
  return materials.filler
}

/** Replace generated terrain with a deterministic, dimension-aware flat layer. */
export const flatChunkOf = (chunk: Chunk, surfaceY: number, dimension: Dimension = 'overworld'): Chunk => {
  const materials = FLAT_CHUNK_MATERIALS[dimension]
  const blocks = new Uint16Array(chunk.blocks)
  for (let localX = 0; localX < CHUNK_SIZE_XZ; localX += UNIT_STEP) {
    for (let localZ = 0; localZ < CHUNK_SIZE_XZ; localZ += UNIT_STEP) {
      for (let localY = 0; localY < CHUNK_HEIGHT; localY += UNIT_STEP) {
        blocks[blockIndex(localX, localY, localZ)] = blockAtHeight(localY, surfaceY, materials)
      }
    }
  }
  return { ...chunk, blocks }
}
