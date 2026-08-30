import { type BootBudgetVerdict, type PhaseTiming } from '../domain/boot-phase.js'
import {
  type CameraPoseSnapshot,
  ClockPort,
  type ClockService,
  type MonotonicTimeSecs,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import { Context, Effect, Option } from 'effect'
import {
  type LaunchOptions,
  type ResolvedLaunchOptions,
  type StageOrderViolation,
} from '../domain/launch-options.js'
import {
  type PlaygroundPorts,
  type PreviewInputService,
  type RendererService,
  type SimulationService,
  type WorldProviderError,
  type WorldProviderService,
} from './preview-ports.js'
import { type GameLoopApi } from '@nerima-games/mc-sim'

export type PlaygroundHandle = {
  readonly options: ResolvedLaunchOptions
  readonly timings: ReadonlyArray<PhaseTiming>
  readonly budget: BootBudgetVerdict
  readonly stageOrderWarnings: ReadonlyArray<StageOrderViolation>
  readonly submitFrame: (at: MonotonicTimeSecs) => Effect.Effect<void>
  readonly framesRendered: Effect.Effect<number>
  readonly framesDropped: Effect.Effect<number>
  readonly secondsLostToClamp: Effect.Effect<number>
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot>
  readonly isRunning: Effect.Effect<boolean>
  readonly stop: Effect.Effect<void>
}

export type PlaygroundApi = {
  readonly launch: (
    options?: LaunchOptions | undefined,
  ) => Effect.Effect<PlaygroundHandle, WorldProviderError, ClockPort | PlaygroundPorts>
  readonly current: Effect.Effect<Option.Option<PlaygroundHandle>>
  readonly stop: Effect.Effect<void>
}

// TypeScript's `isolatedDeclarations` cannot infer through `extends Context.Tag(...)<...>()`, an instantiation expression; hoisting it into an explicitly typed const (same pattern as mc-kernel's ClockPort in src/domain/clock.ts) gives the extends clause a plain identifier.
const PlaygroundBase: Context.TagClass<Playground, '@nerima-games/mc-playground-kit/Playground', PlaygroundApi> =
  Context.Tag('@nerima-games/mc-playground-kit/Playground')<Playground, PlaygroundApi>()
export class Playground extends PlaygroundBase {}

export type Generation = {
  readonly loop: GameLoopApi
}

export type BootServices = {
  readonly clock: ClockService
  readonly world: WorldProviderService
  readonly simulation: SimulationService
  readonly renderer: RendererService
  readonly input: PreviewInputService
}

export type BootOutcome = {
  readonly resolved: ResolvedLaunchOptions
  readonly stages: ReadonlyArray<StageRegistration>
  readonly timings: ReadonlyArray<PhaseTiming>
  readonly budget: BootBudgetVerdict
  readonly warnings: ReadonlyArray<StageOrderViolation>
}

export type BootPhaseTimer = {
  readonly timingsRef: import('effect').Ref.Ref<ReadonlyArray<PhaseTiming>>
  readonly clock: ClockService
}
