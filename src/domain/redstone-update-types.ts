import {
  type BlockId,
  type BlockPosition,
  type BlockPositionKey,
} from '@nerima-games/mc-kernel'
import {
  type RedstonePower,
  type RedstoneRepeaterTimer,
  type RedstoneState,
} from './redstone-state.js'
import { type BlockWorld } from './block-world.js'
import { type RedstoneDevice } from './redstone-devices.js'

export type RedstoneDevicePlacement = {
  readonly device: RedstoneDevice
  readonly key: BlockPositionKey
  readonly position: BlockPosition
}

export type RedstoneLayout = {
  readonly devices: ReadonlyArray<RedstoneDevicePlacement>
  readonly lamps: ReadonlyArray<BlockPosition>
  readonly sources: ReadonlyArray<BlockPosition>
  readonly wires: ReadonlyArray<BlockPosition>
}

export type MutableRedstoneLayout = {
  readonly devices: Array<RedstoneDevicePlacement>
  readonly lamps: Array<BlockPosition>
  readonly sources: Array<BlockPosition>
  readonly wires: Array<BlockPosition>
}

export type PendingWire = {
  readonly position: BlockPosition
  readonly power: RedstonePower
}

export type WireQueue = {
  readonly pending: Array<PendingWire>
  readonly powers: Map<BlockPositionKey, RedstonePower>
}

export type WirePropagation = {
  readonly deviceOutputs: ReadonlyMap<BlockPositionKey, RedstonePower>
  readonly devices: ReadonlyArray<RedstoneDevicePlacement>
  readonly queue: WireQueue
  readonly sources: ReadonlyArray<BlockPosition>
  readonly state: RedstoneState
  readonly world: BlockWorld
}

export type DevicePowerContext = {
  readonly deviceOutputs: ReadonlyMap<BlockPositionKey, RedstonePower>
  readonly devices: ReadonlyArray<RedstoneDevicePlacement>
  readonly powers: ReadonlyMap<BlockPositionKey, RedstonePower>
  readonly state: RedstoneState
  readonly world: BlockWorld
}

export type DeviceTransition = {
  readonly deviceOutputs: Map<BlockPositionKey, RedstonePower>
  readonly observerSnapshots: Map<BlockPositionKey, string>
  readonly repeaterTimers: Map<BlockPositionKey, RedstoneRepeaterTimer>
}

export type RedstoneChange =
  | {
      readonly after: RedstonePower
      readonly before: RedstonePower
      readonly kind: 'device-power'
      readonly position: BlockPosition
    }
  | {
      readonly after: BlockId
      readonly before: BlockId
      readonly kind: 'lamp-state'
      readonly position: BlockPosition
    }
  | {
      readonly after: RedstonePower
      readonly before: RedstonePower
      readonly kind: 'wire-power'
      readonly position: BlockPosition
    }
