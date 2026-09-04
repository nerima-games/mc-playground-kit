---
"@nerima-games/mc-playground-kit": minor
---

Widened `domain/chunk-world.ts`'s `ChunkSnapshot.blocks` from one byte per block (`Uint8Array`, ceiling 255) to two bytes per block (`Uint16Array`, ceiling `BLOCK_ID_MAX` = 65535), the same class of fix `@nerima-games/mc-worldgen` (0.4.0) and `@nerima-games/mc-meshing` shipped for the same reason. The registry currently tops out at id 122 (kernel 0.7.0), so nothing was truncating yet — this closes the gap before it could.

`snapshotOf`'s round trip from a kernel `Chunk` now reads every id through `ChunkBlocks.get(index)` into a `Uint16Array` (renamed `blockIdsOf`, was `legacyBytesOf`) instead of a byte array, and no longer re-validates `value.coord`/`value.height` through a second `chunk()` call — that call would have forced `blocks` back through kernel's byte-capped `Uint8Array` constructor parameter, undoing the widening it was meant to preserve; `value` is already a validated `Chunk`, so its `coord`/`height` need no reconstruction.

Building a kernel `Chunk` from this package's own wide storage (`kernelChunkOf`, `chunksAfterBlockWrite`) can no longer pass the array straight to kernel's `chunk()`, which only accepts the legacy one-byte-per-block shape. Both now go through a new `kernelChunkFromBlocks` helper (exported, since `world-runtime-snapshot.ts` needs the identical construction for `@nerima-games/mc-worldgen`'s own newly-widened `Chunk.blocks`): build an air-filled scaffold through `chunk()`, then widen each slot through `ChunkBlocks`'s own checked, registry-validating `set()` rather than a second typed-array cast.

`domain/flat-chunk.ts`'s `flatChunkOf` copies `Chunk.blocks` (now `@nerima-games/mc-worldgen` 0.4.0's own widened `Uint16Array`) into a same-width buffer; every value it writes still comes from a small, fixed set of real registry ids (`FLAT_CHUNK_MATERIALS`), so this is a type-correctness fix required by the dependency bump rather than an observed truncation.

`@nerima-games/mc-worldgen` bumped 0.3.2 → 0.4.0 to pick up its own widening; `@nerima-games/mc-kernel` (0.7.0) and `@nerima-games/mc-save` (0.4.1) stay pinned, both already compatible with 0.4.0.

This package has no persisted format of its own carrying block ids — chunk persistence is delegated entirely to `@nerima-games/mc-worldgen`'s `makePersistentChunkStore`, whose own version-1-to-2 migration (0.4.0) already handles old saves, so there was no format here to version-bump.

Unlike `mc-worldgen`/`mc-meshing`, this package cannot construct a genuinely registry-unknown wide id to round-trip in a test: every `Chunk` it builds goes through kernel's own registry-validating `chunk()`/`BlockState.set()`, and (verified directly) mocking kernel's published `./domain/block-registry` subpath export does not reach the copy of that registry kernel's own barrel re-exports internally, so a downstream package cannot substitute kernel's live roster the way kernel's own test suite can. Coverage instead asserts the storage width directly: after `storeChunkInChunkWorld` and after `writeBlockAtChunkWorld`, `ChunkSnapshot.blocks` is a `Uint16Array`, not the retired `Uint8Array`.

Light grids and fluid state are untouched: both are keyed maps (`Map<BlockPositionKey, ...>`), not block-id-adjacent byte arrays, so there was nothing to widen there. No packed or bit-shifted field sits next to a block id anywhere in this package.

`typecheck`, `lint`, `test` (248/248), `test:coverage` (100% statements/branches/functions/lines), `build`, and `package:verify` all pass.
