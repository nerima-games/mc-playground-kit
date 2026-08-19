import {
  type BlockPosition,
  type BlockPositionKey,
  blockPositionKeyOf,
} from '@nerima-games/mc-kernel'
import {
  REDSTONE_POWER_MAX,
  REDSTONE_POWER_MIN,
} from './redstone-data.js'
import { Brand } from 'effect'
import { type RedstoneDevice } from './redstone-devices.js'

export type RedstonePower = number & Brand.Brand<'RedstonePower'>

export type RedstoneRepeaterTimer = {
  readonly power: RedstonePower
  readonly remainingTicks: number
}

export type RedstoneDeviceStateUpdate = {
  readonly deviceOutputs: ReadonlyMap<BlockPositionKey, RedstonePower>
  readonly observerSnapshots: ReadonlyMap<BlockPositionKey, string>
  readonly repeaterTimers: ReadonlyMap<BlockPositionKey, RedstoneRepeaterTimer>
}

export const redstonePower = Brand.refined<RedstonePower>(
  (value) => Number.isInteger(value) && value >= REDSTONE_POWER_MIN && value <= REDSTONE_POWER_MAX,
  (value) => Brand.error(`Redstone power must be an integer between ${REDSTONE_POWER_MIN} and ${REDSTONE_POWER_MAX}, received ${value}`),
)

export type RedstoneState = {
  readonly deviceOutputs: ReadonlyMap<BlockPositionKey, RedstonePower>
  readonly devices: ReadonlyMap<BlockPositionKey, RedstoneDevice>
  readonly inputs: ReadonlyMap<BlockPositionKey, boolean>
  readonly observerSnapshots: ReadonlyMap<BlockPositionKey, string>
  readonly repeaterTimers: ReadonlyMap<BlockPositionKey, RedstoneRepeaterTimer>
  readonly wires: ReadonlyMap<BlockPositionKey, RedstonePower>
}

export const emptyRedstoneState = (): RedstoneState => ({
  deviceOutputs: new Map(),
  devices: new Map(),
  inputs: new Map(),
  observerSnapshots: new Map(),
  repeaterTimers: new Map(),
  wires: new Map(),
})

export const redstoneInputAt = (
  state: RedstoneState,
  position: BlockPosition,
): boolean | undefined => state.inputs.get(blockPositionKeyOf(position))

export const redstonePowerAt = (
  state: RedstoneState,
  position: BlockPosition,
): RedstonePower => state.wires.get(blockPositionKeyOf(position)) ?? redstonePower(REDSTONE_POWER_MIN)

export const redstoneDevicePowerAt = (
  state: RedstoneState,
  position: BlockPosition,
): RedstonePower =>
  state.deviceOutputs.get(blockPositionKeyOf(position)) ?? redstonePower(REDSTONE_POWER_MIN)

export const redstoneDeviceAt = (
  state: RedstoneState,
  position: BlockPosition,
): RedstoneDevice | undefined => state.devices.get(blockPositionKeyOf(position))

export const setRedstoneInput = (
  state: RedstoneState,
  position: BlockPosition,
  powered: boolean,
): RedstoneState => {
  const inputs = new Map(state.inputs)
  inputs.set(blockPositionKeyOf(position), powered)

  return {
    deviceOutputs: state.deviceOutputs,
    devices: state.devices,
    inputs,
    observerSnapshots: state.observerSnapshots,
    repeaterTimers: state.repeaterTimers,
    wires: state.wires,
  }
}

export const clearRedstoneInput = (
  state: RedstoneState,
  position: BlockPosition,
): RedstoneState => {
  const key = blockPositionKeyOf(position)
  if (!state.inputs.has(key)) {
    return state
  }

  const inputs = new Map(state.inputs)
  inputs.delete(key)

  return {
    deviceOutputs: state.deviceOutputs,
    devices: state.devices,
    inputs,
    observerSnapshots: state.observerSnapshots,
    repeaterTimers: state.repeaterTimers,
    wires: state.wires,
  }
}

export const setRedstoneDevice = (
  state: RedstoneState,
  position: BlockPosition,
  device: RedstoneDevice,
): RedstoneState => {
  const key = blockPositionKeyOf(position)
  const devices = new Map(state.devices)
  devices.set(key, device)

  const deviceOutputs = new Map(state.deviceOutputs)
  deviceOutputs.delete(key)
  const observerSnapshots = new Map(state.observerSnapshots)
  observerSnapshots.delete(key)
  const repeaterTimers = new Map(state.repeaterTimers)
  repeaterTimers.delete(key)

  return {
    deviceOutputs,
    devices,
    inputs: state.inputs,
    observerSnapshots,
    repeaterTimers,
    wires: state.wires,
  }
}

const withoutRedstoneDeviceState = (
  state: RedstoneState,
  key: BlockPositionKey,
): Pick<RedstoneState, 'deviceOutputs' | 'observerSnapshots' | 'repeaterTimers'> => {
  const deviceOutputs = new Map(state.deviceOutputs)
  const observerSnapshots = new Map(state.observerSnapshots)
  const repeaterTimers = new Map(state.repeaterTimers)
  deviceOutputs.delete(key)
  observerSnapshots.delete(key)
  repeaterTimers.delete(key)
  return { deviceOutputs, observerSnapshots, repeaterTimers }
}

export const clearRedstoneDevice = (
  state: RedstoneState,
  position: BlockPosition,
): RedstoneState => {
  const key = blockPositionKeyOf(position)
  if (!state.devices.has(key)) {
    return state
  }

  const devices = new Map(state.devices)
  devices.delete(key)
  const deviceState = withoutRedstoneDeviceState(state, key)

  return {
    ...deviceState,
    devices,
    inputs: state.inputs,
    wires: state.wires,
  }
}

export const withRedstoneWirePowers = (
  state: RedstoneState,
  wires: ReadonlyMap<BlockPositionKey, RedstonePower>,
): RedstoneState => ({
  deviceOutputs: state.deviceOutputs,
  devices: state.devices,
  inputs: state.inputs,
  observerSnapshots: state.observerSnapshots,
  repeaterTimers: state.repeaterTimers,
  wires,
})

export const withRedstoneDeviceState = (
  state: RedstoneState,
  deviceState: RedstoneDeviceStateUpdate,
): RedstoneState => ({
  deviceOutputs: deviceState.deviceOutputs,
  devices: state.devices,
  inputs: state.inputs,
  observerSnapshots: deviceState.observerSnapshots,
  repeaterTimers: deviceState.repeaterTimers,
  wires: state.wires,
})
