/**
 * The driver: four fake Ports whose cost the operator programs, and the real
 * `Playground` service on top of them.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Why the fakes live here and not in `application/preview-ports.ts`
 * ---------------------------------------------------------------------------
 *
 * `application/preview-ports.ts` is four `Context.Tag`s and their service types,
 * with no `Layer.succeed` anywhere, and that absence is the design (its header
 * says so). A fake shipped from the package would be a fake every consumer could
 * accidentally build a preview on, and a preview standing on a fake renderer
 * that draws nothing is a preview that passes.
 *
 * So the fakes are here, in a dev app, where nothing can import them.
 *
 * ---------------------------------------------------------------------------
 * The clock is a ledger, not a clock
 * ---------------------------------------------------------------------------
 *
 * `ClockPort.monotonicSecs` is backed by a counter this module advances by
 * whatever the fixture says the phase should cost. That is the whole reason the
 * boot budget is measurable now: "the world phase took 400 ms" becomes a fact
 * about the fixture rather than about the machine, and `--stats` produces the
 * same numbers on a laptop and in CI.
 *
 * `Date.now()` / `new Date()` / `performance.now()` appear nowhere in this app,
 * and the `mc-kernel-allow-time-source` escape hatch is not used.
 */
import { Effect, Layer, Logger, Option, Ref } from 'effect'
import {
  Playground,
  PlaygroundLayer,
  type PlaygroundApi,
  type PlaygroundHandle,
} from '../../application/playground'
import {
  InputPort,
  RendererPort,
  SimulationPort,
  WorldProviderPort,
} from '../../application/preview-ports'
import { BOOT_PHASE_ORDER, type BootPhase, type PhaseTiming } from '../../domain/boot-phase'
import type { PreviewModule, StageOrderViolation } from '../../domain/launch-options'
// `domain/kernel-vocabulary.ts` is NOT re-exported from `index.ts` — a consumer
// must take that vocabulary from mc-kernel, and a dev app inside this repository
// is the only thing that may reach for the local mirror directly. See the
// header of that file, and index.ts:44-51.
import {
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  MonotonicTimeSecs,
  position,
  StageId,
  type CameraPoseSnapshot,
} from '../../domain/kernel-vocabulary'
import { scenarioFor, stepAt, type Command, type PortFixture, type ScenarioName } from './script'

const FROZEN_WALL_CLOCK = EpochMillis(1_700_000_000_000)

/** One recorded call into a Port, in the order it happened. */
export type PortCall = {
  readonly seq: number
  readonly port: 'world' | 'simulation' | 'renderer' | 'input'
  readonly method: string
  /** The injected clock reading when it happened, in milliseconds. */
  readonly atMillis: number
  readonly failed: boolean
}

export type LaunchRecord = {
  readonly index: number
  readonly timings: ReadonlyArray<PhaseTiming>
  readonly totalMillis: number
  readonly withinBudget: boolean
  readonly overrunPhases: ReadonlyArray<{
    readonly phase: BootPhase
    readonly durationMillis: number
    readonly budgetMillis: number
    readonly overByMillis: number
  }>
  readonly missingPhases: ReadonlyArray<BootPhase>
  readonly stageOrderWarnings: ReadonlyArray<StageOrderViolation>
  readonly stageIds: ReadonlyArray<string>
}

export type HarnessView = {
  readonly step: number
  readonly lastCommand: string

  readonly launches: number
  readonly current: LaunchRecord | undefined
  readonly history: ReadonlyArray<LaunchRecord>

  readonly isRunning: boolean
  readonly currentIsSome: boolean
  readonly framesSubmitted: number
  readonly framesRendered: number
  readonly cameraPose: CameraPoseSnapshot | undefined

  readonly clockMillis: number
  readonly calls: ReadonlyArray<PortCall>
  /** Ports the LIVE preview has had torn down under it by a stale handle. */
  readonly ghostTeardowns: ReadonlyArray<string>
  /** The `seq` of each such call, so the ledger marks the call and not the name. */
  readonly ghostSeqs: ReadonlyArray<number>

  /** How many times each module's `frameStages` Effect has been evaluated. */
  readonly frameStagesEvaluations: number

  readonly log: ReadonlyArray<string>
}

export type HarnessConfig = {
  readonly scenario: ScenarioName
}

export type Harness = {
  readonly config: HarnessConfig
  readonly advance: (steps: number) => Promise<void>
  readonly view: () => Promise<HarnessView>
}

const LOG_LIMIT = 10
const CALL_LIMIT = 24

/** A teardown step the fixture makes fail. */
class FixtureFailure extends Error {
  constructor(what: string) {
    super(`fixture: ${what} refuses`)
    this.name = 'FixtureFailure'
  }
}

const modulesFor = (
  kind: PortFixture['modules'],
  count: Ref.Ref<number>,
): ReadonlyArray<PreviewModule> => {
  const tally = <A>(value: A): Effect.Effect<A> =>
    Ref.update(count, (seen) => seen + 1).pipe(Effect.as(value))

  switch (kind) {
    case 'none':
      return []
    case 'one':
      return [
        {
          frameStages: tally([
            { id: StageId('preview:camera'), run: () => Effect.void },
            { id: StageId('preview:draw'), after: [StageId('preview:camera')], run: () => Effect.void },
          ]),
        },
      ]
    case 'contradiction':
      // Declared draw-then-camera, while declaring that draw runs AFTER camera.
      return [
        {
          frameStages: tally([
            { id: StageId('preview:draw'), after: [StageId('preview:camera')], run: () => Effect.void },
            { id: StageId('preview:camera'), run: () => Effect.void },
            // An `after` naming an absent stage is deliberately NOT a violation
            // (mc-kernel/domain/frame.ts:46-54): a preview is by construction a
            // subset of the game, so "after input, if there is input" must be
            // sayable. This edge is here to prove the checker stays quiet.
            { id: StageId('preview:hud'), after: [StageId('game:input')], run: () => Effect.void },
          ]),
        },
      ]
    case 'stateful':
      // A module that allocates per-launch state inside its registration Effect,
      // which is the shape `frameStages` became an Effect in order to allow.
      return [
        {
          frameStages: Effect.gen(function* () {
            yield* Ref.update(count, (seen) => seen + 1)
            const drawn = yield* Ref.make(0)
            return [
              {
                id: StageId('preview:stateful'),
                run: () => Ref.update(drawn, (value) => value + 1),
              },
            ]
          }),
        },
      ]
    default:
      return []
  }
}

export const makeHarness = async (config: HarnessConfig): Promise<Harness> => {
  const scenario = scenarioFor(config.scenario)

  let step = 0
  let lastCommand = '(nothing yet)'
  let seq = 0
  let framesSubmitted = 0
  let launches = 0
  const calls: Array<PortCall> = []
  const log: Array<string> = []
  const history: Array<LaunchRecord> = []
  const ghostTeardowns: Array<string> = []
  const ghostSeqs: Array<number> = []

  /** Set while a stale handle's teardown is running, so its calls are attributable. */
  let staleTeardownRunning = false

  const state = await Effect.runPromise(
    Effect.gen(function* () {
      return {
        clockMillis: yield* Ref.make(0),
        stageEvaluations: yield* Ref.make(0),
      }
    }),
  )

  const note = (text: string): void => {
    log.push(text)
    if (log.length > LOG_LIMIT) {
      log.splice(0, log.length - LOG_LIMIT)
    }
  }

  const chargeMillis = (millis: number): Effect.Effect<void> =>
    millis === 0 ? Effect.void : Ref.update(state.clockMillis, (value) => value + millis)

  const record = (
    port: PortCall['port'],
    method: string,
    failed: boolean,
  ): Effect.Effect<void> =>
    Ref.get(state.clockMillis).pipe(
      Effect.map((atMillis) => {
        seq += 1
        calls.push({ seq, port, method, atMillis, failed })
        if (calls.length > CALL_LIMIT) {
          calls.splice(0, calls.length - CALL_LIMIT)
        }
        if (staleTeardownRunning) {
          ghostTeardowns.push(`${port}.${method}`)
          ghostSeqs.push(seq)
        }
      }),
    )

  const cost = (phase: BootPhase): number => scenario.fixture.costMillis[phase] ?? 0

  const teardownStep = (
    port: PortCall['port'],
    method: string,
  ): Effect.Effect<void> =>
    record(port, method, scenario.fixture.failingTeardown.includes(port)).pipe(
      Effect.zipRight(
        scenario.fixture.failingTeardown.includes(port)
          ? Effect.sync(() => {
              throw new FixtureFailure(`${port}.${method}`)
            })
          : Effect.void,
      ),
    )

  const poseRef = await Effect.runPromise(Ref.make<CameraPoseSnapshot | undefined>(undefined))

  const fakes = Layer.mergeAll(
    Layer.succeed(ClockPort, {
      monotonicSecs: Ref.get(state.clockMillis).pipe(
        Effect.map((millis) => MonotonicTimeSecs(millis / 1000)),
      ),
      // Frozen, and deliberately unrelated to the monotonic one: the wall clock
      // is not a second monotonic clock, and letting the two move together would
      // hide any code that measured a duration with it.
      wallClockEpochMillis: Effect.succeed(FROZEN_WALL_CLOCK),
    }),
    Layer.succeed(WorldProviderPort, {
      openFlatWorld: () => chargeMillis(cost('world')).pipe(Effect.zipRight(record('world', 'openFlatWorld', false))),
      closeWorld: teardownStep('world', 'closeWorld'),
    }),
    Layer.succeed(SimulationPort, {
      spawn: () => chargeMillis(cost('simulation')).pipe(Effect.zipRight(record('simulation', 'spawn', false))),
      tick: () => record('simulation', 'tick', false),
      cameraPose: Effect.succeed({
        position: position(0, 50, 0),
        yawRadians: 0,
        pitchRadians: 0,
        capturedAtSecs: MonotonicTimeSecs(0),
      }),
      stop: teardownStep('simulation', 'stop'),
    }),
    Layer.succeed(RendererPort, {
      attach: chargeMillis(cost('renderer')).pipe(Effect.zipRight(record('renderer', 'attach', false))),
      renderFrame: () => record('renderer', 'renderFrame', false),
      detach: teardownStep('renderer', 'detach'),
    }),
    Layer.succeed(InputPort, {
      attach: chargeMillis(cost('input')).pipe(Effect.zipRight(record('input', 'attach', false))),
      detach: teardownStep('input', 'detach'),
    }),
    PlaygroundLayer,
    // The harness logs its boot verdict and its stage-order warnings through
    // Effect's logger. Letting those reach stdout would make `--once` unpipeable
    // and would put them where a person reading the panels is not looking, so
    // they are routed into this app's own log panel instead. That is also the
    // only way to SEE that a stage-order violation is reported by `logWarning`
    // and not by anything the caller is obliged to read.
    Logger.replace(
      Logger.defaultLogger,
      Logger.make(({ logLevel, message }) => {
        note(`[${logLevel.label}] ${String(message)}`)
      }),
    ),
  )

  const playground: PlaygroundApi = await Effect.runPromise(
    Effect.flatMap(Playground, (api) => Effect.succeed(api)).pipe(Effect.provide(fakes)),
  )

  // A handle deliberately kept from before the last relaunch.
  let staleHandle: PlaygroundHandle | undefined
  let liveHandle: PlaygroundHandle | undefined

  const recordLaunch = (handle: PlaygroundHandle): void => {
    launches += 1
    history.push({
      index: launches,
      timings: handle.timings,
      totalMillis: handle.budget.totalMillis,
      withinBudget: handle.budget.withinBudget,
      overrunPhases: handle.budget.overrunPhases.map((overrun) => ({
        phase: overrun.phase,
        durationMillis: overrun.durationMillis,
        budgetMillis: overrun.budgetMillis,
        overByMillis: overrun.overByMillis,
      })),
      missingPhases: handle.budget.missingPhases,
      stageOrderWarnings: handle.stageOrderWarnings,
      stageIds: [],
    })
  }

  const doLaunch = (isRelaunch: boolean): Effect.Effect<void> =>
    Effect.gen(function* () {
      // `resolve-options`, `modules` and `first-frame` are charged around the
      // library's own calls rather than inside a Port, because no Port is
      // involved in them.
      yield* chargeMillis(cost('resolve-options'))
      const modules = modulesFor(scenario.fixture.modules, state.stageEvaluations)
      const handle = yield* playground.launch({ modules })
      yield* chargeMillis(cost('first-frame'))
      if (isRelaunch && liveHandle !== undefined) {
        staleHandle = liveHandle
      }
      liveHandle = handle
      yield* Ref.set(poseRef, yield* handle.cameraPose)
      recordLaunch(handle)
      note(
        `launch #${String(launches)} — boot ${handle.budget.totalMillis.toFixed(1)} ms, ` +
          `${handle.budget.withinBudget ? 'within' : 'OVER'} budget, ` +
          `${String(handle.stageOrderWarnings.length)} stage warning(s)`,
      )
    }).pipe(Effect.provide(fakes))

  const runCommand = (command: Command): Effect.Effect<void> => {
    switch (command.kind) {
      case 'launch':
      case 'relaunch':
        return doLaunch(command.kind === 'relaunch')

      case 'submitFrames':
        return liveHandle === undefined
          ? Effect.sync(() => {
              note('submitFrame with no live handle — nothing to submit to')
            })
          : Effect.forEach(
              Array.from({ length: command.count }, () => DeltaTimeSecs(0.016)),
              (dt) => (liveHandle as PlaygroundHandle).submitFrame(dt),
              { discard: true },
            ).pipe(
              Effect.zipRight(Effect.yieldNow()),
              Effect.zipRight(Effect.yieldNow()),
              Effect.zipRight(
                Effect.sync(() => {
                  framesSubmitted += command.count
                  note(`submitted ${String(command.count)} frame(s)`)
                }),
              ),
            )

      case 'stop':
        return liveHandle === undefined
          ? Effect.sync(() => {
              note('stop with no live handle')
            })
          : (liveHandle as PlaygroundHandle).stop.pipe(
              Effect.zipRight(
                Effect.sync(() => {
                  note('handle.stop')
                }),
              ),
            )

      case 'stopStaleHandle':
        return staleHandle === undefined
          ? Effect.sync(() => {
              note('no superseded handle to stop — relaunch first')
            })
          : Effect.sync(() => {
              staleTeardownRunning = true
            }).pipe(
              Effect.zipRight((staleHandle as PlaygroundHandle).stop),
              Effect.zipRight(
                Effect.sync(() => {
                  staleTeardownRunning = false
                  note(`the superseded handle's stop touched ${String(ghostTeardowns.length)} live port(s)`)
                }),
              ),
            )

      case 'note':
        return Effect.sync(() => {
          note(command.text)
        })

      default:
        return Effect.void
    }
  }

  const oneStep = Effect.gen(function* () {
    const scripted = stepAt(scenario, step)
    if (scripted !== undefined) {
      lastCommand = scripted.why
      yield* runCommand(scripted.command)
    }
    step += 1
  })

  const advance = (steps: number): Promise<void> => {
    const count = Math.max(0, Math.trunc(steps))
    return count === 0
      ? Promise.resolve()
      : Effect.runPromise(Effect.repeatN(oneStep, count - 1).pipe(Effect.asVoid))
  }

  const view = (): Promise<HarnessView> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const currentOption = yield* playground.current
        const handle = liveHandle

        return {
          step,
          lastCommand,
          launches,
          current: history[history.length - 1],
          history: [...history],
          isRunning: handle === undefined ? false : yield* handle.isRunning,
          currentIsSome: Option.isSome(currentOption),
          framesSubmitted,
          framesRendered: handle === undefined ? 0 : yield* handle.framesRendered,
          cameraPose: yield* Ref.get(poseRef),
          clockMillis: yield* Ref.get(state.clockMillis),
          calls: [...calls],
          ghostTeardowns: [...ghostTeardowns],
          ghostSeqs: [...ghostSeqs],
          frameStagesEvaluations: yield* Ref.get(state.stageEvaluations),
          log: [...log],
        } satisfies HarnessView
      }),
    )

  return { config, advance, view }
}

/** The phases, in the order `launch` runs them. Re-exported for the views. */
export const PHASES: ReadonlyArray<BootPhase> = BOOT_PHASE_ORDER
