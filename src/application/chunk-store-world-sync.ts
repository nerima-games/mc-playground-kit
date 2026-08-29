import {
  type ChunkDirtyBatch,
  type ChunkDirtySubscription,
  type ChunkStoreApi,
} from '@nerima-games/mc-worldgen'
import { Effect, Ref } from 'effect'
import { chunkKeyOf } from '@nerima-games/mc-kernel'

import { type BlockWorld } from '../domain/block-world.js'
import {
  type ChunkWorld,
  blockWorldOfChunkWorld,
  removeChunkFromChunkWorld,
  storeChunkInChunkWorld,
} from '../domain/chunk-world.js'
import {
  type WorldRuntimeSnapshotError,
  snapshotChunk,
  snapshotWorldRuntime,
} from './world-runtime-snapshot.js'

export type ChunkStoreWorldSync = {
  readonly current: Effect.Effect<BlockWorld>
  readonly refresh: Effect.Effect<boolean, WorldRuntimeSnapshotError>
  readonly close: Effect.Effect<void>
}

const EMPTY_DIRTY_BATCH_LENGTH = 0
const REFRESH_PERMITS = 1

type RefreshWorldContext = {
  readonly blockWorld: Ref.Ref<BlockWorld>
  readonly chunkWorld: Ref.Ref<ChunkWorld>
  readonly store: ChunkStoreApi
  readonly subscription: ChunkDirtySubscription
}

const applyDirtyBatch = (
  context: RefreshWorldContext,
  batch: ChunkDirtyBatch,
): Effect.Effect<ChunkWorld, WorldRuntimeSnapshotError> =>
  Effect.gen(function* applyDirtyBatchGen() {
    let nextWorld = yield* Ref.get(context.chunkWorld)
    for (const coord of batch.removed) {
      nextWorld = removeChunkFromChunkWorld(nextWorld, chunkKeyOf(coord)).world
    }
    for (const coord of batch.changed) {
      const nextChunk = yield* snapshotChunk(context.store, coord)
      nextWorld = storeChunkInChunkWorld(nextWorld, nextChunk).world
    }

    return nextWorld
  })

const refreshWorld = (
  context: RefreshWorldContext,
): Effect.Effect<boolean, WorldRuntimeSnapshotError> =>
  Effect.gen(function* refreshWorldGen() {
    const batch = yield* context.subscription.drain
    if (
      batch.changed.length === EMPTY_DIRTY_BATCH_LENGTH &&
      batch.removed.length === EMPTY_DIRTY_BATCH_LENGTH
    ) {
      return false
    }

    const nextWorld = yield* applyDirtyBatch(context, batch)
    yield* Ref.set(context.chunkWorld, nextWorld)
    yield* Ref.set(context.blockWorld, blockWorldOfChunkWorld(nextWorld))
    return true
  })

export const makeChunkStoreWorldSync = (
  store: ChunkStoreApi,
): Effect.Effect<ChunkStoreWorldSync, WorldRuntimeSnapshotError> =>
  Effect.flatMap(store.subscribeDirty, (subscription) =>
    Effect.gen(function* makeChunkStoreWorldSyncGen() {
      const initialWorld = yield* snapshotWorldRuntime(store)
      const chunkWorld = yield* Ref.make(initialWorld)
      const blockWorld = yield* Ref.make(blockWorldOfChunkWorld(initialWorld))
      const refreshMutex = yield* Effect.makeSemaphore(REFRESH_PERMITS)
      const refresh = refreshMutex.withPermits(REFRESH_PERMITS)(
        refreshWorld({
          blockWorld,
          chunkWorld,
          store,
          subscription,
        }),
      )

      return {
        close: subscription.unsubscribe,
        current: Ref.get(blockWorld),
        refresh,
      }
    }).pipe(
      Effect.catchAllCause((cause) =>
        subscription.unsubscribe.pipe(Effect.zipRight(Effect.failCause(cause))),
      ),
    ),
  )
