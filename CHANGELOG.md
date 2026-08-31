# @nerima-games/mc-playground-kit

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
