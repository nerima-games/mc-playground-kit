/**
 * `launchPlayground` — the harness itself.
 *
 * plan.md §3.10 gives this repository one public entry point:
 *
 *   launchPlayground(options: {world?, spawnKit?, modules?}) → 起動済みミニゲーム
 *
 * and one reason to care about it:
 *
 *   全プレビューの開発体験がここの起動速度と安定性に依存する — 最も丁寧に作る部品
 *
 * Speed is `domain/boot-phase.ts`'s subject. This file is about the other half,
 * stability, which for a harness means exactly one thing: **relaunching must be
 * as clean as launching.** A preview is relaunched on every hot reload, every
 * parameter tweak, every screenshot run. If the tenth relaunch is not identical
 * to the first, the preview stops being evidence about the game and becomes
 * evidence about the harness.
 *
 * ---------------------------------------------------------------------------
 * The bug class this file is shaped around
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.8 records the reference implementation's worst bug class as
 * deadlocks and leftover fibers on a SECOND world load. `mc-sim`'s frame loop
 * is built against the same lesson, and the comments the reference eventually
 * had to write are quoted in full in `mc-sim/application/game-loop.ts`:
 *
 *   ts-minecraft/packages/game/application/game-loop.ts:141-148
 *     // Re-entrant: this service is an app-scoped singleton reused across
 *     // worlds, and its fibers are daemons that outlive session teardown.
 *     // A best-effort quit stop() can be cut off by its timeout, so rather
 *     // than fail "already running", tear down any lingering processing
 *     // fiber and start fresh ...
 *
 *   ts-minecraft/packages/game/application/game-loop.ts:198-201
 *     // interruptFork (not interrupt): a torn-down session's maintenance
 *     // fiber can take arbitrarily long to acknowledge interruption, and
 *     // awaiting it here left the second world stuck on the loading screen
 *     // forever (save & quit -> load hang).
 *
 * A preview harness is the sharpest possible version of this problem, because
 * relaunching is what it is FOR. So the same four rules apply here, from the
 * first commit rather than retrofitted:
 *
 * 1. THE FRAME PUMP IS A DAEMON. `Effect.forkDaemon`, not `Effect.fork`. A pump
 *    tied to the calling scope dies the moment a UI callback returns.
 * 2. TEARDOWN DETACHES BEFORE IT INTERRUPTS, and uses `Fiber.interruptFork`. A
 *    `stop` that is itself cut short still leaves nothing reachable, and a slow
 *    fiber can never block the next launch.
 * 3. `launch` IS RE-ENTRANT. Launching while running is not an error; it tears
 *    the previous playground down and stands a fresh one up.
 * 4. EACH LAUNCH OWNS ITS OWN STATE. The queue, the frame counter and the
 *    running flag are created per launch and captured by that generation's
 *    daemon. A straggler that has not yet noticed it was interrupted writes into
 *    its own detached state, which nothing will ever read.
 *
 * ---------------------------------------------------------------------------
 * Why this is a service and not a bare function
 * ---------------------------------------------------------------------------
 *
 * Rule 3 needs somewhere for "the previous playground" to live. A free function
 * cannot tear down a launch it was never told about, so `launchPlayground` goes
 * through the `Playground` Tag, and the thing that makes relaunch safe is
 * precisely that the harness is addressable. This mirrors `mc-sim`'s
 * `makeGameLoop` / `GameLoop` / `GameLoopLayer` triple, deliberately: two
 * repositories solving the same lifecycle problem two different ways is how the
 * next 2周目 deadlock gets in.
 *
 * `makePlayground` is also exported, because plan.md §3.9's DN-09 answer is "do
 * not be a singleton in the first place" — two playgrounds side by side in one
 * process is a thing a preview page legitimately wants.
 */
import { Cause, Context, Effect, Fiber, Layer, Option, Queue, Ref } from 'effect'
import {
  classifyBootTimings,
  describeBootVerdict,
  elapsedMillis,
  type BootBudgetVerdict,
  type BootPhase,
  type PhaseTiming,
} from '../domain/boot-phase'
import {
  flattenedStageOrderViolations,
  flattenStages,
  normalizeLaunchOptions,
  type LaunchOptions,
  type ResolvedLaunchOptions,
  type StageOrderViolation,
} from '../domain/launch-options'
import {
  ClockPort,
  DeltaTimeSecs,
  type CameraPoseSnapshot,
  type ClockService,
  type StageRegistration,
} from '../domain/kernel-vocabulary'
import {
  InputPort,
  RendererPort,
  SimulationPort,
  WorldProviderPort,
  type PlaygroundPorts,
  type PreviewInputService,
  type RendererService,
  type SimulationService,
  type WorldProviderService,
} from './preview-ports'

/**
 * Frames the dropping queue holds before it discards.
 *
 * Same capacity and same discipline as `mc-sim/application/game-loop.ts`:
 * DROPPING, not backpressured. Under load the right behaviour is to lose frames
 * rather than to accumulate a backlog the simulation then replays in
 * fast-forward — and a backpressured queue would additionally block the caller,
 * which in a browser is the `requestAnimationFrame` callback itself.
 */
export const FRAME_QUEUE_CAPACITY = 60

/**
 * The delta the boot path's own first frame is run with.
 *
 * There is no previous frame to subtract from, so there is no delta to compute.
 * `0.016` is one frame at 60 Hz — a fiction, but a bounded and reproducible one,
 * and the same fiction the reference and mc-sim already tell:
 *
 *   ts-minecraft/packages/core/domain/constants.ts:9
 *     export const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs = DeltaTimeSecs.make(0.016)
 *   mc-sim/domain/frame-timing.ts:48
 *
 * PROVISIONAL, like `domain/kernel-vocabulary.ts`: when mc-sim is published this
 * constant is deleted and imported from there instead. Note what is NOT
 * duplicated — `clampFrameDelta` itself. See `submitFrame` below.
 */
export const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs = DeltaTimeSecs(0.016)

/**
 * A running preview.
 *
 * `options`, `timings`, `budget` and `stageOrderWarnings` are plain values, not
 * Effects: boot is finished by the time a handle exists, so they cannot change
 * and there is nothing to suspend. Everything that can still change is an
 * Effect.
 */
export type PlaygroundHandle = {
  /** Every default filled in. What actually booted, not what was asked for. */
  readonly options: ResolvedLaunchOptions
  /** One entry per boot phase, in the order the phases ran. */
  readonly timings: ReadonlyArray<PhaseTiming>
  /** The budget verdict for `timings`. Also logged at launch. */
  readonly budget: BootBudgetVerdict
  /**
   * Stages declared before a stage they said they must follow.
   *
   * Warnings, not errors: this harness runs stages in declaration order and does
   * not resolve `after` (`domain/launch-options.ts`). A non-empty list means the
   * preview is running in an order its own author's constraints contradict, so
   * whatever it demonstrates is not evidence about the shipped game.
   */
  readonly stageOrderWarnings: ReadonlyArray<StageOrderViolation>
  /**
   * Offer one frame's delta. A silent no-op once stopped.
   *
   * Takes a DELTA, not a timestamp, and therefore does no clamping. mc-sim owns
   * frame pacing and the `min(max(0.001, raw), 0.05)` clamp (plan.md §3.8;
   * `mc-sim/domain/frame-timing.ts`), and that clamp is the difference between a
   * tab-refocus running the simulation slow and running it through a wall. A
   * second copy here would be a second thing to keep in sync, and the symptom of
   * divergence — the player falling through the floor after a preview was
   * backgrounded — would look like a physics bug. The preview's frame driver
   * (`requestAnimationFrame` in a browser, a loop in a test) clamps once, with
   * mc-sim's function, and passes the result here.
   */
  readonly submitFrame: (dt: DeltaTimeSecs) => Effect.Effect<void>
  /** Frames this launch's pump has completed. Zero once stopped. */
  readonly framesRendered: Effect.Effect<number>
  /** The pose mc-sim published. Read-only, and there is no way to write one back. */
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot>
  readonly isRunning: Effect.Effect<boolean>
  /** Tear down. Never blocks on a slow fiber. Idempotent. */
  readonly stop: Effect.Effect<void>
}

export type PlaygroundApi = {
  /**
   * Boot a preview. Safe to call while one is already running: the previous
   * playground is torn down first. See rule 3 in the module header.
   */
  readonly launch: (
    options?: LaunchOptions | undefined,
  ) => Effect.Effect<PlaygroundHandle, never, ClockPort | PlaygroundPorts>
  /** The playground this service last launched, if it is still running. */
  readonly current: Effect.Effect<Option.Option<PlaygroundHandle>>
  /** Tear down whatever is running. Idempotent. */
  readonly stop: Effect.Effect<void>
}

export class Playground extends Context.Tag('@nerima-games/mc-playground-kit/Playground')<
  Playground,
  PlaygroundApi
>() {}

// ---------------------------------------------------------------------------
// One launch's worth of state
// ---------------------------------------------------------------------------

/** Created per launch, detached wholesale by `stop`. See rule 4. */
type Generation = {
  readonly queue: Queue.Queue<DeltaTimeSecs>
  readonly frames: Ref.Ref<number>
  readonly running: Ref.Ref<boolean>
  readonly fiber: Ref.Ref<Option.Option<Fiber.RuntimeFiber<void, never>>>
}

/** Take ownership of an optional resource and clear the slot in one atomic step. */
const detach = <A>(ref: Ref.Ref<Option.Option<A>>): Effect.Effect<Option.Option<A>> =>
  Ref.getAndSet(ref, Option.none())

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

type BootServices = {
  readonly clock: ClockService
  readonly world: WorldProviderService
  readonly simulation: SimulationService
  readonly renderer: RendererService
  readonly input: PreviewInputService
}

/**
 * Run one frame: simulate, then the caller's stages, then draw.
 *
 * The order is the skeleton of plan.md §4.2's standard stage order
 * (`input → simulation → ... → camera-mirror → render`) with everything a
 * preview does not have removed. `camera-mirror` is the `cameraPose` read
 * between the two: the pose is fetched from the authority AFTER simulation and
 * handed to the renderer, never the other way round (plan.md §5.1-2).
 *
 * `catchAllCause`, not `catchAll`: a thrown exception inside a stage surfaces as
 * `Cause.Die`, which `catchAll` would miss and let kill the pump. A preview
 * whose window goes black on the first bad frame teaches nothing; one that keeps
 * drawing and logs the defect is debuggable. Same call as
 * `mc-sim/application/game-loop.ts` and `ts-minecraft/packages/game/application/game-loop.ts:123-125`.
 */
const runOneFrame = (
  services: BootServices,
  stages: ReadonlyArray<StageRegistration>,
  dt: DeltaTimeSecs,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* services.simulation.tick(dt)
    yield* Effect.forEach(stages, (stage) => stage.run(dt), { discard: true }).pipe(
      Effect.provideService(ClockPort, services.clock),
    )
    const pose = yield* services.simulation.cameraPose
    yield* services.renderer.renderFrame(dt, pose)
  }).pipe(Effect.catchAllCause((cause) => Effect.logError(`Playground frame error: ${Cause.pretty(cause)}`)))

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export const makePlayground: Effect.Effect<PlaygroundApi> = Effect.gen(function* () {
  // Two slots for one thing, because they are cleared at different moments:
  // `generationRef` is what a launch checks to decide whether it is still the
  // current one, and `handleRef` is what an outside caller stops.
  const generationRef = yield* Ref.make<Option.Option<Generation>>(Option.none())
  const handleRef = yield* Ref.make<Option.Option<PlaygroundHandle>>(Option.none())

  /**
   * Stop one generation's frame pump.
   *
   * Detach BEFORE interrupting (rule 2). A `stop` abandoned partway through then
   * leaves nothing reachable for the next `launch` to trip over — which is
   * exactly the state the reference reached when its best-effort quit step timed
   * out mid-teardown.
   */
  const stopGeneration = (generation: Generation): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Ref.set(generation.running, false)
      const fiber = yield* detach(generation.fiber)
      // interruptFork, never interrupt: awaiting a fiber suspended inside a
      // renderer call is how the next launch deadlocks.
      yield* Option.match(fiber, {
        onNone: () => Effect.void,
        onSome: (running) => Fiber.interruptFork(running),
      })
      yield* Queue.shutdown(generation.queue)
    })

  /**
   * Stop whatever this service last launched — pump AND ports.
   *
   * Delegating to the handle rather than reimplementing teardown is what makes
   * `playground.stop` and `handle.stop` provably the same operation. Two
   * teardown paths is one teardown path plus a way for them to disagree.
   */
  const stopCurrent: Effect.Effect<void> = Ref.get(handleRef).pipe(
    Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (handle) => handle.stop })),
  )

  const launch = (
    options?: LaunchOptions | undefined,
  ): Effect.Effect<PlaygroundHandle, never, ClockPort | PlaygroundPorts> =>
    Effect.gen(function* () {
      // Re-entrant (rule 3). Not "fail if already running": a teardown that can
      // be cut short means "already running" is a state the caller cannot
      // reliably escape, so the only useful answer is to escape it for them.
      yield* stopCurrent

      const services: BootServices = {
        clock: yield* ClockPort,
        world: yield* WorldProviderPort,
        simulation: yield* SimulationPort,
        renderer: yield* RendererPort,
        input: yield* InputPort,
      }

      const timingsRef = yield* Ref.make<ReadonlyArray<PhaseTiming>>([])

      /** Time one phase and record it. Every phase in `BOOT_PHASE_ORDER` goes through here. */
      const phase = <A>(name: BootPhase, work: Effect.Effect<A>): Effect.Effect<A> =>
        Effect.gen(function* () {
          const startedAt = yield* services.clock.monotonicSecs
          const result = yield* work
          const finishedAt = yield* services.clock.monotonicSecs
          yield* Ref.update(timingsRef, (recorded) => [
            ...recorded,
            { phase: name, durationMillis: elapsedMillis(startedAt, finishedAt) },
          ])
          return result
        })

      // --- The boot sequence. Order is causal; see domain/boot-phase.ts. ------
      const resolved = yield* phase(
        'resolve-options',
        Effect.sync(() => normalizeLaunchOptions(options)),
      )
      yield* phase('world', services.world.openFlatWorld(resolved.world))
      yield* phase('simulation', services.simulation.spawn(resolved.spawnKit))
      yield* phase('renderer', services.renderer.attach)
      yield* phase('input', services.input.attach)
      // ONE evaluation of `frameStages`, and it happens here, inside the phase
      // that is supposed to be measuring it.
      //
      // `frameStages` is an Effect so that a module can acquire a service or
      // allocate a `Ref` in order to build its stages, which makes a second
      // evaluation a second, DISTINCT set of `StageRegistration`s. Deriving the
      // stage-order warnings from `stageOrderViolations(resolved.modules)` did
      // exactly that: it re-ran every module and reported on stages the pump
      // would never run, and it paid the registration cost a second time
      // OUTSIDE `phase()`, which under-reported the one number this repository
      // exists to produce. `flattenedStageOrderViolations` is pure and takes the
      // array below, so both problems are gone by construction.
      const stages = yield* phase('modules', flattenStages(resolved.modules))
      // One frame end to end, so that a handle is a LIVE preview rather than a
      // promise of one. Without this the budget would stop measuring one step
      // before the thing the developer is actually waiting for: pixels.
      yield* phase('first-frame', runOneFrame(services, stages, FIRST_FRAME_DELTA_SECS))

      const timings = yield* Ref.get(timingsRef)
      const budget = classifyBootTimings(timings)
      const warnings = flattenedStageOrderViolations(stages)

      // --- Install this launch's generation ----------------------------------
      const generation: Generation = {
        queue: yield* Queue.dropping<DeltaTimeSecs>(FRAME_QUEUE_CAPACITY),
        frames: yield* Ref.make(1), // the boot frame above already ran
        running: yield* Ref.make(true),
        fiber: yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, never>>>(Option.none()),
      }

      const pump = Queue.take(generation.queue).pipe(
        Effect.flatMap((dt) => runOneFrame(services, stages, dt)),
        Effect.flatMap(() => Ref.update(generation.frames, (count) => count + 1)),
        Effect.forever,
      )

      yield* Ref.set(generationRef, Option.some(generation))
      const fiber = yield* Effect.forkDaemon(pump)
      yield* Ref.set(generation.fiber, Option.some(fiber))

      /**
       * Teardown, in the REVERSE of boot order, and never partial.
       *
       * Input first: plan.md §3.9 registers key handlers on `window`, and a
       * `window` listener outlives whatever added it. A listener still firing
       * into a half-detached renderer is the relaunch crash, so the very first
       * thing a teardown does is make the outside world stop talking to it.
       * The world is released last because it is the only participant that
       * persists — releasing it while the simulation is still ticking is how a
       * preview's last autosave writes a world that no longer exists.
       *
       * Every port's teardown runs even if an earlier one fails: a best-effort
       * teardown that gives up halfway is the reference's timed-out quit step,
       * which is what made re-entrancy necessary in the first place.
       *
       * -------------------------------------------------------------------
       * Only the CURRENT generation may touch the ports
       * -------------------------------------------------------------------
       *
       * `stopGeneration` is unconditional because it touches nothing but this
       * launch's OWN state (rule 4). Everything after it is shared, and shared
       * includes the four ports: `services` was resolved from the caller's
       * Layer (see the `BootServices` block above), so a relaunch that resolved
       * the same Layer is holding the SAME four objects. A superseded handle
       * that detached them would unregister the live preview's input listeners,
       * detach its renderer, stop its simulation and close its world — while
       * `isRunning`, `current` and `framesRendered` all still read healthy,
       * because none of them is derived from a port.
       *
       * That is not a hypothetical ordering. The whole reason `stop` is
       * best-effort and `launch` is re-entrant (see rule 3 and the module
       * header) is that the reference's quit step could be cut off by its
       * timeout and finish AFTER the next world had started.
       *
       * The claim is a single atomic `Ref.modify` rather than a get-then-set,
       * so two concurrent `stop`s on the same handle cannot both win it — which
       * is also what makes `stop` idempotent in the ports, not merely in the
       * flags.
       */
      const teardown: Effect.Effect<void> = Effect.gen(function* () {
        yield* stopGeneration(generation)
        const claimed = yield* Ref.modify(generationRef, (installed) =>
          Option.isSome(installed) && installed.value === generation
            ? [true, Option.none<Generation>()]
            : [false, installed],
        )
        // A relaunch has already replaced this generation, or an earlier stop()
        // already ran: either way the ports and the shared slots belong to
        // somebody else now, and a late stop() must be inert with respect to
        // them.
        if (!claimed) {
          return
        }
        yield* Ref.set(handleRef, Option.none())
        yield* Effect.forEach(
          [services.input.detach, services.renderer.detach, services.simulation.stop, services.world.closeWorld],
          (step) => step.pipe(Effect.catchAllCause((cause) => Effect.logError(`Playground teardown: ${Cause.pretty(cause)}`))),
          { discard: true },
        )
      })

      yield* Effect.logInfo(`playground: ${describeBootVerdict(budget)}`)
      yield* Effect.forEach(warnings, (violation) =>
        Effect.logWarning(
          `playground: stage ${violation.stage} runs at index ${String(violation.declaredIndex)} but declared after ` +
            `${violation.mustFollow}, which is at index ${String(violation.constraintIndex)}. ` +
            'This harness runs stages in declaration order and does not resolve `after` — mc-compose owns the total order.',
        ),
        { discard: true },
      )

      const handle: PlaygroundHandle = {
        options: resolved,
        timings,
        budget,
        stageOrderWarnings: warnings,
        submitFrame: (dt) =>
          Ref.get(generation.running).pipe(
            Effect.flatMap((running) =>
              running ? Queue.offer(generation.queue, dt).pipe(Effect.asVoid) : Effect.void,
            ),
          ),
        framesRendered: Ref.get(generation.running).pipe(
          Effect.flatMap((running) => (running ? Ref.get(generation.frames) : Effect.succeed(0))),
        ),
        cameraPose: services.simulation.cameraPose,
        isRunning: Ref.get(generation.running),
        stop: teardown,
      }

      yield* Ref.set(handleRef, Option.some(handle))
      return handle
    })

  return {
    launch,
    current: Ref.get(handleRef),
    stop: stopCurrent,
  }
})

/**
 * A `Playground` per Layer build.
 *
 * `Layer.effect`, not `Layer.succeed`: each build gets its own generation slot,
 * so two Layer builds are two independent harnesses. plan.md §3.8's DN-09
 * answer — "do not be an app-scoped singleton, then you need no `reset`" —
 * applies with particular force to the repository whose job is relaunching.
 */
export const PlaygroundLayer: Layer.Layer<Playground> = Layer.effect(Playground, makePlayground)

/**
 * plan.md §3.10's named entry point.
 *
 * `launchPlayground(options) → 起動済みミニゲーム`, routed through the
 * `Playground` service so that a second call tears the first preview down — see
 * "Why this is a service" in the module header.
 */
export const launchPlayground = (
  options?: LaunchOptions | undefined,
): Effect.Effect<PlaygroundHandle, never, Playground | ClockPort | PlaygroundPorts> =>
  Effect.flatMap(Playground, (playground) => playground.launch(options))
