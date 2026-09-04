import { describe, expect, it } from '@effect/vitest'
import { blockIdOf, blockPosition } from '@nerima-games/mc-kernel'
import {
  CHUNK_HEIGHT,
  chunkCoord,
  type ChunkDirtySubscription,
  type ChunkStoreApi,
} from '@nerima-games/mc-worldgen'
import { Effect, Option } from 'effect'
import {
  GeneratedWorldProviderLayer,
  WorldRuntimePort,
} from '../src/application/generated-world-provider'
import { makeChunkStoreWorldSync } from '../src/application/chunk-store-world-sync'
import { WorldProviderPort } from '../src/application/preview-ports'
import {
  snapshotWorldRuntime,
  WorldRuntimeSnapshotError,
} from '../src/application/world-runtime-snapshot'
import { blockAtChunkWorld } from '../src/domain/chunk-world'
import { DEFAULT_FLAT_WORLD } from '../src/domain/launch-options'

const openWorld = (surfaceY = DEFAULT_FLAT_WORLD.surfaceY) =>
  Effect.gen(function* () {
    const provider = yield* WorldProviderPort
    yield* provider.openFlatWorld({ ...DEFAULT_FLAT_WORLD, surfaceY })
  })

describe('snapshotWorldRuntime', () => {
  it.effect('materializes all loaded chunks and supports an empty runtime', () =>
    Effect.gen(function* () {
      yield* openWorld(4)
      const runtime = yield* WorldRuntimePort
      const opened = yield* runtime.current

      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const world = yield* snapshotWorldRuntime(opened.value.chunks)

      expect(world.height).toBe(CHUNK_HEIGHT)
      expect(world.chunks.size).toBe(9)
      expect(blockAtChunkWorld(world, blockPosition(0, 4, 0))).toBe(
        blockIdOf('grass_block'),
      )
      expect(blockAtChunkWorld(world, blockPosition(-16, 4, -16))).toBe(
        blockIdOf('grass_block'),
      )

      yield* opened.value.chunks.reset
      const empty = yield* snapshotWorldRuntime(opened.value.chunks)
      expect(empty.chunks.size).toBe(0)
    }).pipe(
      Effect.provide(
        GeneratedWorldProviderLayer({ terrain: { decorate: false } }),
      ),
    ),
  )

  it.effect('reports a chunk that unloads while it is being copied', () =>
    Effect.gen(function* () {
      yield* openWorld(4)
      const runtime = yield* WorldRuntimePort
      const opened = yield* runtime.current

      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const store = opened.value.chunks
      const initial = yield* store.loadedCoords
      expect(initial.length).toBeGreaterThan(0)
      const broken: ChunkStoreApi = {
        ...store,
        snapshot: (_coord) => Effect.succeed(undefined),
      }
      const result = yield* Effect.either(snapshotWorldRuntime(broken))

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') {
        throw new Error('expected snapshot to fail')
      }
      expect(result.left).toBeInstanceOf(WorldRuntimeSnapshotError)
      expect(result.left.reason).toBe('chunk-unloaded-during-snapshot')
      expect(result.left.cx).toBe(initial[0]?.cx)
      expect(result.left.cz).toBe(initial[0]?.cz)
    }).pipe(
      Effect.provide(
        GeneratedWorldProviderLayer({ terrain: { decorate: false } }),
      ),
    ),
  )

  it.effect('reports malformed chunk data', () =>
    Effect.gen(function* () {
      yield* openWorld(4)
      const runtime = yield* WorldRuntimePort
      const opened = yield* runtime.current

      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const store = opened.value.chunks
      const initial = yield* store.loadedCoords
      expect(initial.length).toBeGreaterThan(0)
      const broken: ChunkStoreApi = {
        ...store,
        snapshot: (coord) =>
          Effect.map(store.snapshot(coord), (value) =>
            value === undefined
              ? value
              : { ...value, blocks: new Uint16Array(1) },
          ),
      }
      const result = yield* Effect.either(snapshotWorldRuntime(broken))

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') {
        throw new Error('expected snapshot to fail')
      }
      expect(result.left.reason).toBe('invalid-chunk')
      expect(result.left.cx).toBe(initial[0]?.cx)
      expect(result.left.cz).toBe(initial[0]?.cz)
    }).pipe(
      Effect.provide(
        GeneratedWorldProviderLayer({ terrain: { decorate: false } }),
      ),
    ),
  )

  it.effect('reports a loaded-set size change during the copy', () =>
    Effect.gen(function* () {
      yield* openWorld(4)
      const runtime = yield* WorldRuntimePort
      const opened = yield* runtime.current

      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const store = opened.value.chunks
      const initial = yield* store.loadedCoords
      let reads = 0
      const broken: ChunkStoreApi = {
        ...store,
        loadedCoords: Effect.sync(() => {
          reads += 1
          return reads === 1 ? initial : [...initial, chunkCoord(1, 0)]
        }),
      }
      const result = yield* Effect.either(snapshotWorldRuntime(broken))

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') {
        throw new Error('expected snapshot to fail')
      }
      expect(result.left.reason).toBe('loaded-set-changed')
    }).pipe(
      Effect.provide(
        GeneratedWorldProviderLayer({ terrain: { decorate: false } }),
      ),
    ),
  )

  it.effect('reports a loaded-set coordinate change with the same size', () =>
    Effect.gen(function* () {
      yield* openWorld(4)
      const runtime = yield* WorldRuntimePort
      const opened = yield* runtime.current

      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const store = opened.value.chunks
      const initial = yield* store.loadedCoords
      let reads = 0
      const broken: ChunkStoreApi = {
        ...store,
        loadedCoords: Effect.sync(() => {
          reads += 1
          return reads === 1 ? initial : [chunkCoord(1, 0)]
        }),
      }
      const result = yield* Effect.either(snapshotWorldRuntime(broken))

      expect(result._tag).toBe('Left')
      if (result._tag !== 'Left') {
        throw new Error('expected snapshot to fail')
      }
      expect(result.left.reason).toBe('loaded-set-changed')
    }).pipe(
      Effect.provide(
        GeneratedWorldProviderLayer({
          terrain: { decorate: false },
        }),
      ),
    ),
  )

  it.effect('uses the configured surface when copying a runtime', () =>
    Effect.gen(function* () {
      yield* openWorld()
      const runtime = yield* WorldRuntimePort
      const opened = yield* runtime.current

      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const world = yield* snapshotWorldRuntime(opened.value.chunks)
      expect(blockAtChunkWorld(world, blockPosition(0, DEFAULT_FLAT_WORLD.surfaceY, 0))).toBe(
        blockIdOf('grass_block'),
      )
    }).pipe(
      Effect.provide(
        GeneratedWorldProviderLayer({ terrain: { decorate: false } }),
      ),
    ),
  )

  it.effect('unsubscribes when the initial sync snapshot fails', () =>
    Effect.gen(function* () {
      yield* openWorld(4)
      const runtime = yield* WorldRuntimePort
      const opened = yield* runtime.current

      if (Option.isNone(opened)) {
        throw new Error('world was not opened')
      }

      const events: Array<string> = []
      const subscription: ChunkDirtySubscription = {
        id: 1 as ChunkDirtySubscription['id'],
        drain: Effect.succeed({ changed: [], removed: [] }),
        unsubscribe: Effect.sync(() => {
          events.push('unsubscribe')
        }),
      }
      const broken: ChunkStoreApi = {
        ...opened.value.chunks,
        subscribeDirty: Effect.succeed(subscription),
        snapshot: (_coord) => Effect.succeed(undefined),
      }

      const result = yield* Effect.either(makeChunkStoreWorldSync(broken))

      expect(result._tag).toBe('Left')
      expect(events).toEqual(['unsubscribe'])
    }).pipe(
      Effect.provide(
        GeneratedWorldProviderLayer({ terrain: { decorate: false } }),
      ),
    ),
  )
})
