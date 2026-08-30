import {
  type BlockFace,
  type BlockId,
  type BlockPosition,
  type BlockPositionKey,
  adjacentBlockPosition,
  blockNeighbours,
  blockPositionKeyOf,
  blockPositionOfKey,
  horizontalBlockNeighbours,
  oppositeBlockFace,
} from '@nerima-games/mc-kernel'
import {
  type BlockWorld,
  blockAt,
} from './block-world.js'
import {
  type DevicePowerContext,
  type MutableRedstoneLayout,
  type PendingWire,
  type RedstoneChange,
  type RedstoneDevicePlacement,
  type RedstoneLayout,
  type WirePropagation,
  type WireQueue,
} from './redstone-update-types.js'
import {
  REDSTONE_BLOCK_IDS,
  REDSTONE_POWER_MAX,
  REDSTONE_POWER_MIN,
  REDSTONE_POWER_STEP,
} from './redstone-data.js'
import {
  type RedstonePower,
  type RedstoneState,
  redstoneInputAt,
  redstonePower,
  redstonePowerAt,
} from './redstone-state.js'
import {
  type RedstoneDevice,
} from './redstone-devices.js'

const REDSTONE_QUEUE_INDEX_STEP = 1

const isWire = (world: BlockWorld, position: BlockPosition): boolean =>
  blockAt(world, position) === REDSTONE_BLOCK_IDS.wire

const isLamp = (blockId: BlockId): boolean =>
  blockId === REDSTONE_BLOCK_IDS.lamp || blockId === REDSTONE_BLOCK_IDS.lampLit

const isSource = (blockId: BlockId): boolean =>
  blockId === REDSTONE_BLOCK_IDS.block ||
  blockId === REDSTONE_BLOCK_IDS.lever ||
  blockId === REDSTONE_BLOCK_IDS.pressurePlate ||
  blockId === REDSTONE_BLOCK_IDS.stoneButton ||
  blockId === REDSTONE_BLOCK_IDS.torch

const deviceBlockId = (device: RedstoneDevice): BlockId => {
  if (device.kind === 'comparator') {
    return REDSTONE_BLOCK_IDS.comparator
  }
  if (device.kind === 'observer') {
    return REDSTONE_BLOCK_IDS.observer
  }
  return REDSTONE_BLOCK_IDS.repeater
}

const isDeviceAt = (
  world: BlockWorld,
  placement: RedstoneDevicePlacement,
): boolean => blockAt(world, placement.position) === deviceBlockId(placement.device)

const addToLayout = (
  layout: MutableRedstoneLayout,
  position: BlockPosition,
  blockId: BlockId,
): void => {
  if (isLamp(blockId)) {
    layout.lamps.push(position)
  }
  if (isSource(blockId)) {
    layout.sources.push(position)
  }
  if (blockId === REDSTONE_BLOCK_IDS.wire) {
    layout.wires.push(position)
  }
}

export const collectRedstoneLayout = (
  world: BlockWorld,
  state: RedstoneState,
): RedstoneLayout => {
  const layout: MutableRedstoneLayout = {
    devices: [],
    lamps: [],
    sources: [],
    wires: [],
  }

  for (const [key, blockId] of world) {
    addToLayout(layout, blockPositionOfKey(key), blockId)
  }

  for (const [key, device] of state.devices) {
    const placement = {
      device,
      key,
      position: blockPositionOfKey(key),
    }
    if (isDeviceAt(world, placement)) {
      layout.devices.push(placement)
    }
  }

  return layout
}

const sourcePowerFromTorch = (input: boolean | undefined): RedstonePower => {
  if (input === false) {
    return redstonePower(REDSTONE_POWER_MIN)
  }
  return redstonePower(REDSTONE_POWER_MAX)
}

const sourcePowerFromSwitch = (input: boolean | undefined): RedstonePower => {
  if (input !== true) {
    return redstonePower(REDSTONE_POWER_MIN)
  }
  return redstonePower(REDSTONE_POWER_MAX)
}

export const sourcePowerAt = (
  world: BlockWorld,
  state: RedstoneState,
  position: BlockPosition,
): RedstonePower => {
  const blockId = blockAt(world, position)
  const input = redstoneInputAt(state, position)

  if (blockId === REDSTONE_BLOCK_IDS.block) {
    return redstonePower(REDSTONE_POWER_MAX)
  }
  if (blockId === REDSTONE_BLOCK_IDS.torch) {
    return sourcePowerFromTorch(input)
  }
  if (
    blockId === REDSTONE_BLOCK_IDS.lever ||
    blockId === REDSTONE_BLOCK_IDS.pressurePlate ||
    blockId === REDSTONE_BLOCK_IDS.stoneButton
  ) {
    return sourcePowerFromSwitch(input)
  }
  return redstonePower(REDSTONE_POWER_MIN)
}

export const deviceOutputFace = (device: RedstoneDevice): BlockFace => {
  if (device.kind === 'observer') {
    return oppositeBlockFace(device.facing)
  }
  return device.facing
}

export const deviceOutputAtTarget = (
  context: Pick<DevicePowerContext, 'deviceOutputs' | 'devices'>,
  target: BlockPosition,
): RedstonePower => {
  const targetKey = blockPositionKeyOf(target)
  let strongest = redstonePower(REDSTONE_POWER_MIN)

  for (const placement of context.devices) {
    const outputTarget = adjacentBlockPosition(
      placement.position,
      deviceOutputFace(placement.device),
    )
    if (blockPositionKeyOf(outputTarget) === targetKey) {
      const output =
        context.deviceOutputs.get(placement.key) ?? redstonePower(REDSTONE_POWER_MIN)
      if (output > strongest) {
        strongest = output
      }
    }
  }

  return strongest
}

const enqueueWire = (
  queue: WireQueue,
  position: BlockPosition,
  power: RedstonePower,
): void => {
  const key = blockPositionKeyOf(position)
  const previous = queue.powers.get(key) ?? redstonePower(REDSTONE_POWER_MIN)
  if (previous < power) {
    queue.powers.set(key, power)
    queue.pending.push({ position, power })
  }
}

const seedSourceWires = (
  context: WirePropagation,
  source: BlockPosition,
): void => {
  const sourcePower = sourcePowerAt(context.world, context.state, source)
  if (sourcePower > REDSTONE_POWER_MIN) {
    for (const neighbour of blockNeighbours(source)) {
      if (isWire(context.world, neighbour)) {
        enqueueWire(context.queue, neighbour, sourcePower)
      }
    }
  }
}

const seedDeviceWire = (
  context: WirePropagation,
  placement: RedstoneDevicePlacement,
): void => {
  const output =
    context.deviceOutputs.get(placement.key) ?? redstonePower(REDSTONE_POWER_MIN)
  if (output > REDSTONE_POWER_MIN) {
    const outputTarget = adjacentBlockPosition(
      placement.position,
      deviceOutputFace(placement.device),
    )
    if (isWire(context.world, outputTarget)) {
      enqueueWire(context.queue, outputTarget, output)
    }
  }
}

const seedPoweredWires = (context: WirePropagation): void => {
  for (const source of context.sources) {
    seedSourceWires(context, source)
  }
  for (const placement of context.devices) {
    seedDeviceWire(context, placement)
  }
}

const propagateFromWire = (
  context: WirePropagation,
  current: PendingWire,
): void => {
  const nextPower = current.power - REDSTONE_POWER_STEP
  if (nextPower > REDSTONE_POWER_MIN) {
    const power = redstonePower(nextPower)
    for (const neighbour of horizontalBlockNeighbours(current.position)) {
      if (isWire(context.world, neighbour)) {
        enqueueWire(context.queue, neighbour, power)
      }
    }
  }
}

const propagatePoweredWires = (context: WirePropagation): void => {
  let pendingIndex = 0
  while (pendingIndex < context.queue.pending.length) {
    const current = context.queue.pending[pendingIndex]!
    pendingIndex += REDSTONE_QUEUE_INDEX_STEP
    propagateFromWire(context, current)
  }
}

export const poweredWiresFrom = (context: Omit<WirePropagation, 'queue'>): Map<
  BlockPositionKey,
  RedstonePower
> => {
  const propagation: WirePropagation = {
    ...context,
    queue: {
      pending: [],
      powers: new Map(),
    },
  }
  seedPoweredWires(propagation)
  propagatePoweredWires(propagation)
  return propagation.queue.powers
}

export const signalPowerAt = (
  context: DevicePowerContext,
  position: BlockPosition,
): RedstonePower => {
  const source = sourcePowerAt(context.world, context.state, position)
  const wire =
    context.powers.get(blockPositionKeyOf(position)) ?? redstonePower(REDSTONE_POWER_MIN)
  const device = deviceOutputAtTarget(context, position)
  return redstonePower(Math.max(source, wire, device))
}

export const wirePowerChanges = (
  state: RedstoneState,
  wires: ReadonlyArray<BlockPosition>,
  powers: ReadonlyMap<BlockPositionKey, RedstonePower>,
): Array<RedstoneChange> => {
  const changes: Array<RedstoneChange> = []

  for (const position of wires) {
    const before = redstonePowerAt(state, position)
    const after = powers.get(blockPositionKeyOf(position)) ?? redstonePower(REDSTONE_POWER_MIN)
    if (before !== after) {
      changes.push({ after, before, kind: 'wire-power', position })
    }
  }

  return changes
}

export const blockIsWire: (world: BlockWorld, position: BlockPosition) => boolean = isWire
