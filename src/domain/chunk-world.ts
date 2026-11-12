import {
  AIR_BLOCK_ID,
  BlockId,
  type BlockPosition,
  type BlockPositionKey,
  CHUNK_SIZE_XZ,
  type Chunk,
  type ChunkBlocks,
  type ChunkCoord,
  type ChunkKey,
  type EncodedChunk,
  type LocalBlockCoord,
  MAX_CHUNK_HEIGHT,
  blockPosition,
  blockPositionKeyOf,
  chunk,
  chunkCoordOfBlock,
  chunkKeyOf,
  decodeChunk,
  encodeChunk,
  isKnownBlockId,
  localCoordOfBlock,
} from '@nerima-games/mc-kernel'
import { type BlockReader, type BlockWorld, blockReaderOf } from './block-world.js'
import { Effect, Option } from 'effect'

const MIN_CHUNK_HEIGHT = 1
const DEFAULT_WORLD_MIN_Y = 0
const UNIT_STEP = 1

export type ChunkSnapshot = {
  readonly coord: ChunkCoord
  readonly height: number
  readonly blocks: Readonly<Uint16Array>
}

export type ChunkWorld = {
  readonly height: number
  readonly minY: number
  readonly chunks: ReadonlyMap<ChunkKey, ChunkSnapshot>
}

type ChunkWorldDataFailure = {
  readonly _tag: 'ChunkWorldDataFailure'
  readonly cause: RangeError
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
  | ChunkWorldDataFailure

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

const chunkWorldDataFailure = (message: string, cause: unknown): ChunkWorldDataFailure => ({
  _tag: 'ChunkWorldDataFailure',
  cause: new RangeError(message, { cause }),
})

const isChunkWorldDataFailure = (value: unknown): value is ChunkWorldDataFailure =>
  typeof value === 'object' && value !== null && '_tag' in value &&
  value['_tag'] === 'ChunkWorldDataFailure'

const expectedBlockCount = (height: number): number => CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * height

const invalidWorldBounds = (
  height: number,
  minY: number,
): Option.Option<ChunkWorldDataFailure> => {
  if (!Number.isInteger(height) || height < MIN_CHUNK_HEIGHT || height > MAX_CHUNK_HEIGHT) {
    return Option.some(chunkWorldDataFailure(
      `Chunk height must be an integer between ${MIN_CHUNK_HEIGHT} and ${MAX_CHUNK_HEIGHT}; received ${String(height)}`,
      { height, reason: 'invalid-height' },
    ))
  }

  if (!Number.isSafeInteger(minY)) {
    return Option.some(chunkWorldDataFailure(
      `Chunk minimum y must be a safe integer; received ${String(minY)}`,
      { minY, reason: 'invalid-min-y' },
    ))
  }

  if (!Number.isSafeInteger(minY + height)) {
    return Option.some(chunkWorldDataFailure(
      `Chunk world upper y must be a safe integer; minimum y ${String(minY)}, height ${String(height)}`,
      { height, minY, reason: 'invalid-upper-y' },
    ))
  }
  return Option.none()
}

const blockIndexOf = (
  height: number,
  minY: number,
  local: LocalBlockCoord,
): number =>
  (local.lx * CHUNK_SIZE_XZ + local.lz) * height + local.ly - minY

type BlockIdAtOptions = {
  readonly world: ChunkWorld
  readonly blocks: Readonly<Uint16Array>
  readonly index: number
  readonly coord: ChunkCoord
}

const blockIdAt = ({ world, blocks, index, coord }: BlockIdAtOptions): BlockId | ChunkWorldDataFailure => {
  const expectedLength = expectedBlockCount(world.height)
  if (blocks.length !== expectedLength) {
    return chunkWorldDataFailure(
      `Chunk storage length mismatch at index ${String(index)}: expected ${String(expectedLength)}, received ${String(blocks.length)}`,
      { cx: coord.cx, cz: coord.cz, expectedLength, index, receivedLength: blocks.length },
    )
  }
  return Option.match(Option.fromNullable(blocks.at(index)), {
    onNone: () => chunkWorldDataFailure(
      `Chunk storage has no block at index ${String(index)} of ${String(expectedLength)}`,
      { cx: coord.cx, cz: coord.cz, expectedLength, index },
    ),
    onSome: (block) => {
      if (!isKnownBlockId(block)) {
        return chunkWorldDataFailure(
          `Chunk storage contains unknown block id ${String(block)} at index ${String(index)}`,
          { blockId: block, cx: coord.cx, cz: coord.cz, index },
        )
      }
      // oxlint-disable-next-line new-cap -- BlockId is the kernel's validated branded constructor.
      return BlockId(block)
    },
  })
}

const isEmptyChunk = (blocks: Readonly<Uint16Array>): boolean => {
  for (const blockId of blocks) {
    if (blockId !== AIR_BLOCK_ID) {
      return false
    }
  }

  return true
}

// ChunkBlocks.toBytes() is the wire encoding, BYTES_PER_ELEMENT bytes per
// Block: it is not a drop-in typed array of one block id per slot. This
// Package's own ChunkSnapshot storage keeps one full-width id per slot
// Instead, so each id is read back through the checked per-index accessor
// Rather than aliased out of the wire buffer.
const blockIdsOf = (blocks: ChunkBlocks): Uint16Array => {
  const ids = new Uint16Array(blocks.length)
  for (let index = 0; index < blocks.length; index += UNIT_STEP) {
    ids[index] = blocks.get(index)
  }
  return ids
}

// `value` is already a validated Chunk, so its coord and height are already
// The exact branded values a round trip through `chunk()` would produce.
// Reconstructing through `chunk()` here would also force `blocks` back
// Through its byte-capped Uint8Array parameter, undoing the widening below.
const snapshotOf = (value: Chunk): ChunkSnapshot => ({
  blocks: blockIdsOf(value.blocks),
  coord: value.coord,
  height: value.height,
})

// Kernel's own `chunk()` constructor takes a `Uint8Array`, one byte per
// Block: it is the legacy/friendly shape and narrows any id above 255 on
// Assignment. Building a wide id requires the air-filled scaffold `chunk()`
// Happily accepts, then widening each slot through `ChunkBlocks`'s own
// Checked, registry-validating `set()` — never through a second typed-array
// Cast, which would silently repeat the same truncation.
export const kernelChunkFromBlocks = (
  coord: ChunkCoord,
  height: number,
  blocks: Readonly<Uint16Array>,
): Chunk => {
  const built = chunk(coord, height, new Uint8Array(blocks.length))
  for (const [index, block] of blocks.entries()) {
    // oxlint-disable-next-line new-cap -- BlockId is the kernel's validated branded constructor.
    built.blocks.set(index, BlockId(block))
  }
  return built
}

const kernelChunkOf = (value: ChunkSnapshot): Chunk =>
  kernelChunkFromBlocks(value.coord, value.height, value.blocks)

const worldWithChunks = (
  world: ChunkWorld,
  chunks: ReadonlyMap<ChunkKey, ChunkSnapshot>,
): ChunkWorld => ({
  chunks,
  height: world.height,
  minY: world.minY,
})

export const emptyChunkWorld = (
  height: number,
  minY: number = DEFAULT_WORLD_MIN_Y,
): ChunkWorld | ChunkWorldDataFailure => {
  const invalidBounds = invalidWorldBounds(height, minY)
  if (Option.isSome(invalidBounds)) {
    return invalidBounds.value
  }
  return { chunks: new Map(), height, minY }
}

export const chunkAt = (world: ChunkWorld, coord: ChunkCoord): ChunkSnapshot | undefined =>
  world.chunks.get(chunkKeyOf(coord))

const blockAtPositionWithinBounds = (
  world: ChunkWorld,
  position: BlockPosition,
): BlockId | ChunkWorldDataFailure => {
  const coord = chunkCoordOfBlock(position)
  const stored = chunkAt(world, coord)

  if (!stored) {
    return AIR_BLOCK_ID
  }
  if (stored.height !== world.height) {
    return chunkWorldDataFailure(
      `Chunk height mismatch at ${String(coord.cx)},${String(coord.cz)}: expected ${String(world.height)}, received ${String(stored.height)}`,
      { cx: coord.cx, cz: coord.cz, expectedHeight: world.height, receivedHeight: stored.height },
    )
  }

  const local = localCoordOfBlock(position)
  // Index construction clamps x and z to the chunk footprint and checks y.
  return blockIdAt({
    blocks: stored.blocks,
    coord: stored.coord,
    index: blockIndexOf(stored.height, world.minY, local),
    world,
  })
}

export const blockAtChunkWorld = (
  world: ChunkWorld,
  position: BlockPosition,
): BlockId | ChunkWorldDataFailure => {
  const invalidBounds = invalidWorldBounds(world.height, world.minY)
  if (Option.isSome(invalidBounds)) {
    return invalidBounds.value
  }
  if (position.y < world.minY || position.y >= world.minY + world.height) {
    return AIR_BLOCK_ID
  }

  return blockAtPositionWithinBounds(world, position)
}

type BlockEntry = readonly [BlockPositionKey, BlockId]

type BlockEntryAtOptions = {
  readonly localX: number
  readonly localY: number
  readonly localZ: number
  readonly stored: ChunkSnapshot
  readonly world: ChunkWorld
}

const blockEntryAt = ({
  localX,
  localY,
  localZ,
  stored,
  world,
}: BlockEntryAtOptions): BlockEntry | null | ChunkWorldDataFailure => {
  if (stored.height !== world.height) {
    return chunkWorldDataFailure(
      `Chunk height mismatch at ${String(stored.coord.cx)},${String(stored.coord.cz)}: expected ${String(world.height)}, received ${String(stored.height)}`,
      {
        cx: stored.coord.cx,
        cz: stored.coord.cz,
        expectedHeight: world.height,
        receivedHeight: stored.height,
      },
    )
  }
  const index = (localX * CHUNK_SIZE_XZ + localZ) * stored.height + localY
  // Caller loops keep each coordinate within the chunk footprint and column range.
  const blockId = blockIdAt({
    blocks: stored.blocks,
    coord: stored.coord,
    index,
    world,
  })
  if (isChunkWorldDataFailure(blockId)) {
    return blockId
  }

  if (blockId === AIR_BLOCK_ID) {
    return null
  }

  const position = blockPosition(
    stored.coord.cx * CHUNK_SIZE_XZ + localX,
    world.minY + localY,
    stored.coord.cz * CHUNK_SIZE_XZ + localZ,
  )
  return [blockPositionKeyOf(position), blockId]
}

type ChunkColumn = {
  readonly blocks: Map<BlockPositionKey, BlockId>
  readonly localX: number
  readonly localZ: number
  readonly stored: ChunkSnapshot
  readonly world: ChunkWorld
}

const addChunkColumnToWorld = ({
  blocks,
  localX,
  localZ,
  stored,
  world,
}: ChunkColumn): ChunkWorldDataFailure | null => {
  for (let localY = 0; localY < stored.height; localY += UNIT_STEP) {
    const entry = blockEntryAt({ localX, localY, localZ, stored, world })
    if (isChunkWorldDataFailure(entry)) {
      return entry
    }
    if (entry !== null) {
      const [key, blockId] = entry
      blocks.set(key, blockId)
    }
  }
  return null
}

const blockWorldOfChunk = (
  world: ChunkWorld,
  stored: ChunkSnapshot,
): BlockWorld | ChunkWorldDataFailure => {
  const blocks = new Map<BlockPositionKey, BlockId>()

  for (let localX = 0; localX < CHUNK_SIZE_XZ; localX += UNIT_STEP) {
    for (let localZ = 0; localZ < CHUNK_SIZE_XZ; localZ += UNIT_STEP) {
      const failure = addChunkColumnToWorld({ blocks, localX, localZ, stored, world })
      if (failure !== null) {
        return failure
      }
    }
  }

  return blocks
}

const mergeBlockWorldInto = (target: Map<BlockPositionKey, BlockId>, source: BlockWorld): void => {
  for (const [key, blockId] of source) {
    target.set(key, blockId)
  }
}

export const blockWorldOfChunkWorld = (
  world: ChunkWorld,
): BlockWorld | ChunkWorldDataFailure => {
  const invalidBounds = invalidWorldBounds(world.height, world.minY)
  if (Option.isSome(invalidBounds)) {
    return invalidBounds.value
  }
  const blocks = new Map<BlockPositionKey, BlockId>()

  for (const stored of world.chunks.values()) {
    const chunkBlocks = blockWorldOfChunk(world, stored)
    if (isChunkWorldDataFailure(chunkBlocks)) {
      return chunkBlocks
    }
    mergeBlockWorldInto(blocks, chunkBlocks)
  }

  return blocks
}

export const blockReaderOfChunkWorld = (
  world: ChunkWorld,
): BlockReader | ChunkWorldDataFailure => {
  const blocks = blockWorldOfChunkWorld(world)
  if (isChunkWorldDataFailure(blocks)) {
    return blocks
  }
  return blockReaderOf(blocks)
}

type ChunkLocation = {
  readonly coord: ChunkCoord
  readonly key: ChunkKey
  readonly local: LocalBlockCoord
}

const chunkLocationOf = (position: BlockPosition): ChunkLocation => {
  const coord = chunkCoordOfBlock(position)
  return { coord, key: chunkKeyOf(coord), local: localCoordOfBlock(position) }
}

const mutableBlocksOf = (
  world: ChunkWorld,
  stored: ChunkSnapshot | undefined,
): Uint16Array => {
  if (stored) {
    return Uint16Array.from(stored.blocks)
  }

  return new Uint16Array(expectedBlockCount(world.height))
}

const invalidStoredBlock = (
  world: ChunkWorld,
  stored: ChunkSnapshot,
  expectedLength: number,
): Option.Option<ChunkWorldDataFailure> => {
  for (let index = 0; index < expectedLength; index += UNIT_STEP) {
    const blockId = blockIdAt({
      blocks: stored.blocks,
      coord: stored.coord,
      index,
      world,
    })
    if (isChunkWorldDataFailure(blockId)) {
      return Option.some(blockId)
    }
  }
  return Option.none()
}

const invalidStoredChunk = (
  world: ChunkWorld,
  stored: ChunkSnapshot,
): Option.Option<ChunkWorldDataFailure> => {
  if (stored.height !== world.height) {
    return Option.some(chunkWorldDataFailure(
      `Chunk height mismatch at ${String(stored.coord.cx)},${String(stored.coord.cz)}: expected ${String(world.height)}, received ${String(stored.height)}`,
      {
        cx: stored.coord.cx,
        cz: stored.coord.cz,
        expectedHeight: world.height,
        receivedHeight: stored.height,
      },
    ))
  }
  const expectedLength = expectedBlockCount(world.height)
  if (stored.blocks.length !== expectedLength) {
    return Option.some(chunkWorldDataFailure(
      `Chunk storage length mismatch at ${String(stored.coord.cx)},${String(stored.coord.cz)}: expected ${String(expectedLength)}, received ${String(stored.blocks.length)}`,
      { cx: stored.coord.cx, cz: stored.coord.cz, expectedLength, receivedLength: stored.blocks.length },
    ))
  }
  return invalidStoredBlock(world, stored, expectedLength)
}

const previousBlockIdOf = (
  world: ChunkWorld,
  position: BlockPosition,
  stored: ChunkSnapshot | undefined,
): BlockId | ChunkWorldDataFailure => {
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
}: ChunkWrite): ReadonlyMap<ChunkKey, ChunkSnapshot> => {
  const blocks = mutableBlocksOf(world, stored)
  blocks[blockIndexOf(world.height, world.minY, location.local)] = blockId
  const nextChunks = new Map(world.chunks)

  if (isEmptyChunk(blocks)) {
    nextChunks.delete(location.key)
  } else {
    nextChunks.set(
      location.key,
      snapshotOf(kernelChunkFromBlocks(location.coord, world.height, blocks)),
    )
  }

  return nextChunks
}

type PreparedBlockWrite = ChunkWrite & {
  readonly previousBlockId: BlockId
}

const blockWriteResult = ({
  blockId,
  location,
  previousBlockId,
  stored,
  world,
}: PreparedBlockWrite): ChunkWorldBlockWriteResult => {
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

const writeBlockToExistingWorld = (
  world: ChunkWorld,
  position: BlockPosition,
  blockId: BlockId,
): ChunkWorldBlockWriteResult => {
  const location = chunkLocationOf(position)
  const stored = world.chunks.get(location.key)
  if (stored) {
    const invalidStorage = invalidStoredChunk(world, stored)
    if (Option.isSome(invalidStorage)) {
      return invalidStorage.value
    }
  }
  const previousBlockId = previousBlockIdOf(world, position, stored)
  if (isChunkWorldDataFailure(previousBlockId)) {
    return previousBlockId
  }
  return blockWriteResult({ blockId, location, previousBlockId, stored, world })
}

const writeBlockWithinBounds = (
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
  return writeBlockToExistingWorld(world, position, blockId)
}

export const writeBlockAtChunkWorld = (
  world: ChunkWorld,
  position: BlockPosition,
  blockId: BlockId,
): ChunkWorldBlockWriteResult =>
  Option.match(invalidWorldBounds(world.height, world.minY), {
    onNone: () => writeBlockWithinBounds(world, position, blockId),
    onSome: (failure) => failure,
  })

export const removeChunkFromChunkWorld = (
  world: ChunkWorld,
  key: ChunkKey,
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
  const key = chunkKeyOf(stored.coord)

  if (isEmptyChunk(stored.blocks)) {
    return removeChunkFromChunkWorld(world, key)
  }

  const nextChunks = new Map(world.chunks)
  nextChunks.set(key, stored)
  return { chunk: stored, outcome: 'stored', world: worldWithChunks(world, nextChunks) }
}

export const encodeChunkAt = (world: ChunkWorld, coord: ChunkCoord): EncodedChunk | undefined => {
  const stored = chunkAt(world, coord)

  if (!stored) {
    return
  }

  return encodeChunk(kernelChunkOf(stored))
}

const invalidEncodedChunkReason = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === 'string') {
    return cause
  }
  return 'Chunk decoder rejected the encoded payload'
}

export const loadEncodedChunkIntoWorld = (
  world: ChunkWorld,
  encoded: Uint8Array | EncodedChunk,
): Effect.Effect<ChunkWorldDecodeResult> =>
  Effect.match(
    Effect.try({
      catch: (cause) => cause,
      try: () => storeChunkInChunkWorld(world, decodeChunk(encoded)),
    }),
    {
      onFailure: (cause): ChunkWorldDecodeResult => ({
        outcome: 'invalid',
        reason: invalidEncodedChunkReason(cause),
        world,
      }),
      onSuccess: (result) => result,
    },
  )
