# Architecture

## Boundary

mc-playground-kit is the application-facing lifecycle layer. It turns a
resolved launch description and injected services into one independently
stoppable preview generation.

~~~
LaunchOptions
    │ normalizeLaunchOptions
    ▼
ResolvedLaunchOptions ── boot timing/budget ──┐
                                             │
ports + frame stages ── mc-sim GameLoop ──────┤
                                             ▼
                         PlaygroundHandle
~~~

The kit never constructs a renderer, reads browser input directly, or decides
how a world is generated. Those implementations are supplied by the caller.

## Source layout

~~~
src/
  domain/
    launch-options.ts   pure defaults, branded kernel values, stage metadata
    boot-phase.ts       pure phase timing and budget decisions
    block-world.ts       immutable sparse block-world data and point-read source
    chunk-world.ts       finite-height sparse chunk storage, point reader, and kernel codec boundary
    flat-chunk.ts        deterministic dimension-aware flat terrain materialization
    block-interaction-state.ts world and PlayerStorage transition state
    block-breaking.ts    block break rules and inventory drops
    block-support-interaction.ts kernel-backed support and falling transitions
    block-collision.ts   kernel-backed block collision hull projections and queries
    block-contact.ts     kernel-backed contact-damage queries and mc-sim Damage values
    block-fluid.ts       kernel-backed fluid occupancy and volume queries
    fluid-data.ts        fluid block ids and level vocabulary
    fluid-state.ts       immutable fluid cells and scheduled positions
    fluid-update.ts      bounded fluid flow and mixing transitions
    block-light.ts       kernel-backed emitted-light sources and bounded propagation
    redstone-data.ts     redstone block ids and power vocabulary
    redstone-state.ts    immutable inputs and wire powers
    redstone-update.ts   bounded source, wire, device, and lamp transitions
    world-mechanics.ts   fixed-tick fluid and redstone stage
    world-mechanics-preview.ts PreviewModule composition for that stage
    block-placement.ts   block placement rules and inventory consumption
    block-interaction.ts public barrel for block interaction modules
    block-targeting.ts  player-pose raycast against a block source
    projectile-interaction.ts arrow block raycast against a block source delegated to mc-sim
    explosion-interaction.ts explosion/TNT planning and sparse-world application
    furnace-interaction.ts inventory/furnace transitions delegated to mc-sim
    crop-interaction.ts  crop/world/inventory transitions delegated to mc-sim
    nether-portal-interaction.ts frame detection and interior activation via mc-worldgen
    end-portal-interaction.ts frame-state matching and interior activation via mc-worldgen
    wither-interaction.ts Wither summon/world transitions delegated to mc-sim
  application/
    preview-ports.ts    narrow lifecycle contracts and Effect Tags
    gameplay-services.ts direct mc-sim service-layer composition and typed
                        generic entity-roster composition
    playground.ts       public lifecycle barrel
    playground-contracts.ts public lifecycle types and Effect Tag
    playground-boot.ts  timed boot sequence and frame generation setup
    playground-service.ts generation ownership and teardown orchestration
    browser-preview.ts  DOM/canvas/RAF lifecycle boundary
    generated-world-provider.ts bounded mc-worldgen generation and ChunkStore runtime
    world-runtime-snapshot.ts raw ChunkStore to sparse BlockWorld snapshot boundary
    world-runtime-persistence.ts sparse diff and raw ChunkStore write boundary
    gameplay-preview.ts mc-sim physics plus local mechanics composition
    generated-gameplay.ts generated runtime and playground composition
  index.ts              explicit package barrel
~~~

Domain modules do not depend on browser APIs or mutable service state.
Application modules own Effects, references, interruption, and cleanup.

## Launch lifecycle

1. launch stops the current generation, if any.
2. Options are normalized into a total ResolvedLaunchOptions value.
3. The world is opened and the simulation receives the spawn kit.
4. Renderer and input ports are attached.
5. Caller-provided frame stages are flattened in declaration order.
6. One boot frame runs and boot timings are classified.
7. A fresh mc-sim game loop accepts monotonic timestamps.
8. A handle exposes read-only observations and idempotent stop operations.

Stopping follows the reverse dependency direction:

1. stop the mc-sim loop and wait for the active frame;
2. detach input;
3. detach the renderer;
4. stop simulation;
5. close the world;
6. clear the current generation.

The loop belongs to the generation. A timestamp submitted through an old handle
cannot advance a later launch.

## Frame lifecycle

The caller submits a MonotonicTimeSecs value. mc-sim owns first-frame behavior,
delta conversion, maximum-delta clamping, bounded queueing, and counters. The
kit invokes the injected services and frame stages with the resulting
DeltaTimeSecs.

This makes timing policy a dependency-owned invariant instead of a second local
frame pump.

## Gameplay state boundary

GameplayServicesLayer is a deliberately small composition boundary, not a
second simulation implementation. It exposes the standard mc-sim services
that can be constructed without a host-specific frame handler. A caller can
merge it with world, renderer, and game-loop layers while retaining mc-sim as
the owner of those service transitions. The optional
gameplayServicesLayerWithEntities<S> factory also merges mc-sim's generic
EntityManagerLayer. The host supplies S, entity behavior, and entity-specific
mechanics; this package does not define an entity adapter or AI.

BlockWorld is a sparse immutable map keyed by mc-kernel block-position keys.
block-interaction-state.ts combines that data with the mc-sim PlayerStorage value;
block-breaking.ts and block-placement.ts contain the pure break/place
transitions. The public block-interaction.ts barrel preserves one import
surface while the implementation delegates block identity, drops, placeable
items, replaceability, and xpOnBreak to mc-kernel. Break transitions delegate
inventory replacement and optional tool durability through mc-sim's
PlayerStorage operations; placement preserves the same storage value while
consuming an item. It implements the break/place vertical slice without
introducing a local block or item registry. The experience value is returned
without mutating vitals; VitalsService remains owned by mc-sim.

block-support-interaction.ts applies mc-kernel's support-sensitive predicate and
falling capabilities to the direct vertical chain above a changed block. A
successful break clears the broken cell first, removes each newly unsupported
known block in order, and returns either its kernel-resolved item drop or a
falling transition. Falling transitions deliberately stop at this world
boundary; the caller owns falling-entity simulation. Horizontal attachments and
block-specific scheduled behavior remain outside this boundary.

block-collision.ts projects the collisionShape property published by
mc-kernel into immutable AABB values for a sparse BlockWorld. Its single-cell
lookup accepts BlockSource, so a ChunkWorld can be exposed through its
read-only blockReaderOfChunkWorld view; its range query remains over stored
BlockWorld cells because enumeration is a separate capability. Both queries
use mc-kernel's strict AABB intersection semantics. The projection covers the
collision shapes currently published by the kernel; movement resolution,
block-state-dependent geometry, and fluid-state collision remain outside this
data boundary. `resolveOptionsForBlockSource` maps the local kernel-backed
BlockSource into the callbacks consumed by mc-sim's upstream physics stages;
this package does not copy the movement solver.

block-fluid.ts projects the kernel's fluid property into immutable full-cell
records for a sparse BlockWorld or BlockSource. It answers whether a cell is
water or lava and enumerates occupied fluid cells through strict AABB queries.
`fluidVolumeAt` and `fluidVolumesIn` additionally project the local fluid state
into partial or full-cell AABBs. fluid-data.ts, fluid-state.ts, and
fluid-update.ts provide a separate pure local transition core for source-level
fluid cells, six-neighbour flow, water/lava mixing, and scheduled positions.
world-mechanics.ts supplies a fixed-tick stage for that core, and
world-mechanics-preview.ts exposes the stage through the existing PreviewModule
contract. The core still leaves state persistence, chunk boundaries,
block-state variants, and integration with a movement solver to the caller.

block-light.ts projects the kernel's lightEmission property into immutable
full-cell source records for a sparse BlockWorld or BlockSource. It enumerates
emitted light levels and provides bounded six-neighbour propagation through
known transparent cells. Sky light, full chunk light grids, and scheduled
world-wide lighting updates remain owned by a world or lighting simulation
package. The package root exposes mc-worldgen's propagated chunk light grid
directly as the `worldgen` namespace, without making the local sparse query
boundary own a second generated-world implementation.

redstone-data.ts, redstone-state.ts, and redstone-update.ts provide a bounded
pure transition core for redstone blocks, levers, buttons, pressure plates,
torches, wires, repeaters, comparators, observers, and lamps. It propagates
power through the local sparse layout and returns immutable world/state changes;
device state includes repeater timers and observer snapshots.
world-mechanics.ts provides a fixed-tick stage and
world-mechanics-preview.ts returns a PreviewModule for explicit composition.
Orientation-specific block states, chunk/world synchronization, and exact
official tick semantics remain caller-owned.

ChunkWorld is the finite-height sparse chunk boundary. It owns immutable chunk
map transitions, the configured vertical origin and y-boundary checks,
empty-chunk pruning, and loading decoded chunks; mc-kernel owns chunk coordinate
conversion, registry validation, and versioned binary encoding. ChunkWorld is a
storage/value boundary. blockReaderOfChunkWorld exposes a read-only point-query
view for target/projectile/single-cell collision APIs; it intentionally does not
provide range enumeration. Generation, streaming, multi-dimension ownership,
and persistence policy remain outside it. `generated-world-provider.ts`
composes mc-worldgen's `generatedDimensionChunkSource` with either its in-memory
or `StoragePort`-backed `ChunkStore`, validates the launch world specification,
preloads a bounded radius, and exposes the raw store through `WorldRuntimePort`.
Flat generation applies the dimension-aware `flatChunkOf` transformation to
each generated chunk; natural generation keeps the terrain from mc-worldgen
and forwards its terrain options. Unbounded streaming and authoritative
full-world ownership remain application policy. The kernel chunk codec does not
carry the world's vertical origin, so the dimension configuration must be
restored by the caller when loading a chunk.

block-targeting.ts delegates player-pose geometry and voxel DDA traversal to
mc-sim and mc-physics. Its only local decision is whether a queried coordinate
contains a known, non-air mc-kernel block through BlockSource, either a sparse
BlockWorld or a point reader. Target resolution is read-only and returns the hit
face needed by a caller's placement transition.

furnace-interaction.ts composes an mc-sim Inventory with FurnaceState. Furnace
transfers, recipes, fuel consumption, smelting, and output-capacity decisions
remain owned by mc-sim; this module only exposes them as one immutable
inventory/furnace transition boundary.

crop-interaction.ts composes an mc-sim CropSnapshot and Inventory with the
kernel-backed BlockWorld. Crop definitions, support rules, growth, bone-meal
advancement, and yields remain owned by mc-sim; this module owns the immutable
planting, crop-block, seed-consumption, and harvest transitions at the sparse
world boundary. BlockWorld represents the currently active dimension slice;
CropLocation.dimension is passed to the upstream planting rule, but this
module does not duplicate generated-dimension or chunk storage.

projectile-interaction.ts applies the same BlockSource predicate to mc-sim's
arrow block raycast. It delegates DDA traversal and impact calculation, while
keeping unknown and air block handling local to the kernel-backed world
boundary. It does not become an entity, damage, or projectile-state system.

explosion-interaction.ts delegates bounded, deterministic explosion and primed
TNT planning to mc-sim. The caller supplies the block blast resistance and
destructibility profile because mc-kernel does not publish those facts. This
module applies only the planned destroyed positions to a new BlockWorld; entity
damage and knockback remain caller-owned effects.

wither-interaction.ts delegates Wither structure matching and entity state
transitions to mc-sim. It consumes the matched summon cells from a new
BlockWorld and returns the upstream charging, spawn-explosion, damage, and death
descriptors. Wither movement, armour, regeneration, damage, and projectiles
remain owned by mc-sim; this package does not introduce an entity or AI adapter.

nether-portal-interaction.ts delegates frame detection and portal layout to
mc-worldgen. It accepts an air ignition cell, detects either supported portal
axis, and materializes the upstream interior layout as nether-portal blocks in
a new BlockWorld. Frame validation and dimensions remain owned by mc-worldgen;
dimension travel, entity teleportation, portal cooldowns, and portal search
remain application responsibilities.

end-portal-interaction.ts delegates completed-frame matching and the 3x3 portal
layout to mc-worldgen. It requires the caller's frame-state reader to preserve
the upstream facing data, accepts only the overworld dimension and an empty
interior, and materializes end-portal blocks in a new BlockWorld. Dimension
travel, entity teleportation, portal search, and frame-state synchronization
remain application responsibilities.

Crafting and container operations remain direct InventoryService capabilities
from mc-sim. GameplayServicesLayer makes those published transitions available
through the same Effect environment; no local recipe or container adapter is
required.

## Module boundary

PreviewModule intentionally contains only frameStages. The application
composition root owns the complete module graph. GameplayServicesLayer is an
exported baseline for standard mc-sim state services, and
gameplayServicesLayerWithEntities<S> is an optional typed composition for the
upstream generic entity manager. The kit does not merge the caller's full
graph or resolve host-specific stage dependencies. Doing that here would
create a second composition implementation with potentially different
behavior from the shipped game.

## Browser boundary

makeBrowserPreview owns a generation-scoped canvas, abort controller, cleanup
callbacks, RAF scheduling, and the mc-sim loop used by a runtime's optional
frame function. Runtime creation remains injected so the package can be tested
without WebGL or pointer lock.

gameplay-preview.ts is the explicit sparse-world gameplay composition. It uses
mc-sim's controllable physics stages, maps the supplied BlockWorld to the
upstream collision callbacks, returns the upstream input port, and appends the
local fluid/redstone stage. The collision reader follows the immutable world
published by that stage, so a mechanics tick is visible to physics on the next
frame. The stage can also report each committed state through
`WorldMechanicsStageOptions.onStateChange`. It remains a caller-supplied
PreviewModule rather than an implicit part of launchPlayground.

The generated gameplay boundary is opt-in. `generated-world-provider.ts` owns
the bounded generated-dimension and raw ChunkStore lifecycle;
`world-runtime-snapshot.ts` converts loaded upstream chunks into the local
sparse BlockWorld boundary, and `world-runtime-persistence.ts` diffs that
boundary back into the upstream store. `generated-gameplay.ts` composes those
pieces with `makeGameplayPreview` and the existing playground lifecycle while
leaving streaming, authoritative world ownership, and host service layers at
the application boundary.

## Non-goals

This architecture does not claim to implement official Minecraft mechanics.
The local preview architecture does not implicitly install GameplayPreview or
the optional world-mechanics preview module, compose unbounded chunk streaming,
sky-light or full-world lighting, entity-specific behavior, authoritative
full-world persistence, networking, mobs, rendering, or input behavior. The
bounded generated-world provider and portable light-grid APIs remain available
through the root exports and `worldgen`. The implemented
finite-height sparse ChunkWorld, block-targeting, projectile, block (including
vertical support detachment, falling-block transitions, collision hull queries,
fluid transitions and state-aware volumes, and bounded redstone device
transitions), explosion, furnace, crop, Nether and End portal, and Wither interaction
boundaries are intentionally smaller than full world mechanics. Each gap has a
more appropriate owner; see
responsibility.md.
