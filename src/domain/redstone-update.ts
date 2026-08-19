import {
  type BlockPosition,
  type BlockPositionKey,
  blockNeighbours,
} from '@nerima-games/mc-kernel'
import { type BlockWorld, blockAt, setBlockAt } from './block-world.js'
import {
  type DevicePowerContext,
  type RedstoneChange,
  type RedstoneLayout,
} from './redstone-update-types.js'
import {
  REDSTONE_BLOCK_IDS,
  REDSTONE_POWER_MIN,
} from './redstone-data.js'
import {
  type RedstonePower,
  type RedstoneState,
  emptyRedstoneState,
  withRedstoneDeviceState,
  withRedstoneWirePowers,
} from './redstone-state.js'
import {
  advanceDeviceTransientState,
  devicePowerChanges,
  makeDeviceTransition,
  scheduleRepeaters,
  updateComparators,
  updateObservers,
} from './redstone-device-update.js'
import {
  collectRedstoneLayout,
  poweredWiresFrom,
  signalPowerAt,
  wirePowerChanges,
} from './redstone-network.js'

export type { RedstoneChange } from './redstone-update-types.js'

export type RedstoneUpdate = {
  readonly changes: ReadonlyArray<RedstoneChange>
  readonly state: RedstoneState
  readonly world: BlockWorld
}

type DeviceExecution = {
  readonly layout: RedstoneLayout
  readonly state: RedstoneState
  readonly transition: ReturnType<typeof makeDeviceTransition>
  readonly world: BlockWorld
}

type LampChanges = {
  readonly changes: ReadonlyArray<RedstoneChange>
  readonly world: BlockWorld
}

const powerContextOf = (
  execution: DeviceExecution,
  powers: ReadonlyMap<BlockPositionKey, RedstonePower>,
): DevicePowerContext => ({
  deviceOutputs: execution.transition.deviceOutputs,
  devices: execution.layout.devices,
  powers,
  state: execution.state,
  world: execution.world,
})

const poweredWiresOf = (execution: DeviceExecution): Map<BlockPositionKey, RedstonePower> =>
  poweredWiresFrom({
    deviceOutputs: execution.transition.deviceOutputs,
    devices: execution.layout.devices,
    sources: execution.layout.sources,
    state: execution.state,
    world: execution.world,
  })

const poweredByAdjacentSignal = (
  context: DevicePowerContext,
  position: BlockPosition,
): boolean => {
  if (signalPowerAt(context, position) > REDSTONE_POWER_MIN) {
    return true
  }

  for (const neighbour of blockNeighbours(position)) {
    if (signalPowerAt(context, neighbour) > REDSTONE_POWER_MIN) {
      return true
    }
  }

  return false
}

const updateLamp = (
  context: DevicePowerContext,
  position: BlockPosition,
): LampChanges => {
  const before = blockAt(context.world, position)
  let after = REDSTONE_BLOCK_IDS.lamp
  if (poweredByAdjacentSignal(context, position)) {
    after = REDSTONE_BLOCK_IDS.lampLit
  }
  if (before === after) {
    return { changes: [], world: context.world }
  }

  return {
    changes: [{ after, before, kind: 'lamp-state', position }],
    world: setBlockAt(context.world, position, after),
  }
}

const updateLamps = (
  context: DevicePowerContext,
  lamps: ReadonlyArray<BlockPosition>,
): LampChanges => {
  let { world } = context
  const changes: Array<RedstoneChange> = []
  for (const position of lamps) {
    const { changes: lampChanges, world: nextWorld } = updateLamp(
      { ...context, world },
      position,
    )
    world = nextWorld
    changes.push(...lampChanges)
  }
  return { changes, world }
}

const advanceTransientDevices = (execution: DeviceExecution): void => {
  const powers = poweredWiresOf(execution)
  const context = powerContextOf(execution, powers)
  advanceDeviceTransientState(context, execution.layout, execution.transition)
}

const updateDevices = (
  execution: DeviceExecution,
): ReadonlyMap<BlockPositionKey, RedstonePower> => {
  advanceTransientDevices(execution)
  let powers = poweredWiresOf(execution)
  let context = powerContextOf(execution, powers)
  scheduleRepeaters(context, execution.layout, execution.transition)
  updateComparators(context, execution.layout, execution.transition)
  powers = poweredWiresOf(execution)
  context = powerContextOf(execution, powers)
  updateObservers(context, execution.layout, execution.transition)
  powers = poweredWiresOf(execution)
  return powers
}

export const updateRedstone = (
  world: BlockWorld,
  state: RedstoneState = emptyRedstoneState(),
): RedstoneUpdate => {
  const layout = collectRedstoneLayout(world, state)
  const transition = makeDeviceTransition(state, layout)
  const execution: DeviceExecution = { layout, state, transition, world }
  const powers = updateDevices(execution)
  const context = powerContextOf(execution, powers)
  const deviceChanges = devicePowerChanges(state, layout, transition.deviceOutputs)
  const wireChanges = wirePowerChanges(state, layout.wires, powers)
  const lampResult = updateLamps(context, layout.lamps)
  const stateWithWires = withRedstoneWirePowers(state, powers)

  return {
    changes: [...deviceChanges, ...wireChanges, ...lampResult.changes],
    state: withRedstoneDeviceState(stateWithWires, {
      deviceOutputs: transition.deviceOutputs,
      observerSnapshots: transition.observerSnapshots,
      repeaterTimers: transition.repeaterTimers,
    }),
    world: lampResult.world,
  }
}
