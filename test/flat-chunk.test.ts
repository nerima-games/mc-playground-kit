import { describe, expect, it } from '@effect/vitest'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { blockIndex, chunkCoord, emptyBlocks, type Chunk } from '@nerima-games/mc-worldgen'
import { flatChunkOf, MIN_FLAT_SURFACE_Y } from '../src/domain/flat-chunk'

const emptyChunk = (): Chunk => ({
  coord: chunkCoord(2, -3),
  blocks: emptyBlocks(),
  biomes: [],
})

describe('flatChunkOf', () => {
  it('creates an immutable overworld layer with air above the surface', () => {
    const source = emptyChunk()
    const flattened = flatChunkOf(source, MIN_FLAT_SURFACE_Y + 4)

    expect(flattened).not.toBe(source)
    expect(flattened.blocks).not.toBe(source.blocks)
    expect(flattened.coord).toBe(source.coord)
    expect(flattened.biomes).toBe(source.biomes)
    expect(flattened.blocks[blockIndex(0, 0, 0)]).toBe(blockIdOf('bedrock'))
    expect(flattened.blocks[blockIndex(0, 1, 0)]).toBe(blockIdOf('stone'))
    expect(flattened.blocks[blockIndex(0, 2, 0)]).toBe(blockIdOf('dirt'))
    expect(flattened.blocks[blockIndex(0, 3, 0)]).toBe(blockIdOf('dirt'))
    expect(flattened.blocks[blockIndex(0, 4, 0)]).toBe(blockIdOf('grass_block'))
    expect(flattened.blocks[blockIndex(0, 5, 0)]).toBe(blockIdOf('air'))
    expect(source.blocks.every((block) => block === blockIdOf('air'))).toBe(true)
  })

  it('supports a surface at the bottom of the chunk', () => {
    const flattened = flatChunkOf(emptyChunk(), MIN_FLAT_SURFACE_Y)

    expect(flattened.blocks[blockIndex(0, 0, 0)]).toBe(blockIdOf('grass_block'))
    expect(flattened.blocks[blockIndex(0, 1, 0)]).toBe(blockIdOf('air'))
  })

  it('uses dimension materials while retaining the same flat shape', () => {
    const nether = flatChunkOf(emptyChunk(), 4, 'nether')
    const end = flatChunkOf(emptyChunk(), 4, 'end')

    expect(nether.blocks[blockIndex(0, 0, 0)]).toBe(blockIdOf('bedrock'))
    expect(nether.blocks[blockIndex(0, 4, 0)]).toBe(blockIdOf('netherrack'))
    expect(nether.blocks[blockIndex(0, 5, 0)]).toBe(blockIdOf('air'))
    expect(end.blocks[blockIndex(0, 0, 0)]).toBe(blockIdOf('bedrock'))
    expect(end.blocks[blockIndex(0, 4, 0)]).toBe(blockIdOf('end_stone'))
  })
})
