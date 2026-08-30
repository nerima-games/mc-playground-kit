/**
 * Public lifecycle and gameplay boundaries for the Minecraft preview runtime.
 *
 * Kernel owns Minecraft vocabulary and mc-sim owns reusable state transitions;
 * this package owns the orchestration and the world-bound gameplay verbs that
 * connect them. The portable mc-kernel and mc-sim surfaces are re-exported
 * directly, while physics, save, and generated-world surfaces are exposed as
 * namespaces to keep upstream domains distinct from this package's local
 * sparse-world and lifecycle boundaries.
 */

export * from './domain/boot-phase.js'
export * from './domain/launch-options.js'
export * from './domain/block-interaction.js'
export * from './domain/block-targeting.js'
export * from './domain/physics-world.js'
export * from './domain/flat-chunk.js'
export * from './domain/explosion-interaction.js'
export * from './domain/crop-interaction.js'
export * from './domain/furnace-interaction.js'
export * from './domain/projectile-interaction.js'
export * from './domain/wither-interaction.js'

export * from '@nerima-games/mc-kernel'
export { isEmpty } from '@nerima-games/mc-sim'
export { isEmpty as isEmptyBlockState } from '@nerima-games/mc-kernel'
export * from '@nerima-games/mc-sim'
// The mc-sim barrel also re-exports the kernel anvil vocabulary.
// Explicit re-exports below pick the owner, mc-kernel.
export type {
  AnvilApplyResult,
  AnvilCustomName,
  AnvilDurability,
  AnvilEnchantment,
  AnvilEnchantmentId,
  AnvilEnchantmentRule,
  AnvilInputStack,
  AnvilItemPayload,
  AnvilPlan,
  AnvilRejectionReason,
  AnvilRepairMaterialRule,
  AnvilRuleSet,
  AnvilSnapshot,
  AnvilSnapshotEncodingResult,
  AnvilSnapshotResult,
  AnvilSnapshotString,
  AnvilState,
  AnvilValidationIssue,
  CanonicalAnvilItemPayload,
  CanonicalAnvilState,
} from '@nerima-games/mc-kernel'
export {
  ANVIL_MAX_CUSTOM_NAME_LENGTH,
  ANVIL_REPAIR_BONUS_RATIO,
  ANVIL_SNAPSHOT_VERSION,
  ANVIL_TOO_EXPENSIVE_LEVEL,
  applyAnvil,
  decodeAnvilSnapshot,
  decodeAnvilSnapshotString,
  encodeAnvilSnapshot,
  isAnvilCustomName,
  isAnvilEnchantmentId,
  isAnvilSnapshotString,
  nextAnvilRepairCost,
  planAnvil,
  snapshotAnvilState,
} from '@nerima-games/mc-kernel'
// Kit-owned interaction helpers shadow the same-named mc-sim re-exports.
export { breakBlock } from './domain/block-breaking.js'
export { placeBlock } from './domain/block-placement.js'
export * as physics from '@nerima-games/mc-physics'
export * as save from '@nerima-games/mc-save'
export * as worldgen from '@nerima-games/mc-worldgen'
export {
  snapshotAgeSecs,
} from '@nerima-games/mc-sim'
export {
  advanceFurnace,
  collectFurnaceOutput,
} from './domain/furnace-interaction.js'

export * from './application/preview-ports.js'
export * from './application/generated-world-provider.js'
export * from './application/chunk-store-world-sync.js'
export * from './application/world-runtime-snapshot.js'
export * from './application/world-runtime-persistence.js'
export * from './application/gameplay-preview.js'
export * from './application/generated-gameplay.js'
export * from './application/playground.js'
export * from './application/browser-preview.js'
export * from './application/gameplay-services.js'
