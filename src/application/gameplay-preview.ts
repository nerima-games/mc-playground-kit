import {
  type BlockSource,
  type BlockWorld,
  blockAt,
} from '../domain/block-world.js'
import { type PreviewModule } from '../domain/launch-options.js'
import { resolveOptionsForBlockSource } from '../domain/physics-world.js'
import { type WorldRuntime } from './generated-world-provider.js'
import { type WorldRuntimeSnapshotError } from './world-runtime-snapshot.js'
import {
  type CropService,
  type PlayerService,
  SIM_STAGE_IDS,
  type SimFrameState,
  type SimInputPort,
  type SimPhysicsConfig,
  type TimeService,
  makeSimStagesForPreviewWithPhysics,
} from '@nerima-games/mc-sim'
import { Effect, Ref } from 'effect'
import {
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
} from '@nerima-games/mc-physics'
import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPositionKey,
  type StageRegistration,
  StageId as makeStageId,
} from '@nerima-games/mc-kernel'
import {
  type WorldMechanicsStageOptions,
  type WorldMechanicsState,
  makeWorldMechanicsStage,
  worldMechanicsStateFromWorld,
} from '../domain/world-mechanics.js'
import {
  type ChunkStoreWorldSync,
  makeChunkStoreWorldSync,
} from './chunk-store-world-sync.js'

/** The stage that advances local fluid and redstone state. */
export const GAMEPLAY_STAGE_IDS = {
  worldMechanics: makeStageId('playground:world-mechanics'),
} as const

export const DEFAULT_GAMEPLAY_WORLD_MECHANICS_STAGE_OPTIONS: WorldMechanicsStageOptions = {
  after: [SIM_STAGE_IDS.physics],
  id: GAMEPLAY_STAGE_IDS.worldMechanics,
}

const DEFAULT_WALK_SPEED = 4.317
const DEFAULT_JUMP_SPEED = 7
const DEFAULT_STEP_HEIGHT = 0.6

export const gameplayPhysicsConfigFor = (source: BlockSource): SimPhysicsConfig => ({
  jumpSpeed: DEFAULT_JUMP_SPEED,
  resolve: resolveOptionsForBlockSource(source, {
    halfHeight: PLAYER_HALF_HEIGHT,
    halfWidth: PLAYER_HALF_WIDTH,
    stepHeight: DEFAULT_STEP_HEIGHT,
  }),
  walkSpeed: DEFAULT_WALK_SPEED,
})

type MergeBlockWorldsContext = {
  readonly key: BlockPositionKey
  readonly baseWorld: BlockWorld
  readonly localWorld: BlockWorld
  readonly remoteWorld: BlockWorld
}

const mergedBlockAt = (context: MergeBlockWorldsContext): BlockId => {
  const baseBlock = context.baseWorld.get(context.key) ?? AIR_BLOCK_ID
  const localBlock = context.localWorld.get(context.key) ?? AIR_BLOCK_ID
  let selected = context.remoteWorld.get(context.key) ?? AIR_BLOCK_ID
  if (localBlock !== baseBlock) {
    selected = localBlock
  }
  return selected
}

const mergeBlockWorlds = (
  baseWorld: BlockWorld,
  localWorld: BlockWorld,
  remoteWorld: BlockWorld,
): BlockWorld => {
  const keys = new Set<BlockPositionKey>([
    ...baseWorld.keys(),
    ...localWorld.keys(),
    ...remoteWorld.keys(),
  ])
  const merged = new Map<BlockPositionKey, BlockId>()

  for (const key of keys) {
    const selected = mergedBlockAt({ baseWorld, key, localWorld, remoteWorld })
    if (selected !== AIR_BLOCK_ID) {
      merged.set(key, selected)
    }
  }

  return merged
}

export type GameplayPreview = {
  readonly initialWorld: BlockWorld
  readonly module: PreviewModule
  readonly mechanics: Ref.Ref<WorldMechanicsState>
  readonly syncWorld: Effect.Effect<void, WorldRuntimeSnapshotError>
  readonly acknowledgeWorld: Effect.Effect<void>
  readonly close: Effect.Effect<void>
  readonly world: Effect.Effect<BlockWorld>
  readonly simulation: {
    readonly input: SimInputPort
    readonly state: SimFrameState
    readonly stages: ReadonlyArray<StageRegistration>
  }
}

export type GameplayPreviewOptions = WorldMechanicsStageOptions

type WorldSyncContext = {
  readonly worldSync: ChunkStoreWorldSync | undefined
  readonly runtimeBase: Ref.Ref<BlockWorld>
  readonly mechanics: Ref.Ref<WorldMechanicsState>
  readonly setActiveWorld: (world: BlockWorld) => void
}

const syncWorldEffect = (
  context: WorldSyncContext,
): Effect.Effect<void, WorldRuntimeSnapshotError> => {
  const { mechanics, runtimeBase, setActiveWorld, worldSync } = context
  if (!worldSync) {
    return Effect.void
  }

  return Effect.gen(function* syncWorldGen() {
    const changed = yield* worldSync.refresh
    if (!changed) {
      return
    }

    const remoteWorld = yield* worldSync.current
    const baseWorld = yield* Ref.get(runtimeBase)
    const currentState = yield* Ref.get(mechanics)
    const mergedWorld = mergeBlockWorlds(baseWorld, currentState.world, remoteWorld)

    setActiveWorld(mergedWorld)
    yield* Ref.set(runtimeBase, remoteWorld)
    yield* Ref.set(mechanics, {
      ...currentState,
      world: mergedWorld,
    })
  })
}

const acknowledgeWorldEffect = (
  worldSync: ChunkStoreWorldSync | undefined,
  runtimeBase: Ref.Ref<BlockWorld>,
  mechanics: Ref.Ref<WorldMechanicsState>,
): Effect.Effect<void> => {
  if (!worldSync) {
    return Effect.void
  }

  return Effect.flatMap(Ref.get(mechanics), (state) => Ref.set(runtimeBase, state.world))
}

const closeWorldEffect = (worldSync: ChunkStoreWorldSync | undefined): Effect.Effect<void> => {
  if (!worldSync) {
    return Effect.void
  }

  return worldSync.close
}

/**
 * Build the frame-stage boundary for a playable preview.
 *
 * The simulation stage and physics solver are supplied by mc-sim and
 * mc-physics. This package only contributes the world-backed collision source
 * and the world-mechanics stage that owns its local fluid and redstone state.
 * Service layers stay with the caller so one service instance is not created
 * accidentally for registration and for frame execution.
 */
export const makeGameplayPreview = (
  world: BlockWorld,
  options: GameplayPreviewOptions = DEFAULT_GAMEPLAY_WORLD_MECHANICS_STAGE_OPTIONS,
  worldSync?: ChunkStoreWorldSync,
): Effect.Effect<GameplayPreview, never, TimeService | PlayerService | CropService> =>
  Effect.gen(function* makeGameplayPreviewGen() {
    const mechanics = yield* Ref.make(worldMechanicsStateFromWorld(world))
    const runtimeBase = yield* Ref.make(world)
    let activeWorld = world
    const simulation = yield* makeSimStagesForPreviewWithPhysics(
      gameplayPhysicsConfigFor((position) => blockAt(activeWorld, position)),
    )
    const mechanicsStage = makeWorldMechanicsStage(mechanics, {
      ...options,
      onStateChange: (next) => {
        activeWorld = next.world
        options.onStateChange?.(next)
      },
    })
    const stages = [...simulation.stages, mechanicsStage]
    const syncWorld = syncWorldEffect({
      mechanics,
      runtimeBase,
      setActiveWorld: (nextWorld) => {
        activeWorld = nextWorld
      },
      worldSync,
    })
    const acknowledgeWorld = acknowledgeWorldEffect(worldSync, runtimeBase, mechanics)
    const close = closeWorldEffect(worldSync)

    return {
      acknowledgeWorld,
      close,
      initialWorld: world,
      mechanics,
      module: {
        frameStages: Effect.succeed(stages),
      },
      simulation: {
        input: simulation.input,
        stages,
        state: simulation.state,
      },
      syncWorld,
      world: Ref.get(mechanics).pipe(Effect.map((state) => state.world)),
    }
  })

export const makeGameplayPreviewFromWorldRuntime = (
  runtime: WorldRuntime,
  options: GameplayPreviewOptions = DEFAULT_GAMEPLAY_WORLD_MECHANICS_STAGE_OPTIONS,
): Effect.Effect<GameplayPreview, WorldRuntimeSnapshotError, TimeService | PlayerService | CropService> =>
  Effect.flatMap(makeChunkStoreWorldSync(runtime.chunks), (worldSync) =>
    Effect.flatMap(worldSync.current, (world) =>
      makeGameplayPreview(world, options, worldSync),
    ),
  )
