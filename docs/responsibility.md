# Responsibility

The repository is intentionally small because each subsystem has one owner.

| Area | Owner | This kit's role |
| --- | --- | --- |
| Branded coordinates, time, items, stages | mc-kernel | Consume the published vocabulary, including canonical item stacks and fixed-duration time brands. |
| Block registry, drops, placeable and replaceable capabilities | mc-kernel | Resolve block and item facts directly; do not copy the registry. |
| Player, inventory, equipment, vitals, time, crop rules, frame loop | mc-sim | Expose a direct baseline through GameplayServicesLayer and delegate fixed-step timing to makeGameLoop. |
| Generic entity roster lifecycle | mc-sim | Expose the typed EntityManagerLayer through gameplayServicesLayerWithEntities; callers own behavior types and entity mechanics. |
| Player-pose block raycast and hit geometry | mc-sim / mc-physics | Delegate traversal and camera geometry; provide a BlockSource predicate (sparse map or point reader). |
| Arrow block raycast and impact geometry | mc-sim / mc-physics | Delegate voxel traversal and apply a BlockSource predicate. |
| Explosion planning and primed-TNT fuse transitions | mc-sim | Delegate bounded deterministic planning; apply the planned block mutation at the world boundary. |
| Crafting and container storage transitions | mc-sim | Expose the published InventoryService operations through GameplayServicesLayer; do not copy recipes or storage rules. |
| Anvil payloads, repair, enchantment, naming, cost, and snapshots | mc-kernel | Consume the published `planAnvil` and `applyAnvil` transitions directly; do not lossy-convert their payload state into PlayerStorage. |
| Sparse block world and break/place transitions | this kit | Combine kernel block facts, including break experience and support rules, with mc-sim PlayerStorage immutably; delegate inventory replacement and tool durability to mc-sim, and leave vitals mutation there. |
| Vertical support and falling transitions after block breaks | this kit / mc-kernel | Apply the kernel's support-sensitive and falling capabilities to the direct vertical chain above the broken cell, remove unsupported cells immutably, return resolved drops or falling transitions, and leave falling-entity simulation to the caller; horizontal attachment and block-specific scheduled behavior remain outside this slice. |
| Sparse-world block collision hull queries | this kit / mc-kernel | Project the kernel's published collisionShape definitions into immutable AABBs; single-cell lookups accept BlockSource, while range queries enumerate sparse BlockWorld cells. |
| Body integration and collision resolution | mc-sim / mc-physics / this kit | Consume the upstream solver through mc-sim's physics stages; `makeGameplayPreview` supplies the default movement configuration and adapts the supplied kernel-backed BlockWorld to its collision callbacks without copying the solver. `launchPlayground` does not install that composition implicitly. |
| Sparse-world fluid occupancy and state-aware volumes | this kit / mc-kernel | Project the kernel's published fluid property into immutable full-cell water/lava records and project local fluid levels and falling state into partial or full-cell AABBs through strict queries. |
| Sparse-world fluid level, flow, mixing, and scheduling transitions | this kit / mc-kernel | `fluidStateFromWorld` and `updateFluids` provide a bounded immutable local transition core using kernel replacement and flow capabilities; `makeWorldMechanicsStage` and `makeWorldMechanicsPreview` provide explicit fixed-tick composition, while the caller owns state persistence, chunk boundaries, block-state variants, and movement-solver integration. |
| Sparse-world redstone source, wire, device, and lamp transitions | this kit / mc-kernel | `updateRedstone` provides bounded immutable source, wire, pressure-plate, repeater, comparator, observer, and lamp transitions over a sparse world; `makeWorldMechanicsStage` and `makeWorldMechanicsPreview` provide explicit fixed-tick composition, while the caller owns orientation-specific block states, exact official tick semantics, and chunk/world synchronization. |
| Sparse-world emitted-light source queries and bounded propagation | this kit / mc-kernel | Project the kernel's published lightEmission property into immutable full-cell source records and provide bounded six-neighbour attenuation through transparent cells; sky light, full chunk light grids, and scheduled world-wide updates remain outside this local slice, while mc-worldgen provides the propagated chunk light grid. |
| Sparse-world explosion composition | this kit | Supply the caller's blast profile to mc-sim and apply only planned destroyed positions; leave entity effects to the caller. |
| Furnace state transitions, recipes, fuels, and output rules | mc-sim | Delegate transfer, advancement, and collection directly to the published pure transitions. |
| Furnace/inventory composition | this kit | Return one immutable transition state without copying smelting rules. |
| Crop definitions, support, growth, bone-meal, and yield rules | mc-sim | Delegate the published crop predicates and pure transitions directly. |
| Crop/world/inventory composition | this kit | Apply kernel block identities and support facts at the active sparse-world boundary; consume seeds or bone meal and return immutable harvest transitions. |
| Nether and End portal frame detection and interior layout | mc-worldgen / this kit | Delegate Nether frame validation and End frame-state matching plus interior coordinates to mc-worldgen, then materialize the corresponding portal blocks immutably in the active sparse world; travel, teleportation, cooldowns, portal search, and frame-state synchronization remain caller-owned. |
| Wither structure matching and state transitions | mc-sim | Delegate structure matching, charging, movement, armour, damage, death, and descriptors directly; callers use the published skull projectile and serialization APIs. |
| Wither/world composition | this kit | Match the active sparse world through mc-sim, consume the seven summon cells immutably, and return explosion/death descriptors without duplicating Wither rules. |
| Finite-height sparse chunk world boundary | this kit | Own immutable chunk-map transitions, y-boundary checks, empty-chunk pruning, decoded-chunk loading, and an optional point reader; do not generate, stream, or persist worlds. |
| Chunk coordinate conversion, registry validation, and binary codec | mc-kernel | Consume the kernel's coordinate and codec APIs; do not duplicate the chunk format. |
| Chunk generation and generated dimensions | mc-worldgen / this kit | mc-worldgen owns generation, terrain options, generated dimensions, and store semantics; this kit exposes that published surface under the root `worldgen` namespace and provides an explicit `GeneratedWorldProviderLayer` plus `PersistentGeneratedWorldProviderLayer` that select flat or natural materialization, preload a bounded radius, and bind the existing launch port without duplicating the generator or store. |
| Input service and world renderer | mc-render | Receive attach/draw/detach implementations; do not duplicate DOM, WebGL, or bindings. |
| Preview defaults and boot decisions | this kit | Keep pure and testable. |
| Relaunch, interruption, cleanup, browser surface | this kit | Own generation lifetime and integration order. |
| Official gameplay mechanics not present upstream | the relevant game package | Add the mechanic at its domain owner, then expose it through a module/service. |

## Why local ports remain

The ports are not adapters around a duplicated implementation. They are narrow
application contracts that make the lifecycle testable in Node:

- the world port expresses “open this preview world” rather than generation or
  streaming policy;
- the simulation port exposes the small operation needed by a preview;
- the renderer port makes pose mirroring explicit;
- the input port owns only listener lifetime.

ChunkWorld provides a pure local value boundary for finite sparse storage,
including a configurable vertical origin; it is not a port adapter and does not
replace a generated world provider. Its blockReaderOfChunkWorld view is a direct
point-query function for APIs that do not need enumeration; it does not broaden
ChunkWorld into generation, streaming, persistence, or multi-dimension
ownership. Its chunk codec boundary does not persist the vertical origin, so the
dimension configuration remains caller-owned.

Concrete mc-render APIs are broader and lower-level; their composition belongs
to the application that owns the real runtime. The portable mc-worldgen APIs
are intentionally exposed directly under the root `worldgen` namespace, and
the generated-world provider layers are the explicit bounded composition for
the preview's `WorldProviderPort`. The preview does not need to install those
layers for its deterministic lifecycle tests to remain focused.

## Upstream usage

The kit directly uses mc-kernel brands, block capabilities, drop rules, the
`collisionShape`, `contactDamage`, `fluid`, `lightEmission`,
`replaceable`, `brokenByWaterFlow`, and `xpOnBreak` block properties,
mc-sim's immutable inventory, crafting/container transitions, block-targeting,
projectile raycast, explosion/TNT planning, furnace, crop, and Wither transitions,
entity manager, service layers, and GameLoopApi. Anvil payload and repair
transitions remain direct mc-kernel capabilities because PlayerStorage does not
represent enchantments, custom names, repair costs, or experience levels.
The published mc-render package remains available to callers that implement
the rendering ports. The published mc-worldgen package is a direct root
dependency and is exposed without a compatibility adapter through `worldgen`.
`resolveOptionsForBlockSource` supplies the local block callback adapter
consumed by mc-sim's physics stages; the solver remains upstream.

`makeGameplayPreview` is the explicit application composition for a sparse
world: it reuses mc-sim's controllable physics stages, supplies the local
collision callbacks, returns the upstream input port, and appends the local
fluid/redstone stage. It is not installed by `launchPlayground` automatically.

GameplayServicesLayer supplies the standard mc-sim state layers, while
gameplayServicesLayerWithEntities adds the generic upstream entity manager for
a caller-provided behavior type. PreviewModule still accepts frame stages only,
and the caller resolves the remaining full GameModule graph so the same
host-specific composition can be used by a shipped runtime and a preview.

## Completeness gaps

The following are not hidden obligations of this repository:

- complete block/item registry beyond the kernel facts used here and remaining
  crafting/gameplay rules beyond the targeting, inventory, crafting/container,
  projectile, block, explosion, furnace, crop, Nether and End portal, and Wither slices;
- authoritative explosion resistance and destructibility data are not present
  in the kernel; this kit requires an explicit caller-owned profile and does not
  derive it from unrelated block hardness values;
- unbounded generated-world streaming, terrain-generation policy beyond the
  provider's forwarded mc-worldgen options and bounded preload, and
  multi-dimension world ownership remain outside this kit's local orchestration;
- implicit installation of `GameplayPreview` or the optional world-mechanics
  stage, sky light and full-world lighting, orientation-specific redstone block
  states, remaining entity-specific behavior, mobs, and AI;
- renderer feature parity and input bindings;
- authoritative full-world persistence, networking, commands, and server
  behavior;
- resource packs, sounds, particles, and UI.

Each item needs a concrete owner and acceptance tests before it can be called
implemented. The playground can host those modules once they exist; it cannot
make an absent upstream mechanic complete by adding an orchestration adapter.
