import { Effect, Ref } from 'effect'
import { type RedstoneState, emptyRedstoneState } from './redstone-state.js'
import {
  type StageId,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import {
  fluidStateFromWorld,
  updateFluids,
} from './fluid-update.js'
import { type BlockWorld } from './block-world.js'
import { type FluidState } from './fluid-state.js'
import { updateRedstone } from './redstone-update.js'

const INITIAL_ELAPSED_SECS = 0
const INITIAL_TICK_INDEX = 0
const MIN_TICK_INTERVAL_SECS = 0
const NEXT_TICK_INDEX = 1
const NO_TICKS = 0

export const WORLD_TICK_INTERVAL_SECS = 0.05

export type WorldMechanicsState = {
  readonly fluids: FluidState
  readonly redstone: RedstoneState
  readonly world: BlockWorld
}

export type WorldMechanicsAdvance = {
  readonly fluids: ReturnType<typeof updateFluids>
  readonly redstone: ReturnType<typeof updateRedstone>
  readonly state: WorldMechanicsState
}

export const worldMechanicsStateFromWorld = (
  world: BlockWorld,
  fluids = fluidStateFromWorld(world),
  redstone = emptyRedstoneState(),
): WorldMechanicsState => ({
  fluids,
  redstone,
  world,
})

export const advanceWorldMechanics = (
  current: WorldMechanicsState,
): WorldMechanicsAdvance => {
  const fluids = updateFluids(current.world, current.fluids)
  const redstone = updateRedstone(fluids.world, current.redstone)

  return {
    fluids,
    redstone,
    state: {
      fluids: fluids.state,
      redstone: redstone.state,
      world: redstone.world,
    },
  }
}

export type WorldMechanicsStageOptions = {
  readonly after?: ReadonlyArray<StageId>
  readonly id: StageId
  readonly tickIntervalSecs?: number
}

const advanceWorldMechanicsTicks = (
  current: WorldMechanicsState,
  tickCount: number,
): WorldMechanicsState => {
  let next = current

  for (
    let index = INITIAL_TICK_INDEX;
    index < tickCount;
    index += NEXT_TICK_INDEX
  ) {
    next = advanceWorldMechanics(next).state
  }

  return next
}

export const makeWorldMechanicsStage = (
  state: Ref.Ref<WorldMechanicsState>,
  options: WorldMechanicsStageOptions,
): StageRegistration => {
  const tickIntervalSecs =
    options.tickIntervalSecs ?? WORLD_TICK_INTERVAL_SECS

  if (
    !Number.isFinite(tickIntervalSecs) ||
    tickIntervalSecs <= MIN_TICK_INTERVAL_SECS
  ) {
    throw new RangeError('tickIntervalSecs must be a finite positive number')
  }

  let accumulatedSecs = INITIAL_ELAPSED_SECS
  const stage: StageRegistration = {
    id: options.id,
    run: (deltaTime) => {
      const elapsedSecs = accumulatedSecs + deltaTime
      const tickCount = Math.floor(elapsedSecs / tickIntervalSecs)
      accumulatedSecs = elapsedSecs - tickCount * tickIntervalSecs

      if (tickCount === NO_TICKS) {
        return Effect.void
      }

      return Ref.update(state, (current) =>
        advanceWorldMechanicsTicks(current, tickCount),
      )
    },
  }

  if (!options.after) {
    return stage
  }

  return {
    ...stage,
    after: options.after,
  }
}
