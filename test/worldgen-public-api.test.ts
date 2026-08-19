import { describe, expect, it } from 'vitest'
import { worldgen } from '../src/index'

describe('public worldgen namespace', () => {
  it('generates deterministic terrain through the upstream API', () => {
    const first = worldgen.generateChunkAt(0x5eed, 0, 0, { decorate: false })
    const second = worldgen.generateChunkAt(0x5eed, 0, 0, { decorate: false })

    expect(first.coord).toStrictEqual(worldgen.chunkCoord(0, 0))
    expect(Array.from(first.blocks)).toStrictEqual(Array.from(second.blocks))
    expect(first.biomes).toStrictEqual(second.biomes)
    expect(first.blocks.some((block) => block !== worldgen.AIR_BLOCK_ID)).toBe(true)
    expect(worldgen.getBlockAt(first, 0, 0, 0)).toBeTypeOf('number')
  })

  it('propagates block light across resident chunk boundaries', () => {
    const biomes = Array.from(
      { length: worldgen.CHUNK_SIZE_XZ * worldgen.CHUNK_SIZE_XZ },
      () => 'PLAINS' as const,
    )
    const left = {
      coord: worldgen.chunkCoord(0, 0),
      blocks: worldgen.emptyBlocks(),
      biomes,
    }
    const right = {
      coord: worldgen.chunkCoord(1, 0),
      blocks: worldgen.emptyBlocks(),
      biomes,
    }
    const torch = worldgen.BlockId(14)

    worldgen.setBlockAt(left.blocks, worldgen.CHUNK_SIZE_XZ - 1, 100, 1, torch)

    const lights = worldgen.computeChunkLights(
      new Map([
        ['left', left],
        ['right', right],
      ]),
    )
    const leftLight = lights.get('left')
    const rightLight = lights.get('right')

    expect(leftLight).toBeDefined()
    expect(rightLight).toBeDefined()
    if (leftLight === undefined || rightLight === undefined) {
      throw new Error('worldgen light grids are incomplete')
    }

    const sourceIndex = worldgen.blockIndex(worldgen.CHUNK_SIZE_XZ - 1, 100, 1)
    const seamIndex = worldgen.blockIndex(0, 100, 1)
    expect(worldgen.getLightAt(leftLight.block, sourceIndex)).toBe(
      worldgen.lightEmissionOfBlockId(torch),
    )
    expect(worldgen.getLightAt(rightLight.block, seamIndex)).toBeGreaterThan(0)
  })
})
