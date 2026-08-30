import { describe, expect, it } from '@effect/vitest'
import { blockIdOf, WorldId as makeWorldId } from '@nerima-games/mc-kernel'
import {
  InMemoryStorageLayer,
  StorageError,
  StoragePort,
  failingStorageLayer,
  makeInMemoryStorage,
  type StorageService,
} from '@nerima-games/mc-save'
import { BlockId, blockIndex, blockPosition, CHUNK_HEIGHT, chunkCoord, generateChunkAt } from '@nerima-games/mc-worldgen'
import { Effect, Layer, Option, Ref } from 'effect'
import { DEFAULT_FLAT_WORLD, type FlatWorldSpec } from '../src/domain/launch-options'
import {
  GeneratedWorldProviderLayer,
  MAX_PRELOAD_RADIUS_CHUNKS,
  PersistentGeneratedWorldProviderLayer,
  WorldRuntimePort,
} from '../src/application/generated-world-provider'
import {
  InvalidWorldSpecError,
  WorldProviderPort,
  type WorldProviderError,
} from '../src/application/preview-ports'

const spec = (overrides: Partial<FlatWorldSpec> = {}): FlatWorldSpec => ({
  ...DEFAULT_FLAT_WORLD,
  radiusChunks: 0,
  worldId: makeWorldId('provider-test'),
  ...overrides,
})

const expectInvalid = (
  provider: WorldProviderPort['Type'],
  world: FlatWorldSpec,
  field: InvalidWorldSpecError['field'],
): Effect.Effect<void, WorldProviderError> =>
  Effect.gen(function* () {
    const result = yield* Effect.either(provider.openFlatWorld(world))
    if (result._tag === 'Right') {
      throw new Error(`expected ${field} validation to fail`)
    }
    expect(result.left).toBeInstanceOf(InvalidWorldSpecError)
    if (result.left._tag !== 'InvalidWorldSpecError') {
      throw new Error(`expected InvalidWorldSpecError, received ${result.left._tag}`)
    }
    expect(result.left.field).toBe(field)
  })

const cleanupFailureStorageLayer = Layer.effect(
  StoragePort,
  Effect.gen(function* () {
    const storage = yield* makeInMemoryStorage
    const readCount = yield* Ref.make(0)

    return {
      ...storage,
      get: (key: Parameters<StorageService['get']>[0]) =>
        Ref.updateAndGet(readCount, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 1
              ? Effect.succeed(Option.none())
              : Effect.fail(new StorageError({ operation: 'load', key })),
          ),
        ),
      put: (key: Parameters<StorageService['put']>[0]) =>
        Effect.fail(new StorageError({ operation: 'cleanup', key })),
    }
  }),
)

const replacementCleanupFailureStorageLayer = Layer.effect(
  StoragePort,
  Effect.gen(function* () {
    const storage = yield* makeInMemoryStorage

    return {
      ...storage,
      get: (_key: Parameters<StorageService['get']>[0]) => Effect.succeed(Option.none()),
      put: (key: Parameters<StorageService['put']>[0]) =>
        Effect.fail(new StorageError({ operation: 'old-unload', key })),
    }
  }),
)

const replacementCleanupSuccessStorageLayer = Layer.effect(
  StoragePort,
  Effect.gen(function* () {
    const storage = yield* makeInMemoryStorage
    const writeCount = yield* Ref.make(0)

    return {
      ...storage,
      get: (_key: Parameters<StorageService['get']>[0]) => Effect.succeed(Option.none()),
      put: (key: Parameters<StorageService['put']>[0]) =>
        Ref.updateAndGet(writeCount, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 1
              ? Effect.fail(new StorageError({ operation: 'old-unload', key }))
              : Effect.void,
          ),
        ),
    }
  }),
)

describe('GeneratedWorldProviderLayer', () => {
  it.effect('validates world specs before touching the runtime', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort

      yield* expectInvalid(provider, spec({ worldId: '  ' as FlatWorldSpec['worldId'] }), 'worldId')
      yield* expectInvalid(provider, spec({ seed: Number.NaN }), 'seed')
      yield* expectInvalid(
        provider,
        spec({ generation: 'unsupported' as FlatWorldSpec['generation'] }),
        'generation',
      )
      yield* expectInvalid(provider, spec({ surfaceY: Number.POSITIVE_INFINITY }), 'surfaceY')
      yield* expectInvalid(provider, spec({ surfaceY: -1 }), 'surfaceY')
      yield* expectInvalid(provider, spec({ surfaceY: CHUNK_HEIGHT }), 'surfaceY')
      yield* expectInvalid(provider, spec({ radiusChunks: 1.5 }), 'radiusChunks')
      yield* expectInvalid(provider, spec({ radiusChunks: -1 }), 'radiusChunks')
      yield* expectInvalid(provider, spec({ radiusChunks: MAX_PRELOAD_RADIUS_CHUNKS + 1 }), 'radiusChunks')

      const runtime = yield* WorldRuntimePort
      expect(Option.isNone(yield* runtime.current)).toBe(true)
    }).pipe(Effect.provide(GeneratedWorldProviderLayer({ terrain: { decorate: false } }))),
  )

  it.effect('materializes the requested flat surface in generated chunks', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      const world = spec({ surfaceY: 4 })

      yield* provider.openFlatWorld(world)
      const opened = yield* runtime.current
      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }
      const readBlock = (y: number) =>
        opened.value.chunks.getBlock(blockPosition(0, y, 0)).pipe(
          Effect.flatMap((reading) =>
            reading._tag === 'Block'
              ? Effect.succeed(reading.block)
              : Effect.fail(new Error(`expected loaded block at y=${String(y)}`)),
          ),
        )

      expect(yield* readBlock(0)).toBe(blockIdOf('bedrock'))
      expect(yield* readBlock(1)).toBe(blockIdOf('stone'))
      expect(yield* readBlock(2)).toBe(blockIdOf('dirt'))
      expect(yield* readBlock(4)).toBe(blockIdOf('grass_block'))
      expect(yield* readBlock(5)).toBe(blockIdOf('air'))
      expect(yield* opened.value.chunks.getBlock(blockPosition(15, 4, 15))).toEqual({
        _tag: 'Block',
        block: blockIdOf('grass_block'),
      })
    }).pipe(Effect.provide(GeneratedWorldProviderLayer({ terrain: { decorate: false } }))),
  )

  it.effect('preserves mc-worldgen terrain in natural mode', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      const world = spec({ generation: 'natural', seed: 17 })

      yield* provider.openFlatWorld(world)
      const opened = yield* runtime.current
      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }
      const actual = yield* opened.value.chunks.snapshot(chunkCoord(0, 0))
      const expected = generateChunkAt(world.seed, 0, 0, { decorate: false })

      expect(actual?.blocks).toEqual(expected.blocks)
      expect(actual?.blocks[blockIndex(0, world.surfaceY, 0)]).not.toBe(blockIdOf('grass_block'))
    }).pipe(Effect.provide(GeneratedWorldProviderLayer({ terrain: { decorate: false } }))),
  )

  it.effect('loads, reuses, replaces, and closes generated chunks', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      const initial = spec()

      yield* provider.openFlatWorld(initial)
      const first = yield* runtime.current
      if (Option.isNone(first)) {
        throw new Error('world was not opened')
      }
      expect(yield* first.value.chunks.loadedCoords).toHaveLength(1)

      yield* provider.openFlatWorld(initial)
      const same = yield* runtime.current
      if (Option.isNone(same)) {
        throw new Error('world disappeared during idempotent open')
      }
      expect(same.value.chunks).toBe(first.value.chunks)

      const variants: ReadonlyArray<FlatWorldSpec> = [
        spec({ worldId: makeWorldId('provider-test-other') }),
        spec({ seed: 1 }),
        spec({ generation: 'natural' }),
        spec({ surfaceY: 50 }),
        spec({ radiusChunks: 1 }),
      ]
      let previous = first.value.chunks
      for (const variant of variants) {
        yield* provider.openFlatWorld(variant)
        const current = yield* runtime.current
        if (Option.isNone(current)) {
          throw new Error('world was not replaced')
        }
        expect(current.value.chunks).not.toBe(previous)
        expect(yield* current.value.chunks.loadedCoords).toHaveLength((variant.radiusChunks * 2 + 1) ** 2)
        previous = current.value.chunks
      }

      yield* provider.closeWorld
      expect(Option.isNone(yield* runtime.current)).toBe(true)
      yield* provider.closeWorld
    }).pipe(Effect.provide(GeneratedWorldProviderLayer())),
  )

  it.effect('persists block mutations across close and reopen', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      const world = spec({ worldId: makeWorldId('persistent-provider-test') })
      const position = blockPosition(0, 100, 0)
      const block = BlockId(14)

      yield* provider.openFlatWorld(world)
      const opened = yield* runtime.current
      if (Option.isNone(opened)) {
        throw new Error('persistent world was not opened')
      }
      expect((yield* opened.value.chunks.setBlock(position, block))._tag).toBe('Written')

      yield* provider.closeWorld
      yield* provider.openFlatWorld(world)
      const reopened = yield* runtime.current
      if (Option.isNone(reopened)) {
        throw new Error('persistent world was not reopened')
      }
      const reading = yield* reopened.value.chunks.getBlock(position)
      expect(reading._tag).toBe('Block')
      if (reading._tag !== 'Block') {
        throw new Error('persisted block was not readable')
      }
      expect(reading.block).toBe(block)
    }).pipe(
      Effect.provide(
        PersistentGeneratedWorldProviderLayer({ terrain: { decorate: false } }).pipe(
          Layer.provide(InMemoryStorageLayer),
        ),
      ),
    ),
  )

  it.effect('keeps the active runtime when a replacement cannot load', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      const active = spec({ worldId: makeWorldId('active-provider-test') })

      yield* provider.openFlatWorld(active)
      const result = yield* Effect.either(
        provider.openFlatWorld(spec({ worldId: makeWorldId('replacement-load-failure-test') })),
      )

      expect(result._tag).toBe('Left')
      const current = yield* runtime.current
      if (Option.isNone(current)) {
        throw new Error('active world was lost after replacement load failure')
      }
      expect(current.value.spec.worldId).toBe(active.worldId)
    }).pipe(
      Effect.provide(
        PersistentGeneratedWorldProviderLayer({ terrain: { decorate: false } }).pipe(
          Layer.provide(cleanupFailureStorageLayer),
        ),
      ),
    ),
  )

  it.effect('keeps the active runtime when replacing it cannot unload the old chunks', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      const active = spec({ worldId: makeWorldId('active-unload-failure-test') })

      yield* provider.openFlatWorld(active)
      const result = yield* Effect.either(
        provider.openFlatWorld(spec({ worldId: makeWorldId('replacement-unload-failure-test') })),
      )

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') {
        throw new Error('expected replacement unload failure')
      }
      expect(result.left._tag).toBe('StorageError')
      if (result.left._tag !== 'StorageError') {
        throw new Error(`expected StorageError, received ${result.left._tag}`)
      }
      expect(result.left.operation).toBe('old-unload')
      const current = yield* runtime.current
      if (Option.isNone(current)) {
        throw new Error('active world was lost after replacement unload failure')
      }
      expect(current.value.spec.worldId).toBe(active.worldId)
    }).pipe(
      Effect.provide(
        PersistentGeneratedWorldProviderLayer({ terrain: { decorate: false } }).pipe(
          Layer.provide(replacementCleanupFailureStorageLayer),
        ),
      ),
    ),
  )

  it.effect('preserves the active runtime when replacement cleanup succeeds after old cleanup fails', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      const active = spec({ worldId: makeWorldId('active-cleanup-recovery-test') })

      yield* provider.openFlatWorld(active)
      const result = yield* Effect.either(
        provider.openFlatWorld(spec({ worldId: makeWorldId('replacement-cleanup-recovery-test') })),
      )

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') {
        throw new Error('expected old cleanup failure')
      }
      expect(result.left._tag).toBe('StorageError')
      if (result.left._tag !== 'StorageError') {
        throw new Error(`expected StorageError, received ${result.left._tag}`)
      }
      expect(result.left.operation).toBe('old-unload')
      const current = yield* runtime.current
      if (Option.isNone(current)) {
        throw new Error('active world was lost after cleanup recovery')
      }
      expect(current.value.spec.worldId).toBe(active.worldId)
    }).pipe(
      Effect.provide(
        PersistentGeneratedWorldProviderLayer({ terrain: { decorate: false } }).pipe(
          Layer.provide(replacementCleanupSuccessStorageLayer),
        ),
      ),
    ),
  )

  it.effect('propagates storage failures and leaves no half-open world', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      const result = yield* Effect.either(provider.openFlatWorld(spec({ worldId: makeWorldId('failing-provider-test') })))

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') {
        throw new Error('expected storage failure')
      }
      expect(result.left._tag).toBe('StorageError')
      expect(Option.isNone(yield* runtime.current)).toBe(true)
      yield* provider.closeWorld
    }).pipe(
      Effect.provide(
        PersistentGeneratedWorldProviderLayer().pipe(
          Layer.provide(failingStorageLayer('load')),
        ),
      ),
    ),
  )

  it.effect('keeps the runtime available when closing cannot persist a chunk', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort

      yield* provider.openFlatWorld(spec({ worldId: makeWorldId('close-failure-provider-test') }))
      const result = yield* Effect.either(provider.closeWorld)

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') {
        throw new Error('expected close persistence failure')
      }
      expect(result.left._tag).toBe('StorageError')
      if (result.left._tag !== 'StorageError') {
        throw new Error(`expected StorageError, received ${result.left._tag}`)
      }
      expect(result.left.operation).toBe('cleanup')
      expect(Option.isSome(yield* runtime.current)).toBe(true)
    }).pipe(
      Effect.provide(
        PersistentGeneratedWorldProviderLayer({ terrain: { decorate: false } }).pipe(
          Layer.provide(cleanupFailureStorageLayer),
        ),
      ),
    ),
  )

  it.effect('preserves the load failure when cleanup persistence also fails', () =>
    Effect.gen(function* () {
      const provider = yield* WorldProviderPort
      const runtime = yield* WorldRuntimePort
      const result = yield* Effect.either(
        provider.openFlatWorld(
          spec({ worldId: makeWorldId('cleanup-failure-provider-test'), radiusChunks: 1 }),
        ),
      )

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') {
        throw new Error('expected load failure')
      }
      expect(result.left._tag).toBe('StorageError')
      if (result.left._tag !== 'StorageError') {
        throw new Error(`expected StorageError, received ${result.left._tag}`)
      }
      expect(result.left.operation).toBe('load')
      expect(Option.isNone(yield* runtime.current)).toBe(true)
    }).pipe(
      Effect.provide(
        PersistentGeneratedWorldProviderLayer({ terrain: { decorate: false } }).pipe(
          Layer.provide(cleanupFailureStorageLayer),
        ),
      ),
    ),
  )
})
