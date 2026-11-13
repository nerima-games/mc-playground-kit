import { Brand, Effect, Ref } from 'effect'
import {
  type StageId,
  type StageRegistration,
  StageId as makeStageId,
} from '@nerima-games/mc-kernel'
import {
  type WorldMechanicsStageOptions,
  type WorldMechanicsState,
  makeWorldMechanicsStage,
  worldMechanicsStateFromWorld,
} from './world-mechanics.js'
import { type BlockWorld } from './block-world.js'
import { type PreviewModule } from './launch-options.js'

export const DEFAULT_WORLD_MECHANICS_STAGE_ID: StageId = makeStageId('world:mechanics')

export type WorldMechanicsPreview = {
  readonly module: PreviewModule
  readonly state: Ref.Ref<WorldMechanicsState>
}

export const makeWorldMechanicsPreview = (
  world: BlockWorld,
  options: WorldMechanicsStageOptions = {
    id: DEFAULT_WORLD_MECHANICS_STAGE_ID,
  },
): Effect.Effect<WorldMechanicsPreview, ReturnType<typeof Brand.error>> =>
  Effect.gen(function* makeWorldMechanicsPreviewGen() {
    const state = yield* Ref.make(worldMechanicsStateFromWorld(world))
    const stageResult = makeWorldMechanicsStage(state, options)
    if (stageResult._tag === 'Invalid') {
      return yield* Effect.fail(stageResult.error)
    }
    const stage = stageResult.value
    const frameStages: ReadonlyArray<StageRegistration> = [stage]

    return {
      module: {
        frameStages: Effect.succeed(frameStages),
      },
      state,
    }
  })
