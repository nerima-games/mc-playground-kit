import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  CHUNK_SIZE_XZ,
  type Chunk,
  type ChunkCoord,
  type LocalBlockCoord,
  chunk,
  chunkCoordOfBlock,
  decodeChunk,
  encodeChunk,
  isKnownBlockId,
  localCoordOfBlock,
} from '@nerima-games/mc-kernel'
import { type BlockReader } from './block-world.js'
import { Brand } from 'effect'

const MIN_CHUNK_HEIGHT = 1
const MAX_CHUNK_HEIGHT = 0xffff
const DEFAULT_WORLD_MIN_Y = 0

export type ChunkCoordKey = string & Brand.Brand<'ChunkCoordKey'>

export type ChunkSnapshot = {
  readonly coord: ChunkCoord
  readonly height: number
  readonly blocks: Readonly<Uint8Array>
}

export type ChunkWorld = {
  readonly height: number
  readonly minY: number
  readonly chunks: ReadonlyMap<ChunkCoordKey, ChunkSnapshot>
}

export type ChunkWorldBlockWriteResult =
  | {
      readonly outcome: 'updated'
      readonly world: ChunkWorld
      readonly previousBlockId: BlockId
    }
  | {
      readonly outcome: 'unchanged'
      readonly world: ChunkWorld
      readonly previousBlockId: BlockId
    }
  | {
      readonly outcome: 'out-of-bounds'
      readonly world: ChunkWorld
    }
  | {
      readonly outcome: 'unknown-block'
      readonly world: ChunkWorld
      readonly blockId: BlockId
    }

export type ChunkWorldChunkStoreResult =
  | {
      readonly outcome: 'stored'
      readonly world: ChunkWorld
      readonly chunk: ChunkSnapshot
    }
  | {
      readonly outcome: 'removed'
      readonly world: ChunkWorld
    }
  | {
      readonly outcome: 'height-mismatch'
      readonly world: ChunkWorld
      readonly expectedHeight: number
      readonly receivedHeight: number
    }

export type ChunkWorldDecodeResult =
  | ChunkWorldChunkStoreResult
  | {
      readonly outcome: 'invalid'
      readonly world: ChunkWorld
      readonly reason: string
    }

const expectedBlockCount = (height: number): number => CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * height

const assertHeight = (height: number): void => {
  if (!Number.isInteger(height) || height < MIN_CHUNK_HEIGHT || height > MAX_CHUNK_HEIGHT) {
    throw new RangeError(
      `Chunk height must be an integer between ${MIN_CHUNK_HEIGHT} and ${MAX_CHUNK_HEIGHT}`,
    )
  }
}

const assertWorldBounds = (height: number, minY: number): void => {
  assertHeight(height)

  if (!Number.isSafeInteger(minY)) {
    throw new RangeError('Chunk minimum y must be a safe integer')
  }

  if (!Number.isSafeInteger(minY + height)) {
    throw new RangeError('Chunk world upper y must be a safe integer')
  }
}

const blockIndexOf = (
  height: number,
  minY: number,
  local: LocalBlockCoord,
): number =>
  (local.lx * CHUNK_SIZE_XZ + local.lz) * height + local.ly - minY

const isEmptyChunk = (blocks: Readonly<Uint8Array>): boolean => {
  for (const blockId of blocks) {
    if (blockId !== AIR_BLOCK_ID) {
      return false
    }
  }

  return true
}

const snapshotOf = (value: Chunk): ChunkSnapshot => {
  const validated = chunk(value.coord, value.height, value.blocks.toBytes())
  return {
    blocks: validated.blocks.toBytes(),
    coord: validated.coord,
    height: validated.height,
  }
}

const kernelChunkOf = (value: ChunkSnapshot): Chunk =>
  chunk(value.coord, value.height, Uint8Array.from(value.blocks))

const worldWithChunks = (
  world: ChunkWorld,
  chunks: ReadonlyMap<ChunkCoordKey, ChunkSnapshot>,
): ChunkWorld => ({
  chunks,
  height: world.height,
  minY: world.minY,
})

export const chunkCoordKeyOf = (coord: ChunkCoord): ChunkCoordKey =>
  `${coord.cx},${coord.cz}` as ChunkCoordKey

export const emptyChunkWorld = (height: number, minY = DEFAULT_WORLD_MIN_Y): ChunkWorld => {
  assertWorldBounds(height, minY)
  return { chunks: new Map(), height, minY }
}

export const chunkAt = (world: ChunkWorld, coord: ChunkCoord): ChunkSnapshot | undefined =>
  world.chunks.get(chunkCoordKeyOf(coord))

export const blockAtChunkWorld = (world: ChunkWorld, position: BlockPosition): BlockId => {
  if (position.y < world.minY || position.y >= world.minY + world.height) {
    return AIR_BLOCK_ID
  }

  const coord = chunkCoordOfBlock(position)
  const stored = chunkAt(world, coord)

  if (!stored) {
    return AIR_BLOCK_ID
  }

  const local = localCoordOfBlock(position)
  return stored.blocks[blockIndexOf(stored.height, world.minY, local)]! as BlockId
}

export const blockReaderOfChunkWorld = (world: ChunkWorld): BlockReader =>
  (position) => blockAtChunkWorld(world, position)

type ChunkLocation = {
  readonly coord: ChunkCoord
  readonly key: ChunkCoordKey
  readonly local: LocalBlockCoord
}

const chunkLocationOf = (position: BlockPosition): ChunkLocation => {
  const coord = chunkCoordOfBlock(position)
  return { coord, key: chunkCoordKeyOf(coord), local: localCoordOfBlock(position) }
}

const mutableBlocksOf = (
  world: ChunkWorld,
  stored: ChunkSnapshot | undefined,
): Uint8Array => {
  if (stored) {
    return Uint8Array.from(stored.blocks)
  }

  return new Uint8Array(expectedBlockCount(world.height))
}

const previousBlockIdOf = (
  world: ChunkWorld,
  position: BlockPosition,
  stored: ChunkSnapshot | undefined,
): BlockId => {
  if (stored) {
    return blockAtChunkWorld(world, position)
  }

  return AIR_BLOCK_ID
}

type ChunkWrite = {
  readonly blockId: BlockId
  readonly location: ChunkLocation
  readonly stored: ChunkSnapshot | undefined
  readonly world: ChunkWorld
}

const chunksAfterBlockWrite = ({
  blockId,
  location,
  stored,
  world,
}: ChunkWrite): ReadonlyMap<ChunkCoordKey, ChunkSnapshot> => {
  const blocks = mutableBlocksOf(world, stored)
  blocks[blockIndexOf(world.height, world.minY, location.local)] = blockId
  const nextChunks = new Map(world.chunks)

  if (isEmptyChunk(blocks)) {
    nextChunks.delete(location.key)
  } else {
    nextChunks.set(
      location.key,
      snapshotOf(chunk(location.coord, world.height, blocks)),
    )
  }

  return nextChunks
}

export const writeBlockAtChunkWorld = (
  world: ChunkWorld,
  position: BlockPosition,
  blockId: BlockId,
): ChunkWorldBlockWriteResult => {
  if (!isKnownBlockId(blockId)) {
    return { blockId, outcome: 'unknown-block', world }
  }

  if (position.y < world.minY || position.y >= world.minY + world.height) {
    return { outcome: 'out-of-bounds', world }
  }

  const location = chunkLocationOf(position)
  const stored = world.chunks.get(location.key)
  const previousBlockId = previousBlockIdOf(world, position, stored)

  if (previousBlockId === blockId) {
    return { outcome: 'unchanged', previousBlockId, world }
  }

  return {
    outcome: 'updated',
    previousBlockId,
    world: worldWithChunks(
      world,
      chunksAfterBlockWrite({ blockId, location, stored, world }),
    ),
  }
}

const worldWithoutChunk = (
  world: ChunkWorld,
  key: ChunkCoordKey,
): ChunkWorldChunkStoreResult => {
  const nextChunks = new Map(world.chunks)

  if (!nextChunks.has(key)) {
    return { outcome: 'removed', world }
  }

  nextChunks.delete(key)
  return { outcome: 'removed', world: worldWithChunks(world, nextChunks) }
}

export const storeChunkInChunkWorld = (
  world: ChunkWorld,
  value: Chunk,
): ChunkWorldChunkStoreResult => {
  if (value.height !== world.height) {
    return {
      expectedHeight: world.height,
      outcome: 'height-mismatch',
      receivedHeight: value.height,
      world,
    }
  }

  const stored = snapshotOf(value)
  const key = chunkCoordKeyOf(stored.coord)

  if (isEmptyChunk(stored.blocks)) {
    return worldWithoutChunk(world, key)
  }

  const nextChunks = new Map(world.chunks)
  nextChunks.set(key, stored)
  return { chunk: stored, outcome: 'stored', world: worldWithChunks(world, nextChunks) }
}

export const encodeChunkAt = (world: ChunkWorld, coord: ChunkCoord): Uint8Array | undefined => {
  const stored = chunkAt(world, coord)

  if (!stored) {
    return
  }

  return encodeChunk(kernelChunkOf(stored))
}

export const loadEncodedChunkIntoWorld = (
  world: ChunkWorld,
  encoded: Uint8Array,
): ChunkWorldDecodeResult => {
  try {
    return storeChunkInChunkWorld(world, decodeChunk(encoded))
  } catch (error) {
    return { outcome: 'invalid', reason: String(error), world }
  }
}
