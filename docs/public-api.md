# Public API

The package root exports the local domain and application modules listed below,
and directly re-exports the portable domain, service, and stage APIs from
`@nerima-games/mc-kernel` and `@nerima-games/mc-sim`. It exposes the portable
`@nerima-games/mc-physics`, `@nerima-games/mc-save`, and
`@nerima-games/mc-worldgen` surfaces through the `physics`, `save`, and
`worldgen` namespaces. These upstream packages remain the canonical owners of
their brands, registries, mechanics, and persistence formats; local modules add
only boundaries that need this package's sparse world or lifecycle ownership.

## Package distribution

The supported runtime import is the generated ESM entry point in `dist/index.js`;
its declarations are emitted as `dist/index.d.ts`. The build bundles the
source-only runtime exports from the mc-kernel, mc-sim, mc-physics, mc-save, and
mc-worldgen packages, while keeping `effect` as a normal external dependency.
Consumers therefore import the package root and do not depend on
checkout-relative TypeScript files.

`pnpm test:package` imports the built entry point under Node 24 and checks the
required runtime exports. It complements TypeScript declaration checking: a
successful typecheck alone does not prove that a published ESM entry point can
be loaded by Node.

## Simulation stages and composition

The root directly re-exports mc-sim's stage factories: `makeSimStages`,
`makeSimStagesWithPhysics`, `makeSimStagesForPreview`,
`makeSimStagesForPreviewWithPhysics`, and
`makeControllableSimStagesWithPhysics`. These factories remain upstream-owned;
the kit does not wrap their `StageRegistration` values or duplicate the physics
stage.

The factories acquire mc-sim's `TimeService`, `PlayerService`, and `CropService`
when their stage effects are built. The application composition root supplies
those services, chooses the physics configuration when needed, merges the
corresponding layers, and resolves one total order for all modules. The local
`Playground` accepts already-built `frameStages` in `LaunchOptions.modules` and
runs them in declaration order while reporting violated `after` metadata; it
does not construct `GameModule.layers`, sort stages, or automatically tick
physics, fluids, or redstone.

Use `makeSimStagesForPreview` when the host needs the upstream `{ state, stages }`
pair, and use the physics variants when it also owns the upstream
`SimInputPort`. The package root exposes both names so callers can choose the
upstream contract directly.

## Generated worlds

`worldgen` is a direct namespace export of `@nerima-games/mc-worldgen`. Use it
for deterministic terrain, biome and structure generation, generated-dimension
and `ChunkStore` lifecycle, persistence ports, and propagated chunk lighting.
This package does not rename or wrap those APIs:

~~~ts
import { worldgen } from '@nerima-games/mc-playground-kit'

const generateChunk = worldgen.generateChunk
const ChunkStore = worldgen.ChunkStore
const computeChunkLights = worldgen.computeChunkLights
~~~

The local `ChunkWorld` below remains a finite immutable sparse-storage boundary
for tests and small host-owned slices. The preview `WorldProvider` port remains
an application lifecycle contract; a shipped runtime can compose it with
`worldgen.ChunkStore` directly.

## Physics and persistence

`physics` is a direct namespace export of `@nerima-games/mc-physics`. Use its
voxel raycast, body integration, world resolution, and projectile helpers when
the host owns a physics simulation. The local collision and targeting helpers
adapt a sparse `BlockSource` to the upstream callback contracts; they do not
replace or wrap the upstream solver.

`save` is a direct namespace export of `@nerima-games/mc-save`. Use its format,
envelope, encoding, storage, and durable-save APIs when the host owns
persistence. Playground launch and teardown do not implicitly load or write
authoritative state.

## Domain values

normalizeLaunchOptions is pure and total:

~~~ts
import { normalizeLaunchOptions } from '@nerima-games/mc-playground-kit'

const options = normalizeLaunchOptions({
  world: { seed: 42 },
})
~~~

options.world, options.spawnKit, and options.modules are always present in the
returned ResolvedLaunchOptions. Nested supplied fields are merged
field-by-field; undefined means “not supplied”.

HotbarSlot.item is the kernel-owned ItemType. Use the kernel constructor or
registry when creating branded values:

~~~ts
import { ItemType, MonotonicTimeSecs } from '@nerima-games/mc-kernel'

const item = ItemType('torch')
const timestamp = MonotonicTimeSecs(0.016)
~~~

The package root re-exports the kernel public surface directly. Kernel remains
the single owner of these branded values, so this package does not introduce a
second constructor or registry.

## Gameplay services

GameplayServicesLayer is the package's direct baseline composition of reusable
mc-sim state services. It provides the simModule layers for inventory, player,
time, and crops, together with equipment, vitals, weather, settings,
statistics, and vehicles.

It is intended to be merged with application-owned world, renderer, entity,
and frame layers:

~~~ts
import { Effect } from 'effect'
import { InventoryService } from '@nerima-games/mc-sim'
import { GameplayServicesLayer } from '@nerima-games/mc-playground-kit'

const readInventory = Effect.gen(function* () {
  const inventory = yield* InventoryService
  return yield* inventory.snapshot
}).pipe(Effect.provide(GameplayServicesLayer))
~~~

The layer does not create a game loop or resolve host-specific entity behavior;
the composition root supplies those capabilities.

When a caller also wants mc-sim's generic entity roster lifecycle, use
`gameplayServicesLayerWithEntities<S>(initial?, repairBehaviour?)`. The type
parameter `S` remains caller-owned, so the helper provides spawn, snapshot,
restore, and reset without inventing entity behavior or an AI adapter in this
package.

The supplied InventoryService also exposes mc-sim's published crafting and
container transitions, including craft, previewCraft, createContainer, and
transferContainerItem. This package composes those operations without copying
their recipes or storage rules.

Anvil operations remain kernel-owned and are re-exported directly by the
package root. Use `planAnvil`, `applyAnvil`, and the snapshot functions for repair,
enchantment, naming, cost, and persistence transitions. `AnvilState` carries
item payloads, enchantments, custom names, repair costs, and experience levels;
`PlayerStorage` cannot represent that state without loss, so this package does
not add an anvil adapter or a second anvil rule implementation.

## Block interaction

makeBlockInteractionState creates an immutable sparse block world and an
mc-sim PlayerStorage snapshot. breakBlock and placeBlock are pure state
transitions. A break request may identify the held tool with mc-sim's
StorageLocation; successful breaks then delegate one durability point to
mc-sim's damageAt operation and expose its result as toolDamage:

- breakBlock reads the kernel block registry, applies the kernel drop rule, and
  adds the resulting item through mc-sim inventory logic. When the kernel
  resolves a non-silk harvest drop, result.experience exposes its xpOnBreak
  value. This is a value-only handoff: vitals remain owned by mc-sim, so a host
  can pass the value to VitalsService.addExperience. Air and unknown blocks
  leave the state unchanged; a full inventory reports leftover items. The
  input PlayerStorage remains unchanged, while the result preserves its
  equipment and updates inventory durability when toolLocation is supplied.
  After a successful break, the direct vertical chain above the cleared cell
  is checked with mc-kernel's support rules. Newly unsupported known blocks are
  removed in order, and result.detached reports each block's transition. A
  `detached` transition includes its kernel drop if one exists and that drop's
  inventory leftover; a `falling` transition has no immediate inventory drop
  and a zero leftover so the caller can create its falling entity.
- placeBlock validates the selected mc-kernel ItemType, resolves its placeable
  block, checks the kernel replaceable capability, and consumes one inventory
  item. Occupied, empty, non-placeable, and invalid-slot requests leave the
  state unchanged.

The result includes the outcome, the affected block, the experience handoff,
any removed vertical blocks and their transitions, and the next state so a host can persist or
compose the transition without a local registry adapter. The lower-level
`removeUnsupportedBlocksAbove` function exposes the same pure support scan for
world transitions that do not include a player inventory.

## Block collision

`blockCollisionFor` projects a known kernel `BlockId` and position into one
collision hull without reading a world. `blockCollisionAt` resolves one block
from a `BlockSource`, either a sparse `BlockWorld` or
`(position: BlockPosition) => BlockId` `BlockReader`.
`blockReaderOf` creates that view for a `BlockWorld`, and
`blockReaderOfChunkWorld` creates it for `ChunkWorld`. `blockCollisionsIn`
remains a `BlockWorld` query because it enumerates stored cells. Both functions
are read-only and preserve the sparse world. The hull projection uses the
`collisionShape` values currently published by mc-kernel: full blocks, lower
slabs, inset cactus blocks, pressure plates, and non-colliding shapes. Unknown
ids and air are ignored. A query that only
touches a hull boundary does not count as an intersection because the kernel's
`aabbIntersects` predicate is strict.

This API provides collision geometry only. Movement resolution is owned by
mc-sim's physics stages; this kit only adapts its sparse block source to the
upstream callbacks. Block-state-dependent variants remain owned by the relevant
world or gameplay package.

`blockContactAt`, `blockContactsIn`, and `blockContactDamageIn` expose the
kernel-defined `contactDamage` property for cactus and fluid-like hazards. They
return immutable contact values or an upstream mc-sim `Damage` value; applying
damage and deciding the tick cadence remain caller-owned. Contact hulls use the
projected collision hull when one exists and a full block volume otherwise.
Unknown ids, air, and blocks without contact damage are ignored, and face-only
contact follows the same strict AABB boundary rule.

`blockFluidAt` and `blockFluidsIn` expose the kernel-defined `fluid` property as
immutable full-cell occupancy records. The point query accepts a `BlockSource`,
and the range query enumerates occupied cells from a sparse `BlockWorld` or its
read-only block reader. Water and lava are returned with their kernel block id,
position, and full-cell AABB; air, unknown ids, and empty ranges are ignored.
The strict AABB boundary rule means face-only overlap is not reported. For
state-aware geometry, `fluidVolumeAt` and `fluidVolumesIn` project immutable
fluid levels and falling state into partial or full-cell AABBs.

`fluidStateFromWorld` creates source-level water and lava cells from a sparse
`BlockWorld` and schedules them for a transition. `updateFluids` applies one
immutable local update over the scheduled cells: it handles downward and
horizontal flow, replacement through mc-kernel capabilities, water/lava mixing,
and immutable scheduling of newly reached cells. The caller owns the state
between ticks and must reschedule externally changed cells.
`makeWorldMechanicsStage` executes that transition at a fixed interval, and
`makeWorldMechanicsPreview` exposes the stage and its `Ref` state through a
`PreviewModule` for explicit launch composition. The caller still owns
external rescheduling, block-state variants, chunk-neighbour scheduling,
fluid collision integration, world/chunk composition, and full official
parity.

`updateRedstone` computes one immutable local transition for redstone blocks,
levers, buttons, pressure plates, torches, wires, repeaters, comparators,
observers, and lamps. `RedstoneState` carries switch inputs, wire powers,
device state, repeater timers, and observer snapshots; the result includes
changed wire powers and lamp block ids. The core uses the kernel block registry
and propagates power through the enumerated sparse layout, while
orientation-specific block states, exact official tick semantics, and
world/chunk composition remain caller-owned. The same local transition can be
run at a fixed interval through `makeWorldMechanicsStage`;
`makeWorldMechanicsPreview` packages that stage as a `PreviewModule` without
installing it into `launchPlayground` implicitly.

## World mechanics stage

`WORLD_TICK_INTERVAL_SECS` is the default fixed interval for the local fluid
and redstone transition stage. `makeWorldMechanicsStage` accepts a mutable
`Ref` of `WorldMechanicsState`, accumulates frame delta time, and advances one
or more local ticks when the configured interval elapses. A custom positive
interval and stage ordering metadata can be supplied.

`makeWorldMechanicsPreview` creates the state `Ref` from a `BlockWorld` and
returns `{ module, state }`. Pass `module` in `LaunchOptions.modules` when the
host wants this local stage in a preview; the playground lifecycle does not
install it automatically. Chunk synchronization, block-state variants,
official scheduled-tick semantics, and full-world mechanics remain host
responsibilities.

`blockLightSourceAt` and `blockLightSourcesIn` expose the kernel-defined
`lightEmission` property as immutable full-cell source records. They return
positive emitted light levels with their kernel block id, position, and
full-cell AABB; air, unknown ids, and non-emitting blocks are ignored. The
range query accepts a sparse `BlockWorld` or its read-only block reader and
uses strict AABB intersection.

`propagateBlockLight` seeds those kernel-defined emission levels and propagates
them through known light-transmitting blocks with six-neighbour attenuation.
`blockLightAt` reads the resulting immutable sparse `BlockLightField`, and
`boundsExpandedForBlockLight` describes the source-search margin used by the
bounded propagation query. This local field does not model sky light, chunk
light grids, scheduled updates, or a full-world lighting tick; use
`worldgen.computeChunkLights` and `worldgen.updateChunkLights` for the upstream
generated-chunk light behavior.

## Chunk world

ChunkWorld provides an immutable-transition boundary for a finite-height,
sparse chunk store. `emptyChunkWorld` accepts heights from 1 through 65,535 and
an optional safe-integer `minY`; the default vertical origin is zero. Absent
chunks and coordinates outside `[minY, minY + height)` read as air. Block
writes validate the mc-kernel registry, preserve prior world values, and remove
chunks that become entirely air:

~~~ts
const world = emptyChunkWorld(384, -64)
const result = writeBlockAtChunkWorld(
  world,
  blockPosition(-1, 64, -17),
  blockIdOf('dirt'),
)
~~~

`storeChunkInChunkWorld` accepts kernel-validated chunks at the configured
height, while `encodeChunkAt` and `loadEncodedChunkIntoWorld` use mc-kernel's
versioned chunk codec. The codec stores chunk payloads but not the world's
vertical origin, so a loader must recreate the same `minY` for the dimension.
Height mismatches, unknown block ids, out-of-bounds writes, and malformed bytes
are returned as tagged outcomes. Chunk generation, streaming, persistence, and
multi-dimension ownership remain caller-owned by this boundary; the portable
implementations are available through `worldgen`.

For point queries, `blockReaderOfChunkWorld(world)` returns a read-only
`BlockReader` without copying or converting chunk data. Supply it to
`targetBlock`, `raycastArrowInWorld`, or `blockCollisionAt`; range queries such
as `blockCollisionsIn` intentionally remain sparse-map operations.

## Block targeting

targetBlock resolves the first known, non-air block in a `BlockSource` (a sparse
`BlockWorld` or `BlockReader`) from an authoritative mc-sim PlayerPose:

~~~ts
const target = targetBlock(world, {
  playerPose,
  maxDistance: 6,
})
~~~

The DDA raycast and camera geometry remain owned by mc-sim and mc-physics. This
package supplies only the world predicate backed by mc-kernel, either from the
sparse map or a direct point reader, and returns an Effect Option<BlockTarget>
containing the hit position, the adjacent placement position, and the hit
distance. Resolving a target never mutates the world; callers can pass the
returned positions to their break or place transition.

## Projectile interaction

raycastArrowInWorld delegates arrow voxel traversal to mc-sim and evaluates
each coordinate against the known, non-air blocks in a `BlockSource`:

~~~ts
const impact = raycastArrowInWorld(world, {
  from: { x: 0.5, y: 1.5, z: 0.5 },
  to: { x: 0.5, y: 1.5, z: -8.5 },
})
~~~

The result is an Effect Option<ArrowBlockImpact>. The world remains caller-owned
and is not mutated. Projectile motion, entity collision, damage, and the
authoritative projectile state remain outside this block-collision boundary.

## Explosion interaction

planBlockWorldExplosion and explodeBlockWorld delegate deterministic explosion
planning to mc-sim. The caller supplies a BlockExplosionProfile because
mc-kernel does not define blast resistance or destructibility:

~~~ts
const profile = (blockId: BlockId): ExplosionBlock | undefined =>
  blockId === AIR_BLOCK_ID
    ? { resistance: 0, destructible: false }
    : explosionData.get(blockId)

const result = explodeBlockWorld({
  ...explosionRequest,
  profile,
  world,
})
~~~

The result contains the upstream ExplosionPlan and a new sparse BlockWorld with
only destroyed cells removed. The input world is never mutated. Use
planBlockWorldExplosion when entity effects need to be committed by the host in
the same transaction as another world or entity store. The corresponding
planBlockWorldPrimedTnt and advancePrimedTntInBlockWorld functions advance a
primed TNT fuse and apply its planned blast exactly once; a non-detonating tick
returns the original world reference.

## Furnace interaction

makeFurnaceInteractionState composes an mc-sim Inventory with an upstream
FurnaceState. transferItemsToFurnace, advanceFurnace, and collectFurnaceOutput
delegate item validation, recipes, fuel rules, smelting, and output capacity to
mc-sim while returning one immutable FurnaceInteractionState transition.

advanceFurnace advances the furnace only; the inventory remains caller-owned
and the result reports fuelConsumed and smelted. Transfer and collection
operations return the upstream tagged result, so rejected transfers and full
inventories do not discard state.

## Crop interaction

makeCropInteractionState composes an mc-sim CropSnapshot and Inventory with an
immutable sparse BlockWorld. plantCrop, advanceCrops,
advanceCropWithBoneMeal, and harvestCrop expose the crop world boundary:

- mc-sim remains the source of crop definitions, supported dimensions and soil,
  growth timing, bone-meal advancement, and mature yields;
- this package checks the active sparse world for occupancy, support, and the
  expected crop block, then consumes seeds or bone meal and updates the crop
  snapshot, inventory, and crop block immutably;
- harvestCrop returns the upstream drops and any inventory leftovers, while
  removing the crop block and crop state only after a mature crop is found.

BlockWorld is the currently active dimension slice. CropLocation.dimension is
used when applying mc-sim's planting rule. ChunkWorld can provide a finite,
sparse chunk-backed dimension slice, while generation, streaming, persistence,
and multi-dimension world ownership remain outside this package. advanceCrops
also discards crop snapshot entries whose world block was removed or replaced,
preventing stale crop state from advancing.

## Wither interaction

makeWitherInteractionState composes an upstream WitherState with an immutable
sparse BlockWorld. summonWitherInBlockWorld delegates the seven-cell structure
match to mc-sim, consumes only the matched soul-sand, soul-soil, and skull cells,
and creates the upstream charging state. Invalid structures and repeated
summons return the original state.

advanceWitherInBlockWorld and damageWitherInBlockWorld delegate movement,
charging, armour, regeneration, damage, and death transitions to mc-sim. The
advance result exposes the upstream spawn-explosion descriptor, while the
damage result preserves the upstream death payload. Wither skull projectile
planning and serialization remain direct mc-sim operations; this package owns
only the sparse-world summon boundary and immutable block consumption.

## Playground

The main entry point is:

~~~ts
export const launchPlayground: (
  options?: LaunchOptions,
) => Effect.Effect<
  PlaygroundHandle,
  never,
  ClockPort | PlaygroundPorts
>
~~~

PlaygroundLayer provides the Playground service. PlaygroundApi.launch performs
the same operation through the service and is safe to call while another
generation is running.

PlaygroundHandle exposes:

| Member | Meaning |
| --- | --- |
| options | Total options used by this generation. |
| timings | Boot phase timings in execution order. |
| budget | Result of classifyBootTimings. |
| stageOrderWarnings | Declared after constraints violated by declaration order. |
| submitFrame(at) | Submit a monotonic timestamp to the generation. |
| framesRendered | Processed frames, including the boot frame while running. |
| framesDropped | Timestamps rejected by the bounded mc-sim queue. |
| secondsLostToClamp | Time removed by the loop's maximum-delta clamp. |
| cameraPose | Read-only pose published by the simulation port. |
| isRunning | Whether the generation still accepts work. |
| stop | Idempotent teardown. |

The first accepted timestamp uses FIRST_FRAME_DELTA_SECS, as defined by
mc-sim. A stopped handle accepts no further work.

## Injected ports

launchPlayground requires:

~~~ts
export type PlaygroundPorts =
  | WorldProviderPort
  | SimulationPort
  | RendererPort
  | InputPort
~~~

The services are deliberately lifecycle-oriented:

- WorldProviderService.openFlatWorld / closeWorld
- SimulationService.spawn / tick / cameraPose / stop
- RendererService.attach / renderFrame / detach
- PreviewInputService.attach / detach

These are composition boundaries, not implementations of the upstream
packages. A caller can provide an Effect Layer backed by
mc-worldgen.ChunkStore, mc-sim services, mc-render, or test doubles.

## Boot phases

BOOT_PHASE_ORDER, BOOT_PHASE_BUDGET_MILLIS, classifyBootTimings, and
describeBootVerdict are pure domain APIs. DurationMillis is a local measurement
brand because the kernel's monotonic clock brands represent a different unit
and meaning.

## Browser preview

makeBrowserPreview requires a container and a runtime factory:

~~~ts
const api = yield* makeBrowserPreview({
  container,
  startRuntime: (surface) =>
    Effect.succeed({
      frame: (delta) => renderAndStep(surface, delta),
      stop: Effect.void,
    }),
})
const handle = yield* api.start
yield* handle.stop
~~~

The factory may return a runtime without frame; in that case the kit manages
the surface lifecycle but does not schedule RAF work. A supplied canvas is
borrowed. A canvas created by the kit is removed during teardown.

start is idempotent while a generation is active. restart stops the old
generation before starting a new one. An aborted start rolls back an owned
canvas and registered cleanup callbacks.

## Compatibility

There are no legacy aliases for the old delta-based frame API or local item
identifiers. Callers must submit MonotonicTimeSecs values and use mc-kernel's
ItemType.
