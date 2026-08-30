import {
  AIR_BLOCK_ID,
  BlockId,
  CHUNK_SIZE_XZ,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
  chunk,
  chunkCoord,
  chunkKeyOf,
  encodeChunk,
  type Chunk,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  blockAtChunkWorld,
  blockWorldOfChunkWorld,
  chunkAt,
  emptyChunkWorld,
  encodeChunkAt,
  loadEncodedChunkIntoWorld,
  storeChunkInChunkWorld,
  writeBlockAtChunkWorld,
} from '../src/domain/chunk-world'

const HEIGHT = 4

const indexOf = (height: number, localX: number, localZ: number, y: number): number =>
  (localX * CHUNK_SIZE_XZ + localZ) * height + y

const sampleChunk = (coord = chunkCoord(-2, 3), height = HEIGHT): Chunk => {
  const blocks = new Uint8Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * height)
  blocks[indexOf(height, 1, 2, 2)] = blockIdOf('dirt')
  return chunk(coord, height, blocks)
}

const emptyChunk = (coord = chunkCoord(-2, 3), height = HEIGHT): Chunk =>
  chunk(coord, height, new Uint8Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * height))

describe('chunk world', () => {
  it('validates the finite vertical boundary without allocating chunks', () => {
    const world = emptyChunkWorld(HEIGHT)

    expect(world.height).toBe(HEIGHT)
    expect(world.minY).toBe(0)
    expect(world.chunks.size).toBe(0)
    expect(() => emptyChunkWorld(0)).toThrow(RangeError)
    expect(() => emptyChunkWorld(1.5)).toThrow(RangeError)
    expect(() => emptyChunkWorld(0x10000)).toThrow(RangeError)
    expect(() => emptyChunkWorld(HEIGHT, Number.NaN)).toThrow(RangeError)
    expect(() => emptyChunkWorld(HEIGHT, Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
  })

  it('reads sparse negative coordinates and preserves prior worlds across writes', () => {
    const world = emptyChunkWorld(HEIGHT)
    const position = blockPosition(-1, 2, -17)
    const result = writeBlockAtChunkWorld(world, position, blockIdOf('dirt'))

    expect(blockAtChunkWorld(world, position)).toBe(AIR_BLOCK_ID)
    expect(result.outcome).toBe('updated')
    if (result.outcome !== 'updated') {
      throw new Error('Expected a block update')
    }
    expect(result.previousBlockId).toBe(AIR_BLOCK_ID)
    expect(result.world).not.toBe(world)
    expect(result.world.chunks).not.toBe(world.chunks)
    expect(chunkKeyOf(chunkCoord(-1, -2))).toBe('-1,-2')
    expect(chunkAt(result.world, chunkCoord(-1, -2))?.coord).toEqual(chunkCoord(-1, -2))
    expect(blockAtChunkWorld(result.world, position)).toBe(blockIdOf('dirt'))
    expect(blockAtChunkWorld(result.world, blockPosition(-1, -1, -17))).toBe(AIR_BLOCK_ID)
    expect(blockAtChunkWorld(result.world, blockPosition(-1, HEIGHT, -17))).toBe(AIR_BLOCK_ID)
  })

  it('supports a configured negative world minimum and keeps it across immutable writes', () => {
    const minY = -64
    const world = emptyChunkWorld(384, minY)
    const bottom = blockPosition(3, minY, 5)
    const top = blockPosition(3, minY + world.height - 1, 5)
    const result = writeBlockAtChunkWorld(world, bottom, blockIdOf('deepslate'))

    expect(world.minY).toBe(minY)
    expect(result.outcome).toBe('updated')
    if (result.outcome !== 'updated') {
      throw new Error('Expected a block update')
    }
    expect(result.world.minY).toBe(minY)
    expect(blockAtChunkWorld(result.world, bottom)).toBe(blockIdOf('deepslate'))
    expect(blockAtChunkWorld(result.world, top)).toBe(AIR_BLOCK_ID)
    expect(blockAtChunkWorld(result.world, blockPosition(3, minY - 1, 5))).toBe(AIR_BLOCK_ID)
    expect(blockAtChunkWorld(result.world, blockPosition(3, minY + world.height, 5))).toBe(AIR_BLOCK_ID)

    const topResult = writeBlockAtChunkWorld(result.world, top, blockIdOf('stone'))
    expect(topResult.outcome).toBe('updated')
    expect(blockAtChunkWorld(
      topResult.outcome === 'updated' ? topResult.world : result.world,
      top,
    )).toBe(blockIdOf('stone'))
  })

  it('reports validation and idempotence outcomes without mutating the world', () => {
    const world = emptyChunkWorld(HEIGHT)
    const position = blockPosition(4, 1, 5)
    const unknownBlockId = BlockId(255)
    const unchanged = writeBlockAtChunkWorld(world, position, AIR_BLOCK_ID)
    const unknown = writeBlockAtChunkWorld(world, position, unknownBlockId)
    const below = writeBlockAtChunkWorld(world, blockPosition(4, -1, 5), blockIdOf('dirt'))
    const above = writeBlockAtChunkWorld(world, blockPosition(4, HEIGHT, 5), blockIdOf('dirt'))
    const placed = writeBlockAtChunkWorld(world, position, blockIdOf('dirt'))

    expect(unchanged).toEqual({ outcome: 'unchanged', previousBlockId: AIR_BLOCK_ID, world })
    expect(unknown).toEqual({ blockId: unknownBlockId, outcome: 'unknown-block', world })
    expect(below).toEqual({ outcome: 'out-of-bounds', world })
    expect(above).toEqual({ outcome: 'out-of-bounds', world })
    expect(placed.outcome).toBe('updated')

    const same = writeBlockAtChunkWorld(placed.world, position, blockIdOf('dirt'))
    const replaced = writeBlockAtChunkWorld(placed.world, position, blockIdOf('stone'))
    const cleared = writeBlockAtChunkWorld(replaced.world, position, AIR_BLOCK_ID)

    expect(same).toEqual({
      outcome: 'unchanged',
      previousBlockId: blockIdOf('dirt'),
      world: placed.world,
    })
    expect(replaced).toMatchObject({ outcome: 'updated', previousBlockId: blockIdOf('dirt') })
    expect(cleared).toMatchObject({ outcome: 'updated', previousBlockId: blockIdOf('stone') })
    expect(cleared.world.chunks.size).toBe(0)
    expect(placed.world.chunks.size).toBe(1)
    expect(blockAtChunkWorld(placed.world, position)).toBe(blockIdOf('dirt'))
  })

  it('stores validated chunks, copies their bytes, and removes empty chunks sparsely', () => {
    const world = emptyChunkWorld(HEIGHT)
    const value = sampleChunk()
    const stored = storeChunkInChunkWorld(world, value)

    expect(stored.outcome).toBe('stored')
    expect(stored.world).not.toBe(world)
    expect(stored.world.chunks.size).toBe(1)
    expect(chunkAt(stored.world, value.coord)?.blocks).not.toBe(value.blocks)
    expect(blockAtChunkWorld(stored.world, blockPosition(-31, 2, 50))).toBe(blockIdOf('dirt'))

    value.blocks.set(0, blockIdOf('stone'))
    expect(blockAtChunkWorld(stored.world, blockPosition(-32, 0, 48))).toBe(AIR_BLOCK_ID)

    const encoded = encodeChunkAt(stored.world, value.coord)
    expect(encoded).toEqual(encodeChunk(sampleChunk()))
    expect(encodeChunkAt(stored.world, chunkCoord(99, 99))).toBeUndefined()

    const removedAbsent = storeChunkInChunkWorld(world, emptyChunk())
    const removedPresent = storeChunkInChunkWorld(stored.world, emptyChunk())
    const storedAgain = storeChunkInChunkWorld(stored.world, sampleChunk())

    expect(removedAbsent).toEqual({ outcome: 'removed', world })
    expect(removedPresent.outcome).toBe('removed')
    expect(removedPresent.world).not.toBe(stored.world)
    expect(removedPresent.world.chunks.size).toBe(0)
    expect(storedAgain.outcome).toBe('stored')
    expect(storedAgain.world.chunks.size).toBe(1)

    const materialized = blockWorldOfChunkWorld(stored.world)
    expect(materialized).toEqual(new Map([
      [blockPositionKeyOf(blockPosition(-31, 2, 50)), blockIdOf('dirt')],
    ]))
  })

  it('rejects chunks with a different world height', () => {
    const world = emptyChunkWorld(HEIGHT)
    const mismatch = storeChunkInChunkWorld(world, emptyChunk(chunkCoord(0, 0), HEIGHT + 1))

    expect(mismatch).toEqual({
      expectedHeight: HEIGHT,
      outcome: 'height-mismatch',
      receivedHeight: HEIGHT + 1,
      world,
    })
  })

  it('loads versioned kernel chunks and reports malformed bytes at the boundary', () => {
    const world = emptyChunkWorld(HEIGHT)
    const value = sampleChunk()
    const loaded = loadEncodedChunkIntoWorld(world, encodeChunk(value))
    const mismatch = loadEncodedChunkIntoWorld(
      world,
      encodeChunk(emptyChunk(chunkCoord(0, 0), HEIGHT + 1)),
    )
    const invalid = loadEncodedChunkIntoWorld(world, new Uint8Array([0]))

    expect(loaded.outcome).toBe('stored')
    expect(blockAtChunkWorld(loaded.world, blockPosition(-31, 2, 50))).toBe(blockIdOf('dirt'))
    expect(mismatch).toEqual({
      expectedHeight: HEIGHT,
      outcome: 'height-mismatch',
      receivedHeight: HEIGHT + 1,
      world,
    })
    expect(invalid.outcome).toBe('invalid')
    expect(invalid.world).toBe(world)
    if (invalid.outcome !== 'invalid') {
      throw new Error('Expected malformed bytes to be rejected')
    }
    expect(invalid.reason.length).toBeGreaterThan(0)
  })
})
