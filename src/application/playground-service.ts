import {
  type BootServices,
  type Generation,
  Playground,
  type PlaygroundApi,
  type PlaygroundHandle,
} from './playground-contracts.js'
import { Cause, Effect, Layer, Option, Ref } from 'effect'
import {
  InputPort,
  type PlaygroundPorts,
  RendererPort,
  SimulationPort,
  WorldProviderPort,
} from './preview-ports.js'
import { runBootSequence, startGeneration } from './playground-boot.js'
import { ClockPort } from '@nerima-games/mc-kernel'
import { type LaunchOptions } from '../domain/launch-options.js'
import { describeBootVerdict } from '../domain/boot-phase.js'

export { FRAME_QUEUE_CAPACITY, FIRST_FRAME_DELTA_SECS } from '@nerima-games/mc-sim'

const INITIAL_FRAME_COUNT = 1
const STOPPED_FRAME_COUNT = 0

export const makePlayground: Effect.Effect<PlaygroundApi> = Effect.gen(function* makePlaygroundGen() {
  const generationRef = yield* Ref.make<Option.Option<Generation>>(Option.none())
  const handleRef = yield* Ref.make<Option.Option<PlaygroundHandle>>(Option.none())

  const stopGeneration = (generation: Generation): Effect.Effect<void> => generation.loop.stop
  const stopCurrent: Effect.Effect<void> = Ref.get(handleRef).pipe(
    Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (handle) => handle.stop })),
  )

  const launch = (
    options?: LaunchOptions | undefined,
  ): Effect.Effect<PlaygroundHandle, never, ClockPort | PlaygroundPorts> =>
    Effect.gen(function* launchGen() {
      yield* stopCurrent
      const services: BootServices = {
        clock: yield* ClockPort,
        input: yield* InputPort,
        renderer: yield* RendererPort,
        simulation: yield* SimulationPort,
        world: yield* WorldProviderPort,
      }
      const { budget, resolved, stages, timings, warnings } = yield* runBootSequence(services, options)
      const generation = yield* startGeneration(generationRef, services, stages)

      const teardown: Effect.Effect<void> = Effect.gen(function* teardownGen() {
        yield* stopGeneration(generation)
        const claimed = yield* Ref.modify(generationRef, (installed) => {
          if (Option.isSome(installed) && installed.value === generation) {
            return [true, Option.none<Generation>()]
          }
          return [false, installed]
        })
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
      yield* Effect.forEach(
        warnings,
        (violation) =>
          Effect.logWarning(
            `playground: stage ${violation.stage} runs at index ${String(violation.declaredIndex)} but declared after ` +
              `${violation.mustFollow}, which is at index ${String(violation.constraintIndex)}. ` +
              'This harness runs stages in declaration order and does not resolve `after` — the application composition root owns the total order.',
          ),
        { discard: true },
      )

      const handle: PlaygroundHandle = {
        budget,
        cameraPose: services.simulation.cameraPose,
        framesDropped: generation.loop.framesDropped,
        framesRendered: generation.loop.isRunning.pipe(
          Effect.flatMap((running) => {
            if (running) {
              return Effect.map(generation.loop.framesProcessed, (count) => count + INITIAL_FRAME_COUNT)
            }
            return Effect.succeed(STOPPED_FRAME_COUNT)
          }),
        ),
        isRunning: generation.loop.isRunning,
        options: resolved,
        secondsLostToClamp: generation.loop.secondsLostToClamp,
        stageOrderWarnings: warnings,
        stop: teardown,
        submitFrame: generation.loop.submitFrame,
        timings,
      }

      yield* Ref.set(handleRef, Option.some(handle))
      return handle
    })

  return {
    current: Ref.get(handleRef),
    launch,
    stop: stopCurrent,
  }
})

export const PlaygroundLayer: Layer.Layer<Playground> = Layer.effect(Playground, makePlayground)

export const launchPlayground = (
  options?: LaunchOptions | undefined,
): Effect.Effect<PlaygroundHandle, never, Playground | ClockPort | PlaygroundPorts> =>
  Effect.flatMap(Playground, (playground) => playground.launch(options))
