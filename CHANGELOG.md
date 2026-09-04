# @nerima-games/mc-playground-kit

## 0.4.0

### Minor Changes

- [#18](https://github.com/nerima-games/mc-playground-kit/pull/18) [`cb90b47`](https://github.com/nerima-games/mc-playground-kit/commit/cb90b47088bfb0ec6c32c768efec6a036c2cbde6) Thanks [@takeokunn](https://github.com/takeokunn)! - Widened `domain/chunk-world.ts`'s `ChunkSnapshot.blocks` from one byte per block (`Uint8Array`, ceiling 255) to two bytes per block (`Uint16Array`, ceiling `BLOCK_ID_MAX` = 65535), the same class of fix `@nerima-games/mc-worldgen` (0.4.0) and `@nerima-games/mc-meshing` shipped for the same reason. The registry currently tops out at id 122 (kernel 0.7.0), so nothing was truncating yet — this closes the gap before it could.
  
  `snapshotOf`'s round trip from a kernel `Chunk` now reads every id through `ChunkBlocks.get(index)` into a `Uint16Array` (renamed `blockIdsOf`, was `legacyBytesOf`) instead of a byte array, and no longer re-validates `value.coord`/`value.height` through a second `chunk()` call — that call would have forced `blocks` back through kernel's byte-capped `Uint8Array` constructor parameter, undoing the widening it was meant to preserve; `value` is already a validated `Chunk`, so its `coord`/`height` need no reconstruction.
  
  Building a kernel `Chunk` from this package's own wide storage (`kernelChunkOf`, `chunksAfterBlockWrite`) can no longer pass the array straight to kernel's `chunk()`, which only accepts the legacy one-byte-per-block shape. Both now go through a new `kernelChunkFromBlocks` helper (exported, since `world-runtime-snapshot.ts` needs the identical construction for `@nerima-games/mc-worldgen`'s own newly-widened `Chunk.blocks`): build an air-filled scaffold through `chunk()`, then widen each slot through `ChunkBlocks`'s own checked, registry-validating `set()` rather than a second typed-array cast.
  
  `domain/flat-chunk.ts`'s `flatChunkOf` copies `Chunk.blocks` (now `@nerima-games/mc-worldgen` 0.4.0's own widened `Uint16Array`) into a same-width buffer; every value it writes still comes from a small, fixed set of real registry ids (`FLAT_CHUNK_MATERIALS`), so this is a type-correctness fix required by the dependency bump rather than an observed truncation.
  
  `@nerima-games/mc-worldgen` bumped 0.3.2 → 0.4.0 to pick up its own widening; `@nerima-games/mc-kernel` (0.7.0) and `@nerima-games/mc-save` (0.4.1) stay pinned, both already compatible with 0.4.0.
  
  This package has no persisted format of its own carrying block ids — chunk persistence is delegated entirely to `@nerima-games/mc-worldgen`'s `makePersistentChunkStore`, whose own version-1-to-2 migration (0.4.0) already handles old saves, so there was no format here to version-bump.
  
  Unlike `mc-worldgen`/`mc-meshing`, this package cannot construct a genuinely registry-unknown wide id to round-trip in a test: every `Chunk` it builds goes through kernel's own registry-validating `chunk()`/`BlockState.set()`, and (verified directly) mocking kernel's published `./domain/block-registry` subpath export does not reach the copy of that registry kernel's own barrel re-exports internally, so a downstream package cannot substitute kernel's live roster the way kernel's own test suite can. Coverage instead asserts the storage width directly: after `storeChunkInChunkWorld` and after `writeBlockAtChunkWorld`, `ChunkSnapshot.blocks` is a `Uint16Array`, not the retired `Uint8Array`.
  
  Light grids and fluid state are untouched: both are keyed maps (`Map<BlockPositionKey, ...>`), not block-id-adjacent byte arrays, so there was nothing to widen there. No packed or bit-shifted field sits next to a block id anywhere in this package.
  
  `typecheck`, `lint`, `test` (248/248), `test:coverage` (100% statements/branches/functions/lines), `build`, and `package:verify` all pass.

## 0.3.1

### Patch Changes

- [#16](https://github.com/nerima-games/mc-playground-kit/pull/16) [`5bd960b`](https://github.com/nerima-games/mc-playground-kit/commit/5bd960b0a7e60342d6263fce6b0d6fb58e0abe8c) Thanks [@takeokunn](https://github.com/takeokunn)! - Align internal pins to the current published versions
  
  - `@nerima-games/mc-physics` to 0.2.2
  - `@nerima-games/mc-sim` to 0.4.2
  - `@nerima-games/mc-worldgen` to 0.3.2
  Each of these upstream releases contained a pin change and no source change,
  so no behaviour moves with this bump.

## 0.3.0

### Minor Changes

- [#14](https://github.com/nerima-games/mc-playground-kit/pull/14) [`a653c79`](https://github.com/nerima-games/mc-playground-kit/commit/a653c796cebe2e5fe2be8102df60907614b98d8f) Thanks [@takeokunn](https://github.com/takeokunn)! - Pin `@nerima-games/mc-kernel` to 0.7.0, `@nerima-games/mc-save` to 0.4.1, `@nerima-games/mc-sim` to 0.4.1, and `@nerima-games/mc-worldgen` to 0.3.1.
  
  Kernel 0.7.0 widened its public vocabulary to cover entity, inventory, equipment, weather, wither, vehicle, recipe, vitals, hotbar, crafting, projectile, primed-tnt, smelting, statistics, enchantment, crop, brewing, and damage domains, plus this package's own redstone/fluid/`PlayerPose` names and mc-sim's settings passthrough — all colliding by name with mc-sim's pre-existing, independently-owned exports and with this package's own local modules. `src/index.ts`'s root barrel now resolves every collision explicitly: mc-sim keeps the state-transition vocabulary this package's own domain and application code already depends on, this package's local modules keep their own redstone/fluid/`PlayerPose` implementations, and mc-kernel keeps only the settings and anvil vocabulary mc-sim purely passes through unchanged.
  
  `domain/chunk-world.ts`'s `ChunkSnapshot` round-trip through kernel's `Chunk` used `ChunkBlocks.toBytes()`, which now returns the versioned wire encoding (2 bytes per block element) rather than one byte per block id; every stored or loaded chunk failed with a block-data-length mismatch. Fixed by reading each block id back through `ChunkBlocks.get(index)`, matching the legacy one-byte-per-block shape this package's own `ChunkSnapshot.blocks` still uses (registry ids remain well under 256; re-check if the registry ever grows past that). `encodeChunkAt`'s return type follows kernel's now-branded `EncodedChunk`, and `loadEncodedChunkIntoWorld` accepts either that brand or a plain `Uint8Array`.
  
  `domain/nether-portal-interaction.ts` follows mc-worldgen 0.3.0's removal of its duplicate portal-frame exports: `PortalFrame`, `detectNetherPortal`, and (in the test) `generatePortalLayout`/`PortalAxis` now come from `@nerima-games/mc-kernel`, and `detectNetherPortal`'s `PortalFrame | undefined` return replaces the retired `Option` result.

### Patch Changes

- [#13](https://github.com/nerima-games/mc-playground-kit/pull/13) [`5f8dbd6`](https://github.com/nerima-games/mc-playground-kit/commit/5f8dbd639246e24ce1e2997c3bdfeb9abdaa28c1) Thanks [@takeokunn](https://github.com/takeokunn)! - Declare main: ./dist/index.js beside the exports map, matching every sibling package (the org conformance check reads it).

- [#12](https://github.com/nerima-games/mc-playground-kit/pull/12) [`88667f0`](https://github.com/nerima-games/mc-playground-kit/commit/88667f0d1942c996ee5a8a6f4a799a2b23b1c6c5) Thanks [@takeokunn](https://github.com/takeokunn)! - Complete the org toolchain devDependency pin set: knip 6.33.0 (its verify gate arrives in Wave 3; the pin belongs to the Wave 0 table) plus @effect/vitest 0.30.0 where it was missing.

## 0.2.0

### Minor Changes

- [#10](https://github.com/nerima-games/mc-playground-kit/pull/10) [`1aacd74`](https://github.com/nerima-games/mc-playground-kit/commit/1aacd74f5711f3af7f593efc0c351d5f24ad2d3c) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added. Adopts the mc-sim 0.2.1 contract: makeControllableSimStagesWithPhysics replaces makeSimStagesForPreviewWithPhysics, ExplosionRequest/PrimedTntRequest are non-generic with a required entities list, PrimedTntState uses kind tags, and physics ResolveOptions takes blockPropertiesAt instead of isBlockSolid
