---
"@nerima-games/mc-playground-kit": minor
---

Pin `@nerima-games/mc-kernel` to 0.7.0, `@nerima-games/mc-save` to 0.4.1, `@nerima-games/mc-sim` to 0.4.1, and `@nerima-games/mc-worldgen` to 0.3.1.

Kernel 0.7.0 widened its public vocabulary to cover entity, inventory, equipment, weather, wither, vehicle, recipe, vitals, hotbar, crafting, projectile, primed-tnt, smelting, statistics, enchantment, crop, brewing, and damage domains, plus this package's own redstone/fluid/`PlayerPose` names and mc-sim's settings passthrough — all colliding by name with mc-sim's pre-existing, independently-owned exports and with this package's own local modules. `src/index.ts`'s root barrel now resolves every collision explicitly: mc-sim keeps the state-transition vocabulary this package's own domain and application code already depends on, this package's local modules keep their own redstone/fluid/`PlayerPose` implementations, and mc-kernel keeps only the settings and anvil vocabulary mc-sim purely passes through unchanged.

`domain/chunk-world.ts`'s `ChunkSnapshot` round-trip through kernel's `Chunk` used `ChunkBlocks.toBytes()`, which now returns the versioned wire encoding (2 bytes per block element) rather than one byte per block id; every stored or loaded chunk failed with a block-data-length mismatch. Fixed by reading each block id back through `ChunkBlocks.get(index)`, matching the legacy one-byte-per-block shape this package's own `ChunkSnapshot.blocks` still uses (registry ids remain well under 256; re-check if the registry ever grows past that). `encodeChunkAt`'s return type follows kernel's now-branded `EncodedChunk`, and `loadEncodedChunkIntoWorld` accepts either that brand or a plain `Uint8Array`.

`domain/nether-portal-interaction.ts` follows mc-worldgen 0.3.0's removal of its duplicate portal-frame exports: `PortalFrame`, `detectNetherPortal`, and (in the test) `generatePortalLayout`/`PortalAxis` now come from `@nerima-games/mc-kernel`, and `detectNetherPortal`'s `PortalFrame | undefined` return replaces the retired `Option` result.
