import {
  type BootOutcome,
  type BootPhaseTimer,
  type BootServices,
  type Generation,
} from './playground-contracts.js'
import { type BootPhase, classifyBootTimings, elapsedMillis } from '../domain/boot-phase.js'
import { Cause, Effect, Option, Ref } from 'effect'
import { ClockPort, type DeltaTimeSecs, type StageRegistration } from '@nerima-games/mc-kernel'
import { FIRST_FRAME_DELTA_SECS, makeGameLoop } from '@nerima-games/mc-sim'
import {
  type LaunchOptions,
  type ResolvedLaunchOptions,
  flattenStages,
  flattenedStageOrderViolations,
  normalizeLaunchOptions,
} from '../domain/launch-options.js'

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
  }).pipe(Effect.catchAllCause((cause) => Effect.logError(`Playground frame error: ${Cause.pretty(cause)}`)))

const timePhase = <A>(timer: BootPhaseTimer, name: BootPhase, work: Effect.Effect<A>): Effect.Effect<A> =>
  Effect.gen(function* timePhaseGen() {
    const startedAt = yield* timer.clock.monotonicSecs
    const result = yield* work
    const finishedAt = yield* timer.clock.monotonicSecs
    yield* Ref.update(timer.timingsRef, (recorded) => [
      ...recorded,
      { durationMillis: elapsedMillis(startedAt, finishedAt), phase: name },
    ])
    return result
  })

const bootInfrastructure = (
  services: BootServices,
  phase: <A>(name: BootPhase, work: Effect.Effect<A>) => Effect.Effect<A>,
  resolved: ResolvedLaunchOptions,
): Effect.Effect<void> =>
  Effect.gen(function* bootInfrastructureGen() {
    yield* phase('world', services.world.openFlatWorld(resolved.world))
    yield* phase('simulation', services.simulation.spawn(resolved.spawnKit))
    yield* phase('renderer', services.renderer.attach)
    yield* phase('input', services.input.attach)
  })

export const runBootSequence = (services: BootServices, options: LaunchOptions | undefined): Effect.Effect<BootOutcome> =>
  Effect.gen(function* runBootSequenceGen() {
    const timingsRef = yield* Ref.make<ReadonlyArray<import('../domain/boot-phase.js').PhaseTiming>>([])
    const phase = <A>(name: BootPhase, work: Effect.Effect<A>): Effect.Effect<A> =>
      timePhase({ clock: services.clock, timingsRef }, name, work)
    const resolved = yield* phase('resolve-options', Effect.sync(() => normalizeLaunchOptions(options)))
    yield* bootInfrastructure(services, phase, resolved)
    const stages = yield* phase('modules', flattenStages(resolved.modules))
    yield* phase('first-frame', runOneFrame(services, stages, FIRST_FRAME_DELTA_SECS))
    const timings = yield* Ref.get(timingsRef)
    const budget = classifyBootTimings(timings)
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
    yield* loop.start((dt) => runOneFrame(services, stages, dt))
    const generation: Generation = { loop }
    yield* Ref.set(generationRef, Option.some(generation))
    return generation
  })
