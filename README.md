# @nerima-games/mc-playground-kit

An Effect-based development preview lifecycle for the Minecraft packages.
The kit supplies deterministic launch configuration, boot-budget accounting,
relaunch-safe teardown, and browser/terminal preview boundaries.

This package is an orchestration layer. It is not a complete Minecraft game and
does not replace the world, renderer, input, physics, or gameplay packages.

## Scope

The kit owns:

- pure launch-option normalization and default spawn data;
- boot phase timing and budget classification;
- one-generation-at-a-time playground lifecycle;
- timestamp-based frame submission through mc-sim makeGameLoop;
- browser surface and requestAnimationFrame lifecycle;
- immutable block break/place transitions backed by mc-kernel and mc-sim,
  including kernel-defined vertical support detachment and falling-block
  transitions;
- finite-height sparse `ChunkWorld` storage with configurable vertical origin
  and kernel-backed chunk codec boundaries;
- direct `BlockReader` point-query views for sparse `BlockWorld` and finite
  `ChunkWorld` storage, consumed by targeting, projectile, and single-cell
  collision queries;
- block targeting from a player pose backed by mc-sim voxel raycasting and the
  mc-kernel block registry;
- arrow block collision delegated to mc-sim voxel raycasting against the
  mc-kernel-backed sparse world;
- sparse-world block collision hull queries derived from mc-kernel collision
  shape definitions;
- sparse-world fluid occupancy and state-aware volume queries derived from
  mc-kernel fluid properties;
- local immutable fluid level, flow, mixing, and scheduled transitions;
- bounded redstone source, pressure-plate, wire, repeater, comparator,
  observer, and lamp power transitions;
- an explicit fixed-tick world-mechanics stage and PreviewModule helper for
  local fluid and redstone transitions;
- sparse-world emitted-light source and bounded six-neighbour propagation
  queries derived from mc-kernel light properties;
- explosion and primed-TNT transitions delegated to mc-sim with an explicit
  caller-provided blast profile;
- furnace transfer, smelting, and output-collection transitions backed by
  mc-sim;
- crop planting, growth, bone-meal, and harvest transitions backed by mc-sim
  crop rules and the mc-kernel block registry;
- Nether portal frame detection and interior activation delegated to
  mc-worldgen over the immutable sparse world boundary;
- End portal frame-state matching and interior activation delegated to
  mc-worldgen over the immutable sparse world boundary;
- Wither structure summoning and immutable sparse-world consumption backed by
  mc-sim Wither state transitions;
- a direct GameplayServicesLayer composition for the standard mc-sim state
  services, including its crafting and container transactions;
- a typed gameplayServicesLayerWithEntities factory that composes mc-sim's
  generic entity roster lifecycle while leaving host behavior types to callers;
- an explicit `GameplayPreview` composition that connects mc-sim's physics
  stages to a sparse `BlockWorld` and appends the local fluid/redstone stage;
- small injected ports for world, simulation, rendering, and input;
- deterministic test doubles used by the terminal preview harness.

The kit does not own:

- unbounded chunk streaming, authoritative full-world ownership, rendering,
  pointer lock, or input mappings;
- low-level terrain generation or storage formats; the opt-in generated-world
  layers compose those responsibilities from mc-worldgen without copying them;
- the authoritative full world or gameplay state; GameplayServicesLayer
  composes the upstream services but does not replace their ownership;
- entity-specific behavior, damage, AI, or mob mechanics; the entity helper
  only exposes mc-sim's generic roster lifecycle;
- dependency composition or module-layer merging;
- the complete set of official Minecraft mechanics beyond the implemented
  block-targeting, projectile-interaction, block-interaction (including the
  kernel-backed mining-experience handoff, fluid occupancy and state-aware
  volumes, local fluid transitions, and bounded redstone device transitions),
  explosion-interaction, nether-portal-interaction, end-portal-interaction,
  furnace-interaction, crop-interaction, and wither-interaction boundaries.

Those responsibilities belong to the upstream packages or to the application
composition root that supplies the ports.

The root `physics`, `save`, and `worldgen` namespaces expose the published
upstream APIs directly. `GeneratedWorldProviderLayer` composes mc-worldgen's
generated-dimension source and in-memory `ChunkStore`, while
`PersistentGeneratedWorldProviderLayer` binds the same runtime to the
injected `StoragePort`. Both layers validate the launch spec, preload a bounded
radius, expose the raw upstream store through `WorldRuntimePort`, and unload it
on close. They are explicit application composition; they do not claim
unbounded streaming or authoritative full-world ownership, and the default
preview lifecycle still does not install them implicitly.

`makeGameplayPreview` is the explicit playable-preview composition. It uses
mc-sim's physics stages with a collision source derived from the supplied
`BlockWorld`, returns the upstream `SimInputPort`, and appends the local
fluid/redstone stage. It does not install itself into `launchPlayground` or
provide renderer, pointer-lock, or input-mapping behavior.

`launchGeneratedPlayground` is the opt-in composition for the bounded generated
runtime. It combines the provider, loaded-chunk snapshot, playable preview,
and normal playground lifecycle, and returns a `persistWorld` operation for
changed blocks. Use the generated provider layer and supply the remaining host
services explicitly; streaming and authoritative world ownership remain
application policies.

## Development

The repository uses Node 24, pnpm 11, TypeScript, Effect, Vitest, and the Nix
development shell. From the repository root:

~~~sh
nix develop
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm test:package
pnpm lint
~~~

oxlint is provided by Nix, so pnpm lint and pnpm verify must run inside nix
develop. The CI-equivalent command is:

~~~sh
nix develop --command pnpm verify
~~~

pnpm verify runs typechecking, linting, the coverage-enabled test suite, the
package build, and the generated package runtime smoke test.

## Public entry points

The package root exports the local domain and application APIs together with
the reusable domain, service, and stage APIs published by `@nerima-games/mc-sim`.
Those upstream values are re-exported directly; the local modules only add
world-owned boundaries such as sparse block storage and block transitions:

~~~ts
import { launchPlayground } from '@nerima-games/mc-playground-kit'
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel'

const handle = yield* launchPlayground()
yield* handle.submitFrame(MonotonicTimeSecs(0.016))
~~~

launchPlayground requires four application-owned services:

- WorldProviderPort
- SimulationPort
- RendererPort
- InputPort

mc-kernel remains the canonical owner of branded vocabulary and registries. The
package root re-exports its portable public surface directly so callers can use
one kit import without introducing a second local spelling.

The browser API, port contracts, and exact lifecycle semantics are documented
in docs/public-api.md.

GameplayServicesLayer, gameplayServicesLayerWithEntities, targetBlock,
raycastArrowInWorld, blockReaderOf, blockReaderOfChunkWorld, readBlockAt,
breakBlock, placeBlock, blockCollisionAt,
blockCollisionFor, blockCollisionsIn, blockContactAt, blockContactsIn,
blockContactDamageIn, blockFluidAt, blockFluidsIn, blockLightSourceAt,
blockLightSourcesIn, fluidStateFromWorld, updateFluids, updateRedstone,
makeWorldMechanicsStage, makeWorldMechanicsPreview,
removeUnsupportedBlocksAbove, the
mining-experience handoff, the explosion and primed-TNT interaction functions,
the Nether and End portal, furnace, crop, and Wither interaction functions are
documented there as well.

## Architecture

Pure values and decisions live under src/domain. Effectful lifecycle code
lives under src/application. The dependency boundary is explicit:

~~~
caller layers / upstream implementations
        │
        ▼
  mc-playground-kit ports ── mc-sim GameLoop
        │
        ▼
  launch generation and browser lifecycle
~~~

See docs/architecture.md and docs/responsibility.md.

## Current completeness boundary

The lifecycle and preview contract are implemented and tested. “All official
Minecraft functionality” is not a property of this repository: missing
mechanics must be implemented in the appropriate upstream package or in an
application module, then supplied through the composition boundary. The
implemented finite-height sparse `ChunkWorld` with configurable vertical origin,
block targeting, projectile, direct point-reader, and single-cell collision
lookups,
block (including vertical support detachment, falling-block transitions,
collision hull, fluid occupancy, state-aware fluid volumes, local fluid
level/flow/mixing transitions, emitted-light source queries and bounded
six-neighbour propagation, and bounded redstone source/wire/device/lamp
transitions),
explosion, Nether and End portal, furnace, crop, and Wither interactions plus direct
mc-sim service composition, including the optional generic entity roster, are
the current gameplay boundary. The opt-in generated-world provider adds deterministic
mc-worldgen terrain, bounded preload, lifecycle cleanup, and memory or
`StoragePort`-backed chunk persistence. `generation: 'flat'` materializes the
validated `surfaceY` with the local dimension-aware `flatChunkOf` transformation;
`generation: 'natural'` keeps the terrain produced by mc-worldgen and forwards
its `terrain` options. Both modes are part of the materialized chunk data rather
than launch-only metadata.
Remaining work is tracked as explicit gaps in the
architecture and responsibility documents rather than hidden behind
compatibility adapters.

The fluid and redstone cores are pure immutable local transitions, and
`makeWorldMechanicsStage` plus `makeWorldMechanicsPreview` provide an explicit
fixed-tick preview composition, not a claim of full Minecraft parity.
Block-state variants, exact official tick semantics, chunk-neighbor scheduling,
fluid collision integration, world-wide composition, and automatic installation
into a launch remain caller or application responsibilities.

The root `physics`, `save`, and `worldgen` namespaces are direct access points
to upstream portable functionality. The default preview remains a focused
port-driven lifecycle; `makeGameplayPreview` provides the explicit physics and
local-mechanics composition for a sparse world, while the generated-world
layers provide an explicit bounded runtime for applications that need one.

## License

See LICENSE.
