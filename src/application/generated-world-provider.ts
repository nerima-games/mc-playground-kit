import {
  CHUNK_HEIGHT,
  type ChunkCoord,
  type ChunkPersistenceContext,
  type ChunkPersistenceError,
  type ChunkSource,
  type ChunkStoreApi,
  type Dimension,
  type GenerateOptions,
  chunkCoord,
  generatedDimensionChunkSource,
  makeChunkStore,
  makePersistentChunkStore,
} from '@nerima-games/mc-worldgen'
import { Context, Effect, Layer, Option, Ref } from 'effect'
import {
  InvalidWorldSpecError,
  type WorldProviderError,
  WorldProviderPort,
  type WorldProviderService,
} from './preview-ports.js'
import { MIN_FLAT_SURFACE_Y, flatChunkOf } from '../domain/flat-chunk.js'
import type { FlatWorldSpec } from '../domain/launch-options.js'
import { StoragePort } from '@nerima-games/mc-save'

export const DEFAULT_WORLD_DIMENSION: Dimension = 'overworld'
const EMPTY_TEXT_LENGTH = 0
const MIN_PRELOAD_RADIUS_CHUNKS = 0
const UNIT_STEP = 1
const SINGLE_PERMIT = 1
const LAST_BLOCK_OFFSET = 1
export const MAX_PRELOAD_RADIUS_CHUNKS = 32

export type GeneratedWorldProviderOptions = {
  readonly dimension?: Dimension
  readonly terrain?: GenerateOptions
}

export type WorldRuntime = {
  readonly spec: FlatWorldSpec
  readonly dimension: Dimension
  readonly chunks: ChunkStoreApi
}

export type WorldRuntimeService = {
  readonly current: Effect.Effect<Option.Option<WorldRuntime>>
}

// TypeScript's `isolatedDeclarations` cannot infer through `extends Context.Tag(...)<...>()`, an instantiation expression; hoisting it into an explicitly typed const (same pattern as mc-kernel's ClockPort in src/domain/clock.ts) gives the extends clause a plain identifier.
const WorldRuntimePortBase: Context.TagClass<
  WorldRuntimePort,
  '@nerima-games/mc-playground-kit/WorldRuntimePort',
  WorldRuntimeService
> = Context.Tag('@nerima-games/mc-playground-kit/WorldRuntimePort')<WorldRuntimePort, WorldRuntimeService>()
export class WorldRuntimePort extends WorldRuntimePortBase {}

const invalidSpec = (
  field: InvalidWorldSpecError['field'],
  value: unknown,
  message: string,
): Effect.Effect<never, InvalidWorldSpecError> =>
  Effect.fail(new InvalidWorldSpecError({ field, message, value }))

const validateWorldIdentity = (
  spec: FlatWorldSpec,
): Effect.Effect<FlatWorldSpec, InvalidWorldSpecError> => {
  if (String(spec.worldId).trim().length === EMPTY_TEXT_LENGTH) {
    return invalidSpec('worldId', spec.worldId, 'worldId must not be blank')
  }
  if (!Number.isFinite(spec.seed)) {
    return invalidSpec('seed', spec.seed, 'seed must be finite')
  }
  if (spec.generation !== 'flat' && spec.generation !== 'natural') {
    return invalidSpec('generation', spec.generation, 'generation must be flat or natural')
  }
  return Effect.succeed(spec)
}

const validateSurface = (spec: FlatWorldSpec): Effect.Effect<FlatWorldSpec, InvalidWorldSpecError> => {
  if (!Number.isSafeInteger(spec.surfaceY)) {
    return invalidSpec('surfaceY', spec.surfaceY, 'surfaceY must be a safe integer')
  }
  if (spec.surfaceY < MIN_FLAT_SURFACE_Y || spec.surfaceY >= CHUNK_HEIGHT) {
    return invalidSpec(
      'surfaceY',
      spec.surfaceY,
      `surfaceY must be an integer from ${String(MIN_FLAT_SURFACE_Y)} through ${String(CHUNK_HEIGHT - LAST_BLOCK_OFFSET)}`,
    )
  }
  return Effect.succeed(spec)
}

const validateRadius = (spec: FlatWorldSpec): Effect.Effect<FlatWorldSpec, InvalidWorldSpecError> => {
  if (
    !Number.isSafeInteger(spec.radiusChunks) ||
    spec.radiusChunks < MIN_PRELOAD_RADIUS_CHUNKS ||
    spec.radiusChunks > MAX_PRELOAD_RADIUS_CHUNKS
  ) {
    return invalidSpec(
      'radiusChunks',
      spec.radiusChunks,
      `radiusChunks must be an integer from ${String(MIN_PRELOAD_RADIUS_CHUNKS)} through ${String(MAX_PRELOAD_RADIUS_CHUNKS)}`,
    )
  }
  return Effect.succeed(spec)
}

export const validateWorldSpec = (
  spec: FlatWorldSpec,
): Effect.Effect<FlatWorldSpec, InvalidWorldSpecError> =>
  validateWorldIdentity(spec).pipe(Effect.flatMap(validateSurface), Effect.flatMap(validateRadius))

const chunkCoordsForRadius = (radiusChunks: number): ReadonlyArray<ChunkCoord> => {
  const coords: Array<ChunkCoord> = []
  for (let chunkX = -radiusChunks; chunkX <= radiusChunks; chunkX += UNIT_STEP) {
    for (let chunkZ = -radiusChunks; chunkZ <= radiusChunks; chunkZ += UNIT_STEP) {
      coords.push(chunkCoord(chunkX, chunkZ))
    }
  }
  return coords
}

const loadAll = (store: ChunkStoreApi, coords: ReadonlyArray<ChunkCoord>): Effect.Effect<void, ChunkPersistenceError> =>
  Effect.forEach(coords, (coord) => store.load(coord), { discard: true })

const unloadAll = (store: ChunkStoreApi): Effect.Effect<void, ChunkPersistenceError> =>
  Effect.flatMap(store.loadedCoords, (coords) =>
    Effect.forEach(coords, (coord) => store.unload(coord), { discard: true }),
  )

const loadWithCleanup = (
  store: ChunkStoreApi,
  coords: ReadonlyArray<ChunkCoord>,
): Effect.Effect<void, ChunkPersistenceError> =>
  loadAll(store, coords).pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) =>
        unloadAll(store).pipe(
          Effect.matchCauseEffect({
            onFailure: () => Effect.failCause(cause),
            onSuccess: () => Effect.failCause(cause),
          }),
        ),
      onSuccess: () => Effect.void,
    }),
  )

const sameWorld = (left: FlatWorldSpec, right: FlatWorldSpec): boolean =>
  String(left.worldId) === String(right.worldId) &&
  left.seed === right.seed &&
  left.generation === right.generation &&
  left.surfaceY === right.surfaceY &&
  left.radiusChunks === right.radiusChunks

type NormalizedGeneratedWorldProviderOptions = {
  readonly dimension: Dimension
  readonly terrain?: GenerateOptions
}

const sourceForWorld = (
  spec: FlatWorldSpec,
  options: NormalizedGeneratedWorldProviderOptions,
): ChunkSource => {
  const generatedSource = generatedDimensionChunkSource(spec.seed, options.dimension, options.terrain)
  if (spec.generation === 'natural') {
    return generatedSource
  }
  return (coord) =>
    generatedSource(coord).pipe(
      Effect.map((chunk) => flatChunkOf(chunk, spec.surfaceY, options.dimension)),
    )
}

type StoreFactory = (
  source: ChunkSource,
  context: ChunkPersistenceContext,
) => Effect.Effect<ChunkStoreApi, ChunkPersistenceError>

const closeRuntime = (
  currentRef: Ref.Ref<Option.Option<WorldRuntime>>,
  current: Option.Option<WorldRuntime>,
): Effect.Effect<void, ChunkPersistenceError> =>
  Effect.gen(function* closeRuntimeGen() {
    if (Option.isNone(current)) {
      return
    }
    yield* unloadAll(current.value.chunks)
    yield* Ref.set(currentRef, Option.none())
  })

const installRuntime = (
  currentRef: Ref.Ref<Option.Option<WorldRuntime>>,
  current: Option.Option<WorldRuntime>,
  replacement: WorldRuntime,
): Effect.Effect<void, ChunkPersistenceError> => {
  if (Option.isNone(current)) {
    return Ref.set(currentRef, Option.some(replacement))
  }

  return unloadAll(current.value.chunks).pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) =>
        unloadAll(replacement.chunks).pipe(
          Effect.matchCauseEffect({
            onFailure: () => Effect.failCause(cause),
            onSuccess: () => Effect.failCause(cause),
          }),
        ),
      onSuccess: () => Ref.set(currentRef, Option.some(replacement)),
    }),
  )
}

const makeWorldProvider = (
  options: NormalizedGeneratedWorldProviderOptions,
  makeStore: StoreFactory,
): Effect.Effect<Context.Context<WorldProviderPort | WorldRuntimePort>> =>
  Effect.gen(function* makeWorldProviderGen() {
    const currentRef = yield* Ref.make<Option.Option<WorldRuntime>>(Option.none())
    const mutex = yield* Effect.makeSemaphore(SINGLE_PERMIT)

    const openFlatWorldUnlocked = (spec: FlatWorldSpec): Effect.Effect<void, WorldProviderError> =>
      Effect.gen(function* openFlatWorldGen() {
        const validated = yield* validateWorldSpec(spec)
        const current = yield* Ref.get(currentRef)
        if (Option.isSome(current)) {
          if (sameWorld(current.value.spec, validated)) {
            return
          }
        }
        const chunks = yield* makeStore(sourceForWorld(validated, options), {
          dimension: options.dimension,
          worldId: String(validated.worldId),
        })
        yield* loadWithCleanup(chunks, chunkCoordsForRadius(validated.radiusChunks))
        yield* installRuntime(currentRef, current, {
          chunks,
          dimension: options.dimension,
          spec: validated,
        })
      })

    const closeWorldUnlocked: Effect.Effect<void, WorldProviderError> = Effect.gen(function* closeWorldGen() {
      const current = yield* Ref.get(currentRef)
      yield* closeRuntime(currentRef, current)
    })

    const openFlatWorld = (spec: FlatWorldSpec): Effect.Effect<void, WorldProviderError> =>
      mutex.withPermits(SINGLE_PERMIT)(openFlatWorldUnlocked(spec))
    const closeWorld = mutex.withPermits(SINGLE_PERMIT)(closeWorldUnlocked)

    const provider: WorldProviderService = { closeWorld, openFlatWorld }
    const runtime: WorldRuntimeService = { current: Ref.get(currentRef) }
    return Context.merge(Context.make(WorldProviderPort, provider), Context.make(WorldRuntimePort, runtime))
  })

const normalizedOptions = (options: GeneratedWorldProviderOptions): NormalizedGeneratedWorldProviderOptions => {
  const dimension = options.dimension ?? DEFAULT_WORLD_DIMENSION
  if (options.terrain) {
    return { dimension, terrain: options.terrain }
  }
  return { dimension }
}

export const GeneratedWorldProviderLayer = (
  options: GeneratedWorldProviderOptions = {},
): Layer.Layer<WorldProviderPort | WorldRuntimePort, WorldProviderError> =>
  Layer.effectContext(makeWorldProvider(normalizedOptions(options), (source) => makeChunkStore(source)))

export const PersistentGeneratedWorldProviderLayer = (
  options: GeneratedWorldProviderOptions = {},
): Layer.Layer<WorldProviderPort | WorldRuntimePort, WorldProviderError, StoragePort> =>
  Layer.effectContext(
    Effect.flatMap(StoragePort, (storage) =>
      makeWorldProvider(
        normalizedOptions(options),
        (source, context) => makePersistentChunkStore(source, context).pipe(Effect.provideService(StoragePort, storage)),
      ),
    ),
  )
