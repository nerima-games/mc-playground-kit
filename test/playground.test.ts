/**
 * REGRESSION: the harness boots in causal order, tears down in reverse, and
 * relaunching is as clean as launching.
 *
 * plan.md §3.8 names deadlocks and leftover fibers on a SECOND world load as the
 * reference implementation's worst bug class, and plan.md §3.10 makes this
 * repository the one whose 起動速度と安定性 every other preview depends on. A
 * preview harness is the sharpest version of that problem: relaunching is what
 * it is FOR. So every test here that matters exercises a stop/start cycle — a
 * test that only ever launches once cannot see any of these bugs.
 *
 * ---------------------------------------------------------------------------
 * Why this runs in Node with no browser
 * ---------------------------------------------------------------------------
 *
 * `vitest.config.ts` fixes `environment: 'node'`, and the four heavyweight
 * surfaces are Ports (`application/preview-ports.ts`). plan.md §3.10's
 * carried-over knowledge is that the E2E environment is hostile — SwiftShader
 * software rendering, and no pointer lock at all
 * (`ts-minecraft/e2e/gameplay/player-controls.e2e.ts:208`). Boot order, teardown
 * order and relaunch safety are exactly the properties that must NOT be verified
 * there, because there they are verified slowly, flakily, and only in the
 * configurations a browser will produce.
 *
 * Time comes from an INJECTED clock backed by a `Ref` that the fake ports
 * advance as they do work. No wall clock is read anywhere, and no test waits for
 * real time to pass, so nothing here can flake on a loaded CI machine.
 */
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Layer, Option, Ref } from 'effect'
import { BOOT_PHASE_ORDER } from '../domain/boot-phase'
import { DEFAULT_FLAT_WORLD, DEFAULT_SPAWN_KIT, type PreviewModule } from '../domain/launch-options'
import {
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  MonotonicTimeSecs,
  StageId,
  WorldId,
  position,
  type CameraPoseSnapshot,
  type StageRegistration,
} from '../domain/kernel-vocabulary'
import { InputPort, RendererPort, SimulationPort, WorldProviderPort } from '../application/preview-ports'
import { FIRST_FRAME_DELTA_SECS, Playground, PlaygroundLayer, launchPlayground } from '../application/playground'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Seconds each port pretends to spend, so boot timings are deterministic. */
type PortCosts = {
  readonly world: number
  readonly simulation: number
  readonly renderer: number
  readonly input: number
  readonly frame: number
}

const CHEAP: PortCosts = { world: 0.05, simulation: 0.01, renderer: 0.02, input: 0.001, frame: 0.005 }

const POSE: CameraPoseSnapshot = {
  position: position(0, 51.62, 0),
  yawRadians: 0,
  pitchRadians: 0,
  capturedAtSecs: MonotonicTimeSecs(0),
}

/**
 * Every port, recording what it was asked to do and when.
 *
 * One shared event log across all four is the point: the ORDER in which
 * different repositories' surfaces are touched is what these tests are about,
 * and four separate logs could not express it.
 */
const makeFakes = (costs: PortCosts = CHEAP) =>
  Effect.gen(function* () {
    const events = yield* Ref.make<ReadonlyArray<string>>([])
    const nowSecs = yield* Ref.make(0)
    const framesRendered = yield* Ref.make(0)

    const record = (what: string): Effect.Effect<void> => Ref.update(events, (log) => [...log, what])
    const spend = (secs: number): Effect.Effect<void> => Ref.update(nowSecs, (value) => value + secs)
    const step = (what: string, secs: number): Effect.Effect<void> => record(what).pipe(Effect.zipRight(spend(secs)))

    const layer = Layer.mergeAll(
      Layer.succeed(ClockPort, {
        monotonicSecs: Ref.get(nowSecs).pipe(Effect.map(MonotonicTimeSecs)),
        wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
      }),
      Layer.succeed(WorldProviderPort, {
        openFlatWorld: (spec) => step(`world.open:${String(spec.worldId)}`, costs.world),
        closeWorld: step('world.close', 0),
      }),
      Layer.succeed(SimulationPort, {
        spawn: (kit) => step(`sim.spawn:y=${String(kit.feetPosition.y)}`, costs.simulation),
        tick: (_dt) => spend(costs.frame),
        cameraPose: Effect.succeed(POSE),
        stop: step('sim.stop', 0),
      }),
      Layer.succeed(RendererPort, {
        attach: step('renderer.attach', costs.renderer),
        renderFrame: (_dt, _pose) => Ref.update(framesRendered, (count) => count + 1),
        detach: step('renderer.detach', 0),
      }),
      Layer.succeed(InputPort, {
        attach: step('input.attach', costs.input),
        detach: step('input.detach', 0),
      }),
    )

    return { layer, events: Ref.get(events), framesRendered: Ref.get(framesRendered) }
  })

/** A stage that records each delta it is run with, and signals after `target` runs. */
const recordingStage = (id: string, target: number) =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<ReadonlyArray<number>>([])
    const reached = yield* Deferred.make<void>()

    const registration: StageRegistration = {
      id: StageId(id),
      run: (dt) =>
        Ref.updateAndGet(seen, (deltas) => [...deltas, dt]).pipe(
          Effect.flatMap((deltas) =>
            deltas.length >= target ? Deferred.succeed(reached, undefined) : Effect.succeed(false),
          ),
          Effect.asVoid,
        ),
    }

    return { seen: Ref.get(seen), reached, module: { frameStages: Effect.succeed([registration]) } satisfies PreviewModule }
  })

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

describe('boot', () => {
  it.effect('launchPlayground() with no arguments produces a live preview', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const handle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))

      expect(yield* handle.isRunning).toBe(true)
      expect(handle.options.world).toStrictEqual(DEFAULT_FLAT_WORLD)
      expect(handle.options.spawnKit).toStrictEqual(DEFAULT_SPAWN_KIT)
      // "Live" means pixels, not a promise of pixels: boot ends with one frame
      // already rendered, which is why `first-frame` is a budgeted phase.
      expect(yield* fakes.framesRendered).toBe(1)
      expect(yield* handle.framesRendered).toBe(1)

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('touches the parent repositories in causal order', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const handle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))

      expect(yield* fakes.events).toStrictEqual([
        'world.open:playground',
        'sim.spawn:y=50',
        'renderer.attach',
        'input.attach',
      ])

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('times every phase, in order, and judges the result', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const handle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))

      expect(handle.timings.map((entry) => entry.phase)).toStrictEqual([...BOOT_PHASE_ORDER])
      expect(handle.budget.missingPhases).toStrictEqual([])
      expect(handle.budget.withinBudget).toBe(true)
      // CHEAP costs: 50 + 10 + 20 + 1 + 5(frame) = 86ms of simulated work.
      expect(handle.budget.totalMillis).toBeCloseTo(86, 6)

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('REGRESSION: a slow world phase is reported, not absorbed', () =>
    Effect.gen(function* () {
      // The failure this repository exists to prevent: a preview that has
      // quietly become slow enough that nobody relaunches it.
      const fakes = yield* makeFakes({ ...CHEAP, world: 1.4 })
      const handle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))

      expect(handle.budget.withinBudget).toBe(false)
      expect(handle.budget.overrunPhases.map((overrun) => overrun.phase)).toStrictEqual(['world'])
      expect(handle.budget.overBudgetMillis).toBeGreaterThan(400)

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('the boot frame runs with the first-frame delta, not with zero', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const probe = yield* recordingStage('preview:tick', 1)

      const handle = yield* launchPlayground({ modules: [probe.module] }).pipe(Effect.provide(fakes.layer))

      expect(FIRST_FRAME_DELTA_SECS).toBe(0.016)
      expect(yield* probe.seen).toStrictEqual([0.016])

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('a partial options bag reaches the ports', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const handle = yield* launchPlayground({
        world: { worldId: WorldId('redstone-bench') },
        spawnKit: { feetPosition: position(0, 80, 0) },
      }).pipe(Effect.provide(fakes.layer))

      expect(yield* fakes.events).toContain('world.open:redstone-bench')
      expect(yield* fakes.events).toContain('sim.spawn:y=80')
      // Untouched fields still carry their defaults all the way through.
      expect(handle.options.world.surfaceY).toBe(DEFAULT_FLAT_WORLD.surfaceY)

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )
})

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

describe('frames', () => {
  it.effect('runs the caller stages every frame and draws afterwards', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const probe = yield* recordingStage('preview:tick', 3)

      const handle = yield* launchPlayground({ modules: [probe.module] }).pipe(Effect.provide(fakes.layer))

      yield* handle.submitFrame(DeltaTimeSecs(0.02))
      yield* handle.submitFrame(DeltaTimeSecs(0.03))
      yield* Deferred.await(probe.reached)

      expect(yield* probe.seen).toStrictEqual([0.016, 0.02, 0.03])
      expect(yield* fakes.framesRendered).toBe(3)

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('does no clamping of its own — mc-sim owns the delta clamp', () =>
    Effect.gen(function* () {
      // plan.md §3.8 / mc-sim/domain/frame-timing.ts own `min(max(0.001, raw),
      // 0.05)`. A second copy here would be a second thing to keep in sync, and
      // the symptom of divergence — the player walking through the floor after a
      // preview was backgrounded — would look like a physics bug. A 30-second
      // delta arriving here is passed straight through, because the preview's
      // frame driver was supposed to clamp it.
      const fakes = yield* makeFakes()
      const probe = yield* recordingStage('preview:tick', 2)

      const handle = yield* launchPlayground({ modules: [probe.module] }).pipe(Effect.provide(fakes.layer))
      yield* handle.submitFrame(DeltaTimeSecs(30))
      yield* Deferred.await(probe.reached)

      expect(yield* probe.seen).toStrictEqual([0.016, 30])

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('a stage DEFECT is logged and the pump keeps running', () =>
    Effect.gen(function* () {
      // catchAllCause, not catchAll: a thrown exception is a Cause.Die that
      // catchAll would let through, killing the pump on the first bad frame. A
      // preview whose window goes black on frame one teaches nothing.
      const fakes = yield* makeFakes()
      const calls = yield* Ref.make(0)
      const reached = yield* Deferred.make<void>()

      const exploding: PreviewModule = {
        frameStages: Effect.succeed([
          {
            id: StageId('preview:explodes'),
            run: () =>
              Ref.updateAndGet(calls, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  count >= 3
                    ? Deferred.succeed(reached, undefined).pipe(Effect.asVoid)
                    : Effect.sync(() => {
                        throw new Error(`stage exploded on frame ${String(count)}`)
                      }),
                ),
              ),
          },
        ]),
      }

      const handle = yield* launchPlayground({ modules: [exploding] }).pipe(Effect.provide(fakes.layer))
      yield* handle.submitFrame(DeltaTimeSecs(0.02))
      yield* handle.submitFrame(DeltaTimeSecs(0.02))
      yield* Deferred.await(reached)

      expect(yield* handle.isRunning).toBe(true)
      expect(yield* Ref.get(calls)).toBe(3)

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('the camera pose is read from the simulation, and cannot be written back', () =>
    Effect.gen(function* () {
      // plan.md §5.1-2: mc-sim owns the pose, mc-render mirrors it. A harness
      // sitting between the two is exactly where a convenient `setCameraPose`
      // would be added, and exactly where it would undo the fix.
      const fakes = yield* makeFakes()
      const handle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))

      expect(yield* handle.cameraPose).toStrictEqual(POSE)
      // There is no setter to call. `PlaygroundHandle` has these keys and no
      // others — a `setCameraPose` would have to appear here first.
      expect(Object.keys(handle).sort()).toStrictEqual([
        'budget',
        'cameraPose',
        'framesRendered',
        'isRunning',
        'options',
        'stageOrderWarnings',
        'stop',
        'submitFrame',
        'timings',
      ])

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )
})

// ---------------------------------------------------------------------------
// Teardown and relaunch — the reason this file exists
// ---------------------------------------------------------------------------

describe('teardown', () => {
  it.effect('REGRESSION: input is detached FIRST, before the renderer it fires into', () =>
    Effect.gen(function* () {
      // plan.md §3.9: 入力は `window` にキー登録. A window listener outlives
      // whatever added it, so the first thing a teardown must do is make the
      // outside world stop talking to a half-detached preview. The world goes
      // last, because it is the only participant that persists.
      const fakes = yield* makeFakes()
      const handle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))
      yield* handle.stop

      expect((yield* fakes.events).slice(4)).toStrictEqual([
        'input.detach',
        'renderer.detach',
        'sim.stop',
        'world.close',
      ])
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('stop() is idempotent, so a best-effort teardown may run twice', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const handle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))

      yield* handle.stop
      yield* handle.stop

      expect(yield* handle.isRunning).toBe(false)
      expect(yield* handle.framesRendered).toBe(0)
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('frames submitted after stop() are a silent no-op', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const handle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))
      yield* handle.stop

      // A stopped preview ignoring a stray requestAnimationFrame callback is the
      // correct behaviour. It must not throw, and it must not resurrect.
      yield* handle.submitFrame(DeltaTimeSecs(0.02))
      yield* handle.submitFrame(DeltaTimeSecs(0.02))

      expect(yield* handle.isRunning).toBe(false)
      expect(yield* fakes.framesRendered).toBe(1)
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('the service knows what it launched, and forgets it once stopped', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const playground = yield* Playground

      expect(Option.isNone(yield* playground.current)).toBe(true)
      const handle = yield* playground.launch().pipe(Effect.provide(fakes.layer))
      expect(Option.isSome(yield* playground.current)).toBe(true)

      yield* playground.stop
      expect(Option.isNone(yield* playground.current)).toBe(true)
      expect(yield* handle.isRunning).toBe(false)
    }).pipe(Effect.provide(PlaygroundLayer)),
  )
})

describe('relaunch', () => {
  it.effect('REGRESSION: a second launch tears the first down — the second-world-load bug', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const first = yield* recordingStage('first:tick', 1)
      const second = yield* recordingStage('second:tick', 1)

      const firstHandle = yield* launchPlayground({ modules: [first.module] }).pipe(Effect.provide(fakes.layer))
      yield* Deferred.await(first.reached)

      // Relaunch WITHOUT stopping first — exactly what a hot reload does.
      const secondHandle = yield* launchPlayground({ modules: [second.module] }).pipe(
        Effect.provide(fakes.layer),
      )

      expect(yield* firstHandle.isRunning).toBe(false)
      expect(yield* secondHandle.isRunning).toBe(true)

      // Every port was released before being re-acquired: the old preview did
      // not leave a renderer attached or a window listener registered.
      expect(yield* fakes.events).toStrictEqual([
        'world.open:playground',
        'sim.spawn:y=50',
        'renderer.attach',
        'input.attach',
        'input.detach',
        'renderer.detach',
        'sim.stop',
        'world.close',
        'world.open:playground',
        'sim.spawn:y=50',
        'renderer.attach',
        'input.attach',
      ])

      yield* secondHandle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('REGRESSION: no fiber from the first launch survives to see a second launch frame', () =>
    Effect.gen(function* () {
      // The leftover-fiber half of the bug class. The first launch's pump must
      // not process anything after it was superseded, and its queue must not
      // accept anything either — the two are separate failures and this checks
      // both: the stale handle sees no new deltas, and the fresh one sees its
      // own.
      const fakes = yield* makeFakes()
      const stale = yield* recordingStage('stale:tick', 1)
      const fresh = yield* recordingStage('fresh:tick', 2)

      const staleHandle = yield* launchPlayground({ modules: [stale.module] }).pipe(Effect.provide(fakes.layer))
      yield* Deferred.await(stale.reached)

      const freshHandle = yield* launchPlayground({ modules: [fresh.module] }).pipe(Effect.provide(fakes.layer))
      yield* staleHandle.submitFrame(DeltaTimeSecs(0.04))
      yield* freshHandle.submitFrame(DeltaTimeSecs(0.02))
      yield* Deferred.await(fresh.reached)

      // Only the boot frame. The 0.04 offered to the dead handle went nowhere.
      expect(yield* stale.seen).toStrictEqual([0.016])
      expect(yield* fresh.seen).toStrictEqual([0.016, 0.02])
      // Frame counting restarted: the second preview is a new world, not a
      // continuation of the first.
      expect(yield* staleHandle.framesRendered).toBe(0)
      expect(yield* freshHandle.framesRendered).toBe(2)

      yield* freshHandle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('REGRESSION: a late stop() on a superseded handle does not kill the live preview', () =>
    Effect.gen(function* () {
      // The reference's teardown ran under a timeout and could therefore finish
      // AFTER the next world had started. A stale handle's stop() arriving late
      // must be inert with respect to the current preview — otherwise the fix
      // for one relaunch bug becomes the cause of another.
      const fakes = yield* makeFakes()
      const staleHandle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))
      const liveHandle = yield* launchPlayground().pipe(Effect.provide(fakes.layer))
      const playground = yield* Playground

      yield* staleHandle.stop

      expect(yield* liveHandle.isRunning).toBe(true)
      expect(yield* playground.current).toStrictEqual(Option.some(liveHandle))

      yield* liveHandle.stop
      expect(yield* liveHandle.isRunning).toBe(false)
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('two Layer builds are two independent harnesses', () =>
    Effect.gen(function* () {
      // plan.md §3.8's DN-09 answer: do not be an app-scoped singleton, then you
      // need no `reset`. Two previews side by side in one process is a thing a
      // preview page legitimately wants, and it is what makes `Layer.effect`
      // (not `Layer.succeed`) the right call in application/playground.ts.
      const fakes = yield* makeFakes()

      const left = yield* launchPlayground().pipe(Effect.provide(fakes.layer), Effect.provide(PlaygroundLayer))
      const right = yield* launchPlayground().pipe(Effect.provide(fakes.layer), Effect.provide(PlaygroundLayer))

      expect(yield* left.isRunning).toBe(true)
      expect(yield* right.isRunning).toBe(true)

      yield* left.stop
      expect(yield* right.isRunning).toBe(true)
      yield* right.stop
    }),
  )
})

// ---------------------------------------------------------------------------
// Stage order
// ---------------------------------------------------------------------------

describe('stage order warnings', () => {
  it.effect('a well-ordered preview warns about nothing', () =>
    Effect.gen(function* () {
      const fakes = yield* makeFakes()
      const handle = yield* launchPlayground({
        modules: [{ frameStages: Effect.succeed([]) }],
      }).pipe(Effect.provide(fakes.layer))

      expect(handle.stageOrderWarnings).toStrictEqual([])

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )

  it.effect('surfaces a contradiction between the caller order and the caller constraints', () =>
    Effect.gen(function* () {
      // The harness runs stages in declaration order and does NOT resolve
      // `after` — mc-compose owns the total order (plan.md §2.3-3). Checking is
      // safe where resolving is not: this cannot make a preview disagree with
      // the shipped game, because it never chooses an order.
      const fakes = yield* makeFakes()
      const noop = (id: string, after?: ReadonlyArray<string>): StageRegistration => ({
        id: StageId(id),
        ...(after === undefined ? {} : { after: after.map(StageId) }),
        run: () => Effect.void,
      })

      const handle = yield* launchPlayground({
        modules: [{ frameStages: Effect.succeed([noop('render', ['sim']), noop('sim')]) }],
      }).pipe(Effect.provide(fakes.layer))

      expect(handle.stageOrderWarnings).toHaveLength(1)
      expect(String(handle.stageOrderWarnings[0]?.stage)).toBe('render')
      // A warning, not a failure: the preview still runs, because refusing to
      // boot would make the harness the thing that has to be debugged.
      expect(yield* handle.isRunning).toBe(true)

      yield* handle.stop
    }).pipe(Effect.provide(PlaygroundLayer)),
  )
})
