import {
  CHUNK_HEIGHT,
  type ChunkStoreApi,
  type Chunk as GeneratedChunk,
  type ChunkCoord as GeneratedChunkCoord,
} from '@nerima-games/mc-worldgen'
import { Cause, Data, Effect } from 'effect'
import {
  type ChunkWorld,
  emptyChunkWorld,
  kernelChunkFromBlocks,
  storeChunkInChunkWorld,
} from '../domain/chunk-world.js'
import { type Chunk as KernelChunk, chunkCoord } from '@nerima-games/mc-kernel'

export type WorldRuntimeSnapshotReason =
  | 'chunk-unloaded-during-snapshot'
  | 'loaded-set-changed'
  | 'invalid-chunk'

type WorldRuntimeSnapshotErrorFields = {
  readonly cx?: number
  readonly cz?: number
  readonly reason: WorldRuntimeSnapshotReason
}
// TypeScript's `isolatedDeclarations` cannot infer through `extends Data.TaggedError(...)<...>()`, an instantiation expression; hoisting it into an explicitly typed const (same pattern as mc-kernel's ClockPort in src/domain/clock.ts) gives the extends clause a plain identifier.
const WorldRuntimeSnapshotErrorBase: new (
  args: WorldRuntimeSnapshotErrorFields,
) => Cause.YieldableError & { readonly _tag: 'WorldRuntimeSnapshotError' } & Readonly<WorldRuntimeSnapshotErrorFields> =
  // oxlint-disable-next-line new-cap -- Effect exposes TaggedError as a factory with a constructor-shaped name.
  Data.TaggedError('WorldRuntimeSnapshotError')<WorldRuntimeSnapshotErrorFields>
export class WorldRuntimeSnapshotError extends WorldRuntimeSnapshotErrorBase {}

const coordKeyOf = (coord: { readonly cx: number; readonly cz: number }): string =>
  `${String(coord.cx)},${String(coord.cz)}`

const sameLoadedCoords = (
  left: ReadonlyArray<GeneratedChunkCoord>,
  right: ReadonlyArray<GeneratedChunkCoord>,
): boolean => {
  if (left.length !== right.length) {
    return false
  }

  const leftKeys = new Set(left.map(coordKeyOf))
  return right.every((coord) => leftKeys.has(coordKeyOf(coord)))
}

// Worldgen's own Chunk.blocks is a plain, unregistry-gated Uint16Array
// (mc-worldgen 0.4.0); kernelChunkFromBlocks widens each id through the
// Kernel Chunk's own checked set() rather than a Uint8Array cast, which
// Would silently narrow any id above 255.
const kernelChunkOf = (value: GeneratedChunk): KernelChunk =>
  kernelChunkFromBlocks(
    chunkCoord(value.coord.cx, value.coord.cz),
    CHUNK_HEIGHT,
    value.blocks,
  )

export const snapshotChunk = (
  store: ChunkStoreApi,
  coord: GeneratedChunkCoord,
): Effect.Effect<KernelChunk, WorldRuntimeSnapshotError> =>
  Effect.flatMap(store.snapshot(coord), (value) => {
    if (!value) {
      return Effect.fail(
        new WorldRuntimeSnapshotError({
          cx: coord.cx,
          cz: coord.cz,
          reason: 'chunk-unloaded-during-snapshot',
        }),
      )
    }

    return Effect.try({
      catch: () =>
        new WorldRuntimeSnapshotError({
          cx: coord.cx,
          cz: coord.cz,
          reason: 'invalid-chunk',
        }),
      try: () => kernelChunkOf(value),
    })
  })

const assertLoadedCoordsUnchanged = (
  store: ChunkStoreApi,
  loadedCoords: ReadonlyArray<GeneratedChunkCoord>,
): Effect.Effect<void, WorldRuntimeSnapshotError> =>
  Effect.flatMap(store.loadedCoords, (currentLoadedCoords) => {
    if (sameLoadedCoords(loadedCoords, currentLoadedCoords)) {
      return Effect.void
    }
    return Effect.fail(new WorldRuntimeSnapshotError({ reason: 'loaded-set-changed' }))
  })

const worldOfChunks = (
  chunks: ReadonlyArray<KernelChunk>,
): Effect.Effect<ChunkWorld, WorldRuntimeSnapshotError> => {
  const emptyWorld = emptyChunkWorld(CHUNK_HEIGHT)
  if ('_tag' in emptyWorld) {
    return Effect.fail(new WorldRuntimeSnapshotError({ reason: 'invalid-chunk' }))
  }

  let world = emptyWorld
  for (const value of chunks) {
    const { world: nextWorld } = storeChunkInChunkWorld(world, value)
    world = nextWorld
  }
  return Effect.succeed(world)
}

export const snapshotWorldRuntime = (
  store: ChunkStoreApi,
): Effect.Effect<ChunkWorld, WorldRuntimeSnapshotError> =>
  Effect.gen(function* snapshotWorldRuntimeGen() {
    const loadedCoords = yield* store.loadedCoords
    const chunks = yield* Effect.forEach(loadedCoords, (coord) => snapshotChunk(store, coord))
    yield* assertLoadedCoordsUnchanged(store, loadedCoords)
    return yield* worldOfChunks(chunks)
  })
