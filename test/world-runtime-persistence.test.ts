import {
  AIR_BLOCK_ID,
  blockIdOf,
  blockPosition,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import {
  GeneratedWorldProviderLayer,
  WorldRuntimePort,
  type WorldRuntime,
} from '../src/application/generated-world-provider'
import {
  persistBlockWorld,
  WorldRuntimePersistenceError,
} from '../src/application/world-runtime-persistence'
import { WorldProviderPort } from '../src/application/preview-ports'
import { DEFAULT_FLAT_WORLD } from '../src/domain/launch-options'
import { emptyBlockWorld, setBlockAt } from '../src/domain/block-world'

describe('persistBlockWorld', () => {
  it.effect('writes additions, recognizes unchanged blocks, and writes removals', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtimeService = yield* WorldRuntimePort
      const world = {
        ...DEFAULT_FLAT_WORLD,
        radiusChunks: 0,
        surfaceY: 4,
      }

      yield* provider.openFlatWorld(world)
      const opened = yield* runtimeService.current
      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const runtime = opened.value
      const position = blockPosition(0, 20, 0)
      const stone = blockIdOf('stone')
      const empty = emptyBlockWorld()
      const placed = setBlockAt(empty, position, stone)

      expect(yield* persistBlockWorld(runtime, empty, empty)).toEqual({
        unchanged: 0,
        written: 0,
      })
      expect(yield* persistBlockWorld(runtime, empty, placed)).toEqual({
        unchanged: 0,
        written: 1,
      })
      expect(yield* runtime.chunks.getBlock(position)).toEqual({
        _tag: 'Block',
        block: stone,
      })
      expect(yield* persistBlockWorld(runtime, empty, placed)).toEqual({
        unchanged: 1,
        written: 0,
      })
      expect(yield* persistBlockWorld(runtime, placed, placed)).toEqual({
        unchanged: 0,
        written: 0,
      })
      expect(yield* persistBlockWorld(runtime, placed, empty)).toEqual({
        unchanged: 0,
        written: 1,
      })
      expect(yield* runtime.chunks.getBlock(position)).toEqual({
        _tag: 'Block',
        block: AIR_BLOCK_ID,
      })
    }).pipe(Effect.provide(GeneratedWorldProviderLayer({ terrain: { decorate: false } }))),
  )

  it.effect('reports unloaded and out-of-world changes before writing', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtimeService = yield* WorldRuntimePort
      yield* provider.openFlatWorld({
        ...DEFAULT_FLAT_WORLD,
        radiusChunks: 0,
        surfaceY: 4,
      })
      const opened = yield* runtimeService.current
      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const empty = emptyBlockWorld()
      const stone = blockIdOf('stone')
      const cases = [
        [blockPosition(16, 20, 0), 'ChunkNotLoaded'],
        [blockPosition(0, 256, 0), 'OutOfWorld'],
      ] as const

      for (const [position, outcome] of cases) {
        const result = yield* Effect.either(
          persistBlockWorld(
            opened.value,
            empty,
            setBlockAt(empty, position, stone),
          ),
        )
        expect(result._tag).toBe('Left')
        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(WorldRuntimePersistenceError)
          expect(result.left.outcome).toBe(outcome)
          expect(result.left.position).toEqual(position)
        }
      }
    }).pipe(Effect.provide(GeneratedWorldProviderLayer({ terrain: { decorate: false } }))),
  )

  it.effect('normalizes a failed store write after a successful read', () =>
    Effect.gen(function* () {
      const position = blockPosition(0, 20, 0)
      const stone = blockIdOf('stone')
      const empty = emptyBlockWorld()
      const next = setBlockAt(empty, position, stone)
      const reading = { _tag: 'Block' as const, block: AIR_BLOCK_ID }

      for (const outcome of ['ChunkNotLoaded', 'OutOfWorld'] as const) {
        const runtime = {
          chunks: {
            getBlock: () => Effect.succeed(reading),
            setBlock: () => Effect.succeed({ _tag: outcome }),
          },
        } as unknown as WorldRuntime
        const result = yield* Effect.either(
          persistBlockWorld(runtime, empty, next),
        )

        expect(result._tag).toBe('Left')
        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(WorldRuntimePersistenceError)
          expect(result.left.outcome).toBe(outcome)
        }
      }
    }),
  )
})
