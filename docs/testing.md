# Testing

## Required verification

Run the commands from nix develop:

~~~sh
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm package:verify
~~~

pnpm verify is the local aggregate; it runs typechecking, linting, and the
(non-coverage) test suite. Coverage, the package build, and the packed-archive
runtime smoke test are separate CI steps (pnpm test:coverage and
pnpm package:verify), so a passing pnpm verify does not by itself prove the
package builds or that the packed archive still imports cleanly. The package
build emits declaration and JavaScript output into dist; that directory is a
build artifact and is not source-controlled.

## Test layers

- test/explosion-interaction.test.ts covers profile-driven explosion planning,
  shielding and unloaded cells, immutable block application, and primed-TNT
  fuse advancement/detonation.

- test/launch-options.test.ts covers pure defaults, partial overrides, branded
  kernel item values, and stage metadata.
- test/boot-phase.test.ts covers phase order and budget classification.
- test/playground.test.ts covers generation isolation, boot ordering,
  timestamp-to-loop behavior, queue/clamp metrics, relaunch, and teardown.
- test/browser-preview.test.ts covers owned/borrowed canvases, abort, restart,
  cleanup, scheduler cancellation, frame failures, and stop races.
- test/block-interaction.test.ts covers immutable break/place transitions,
  drops, the kernel-backed mining-experience handoff and silk-touch suppression,
  replaceable blocks, unknown blocks, full inventories, and invalid selections.
- test/block-collision.test.ts covers kernel collision-shape projections,
  non-colliding and unknown blocks, strict query boundaries, sparse traversal,
  and world read-only behavior.
- test/block-contact.test.ts covers kernel contact-damage projection, hazard
  hulls, block-reader range queries, aggregation into mc-sim Damage, unknown
  and non-damaging blocks, and strict face-only contact.
- test/block-fluid.test.ts covers kernel fluid-property projection, water/lava
  occupancy, state-aware partial fluid volumes, block-reader range queries,
  unknown blocks, empty ranges, and strict face-only overlap.
- test/fluid-update.test.ts covers immutable source-cell discovery, downward
  and horizontal flow, replacement rules, water/lava mixing, scheduled
  transitions, stale state, and unchanged cells.
- test/world-mechanics.test.ts covers fixed-tick composition of fluid and
  redstone updates and exposure through the PreviewModule stage contract.
- test/redstone.test.ts covers source inputs including pressure plates, wire
  attenuation and propagation, repeater/comparator/observer device behavior,
  lamp transitions, immutable state/world results, and unchanged layouts.
- test/block-light.test.ts covers kernel emitted-light projection, bounded
  six-neighbour propagation, positive source levels, block-reader range
  queries, unknown and non-emitting blocks, empty ranges, and strict face-only
  overlap.
- test/block-targeting.test.ts covers known non-air hits, placement faces,
  range misses, unknown ids, and world immutability while delegating DDA to
  mc-sim.
- test/projectile-interaction.test.ts covers arrow block impacts, transparent
  unknown blocks, misses, and world immutability while delegating DDA to mc-sim.
- test/furnace-interaction.test.ts covers upstream furnace transfers,
  rejected requests, smelting advancement, output collection, and full
  inventories.
- test/crop-interaction.test.ts covers immutable planting, unsupported and
  invalid requests, crop growth and stale-world filtering, bone-meal
  advancement, mature harvests, and inventory leftovers.
- test/wither-interaction.test.ts covers summon-cell matching, immutable block
  consumption, invalid and repeated summons, charging transitions, damage,
  armour, regeneration, and death payloads delegated to mc-sim.
- test/gameplay-services.test.ts proves the standard mc-sim services and
  upstream crafting/container transitions are available through
  GameplayServicesLayer, and verifies the typed entity composition's
  spawn/snapshot/reset lifecycle through gameplayServicesLayerWithEntities.
- test/flat-chunk.test.ts covers deterministic dimension-aware flat terrain
  materialization and validation of the finite chunk boundary.
- test/generated-world-provider.test.ts covers flat and natural generation,
  bounded preload, idempotent open, validation, raw-store exposure, and close.
- test/world-runtime-snapshot.test.ts covers loaded-chunk snapshots and the
  explicit mc-worldgen-to-mc-kernel chunk conversion.
- test/world-runtime-persistence.test.ts covers changed-cell diffing,
  unchanged writes, unloaded/out-of-bounds failures, and serialized writes.
- test/gameplay-preview.test.ts covers live collision reads, upstream physics
  input, and local mechanics-stage composition.
- test/generated-gameplay.test.ts covers generated launch composition, spawn
  state restoration, persistence, invalid spawn kits, and launch cleanup.
- test/nether-portal-interaction.test.ts and
  test/end-portal-interaction.test.ts cover upstream frame detection and local
  portal-block materialization boundaries.

Tests use injected services and a deterministic clock. Browser lifecycle tests
use a DOM test environment; they do not require WebGL or pointer lock.

## Coverage contract

vitest.config.ts instruments the runtime source under src/**/*.ts and enforces
a 100% threshold for statements, branches, functions, and lines. Type-only
`src/domain/**/*-types.ts` files are excluded from instrumentation, and the
selected source set is asserted to be non-empty. Coverage is a regression gate,
not a substitute for behavioral assertions.

When adding a source file, add a test that exercises both its success and
failure/edge paths before treating a green coverage command as complete.

## Verification interpretation

A passing command is reported with its exact command and exit status. Test
selection must show the number of files and tests selected. A successful
TypeScript compile does not prove runtime behavior, and a successful package
build does not prove that the emitted entry point is usable; the package smoke
test imports the generated ESM entry point from Node 24 and checks required
runtime exports. Both behavior tests and the build/runtime checks are required.

## Scope

This suite verifies the kit's lifecycle, service composition, generic entity
roster composition, and implemented block-targeting, projectile, block,
collision, contact, fluid occupancy and state-aware volumes plus bounded fluid
level/flow/mixing/scheduling, emitted-light sources, bounded redstone
source/wire/device/lamp power,
explosion, mining-experience, furnace, crop, crafting, and container
interaction contracts. It does not claim official Minecraft gameplay parity.
Wither interaction is included in the implemented boundary; additional
gameplay modules must bring their own domain-level tests and can be exercised
through the same composition boundary.
