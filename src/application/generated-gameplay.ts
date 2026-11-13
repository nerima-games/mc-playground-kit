import { Brand, Cause, Data, Effect, Option, Ref } from 'effect'
import { ClockPort, type ClockService } from '@nerima-games/mc-kernel'
import {
  type CropService,
  INVENTORY_SLOT_COUNT,
  type Inventory,
  InventoryService,
  type InventoryServiceApi,
  PlayerService,
  type PlayerServiceApi,
  type SimFrameState,
  type SimInputPort,
  type TimeService,
  emptyInventory,
  itemStack,
} from '@nerima-games/mc-sim'
import {
  type GameplayPreview,
  makeGameplayPreviewFromWorldRuntime,
} from './gameplay-preview.js'
import {
  type HotbarSlot,
  type LaunchOptions,
  type SpawnKit,
  normalizeLaunchOptions,
} from '../domain/launch-options.js'
import {
  type InputPort,
  type RendererPort,
  SimulationPort,
  type SimulationService,
  type WorldProviderError,
  WorldProviderPort,
} from './preview-ports.js'
import {
  Playground,
  type PlaygroundHandle,
} from './playground-contracts.js'
import { type WorldRuntime, WorldRuntimePort } from './generated-world-provider.js'
import {
  type WorldRuntimePersistenceError,
  type WorldRuntimePersistenceResult,
  persistBlockWorld,
} from './world-runtime-persistence.js'
import type { Dimension } from '@nerima-games/mc-worldgen'
import type { WorldMechanicsState } from '../domain/world-mechanics.js'
import type { WorldRuntimeSnapshotError } from './world-runtime-snapshot.js'

type InvalidSpawnKitErrorFields = {
  readonly message: string
  readonly slotIndex: number
}
// TypeScript's `isolatedDeclarations` cannot infer through `extends Data.TaggedError(...)<...>()`, an instantiation expression; hoisting it into an explicitly typed const (same pattern as mc-kernel's ClockPort in src/domain/clock.ts) gives the extends clause a plain identifier.
const InvalidSpawnKitErrorBase: new (
  args: InvalidSpawnKitErrorFields,
) => Cause.YieldableError & { readonly _tag: 'InvalidSpawnKitError' } & Readonly<InvalidSpawnKitErrorFields> =
  // oxlint-disable-next-line new-cap -- Effect exposes TaggedError as a factory with a constructor-shaped name.
  Data.TaggedError('InvalidSpawnKitError')<InvalidSpawnKitErrorFields>
export class InvalidSpawnKitError extends InvalidSpawnKitErrorBase {}

type GeneratedGameplayWorldUnavailableErrorFields = {
  readonly message: string
  readonly worldId: string
}
// TypeScript's `isolatedDeclarations` cannot infer through `extends Data.TaggedError(...)<...>()`, an instantiation expression; hoisting it into an explicitly typed const (same pattern as mc-kernel's ClockPort in src/domain/clock.ts) gives the extends clause a plain identifier.
const GeneratedGameplayWorldUnavailableErrorBase: new (
  args: GeneratedGameplayWorldUnavailableErrorFields,
) => Cause.YieldableError & {
  readonly _tag: 'GeneratedGameplayWorldUnavailableError'
} & Readonly<GeneratedGameplayWorldUnavailableErrorFields> =
  // oxlint-disable-next-line new-cap -- Effect exposes TaggedError as a factory with a constructor-shaped name.
  Data.TaggedError('GeneratedGameplayWorldUnavailableError')<GeneratedGameplayWorldUnavailableErrorFields>
export class GeneratedGameplayWorldUnavailableError extends GeneratedGameplayWorldUnavailableErrorBase {}

export type GeneratedGameplayError =
  | GeneratedGameplayWorldUnavailableError
  | InvalidSpawnKitError
  | ReturnType<typeof Brand.error>
  | WorldProviderError
  | WorldRuntimePersistenceError
  | WorldRuntimeSnapshotError

export type GeneratedGameplayRequirements =
  | ClockPort
  | CropService
  | InputPort
  | InventoryService
  | PlayerService
  | Playground
  | RendererPort
  | TimeService
  | WorldProviderPort
  | WorldRuntimePort

export type GeneratedGameplayHandle = PlaygroundHandle & {
  readonly input: SimInputPort
  readonly mechanics: Ref.Ref<WorldMechanicsState>
  readonly persistWorld: Effect.Effect<WorldRuntimePersistenceResult, WorldRuntimePersistenceError>
  readonly state: SimFrameState
  readonly syncWorld: GameplayPreview['syncWorld']
}

const messageOf = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if ((typeof cause === 'object' && cause !== null) || typeof cause === 'function') {
    return '[object Object]'
  }
  return String(cause)
}

const invalidSpawnKitError = (slotIndex: number, cause: unknown): InvalidSpawnKitError =>
  new InvalidSpawnKitError({ message: messageOf(cause), slotIndex })

const UNKNOWN_SLOT_INDEX = -1
const NO_LEFTOVER_ITEMS = 0
const FIRST_SLOT_INDEX = 0
const SLOT_INDEX_STEP = 1

const inventorySlotOf = (
  hotbar: ReadonlyArray<HotbarSlot>,
  slotIndex: number,
): Effect.Effect<ReturnType<typeof itemStack>, InvalidSpawnKitError> =>
  Effect.flatMap(
    Effect.try({
      catch: (cause) => invalidSpawnKitError(slotIndex, cause),
      try: () => hotbar[slotIndex],
    }),
    (slot) => Option.match(Option.fromNullable(slot), {
      onNone: () => Effect.fail(
        invalidSpawnKitError(slotIndex, new TypeError('spawn kit hotbar slot is undefined')),
      ),
      onSome: (value) => Effect.try({
        catch: (cause) => invalidSpawnKitError(slotIndex, cause),
        try: () => itemStack(value.item, value.count),
      }),
    }),
  )

const inventorySlotsOfHotbar = (
  hotbar: ReadonlyArray<HotbarSlot>,
): Effect.Effect<Inventory, InvalidSpawnKitError> => Effect.gen(function* inventorySlotsOfHotbarGen() {
  const hotbarLength = yield* Effect.try({
    catch: (cause) => invalidSpawnKitError(UNKNOWN_SLOT_INDEX, cause),
    try: () => hotbar.length,
  })
  if (hotbarLength > INVENTORY_SLOT_COUNT) {
    return yield* Effect.fail(new InvalidSpawnKitError({
      message: `hotbar has ${String(hotbarLength)} slots but inventory has ${String(INVENTORY_SLOT_COUNT)}`,
      slotIndex: INVENTORY_SLOT_COUNT,
    }))
  }

  const slots = [...emptyInventory().slots]
  for (let slotIndex = FIRST_SLOT_INDEX; slotIndex < hotbarLength; slotIndex += SLOT_INDEX_STEP) {
    const hasSlot = yield* Effect.try({
      catch: (cause) => invalidSpawnKitError(slotIndex, cause),
      try: () => slotIndex in hotbar,
    })
    if (hasSlot) {
      slots[slotIndex] = yield* inventorySlotOf(hotbar, slotIndex)
    }
  }
  return { slots }
})

export const inventoryOfSpawnKit = (
  kit: SpawnKit,
): Effect.Effect<Inventory, InvalidSpawnKitError> => Effect.gen(function* inventoryOfSpawnKitGen() {
  const hotbarInspection = yield* Effect.try({
    catch: (cause) => invalidSpawnKitError(UNKNOWN_SLOT_INDEX, cause),
    try: () => {
      const hotbar = kit?.hotbar
      if (Array.isArray(hotbar)) {
        return { _tag: 'Valid' as const, hotbar }
      }
      return { _tag: 'Invalid' as const }
    },
  })
  if (hotbarInspection._tag === 'Invalid') {
    return yield* Effect.fail(
      invalidSpawnKitError(UNKNOWN_SLOT_INDEX, new TypeError('spawn kit hotbar must be an array')),
    )
  }
  return yield* inventorySlotsOfHotbar(hotbarInspection.hotbar)
})

const restoreInventory = (
  inventory: InventoryServiceApi,
  initialInventory: Inventory,
): Effect.Effect<void> =>
  Effect.flatMap(inventory.restore(initialInventory), (leftover) => {
    if (leftover === NO_LEFTOVER_ITEMS) {
      return Effect.void
    }
    return Effect.die(
      new Error(`spawn inventory left ${String(leftover)} items outside the player inventory`),
    )
  })

type GeneratedSimulationOptions = {
  readonly clock: ClockService
  readonly dimension: Dimension
  readonly initialInventory: Inventory
  readonly inventory: InventoryServiceApi
  readonly player: PlayerServiceApi
  readonly syncWorld: GameplayPreview['syncWorld']
  readonly closeWorldSync: GameplayPreview['close']
}

export const makeGeneratedSimulation = ({
  clock,
  closeWorldSync,
  dimension,
  initialInventory,
  inventory,
  player,
  syncWorld,
}: GeneratedSimulationOptions): SimulationService => ({
  cameraPose: player.cameraPose.pipe(Effect.provideService(ClockPort, clock)),
  spawn: (kit) =>
    Effect.gen(function* spawnGeneratedSimulationGen() {
      yield* player.restore(
        {
          feetPosition: kit.feetPosition,
          pitchRadians: kit.pitchRadians,
          yawRadians: kit.yawRadians,
        },
        dimension,
      )
      yield* restoreInventory(inventory, initialInventory)
    }),
  stop: Effect.gen(function* stopGeneratedSimulationGen() {
    yield* player.reset
    yield* inventory.reset
    yield* closeWorldSync
  }),
  tick: () =>
    Effect.matchCauseEffect(syncWorld, {
      onFailure: (cause) => Effect.die(cause),
      onSuccess: () => Effect.void,
    }),
})

const generatedHandleOf = (
  handle: PlaygroundHandle,
  preview: GameplayPreview,
  persistWorld: Effect.Effect<WorldRuntimePersistenceResult, WorldRuntimePersistenceError>,
): GeneratedGameplayHandle => ({
  ...handle,
  input: preview.simulation.input,
  mechanics: preview.mechanics,
  persistWorld,
  state: preview.simulation.state,
  syncWorld: preview.syncWorld,
})

const unavailableWorld = (worldId: string): GeneratedGameplayWorldUnavailableError =>
  new GeneratedGameplayWorldUnavailableError({
    message: 'the generated world provider did not install a runtime',
    worldId,
  })

const runtimeOf = (
  current: Option.Option<WorldRuntime>,
  worldId: string,
): Effect.Effect<WorldRuntime, GeneratedGameplayWorldUnavailableError> =>
  Option.match(current, {
    onNone: () => Effect.fail(unavailableWorld(worldId)),
    onSome: Effect.succeed,
  })

const generatedLaunchServices = Effect.all({
  clock: ClockPort,
  inventory: InventoryService,
  player: PlayerService,
  playground: Playground,
  runtime: WorldRuntimePort,
})

const PERSISTENCE_PERMITS = 1

const makeWorldPersistence = (
  runtime: WorldRuntime,
  preview: GameplayPreview,
): Effect.Effect<
  Effect.Effect<WorldRuntimePersistenceResult, WorldRuntimePersistenceError>
> =>
  Effect.gen(function* makeWorldPersistenceGen() {
    const persistedWorld = yield* Ref.make(preview.initialWorld)
    const persistenceMutex = yield* Effect.makeSemaphore(PERSISTENCE_PERMITS)
    return persistenceMutex.withPermits(PERSISTENCE_PERMITS)(
      Effect.gen(function* persistGeneratedWorldGen() {
        const previous = yield* Ref.get(persistedWorld)
        const current = yield* preview.world
        const result = yield* persistBlockWorld(runtime, previous, current)
        yield* preview.acknowledgeWorld
        yield* Ref.set(persistedWorld, current)
        return result
      }),
    )
  })

export const launchGeneratedPlayground = (
  options?: LaunchOptions | undefined,
): Effect.Effect<GeneratedGameplayHandle, GeneratedGameplayError, GeneratedGameplayRequirements> =>
  Effect.gen(function* launchGeneratedPlaygroundGen() {
    const worldProvider = yield* WorldProviderPort
    const resolved = normalizeLaunchOptions(options)
    const initialInventory = yield* inventoryOfSpawnKit(resolved.spawnKit)

    const launch = Effect.gen(function* launchGeneratedPlaygroundInnerGen() {
      const { clock, inventory, player, playground, runtime } = yield* generatedLaunchServices

      yield* playground.stop
      yield* worldProvider.openFlatWorld(resolved.world)
      const currentRuntime = yield* runtime.current
      const installedRuntime = yield* runtimeOf(
        currentRuntime,
        String(resolved.world.worldId),
      )
      const preview = yield* makeGameplayPreviewFromWorldRuntime(installedRuntime)
      const persistWorld = yield* makeWorldPersistence(installedRuntime, preview)
      const simulation = makeGeneratedSimulation({
        clock,
        closeWorldSync: preview.close,
        dimension: installedRuntime.dimension,
        initialInventory,
        inventory,
        player,
        syncWorld: preview.syncWorld,
      })
      const handle = yield* playground.launch({
        modules: [preview.module, ...resolved.modules],
        spawnKit: resolved.spawnKit,
        world: resolved.world,
      }).pipe(Effect.provideService(SimulationPort, simulation))

      return generatedHandleOf(handle, preview, persistWorld)
    })

    return yield* Effect.matchCauseEffect(launch, {
      onFailure: (cause) =>
        Effect.matchCauseEffect(worldProvider.closeWorld, {
          onFailure: () => Effect.void,
          onSuccess: () => Effect.void,
        }).pipe(Effect.andThen(Effect.failCause(cause))),
      onSuccess: Effect.succeed,
    })
  })
