import {
  type BootBudgetVerdict,
  type BootPhase,
  type PhaseTiming,
  classifyBootTimings,
  elapsedMillis,
} from '../domain/boot-phase.js'
import {
  type BootOutcome,
  type BootPhaseTimer,
  type BootServices,
  type Generation,
} from './playground-contracts.js'
import { Brand, Cause, Effect, Option, Ref } from 'effect'
import { ClockPort, type DeltaTimeSecs, type StageRegistration } from '@nerima-games/mc-kernel'
import { FIRST_FRAME_DELTA_SECS, makeGameLoop } from '@nerima-games/mc-sim'
import {
  type LaunchOptions,
  type ResolvedLaunchOptions,
  flattenStages,
  flattenedStageOrderViolations,
  normalizeLaunchOptions,
} from '../domain/launch-options.js'
import type { WorldProviderError } from './preview-ports.js'

const runOneFrame = (
  services: BootServices,
  stages: ReadonlyArray<StageRegistration>,
  dt: DeltaTimeSecs,
): Effect.Effect<void> =>
  Effect.gen(function* runOneFrameGen() {
    yield* services.simulation.tick(dt)
    yield* Effect.forEach(stages, (stage) => stage.run(dt), { discard: true }).pipe(
      Effect.provideService(ClockPort, services.clock),
    )
    const pose = yield* services.simulation.cameraPose
    yield* services.renderer.renderFrame(dt, pose)
  }).pipe(
    Effect.tapErrorCause((cause) => Effect.logError(`Playground frame error: ${Cause.pretty(cause)}`)),
  )

const timePhase = <A, E>(
  timer: BootPhaseTimer,
  name: BootPhase,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, E | ReturnType<typeof Brand.error>> =>
  Effect.gen(function* timePhaseGen() {
    const startedAt = yield* timer.clock.monotonicSecs
    const result = yield* work
    const finishedAt = yield* timer.clock.monotonicSecs
    const durationMillis = elapsedMillis(startedAt, finishedAt)
    if (durationMillis._tag === 'Invalid') {
      return yield* Effect.fail(durationMillis.error)
    }
    yield* Ref.update(timer.timingsRef, (recorded) => [
      ...recorded,
      { durationMillis: durationMillis.value, phase: name },
    ])
    return result
  })

const bootInfrastructure = (
  services: BootServices,
  phase: BootPhaseRunner,
  resolved: ResolvedLaunchOptions,
): Effect.Effect<void, WorldProviderError | ReturnType<typeof Brand.error>> =>
  Effect.gen(function* bootInfrastructureGen() {
    yield* phase('world', services.world.openFlatWorld(resolved.world))
    yield* phase('simulation', services.simulation.spawn(resolved.spawnKit))
    yield* phase('renderer', services.renderer.attach)
    yield* phase('input', services.input.attach)
  })

const bootBudgetOf = (
  timings: ReadonlyArray<PhaseTiming>,
): Effect.Effect<BootBudgetVerdict, ReturnType<typeof Brand.error>> => {
  const result = classifyBootTimings(timings)
  if (result._tag === 'Invalid') {
    return Effect.fail(result.error)
  }
  return Effect.succeed(result.value)
}

type BootPhaseRunner = <A, E>(
  name: BootPhase,
  work: Effect.Effect<A, E>,
) => Effect.Effect<A, E | ReturnType<typeof Brand.error>>

const resolveAndBoot = (
  services: BootServices,
  options: LaunchOptions | undefined,
  phase: BootPhaseRunner,
): Effect.Effect<{
  readonly resolved: ResolvedLaunchOptions
  readonly stages: ReadonlyArray<StageRegistration>
}, WorldProviderError | ReturnType<typeof Brand.error>> =>
  Effect.gen(function* resolveAndBootGen() {
    const resolved = yield* phase('resolve-options', Effect.sync(() => normalizeLaunchOptions(options)))
    yield* bootInfrastructure(services, phase, resolved)
    const stages = yield* phase('modules', flattenStages(resolved.modules))
    return { resolved, stages }
  })

export const runBootSequence = (
  services: BootServices,
  options: LaunchOptions | undefined,
): Effect.Effect<BootOutcome, WorldProviderError | ReturnType<typeof Brand.error>> =>
  Effect.gen(function* runBootSequenceGen() {
    const timingsRef = yield* Ref.make<ReadonlyArray<import('../domain/boot-phase.js').PhaseTiming>>([])
    const phase: BootPhaseRunner = (name, work) =>
      timePhase({ clock: services.clock, timingsRef }, name, work)
    const { resolved, stages } = yield* resolveAndBoot(services, options, phase)
    yield* phase('first-frame', runOneFrame(services, stages, FIRST_FRAME_DELTA_SECS))
    const timings = yield* Ref.get(timingsRef)
    const budget = yield* bootBudgetOf(timings)
    const warnings = flattenedStageOrderViolations(stages)
    return { budget, resolved, stages, timings, warnings }
  })

export const startGeneration = (
  generationRef: Ref.Ref<Option.Option<Generation>>,
  services: BootServices,
  stages: ReadonlyArray<StageRegistration>,
): Effect.Effect<Generation> =>
  Effect.gen(function* startGenerationGen() {
    const loop = yield* makeGameLoop()
    yield* loop.start((dt) =>
      runOneFrame(services, stages, dt).pipe(
        Effect.tapErrorCause(() => loop.stop),
      ),
    )
    const generation: Generation = { loop }
    yield* Ref.set(generationRef, Option.some(generation))
    return generation
  })
