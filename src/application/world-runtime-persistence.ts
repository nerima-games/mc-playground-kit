import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type BlockPositionKey,
  blockPositionOfKey,
} from '@nerima-games/mc-kernel'
import { Cause, Data, Effect } from 'effect'
import type { BlockWorld } from '../domain/block-world.js'
import type { WorldRuntime } from './generated-world-provider.js'

export type WorldRuntimePersistenceResult = {
  readonly unchanged: number
  readonly written: number
}

type WorldRuntimePersistenceErrorFields = {
  readonly block: BlockId
  readonly message: string
  readonly outcome: 'ChunkNotLoaded' | 'OutOfWorld'
  readonly position: BlockPosition
}
// TypeScript's `isolatedDeclarations` cannot infer through `extends Data.TaggedError(...)<...>()`, an instantiation expression; hoisting it into an explicitly typed const (same pattern as mc-kernel's ClockPort in src/domain/clock.ts) gives the extends clause a plain identifier.
const WorldRuntimePersistenceErrorBase: new (
  args: WorldRuntimePersistenceErrorFields,
) => Cause.YieldableError & { readonly _tag: 'WorldRuntimePersistenceError' } & Readonly<WorldRuntimePersistenceErrorFields> =
  // oxlint-disable-next-line new-cap -- Effect exposes TaggedError as a factory with a constructor-shaped name.
  Data.TaggedError('WorldRuntimePersistenceError')<WorldRuntimePersistenceErrorFields>
export class WorldRuntimePersistenceError extends WorldRuntimePersistenceErrorBase {}

type BlockChange = readonly [position: BlockPosition, block: BlockId]
type WriteCounts = WorldRuntimePersistenceResult

const NO_CHANGES = 0
const ONE_CHANGE = 1

const changesBetween = (previous: BlockWorld, next: BlockWorld): ReadonlyArray<BlockChange> => {
  const keys = new Set<BlockPositionKey>([...previous.keys(), ...next.keys()])
  const changes: Array<BlockChange> = []

  for (const key of keys) {
    const previousBlock = previous.get(key) ?? AIR_BLOCK_ID
    const nextBlock = next.get(key) ?? AIR_BLOCK_ID
    if (previousBlock !== nextBlock) {
      changes.push([blockPositionOfKey(key), nextBlock])
    }
  }

  return changes
}

const persistenceError = (
  position: BlockPosition,
  block: BlockId,
  outcome: 'ChunkNotLoaded' | 'OutOfWorld',
): WorldRuntimePersistenceError =>
  new WorldRuntimePersistenceError({
    block,
    message: `cannot persist block at ${String(position.x)},${String(position.y)},${String(position.z)}: ${outcome}`,
    outcome,
    position,
  })

const assertWritable = (
  runtime: WorldRuntime,
  [position, block]: BlockChange,
): Effect.Effect<void, WorldRuntimePersistenceError> =>
  Effect.flatMap(runtime.chunks.getBlock(position), (reading) => {
    if (reading._tag === 'ChunkNotLoaded' || reading._tag === 'OutOfWorld') {
      return Effect.fail(persistenceError(position, block, reading._tag))
    }
    return Effect.void
  })

const assertChangesWritable = (
  runtime: WorldRuntime,
  changes: ReadonlyArray<BlockChange>,
): Effect.Effect<void, WorldRuntimePersistenceError> =>
  Effect.forEach(changes, (change) => assertWritable(runtime, change), {
    discard: true,
  })

const writeChange = (
  runtime: WorldRuntime,
  [position, block]: BlockChange,
): Effect.Effect<WriteCounts, WorldRuntimePersistenceError> =>
  runtime.chunks.setBlock(position, block).pipe(
    Effect.flatMap((outcome) => {
      if (outcome._tag === 'Written') {
        return Effect.succeed({ unchanged: NO_CHANGES, written: ONE_CHANGE })
      }
      if (outcome._tag === 'Unchanged') {
        return Effect.succeed({ unchanged: ONE_CHANGE, written: NO_CHANGES })
      }
      return Effect.fail(persistenceError(position, block, outcome._tag))
    }),
  )

const sumWriteCounts = (
  counts: ReadonlyArray<WriteCounts>,
): WorldRuntimePersistenceResult =>
  counts.reduce<WorldRuntimePersistenceResult>(
    (total, current) => ({
      unchanged: total.unchanged + current.unchanged,
      written: total.written + current.written,
    }),
    { unchanged: NO_CHANGES, written: NO_CHANGES },
  )

const writeChanges = (
  runtime: WorldRuntime,
  changes: ReadonlyArray<BlockChange>,
): Effect.Effect<WorldRuntimePersistenceResult, WorldRuntimePersistenceError> =>
  Effect.forEach(changes, (change) => writeChange(runtime, change)).pipe(
    Effect.map(sumWriteCounts),
  )

export const persistBlockWorld = (
  runtime: WorldRuntime,
  previous: BlockWorld,
  next: BlockWorld,
): Effect.Effect<WorldRuntimePersistenceResult, WorldRuntimePersistenceError> =>
  Effect.gen(function* persistBlockWorldGen() {
    const changes = changesBetween(previous, next)

    yield* assertChangesWritable(runtime, changes)
    return yield* writeChanges(runtime, changes)
  })
