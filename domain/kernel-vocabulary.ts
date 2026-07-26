/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-kernel`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * plan.md §6 Step 3 publishes the repositories bottom-up: a repository is
 * published to GitHub Packages only once its interface has held still, and only
 * then may its consumers pin it. Nothing is published yet, so mc-playground-kit
 * cannot `import ... from '@nerima-games/mc-kernel'` — there is no package to
 * resolve, and `scripts/check-dependency-whitelist.ts` would in any case reject
 * an import of something absent from `package.json#dependencies`.
 *
 * Rather than invent a different vocabulary that would have to be reconciled
 * later, this file mirrors the handful of kernel declarations mc-playground-kit
 * actually uses, verbatim in shape and semantics, from
 * `mc-kernel/domain/{quantities,identifiers,coordinates,clock,camera,frame}.ts`.
 *
 * WHEN mc-kernel IS PUBLISHED:
 *   1. add `@nerima-games/mc-kernel` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './kernel-vocabulary'` at `'@nerima-games/mc-kernel'`.
 * Nothing else should need to change. If step 3 turns out not to typecheck,
 * this file has drifted and the drift is the bug.
 *
 * The mirror is deliberately MINIMAL — only what mc-playground-kit uses. A
 * larger mirror would be a larger thing to keep honest.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CLOCK PORT IS MIRRORED WHOLE, AGAINST THE "MINIMAL" RULE
 * ---------------------------------------------------------------------------
 *
 * `ClockPort` is a `Context.Tag`, and Effect resolves Tags by their TEXTUAL KEY
 * — `'@nerima-games/mc-kernel/ClockPort'`. Every mirror of it in every
 * repository therefore denotes the SAME service at runtime while being an
 * unrelated nominal type to TypeScript. A mirror that dropped a field would not
 * be "less of the vocabulary"; it would let a `Layer` built here satisfy a tag
 * that promises more, and the missing field would read `undefined` in a
 * repository that never saw this file.
 *
 * So this mirror carries kernel's `ClockService` verbatim — both fields, the
 * object-shaped `fixedClock` / `FixedClockLayer`, and therefore `EpochMillis`
 * too, even though nothing in this repository reads a wall clock.
 * `test/kernel-mirror.test.ts` pins that shape against kernel's documented one,
 * so the next divergence fails CI rather than a frame.
 */
import { Brand, Context, Effect, Layer } from 'effect'

// ---------------------------------------------------------------------------
// Quantities — mirrors mc-kernel/domain/quantities.ts
// ---------------------------------------------------------------------------

/**
 * Elapsed simulation time for one frame, in seconds. Finite and non-negative.
 * A zero delta is legal: a frame may be scheduled twice inside one clock tick.
 */
export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>

export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`DeltaTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A reading from a monotonic clock, in seconds. Never decreases; the origin is
 * unspecified, so only differences are meaningful. Comes from `ClockPort`.
 */
export type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>

export const MonotonicTimeSecs = Brand.refined<MonotonicTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`MonotonicTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A wall-clock reading: milliseconds since the Unix epoch. Only for values a
 * human reads or that must survive a save/load round trip — never for durations,
 * because it can jump in either direction.
 *
 * Mirrored solely so that `ClockService` below has kernel's real shape.
 */
export type EpochMillis = number & Brand.Brand<'EpochMillis'>

export const EpochMillis = Brand.refined<EpochMillis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`EpochMillis must be a safe integer number of milliseconds, received ${value}`),
)

// ---------------------------------------------------------------------------
// Identifiers — mirrors mc-kernel/domain/identifiers.ts
// ---------------------------------------------------------------------------

/** Identifies a single world (save). Non-blank. */
export type WorldId = string & Brand.Brand<'WorldId'>

export const WorldId = Brand.refined<WorldId>(
  (value) => value.trim().length > 0,
  (value) => Brand.error(`WorldId must be a non-blank string, received ${JSON.stringify(value)}`),
)

/**
 * Identifies a frame stage (plan.md §4.1). Stage ids are the vertices of the
 * per-frame ordering graph, so they must be stable across repositories: a module
 * may declare `after: [StageId('input')]` without importing whoever owns input.
 */
export type StageId = string & Brand.Brand<'StageId'>

export const StageId = Brand.refined<StageId>(
  (value) => value.trim().length > 0,
  (value) => Brand.error(`StageId must be a non-blank string, received ${JSON.stringify(value)}`),
)

// ---------------------------------------------------------------------------
// Coordinates — mirrors mc-kernel/domain/coordinates.ts (the continuous part)
// ---------------------------------------------------------------------------

/** A continuous world-space point. Y is up, 1 block = 1 unit. */
export type Position = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const position = (x: number, y: number, z: number): Position => ({ x, y, z })

// ---------------------------------------------------------------------------
// Clock Port — mirrors mc-kernel/domain/clock.ts
// ---------------------------------------------------------------------------

export type ClockService = {
  /** Monotonic reading. Only differences between readings are meaningful. */
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  /** Wall-clock reading. Never use for durations. */
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

export class ClockPort extends Context.Tag('@nerima-games/mc-kernel/ClockPort')<ClockPort, ClockService>() {}

/** Read the monotonic clock. The only sanctioned answer to "what time is it?". */
export const monotonicSecs: Effect.Effect<MonotonicTimeSecs, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.monotonicSecs,
)

/** A clock frozen at one instant. Platform-independent, hence shippable by kernel. */
export const fixedClock = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): ClockService => ({
  monotonicSecs: Effect.succeed(at.monotonicSecs),
  wallClockEpochMillis: Effect.succeed(at.wallClockEpochMillis),
})

/** `fixedClock` as a Layer, for deterministic tests and replays. */
export const FixedClockLayer = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): Layer.Layer<ClockPort> => Layer.succeed(ClockPort, fixedClock(at))

/** Read the wall clock. Only for human-facing or persisted values. */
export const wallClockEpochMillis: Effect.Effect<EpochMillis, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.wallClockEpochMillis,
)

// ---------------------------------------------------------------------------
// Camera pose — mirrors mc-kernel/domain/camera.ts
// ---------------------------------------------------------------------------

/**
 * The camera pose, as a value.
 *
 * plan.md §4.3 / §5.1-2: **mc-sim owns the truth and mc-render mirrors it.** The
 * type has no setter and must never grow one. This harness only ever *carries* a
 * snapshot from the simulation to whoever asks; it never produces one, and there
 * is no path through it by which a renderer could write one back.
 */
export type CameraPoseSnapshot = {
  readonly position: Position
  readonly yawRadians: number
  readonly pitchRadians: number
  readonly capturedAtSecs: MonotonicTimeSecs
}

/**
 * Age of a snapshot at a given instant, in seconds. Negative under clock skew,
 * which is a real condition (a worker stamping a pose ahead of the reader) and
 * is surfaced rather than clamped away.
 */
export const snapshotAgeSecs = (snapshot: CameraPoseSnapshot, now: MonotonicTimeSecs): number =>
  now - snapshot.capturedAtSecs

// ---------------------------------------------------------------------------
// Frame / module contract — mirrors mc-kernel/domain/frame.ts (plan.md §4.1)
// ---------------------------------------------------------------------------

/**
 * PLACEHOLDER in kernel, therefore a placeholder here.
 *
 * `FrameServices` is the context every frame stage may assume is present.
 * Kernel aliases it to `ClockPort` — the one service a stage provably needs —
 * pending the vertical-slice spike (`mc-kernel/docs/freeze-checklist.md`).
 */
export type FrameServices = ClockPort

/**
 * One unit of per-frame work, contributed by a repository.
 *
 * `after` declares ORDERING EDGES ONLY. It is not a dependency on the named
 * stage existing: a stage naming an absent stage is scheduled as if the edge
 * were absent, which is what lets a module say "run me after input, if there is
 * input" without depending on whoever owns input.
 *
 * Reproduced from plan.md §4.1 verbatim, `interface` and all.
 */
export interface StageRegistration {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
  readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>
}

/**
 * A repository's contribution to a running game.
 *
 * `ROut` — services this module provides.
 * `E`    — errors that can occur while BUILDING those services.
 * `RIn`  — services this module needs in order to build.
 *
 * Reproduced from plan.md §4.1 verbatim. `domain/launch-options.ts` records why
 * a playground consumes only the `frameStages` half of this contract.
 */
export interface GameModule<ROut, E, RIn> {
  readonly layers: Layer.Layer<ROut, E, RIn>
  readonly frameStages: ReadonlyArray<StageRegistration>
}
