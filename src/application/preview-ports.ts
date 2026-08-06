/**
 * The four sibling surfaces a playground needs, as injected Ports.
 *
 * ---------------------------------------------------------------------------
 * Why Ports and not imports
 * ---------------------------------------------------------------------------
 *
 * Two reasons, one temporary and one permanent.
 *
 * The preview boundary uses the published kernel contract. Higher-level
 * packages remain behind local ports so the harness can be written, typechecked
 * and tested against fakes, then repointed by writing Layers rather than editing
 * this repository's logic.
 *
 * PERMANENT, and the reason these will stay Ports after publication: the whole
 * of `application/playground.ts` must be runnable in Node with no DOM, no WebGL
 * and no Playwright. plan.md §3.10's carried-over knowledge is that the E2E
 * environment is hostile — SwiftShader software rendering, and no pointer lock
 * at all (`ts-minecraft/e2e/gameplay/player-controls.e2e.ts:208`). Boot order,
 * teardown order, relaunch safety and the budget arithmetic are exactly the
 * things that must NOT be verified in that environment, because there they are
 * verified slowly, flakily, and only in the configurations a browser can
 * produce. Injecting the three heavyweight surfaces is what keeps them in
 * `vitest --environment node`.
 *
 * ---------------------------------------------------------------------------
 * On `InputPort` specifically — plan.md §2.3-2
 * ---------------------------------------------------------------------------
 *
 * `InputPort` is a Tag declared here and an implementation that is NOT here.
 *
 *   実行時入力サービスは mc-render が所有。kit は devDependency 専用のため、
 *   kit に入力を置くと本番ゲームから入力が消える。 (plan.md §2.3-2)
 *
 * mc-playground-kit is referenced only as a devDependency and is not in the
 * release build. An input service living in this repository would therefore be
 * absent from the shipped game: the game would boot, render, and respond to
 * nothing. That is not a hypothetical — it is what makes the rule worth a CI
 * gate (`scripts/check-dependency-whitelist.ts`, rules 6 and
 * `DEV_ONLY_PACKAGES`), and it is why the interface below is a REQUIREMENT.
 * Requiring an implementation from mc-render is the opposite of owning one, and
 * the type system makes it structurally impossible to drift into ownership: to
 * satisfy `InputPort` this repository would have to write the implementation
 * that the rule forbids it to have.
 *
 * ---------------------------------------------------------------------------
 * `Context.Tag` + explicit `Layer`, not `Effect.Service`
 * ---------------------------------------------------------------------------
 *
 * Same call as mc-sim (`mc-sim/docs/public-api.md` §0), and doubly so here: a
 * fake is `Layer.succeed(Tag, fake)` with no subclassing, and the same Tag can
 * back several independent instances — which is what a harness capable of
 * standing two previews side by side in one process actually needs.
 */
import { Context, Effect } from 'effect'
import type { FlatWorldSpec, SpawnKit } from '../domain/launch-options'
import type { CameraPoseSnapshot, DeltaTimeSecs } from '@nerima-games/mc-kernel'

// ---------------------------------------------------------------------------
// mc-worldgen
// ---------------------------------------------------------------------------

/**
 * The slice of mc-worldgen a playground uses: make a small flat plate exist,
 * then let go of it.
 *
 * Not `generateChunk` (plan.md §3.7's real API) — a harness has no business
 * choosing chunk coordinates. It says "a flat world of this shape, ready to
 * stand on", and mc-worldgen decides what that costs.
 */
export type WorldProviderService = {
  /** Generate and load the plate described by `spec`. Idempotent per world id. */
  readonly openFlatWorld: (spec: FlatWorldSpec) => Effect.Effect<void>
  /** Unload it. Must be safe to call on a world that was never opened. */
  readonly closeWorld: Effect.Effect<void>
}

export class WorldProviderPort extends Context.Tag('@nerima-games/mc-playground-kit/WorldProviderPort')<
  WorldProviderPort,
  WorldProviderService
>() {}

// ---------------------------------------------------------------------------
// mc-sim
// ---------------------------------------------------------------------------

/**
 * The slice of mc-sim a playground uses.
 *
 * `cameraPose` is READ-ONLY, and there is deliberately no way to write one.
 * plan.md §5.1-2 makes mc-sim the authority on camera pose and mc-render a
 * mirror; the reference implementation's chronic gotcha was the reverse
 * structure, in which simulation logic read the pose back out of the THREE
 * camera (`mc-sim/docs/design-notes.md` DN-01 lists all thirteen sites). A
 * harness sitting between the two is precisely where a convenient
 * `setCameraPose` would be added, and precisely where it would undo the fix, so
 * the surface does not offer one.
 */
export type SimulationService = {
  /** Place the player and give them the kit. Runs once per launch. */
  readonly spawn: (kit: SpawnKit) => Effect.Effect<void>
  /** Advance the simulation by one frame. */
  readonly tick: (dt: DeltaTimeSecs) => Effect.Effect<void>
  /** The authoritative pose. Read only — mc-sim owns it, everyone else mirrors. */
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot>
  /** Tear down. Idempotent; a best-effort teardown may run twice. */
  readonly stop: Effect.Effect<void>
}

export class SimulationPort extends Context.Tag('@nerima-games/mc-playground-kit/SimulationPort')<
  SimulationPort,
  SimulationService
>() {}

// ---------------------------------------------------------------------------
// mc-render (1 of 2): drawing
// ---------------------------------------------------------------------------

/**
 * The slice of mc-render that draws.
 *
 * `renderFrame` takes the pose as a value rather than reading it from anywhere:
 * the mirror direction is visible in the signature, and there is no argument
 * position in which a renderer could hand a pose back.
 */
export type RendererService = {
  /** Create the renderer and attach it to its surface. */
  readonly attach: Effect.Effect<void>
  /** Draw one frame from the pose the simulation published. */
  readonly renderFrame: (dt: DeltaTimeSecs, pose: CameraPoseSnapshot) => Effect.Effect<void>
  /** Release GPU resources. Idempotent. */
  readonly detach: Effect.Effect<void>
}

export class RendererPort extends Context.Tag('@nerima-games/mc-playground-kit/RendererPort')<
  RendererPort,
  RendererService
>() {}

// ---------------------------------------------------------------------------
// mc-render (2 of 2): runtime input — OWNED BY mc-render, see the module header
// ---------------------------------------------------------------------------

/**
 * The slice of mc-render that reads input. Implemented in mc-render. Never here.
 *
 * `attach` / `detach` and nothing else: a playground's entire relationship with
 * input is to switch it on for the preview's lifetime and off again. Key
 * mapping, pointer lock, touch and gamepad are mc-render's, and a preview that
 * needs to *simulate* input reaches for the reference's virtual-input path
 * (`ts-minecraft/packages/presentation/input/input-service.ts:305-318`:
 * `setVirtualKey` / `pulseVirtualKey` / `addVirtualLookDelta` /
 * `setVirtualLookActive`) — which is likewise mc-render's surface, not this
 * one. See docs/porting.md: that path is the load-bearing carry-over, because
 * headless Chromium denies pointer lock outright.
 */
export type PreviewInputService = {
  /** Begin listening. */
  readonly attach: Effect.Effect<void>
  /**
   * Stop listening and drop every registered listener.
   *
   * plan.md §3.9: 入力は `window` にキー登録. A listener on `window` outlives the
   * object that added it, so a relaunch that does not detach leaves the previous
   * preview's handlers running against a torn-down world — two previews, one
   * keyboard. Idempotent.
   */
  readonly detach: Effect.Effect<void>
}

export class InputPort extends Context.Tag('@nerima-games/mc-playground-kit/InputPort')<
  InputPort,
  PreviewInputService
>() {}

/**
 * Everything a playground must be given.
 *
 * Named because it appears in `launchPlayground`'s requirements and reads far
 * better than a four-way union at every call site — and because it is the exact
 * list of parent repositories from plan.md §3.10 (mc-kernel supplies vocabulary,
 * not a service, and so is absent).
 */
export type PlaygroundPorts = WorldProviderPort | SimulationPort | RendererPort | InputPort
