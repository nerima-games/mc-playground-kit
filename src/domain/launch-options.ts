/**
 * `LaunchOptions` — the single most important type in this repository.
 *
 * ---------------------------------------------------------------------------
 * Why the shape of an options bag is the whole design
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.10 gives this repository's public API as, in full:
 *
 *   launchPlayground(options: {world?, spawnKit?, modules?}) → 起動済みミニゲーム
 *
 * Every field is optional, and that is the point. plan.md calls this repository
 * 「最も丁寧に作る部品」because 全プレビューの開発体験がここの起動速度と安定性に依存する —
 * and the first thing a developer experiences is whether `launchPlayground()`,
 * with no arguments at all, produces a world they can stand up and walk around
 * in. If it does not, every preview in the project acquires a paragraph of
 * boilerplate, and that paragraph drifts per preview.
 *
 * So the contract is: **`launchPlayground()` with zero arguments is a complete,
 * runnable configuration.** Everything below exists to make that true and to
 * make the filling-in mechanical, total and testable without a browser.
 *
 * ---------------------------------------------------------------------------
 * Three rules this module follows
 * ---------------------------------------------------------------------------
 *
 * 1. NORMALISATION IS PURE AND TOTAL. `normalizeLaunchOptions` is a plain
 *    function from a partial value to a total one. It cannot fail and it cannot
 *    read a clock, a DOM or a network. That is what lets the boot path measure
 *    the `resolve-options` phase at a handful of microseconds
 *    (domain/boot-phase.ts) and what lets a test assert the defaults without
 *    standing up a runtime.
 *
 * 2. INPUT TYPES ARE PERMISSIVE, OUTPUT TYPES ARE TOTAL. Under
 *    `exactOptionalPropertyTypes` (tsconfig.base.json) a field declared `x?: T`
 *    accepts omission but REJECTS an explicit `undefined`. That is right for a
 *    value the program constructs and wrong for a value a caller assembles:
 *
 *      launchPlayground({ world: featureFlag ? { seed: 7 } : undefined })
 *
 *    is ordinary, reasonable calling code, and it does not compile against
 *    `world?: LaunchWorldOptions`. Every optional field on the way IN is
 *    therefore `?: T | undefined`; every field on the way OUT is required. The
 *    permissiveness stops at this function.
 *
 * 3. DEFAULTS ARE MERGED FIELD BY FIELD, NOT OBJECT BY OBJECT. Passing
 *    `{ world: { seed: 7 } }` must not silently discard the default surface
 *    height. `{ ...DEFAULT, ...override }` would do the right thing only if
 *    `override` never carried an explicit `undefined` — which rule 2 has just
 *    made legal. Hence `pick` below, which treats `undefined` as "not supplied".
 */
import { Effect } from 'effect'
import type { GameModule, Position, StageId, StageRegistration, WorldId } from '@nerima-games/mc-kernel'
import { position, WorldId as makeWorldId } from '@nerima-games/mc-kernel'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * The permissive form of a record: every field optional AND explicitly
 * nullable. See rule 2 in the module header.
 */
export type Supplied<T> = { readonly [K in keyof T]?: T[K] | undefined }

/** `undefined` means "not supplied", so the default wins. */
const pick = <T>(supplied: T | undefined, fallback: T): T => (supplied === undefined ? fallback : supplied)

// ---------------------------------------------------------------------------
// world
// ---------------------------------------------------------------------------

/**
 * The mini flat world a playground stands up.
 *
 * plan.md §3.10 says 「ミニ平地ワールド」— *mini* and *flat*, both load-bearing.
 * Flat because a preview verifying a redstone repeater must not also be
 * verifying a cave carver; mini because the boot budget is one second and
 * terrain generation is the largest single item in it (domain/boot-phase.ts).
 */
export type FlatWorldSpec = {
  /** Which save this playground writes to. Previews use a throwaway id. */
  readonly worldId: WorldId
  /**
   * Terrain seed. Fixed by default: a preview that generates different terrain
   * on every launch cannot be screenshot-compared, and plan.md §3.10's
   * completion criterion is 起動→操作→スクリーンショット.
   */
  readonly seed: number
  /** Y of the topmost solid block. The player's feet spawn at `surfaceY + 1`. */
  readonly surfaceY: number
  /**
   * Chunks generated around the origin before the first frame, as a radius.
   * `1` means a 3x3 = 9-chunk plate: 48x48 blocks, enough to walk around in for
   * a minute without a chunk-streaming pause, and small enough to fit the
   * `world` phase budget.
   */
  readonly radiusChunks: number
}

export const DEFAULT_FLAT_WORLD: FlatWorldSpec = {
  worldId: makeWorldId('playground'),
  seed: 0,
  // 49 is NOT chosen for its relation to sea level. plan.md §3.7 states
  // SEA_LEVEL = 48, and an earlier version of this comment justified 49 as
  // "one block above it, so water is reachable by digging down". Both halves
  // are wrong: the reference's SEA_LEVEL is 63 (<reference-impl>
  // /packages/core/domain/constants.ts:17), which puts 49 fourteen blocks
  // BELOW sea level, and a flat preview world generates no water at all.
  //
  // It survives as an arbitrary-but-stable ground plane. Previews only need a
  // surface to stand on. Revisit when a preview needs real terrain, and take
  // the level from mc-worldgen rather than restating a constant here.
  surfaceY: 49,
  radiusChunks: 1,
}

// ---------------------------------------------------------------------------
// spawnKit
// ---------------------------------------------------------------------------

/**
 * `ItemId` is provisionally a bare `string`.
 *
 * The preview boundary intentionally remains a bare `string` so it can accept
 * mod-provided ids. Consumers that need the closed kernel vocabulary import
 * `ItemType` from `@nerima-games/mc-kernel`.
 */
export type ItemId = string

export type HotbarSlot = {
  readonly item: ItemId
  readonly count: number
}

/**
 * What the player is holding, and where they are standing, the moment the
 * preview becomes interactive.
 *
 * A preview whose first two actions are "walk to a chest" and "find a pickaxe"
 * is a preview nobody runs twice. The spawn kit is how a preview author says
 * "assume the player already has what this preview is about".
 */
export type SpawnKit = {
  /** Feet origin, NOT the AABB centre or the eye. plan.md §3.4's Y-convention rule. */
  readonly feetPosition: Position
  readonly yawRadians: number
  readonly pitchRadians: number
  readonly hotbar: ReadonlyArray<HotbarSlot>
}

export const DEFAULT_SPAWN_KIT: SpawnKit = {
  // surfaceY + 1: plan.md §3.4 — "ブロックは [y, y+1] を占有。スポーンと物理平面は
  // surfaceY+1 基準". Spawning at surfaceY itself puts the player inside the
  // ground, which the collision resolver then ejects them from, upward,
  // visibly, on frame one.
  feetPosition: position(0, DEFAULT_FLAT_WORLD.surfaceY + 1, 0),
  // Facing -Z, level. Kernel's convention: yaw 0 looks down -Z.
  yawRadians: 0,
  pitchRadians: 0,
  hotbar: [
    { item: 'STONE', count: 64 },
    { item: 'OAK_PLANKS', count: 64 },
    { item: 'TORCH', count: 64 },
  ],
}

// ---------------------------------------------------------------------------
// modules
// ---------------------------------------------------------------------------

/**
 * The half of plan.md §4.1's `GameModule` that a playground consumes.
 *
 * ---------------------------------------------------------------------------
 * Why only half
 * ---------------------------------------------------------------------------
 *
 * `GameModule<ROut, E, RIn>` has two halves: `layers` and `frameStages`. This
 * harness takes the second and NOT the first, for two independent reasons, and
 * either alone would be sufficient.
 *
 * THE ARCHITECTURAL REASON. plan.md §2.3-3 gives the Layer merge and the single
 * total stage order to mc-compose, and to mc-compose alone. A harness that
 * merged Layers and resolved `after` edges would be a second implementation of
 * compose's only job. It would then be possible for a module to work in every
 * preview and fail in the shipped game — which is the exact failure mode the
 * 16-repository split exists to prevent, reintroduced by the tool meant to make
 * the split bearable.
 *
 * THE TYPE-SYSTEM REASON. `ReadonlyArray<GameModule<ROut, E, RIn>>` cannot
 * express a heterogeneous list: two modules providing different services have
 * different `ROut`, and TypeScript has no existential to quantify them away.
 * Every workaround (a union, `any`, a wildcard `unknown`) either erases the
 * service types the merge exists to compute or forces every caller to spell out
 * one enormous type parameter. compose can solve this because it knows the full
 * module list statically. A harness taking modules at runtime cannot.
 *
 * So a preview's services come from the Layer the caller provides to
 * `launchPlayground` in the ordinary Effect way, and `modules` carries only the
 * per-frame work. `PreviewModule` is written as a `Pick` of the contract type
 * rather than as a fresh interface so that a real `GameModule` is structurally
 * assignable to it and so that this file breaks if §4.1 changes.
 */
export type PreviewModule = Pick<GameModule<never, never, never>, 'frameStages'>

// ---------------------------------------------------------------------------
// LaunchOptions
// ---------------------------------------------------------------------------

/**
 * What a caller may pass. Every field, at every depth, is optional and
 * explicitly nullable — see rule 2 in the module header.
 */
export type LaunchOptions = {
  readonly world?: Supplied<FlatWorldSpec> | undefined
  readonly spawnKit?: Supplied<SpawnKit> | undefined
  readonly modules?: ReadonlyArray<PreviewModule> | undefined
}

/**
 * What the boot path receives. Total: no optional fields, no `undefined`, no
 * further defaulting anywhere downstream.
 *
 * The asymmetry with `LaunchOptions` is the entire value of this module. Code
 * after normalisation never asks "was this supplied?" again, so there is exactly
 * one place where a default can be wrong, and exactly one place to test.
 */
export type ResolvedLaunchOptions = {
  readonly world: FlatWorldSpec
  readonly spawnKit: SpawnKit
  readonly modules: ReadonlyArray<PreviewModule>
}

/**
 * Fill in every unsupplied field. Pure, total, and the only place defaults live.
 *
 * Note that `spawnKit.feetPosition` does NOT track an overridden
 * `world.surfaceY`. That is deliberate: making one default depend on another
 * caller-supplied value turns "what do I get if I pass nothing" into "what do I
 * get if I pass this particular subset", and the subsets multiply. A caller
 * raising the surface raises the spawn too, explicitly, and can be seen to have
 * done so. `DEFAULT_SPAWN_KIT` is a constant, not a function of the world.
 */
export const normalizeLaunchOptions = (options?: LaunchOptions | undefined): ResolvedLaunchOptions => {
  const world = options?.world
  const spawnKit = options?.spawnKit

  return {
    world: {
      worldId: pick(world?.worldId, DEFAULT_FLAT_WORLD.worldId),
      seed: pick(world?.seed, DEFAULT_FLAT_WORLD.seed),
      surfaceY: pick(world?.surfaceY, DEFAULT_FLAT_WORLD.surfaceY),
      radiusChunks: pick(world?.radiusChunks, DEFAULT_FLAT_WORLD.radiusChunks),
    },
    spawnKit: {
      feetPosition: pick(spawnKit?.feetPosition, DEFAULT_SPAWN_KIT.feetPosition),
      yawRadians: pick(spawnKit?.yawRadians, DEFAULT_SPAWN_KIT.yawRadians),
      pitchRadians: pick(spawnKit?.pitchRadians, DEFAULT_SPAWN_KIT.pitchRadians),
      hotbar: pick(spawnKit?.hotbar, DEFAULT_SPAWN_KIT.hotbar),
    },
    modules: pick(options?.modules, []),
  }
}

// ---------------------------------------------------------------------------
// Stage order: checked, never resolved
// ---------------------------------------------------------------------------

/**
 * A stage that runs before a stage it declared it must follow.
 *
 * `declaredIndex` and `constraintIndex` are positions in the flattened stage
 * list — modules in the order given, stages within a module in the order given.
 */
export type StageOrderViolation = {
  readonly stage: StageId
  readonly mustFollow: StageId
  readonly declaredIndex: number
  readonly constraintIndex: number
}

/**
 * Flatten `modules` into the order a playground will actually run their stages
 * in: declaration order, and nothing else.
 *
 * This function is the whole of the harness's stage "scheduling", and its
 * smallness is the point. See `PreviewModule` above for why the total order is
 * not computed here.
 */
export const flattenStages = (
  modules: ReadonlyArray<PreviewModule>,
): Effect.Effect<ReadonlyArray<StageRegistration>> =>
  // `frameStages` became an Effect when the GameModule contract was fixed: a
  // module has to be able to acquire a service in order to BUILD its stages.
  // `PreviewModule` pins `RRegister` to `never`, so nothing a playground accepts
  // can require anything to register — the Effect here is sequencing, not a
  // dependency. Flattening therefore stays as small as this comment claims.
  Effect.map(
    Effect.all(modules.map((module) => module.frameStages)),
    (perModule) => perModule.flat(),
  )

/**
 * Check the caller's declaration order against the caller's OWN `after` edges.
 *
 * Takes the ALREADY FLATTENED stage list — the exact array the frame loop will
 * run — and is pure, so the warnings on a `PlaygroundHandle` are guaranteed to
 * describe the stages that preview is actually running. See
 * `stageOrderViolations` below for why starting from the modules instead is a
 * trap for anything that has already flattened them.
 *
 * This is not a topological sort and must never become one — see
 * `PreviewModule`. It answers a strictly weaker and entirely local question:
 * given that the harness will run these stages in the order written, does that
 * order already contradict a constraint the author themselves declared?
 *
 * Checking is safe where resolving is not. A checker cannot make a preview
 * disagree with the shipped game, because it never chooses an order; it can only
 * report that the author's order and the author's constraints cannot both be
 * what they meant. compose still owns the real answer.
 *
 * Two cases are deliberately NOT violations:
 *
 * - AN `after` NAMING AN ABSENT STAGE. `mc-kernel/domain/frame.ts:46-54`: an
 *   edge to a stage that is not present is scheduled as if it were absent. This
 *   is what lets a module say "after input, if there is input" in a preview that
 *   has no input stage — the common case here, since a preview is by
 *   construction a subset of the game.
 * - A SELF-EDGE OR A DUPLICATE ID. A duplicate id makes "the index of that
 *   stage" ambiguous; this function resolves it to the FIRST occurrence and
 *   otherwise stays quiet, because deciding what a duplicate stage id means is
 *   compose's call, not a preview harness's.
 */
export const flattenedStageOrderViolations = (
  stages: ReadonlyArray<StageRegistration>,
): ReadonlyArray<StageOrderViolation> => {
  const firstIndexOf = new Map<StageId, number>()
  stages.forEach((stage, index) => {
    if (!firstIndexOf.has(stage.id)) {
      firstIndexOf.set(stage.id, index)
    }
  })

  return stages.flatMap((stage, declaredIndex) =>
    (stage.after ?? []).flatMap((mustFollow) => {
      const constraintIndex = firstIndexOf.get(mustFollow)
      // Absent constraint: no edge (kernel frame.ts). Self-edge: nothing to say.
      if (constraintIndex === undefined || mustFollow === stage.id) {
        return []
      }
      return constraintIndex > declaredIndex
        ? [{ stage: stage.id, mustFollow, declaredIndex, constraintIndex }]
        : []
    }),
  )
}

/**
 * The same check, starting from the modules — which means EVALUATING them.
 *
 * Convenience for a caller who has modules and no stages. A caller who has
 * already flattened must use `flattenedStageOrderViolations` on the result
 * instead of calling this: `frameStages` is an Effect precisely so that a
 * module can acquire a service or allocate a `Ref` in order to build its
 * stages, so a second evaluation is a second, DISTINCT set of
 * `StageRegistration`s. Warnings computed over stages the frame loop will never
 * run describe a preview that does not exist. `application/playground.ts` used
 * to do exactly that; see the `modules` phase there.
 */
export const stageOrderViolations = (
  modules: ReadonlyArray<PreviewModule>,
): Effect.Effect<ReadonlyArray<StageOrderViolation>> =>
  Effect.map(flattenStages(modules), flattenedStageOrderViolations)
