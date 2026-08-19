import {
  type BlockId,
  type BlockPositionKey,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  clearRedstoneInput,
  clearRedstoneDevice,
  emptyRedstoneState,
  redstoneInputAt,
  redstoneComparator,
  redstoneDeviceAt,
  redstoneDevicePowerAt,
  redstonePower,
  redstonePowerAt,
  redstoneObserver,
  redstoneRepeater,
  setRedstoneDevice,
  setRedstoneInput,
  updateRedstone,
  withRedstoneDeviceState,
  withRedstoneWirePowers,
} from '../src/domain/block-interaction'
import {
  collectRedstoneLayout,
  deviceOutputAtTarget,
} from '../src/domain/redstone-network'

const at = (x: number, y = 0, z = 0) => blockPosition(x, y, z)

const place = (
  world: ReadonlyMap<BlockPositionKey, BlockId>,
  position: ReturnType<typeof at>,
  blockId: BlockId,
): ReadonlyMap<BlockPositionKey, BlockId> => {
  const next = new Map(world)
  next.set(blockPositionKeyOf(position), blockId)
  return next
}

describe('redstone state', () => {
  it('validates signal strength and keeps input state immutable', () => {
    expect(redstonePower(0)).toBe(0)
    expect(redstonePower(15)).toBe(15)
    expect(() => redstonePower(-1)).toThrow()
    expect(() => redstonePower(16)).toThrow()
    expect(() => redstonePower(1.5)).toThrow()

    const position = at(2)
    const empty = emptyRedstoneState()
    expect(redstoneInputAt(empty, position)).toBeUndefined()
    expect(redstonePowerAt(empty, position)).toBe(0)
    expect(clearRedstoneInput(empty, position)).toBe(empty)

    const powered = setRedstoneInput(empty, position, true)
    expect(redstoneInputAt(powered, position)).toBe(true)
    expect(redstoneInputAt(empty, position)).toBeUndefined()
    expect(clearRedstoneInput(powered, position)).not.toBe(powered)
    expect(redstoneInputAt(clearRedstoneInput(powered, position), position)).toBeUndefined()

    const unpowered = setRedstoneInput(powered, position, false)
    expect(redstoneInputAt(unpowered, position)).toBe(false)
    expect(redstonePowerAt(unpowered, position)).toBe(0)

    const wirePowers = new Map([[blockPositionKeyOf(position), redstonePower(7)]])
    const withWires = withRedstoneWirePowers(unpowered, wirePowers)
    expect(redstonePowerAt(withWires, position)).toBe(7)
    expect(redstoneInputAt(withWires, position)).toBe(false)
  })

  it('keeps device state isolated and clears transient state with the device', () => {
    const position = at(2)
    const device = redstoneRepeater('east', 2)
    const empty = emptyRedstoneState()
    const placed = setRedstoneDevice(empty, position, device)
    expect(redstoneDeviceAt(placed, position)).toEqual(device)
    const updated = updateRedstone(
      place(new Map(), position, blockIdOf('repeater')),
      placed,
    )

    expect(redstoneDevicePowerAt(updated.state, position)).toBe(0)
    expect(clearRedstoneDevice(empty, position)).toBe(empty)

    const cleared = clearRedstoneDevice(updated.state, position)
    expect(cleared.devices.has(blockPositionKeyOf(position))).toBe(false)
    expect(cleared.repeaterTimers.has(blockPositionKeyOf(position))).toBe(false)
    expect(redstoneDevicePowerAt(cleared, position)).toBe(0)

    const key = blockPositionKeyOf(position)
    const stale = withRedstoneDeviceState(placed, {
      deviceOutputs: new Map([[key, redstonePower(7)]]),
      observerSnapshots: new Map([[key, 'stale']]),
      repeaterTimers: new Map([[key, { power: redstonePower(7), remainingTicks: 2 }]]),
    })
    const pruned = updateRedstone(new Map(), stale)
    expect(redstoneDeviceAt(pruned.state, position)).toEqual(device)
    expect(pruned.state.deviceOutputs.has(key)).toBe(false)
    expect(pruned.state.observerSnapshots.has(key)).toBe(false)
    expect(pruned.state.repeaterTimers.has(key)).toBe(false)
  })
})

describe('redstone device definitions', () => {
  it('validates orientation, delay, and comparator mode at construction', () => {
    expect(redstoneRepeater('north', 4, true)).toEqual({
      delayTicks: 4,
      facing: 'north',
      kind: 'repeater',
      locked: true,
    })
    expect(redstoneComparator('south', 'subtract')).toEqual({
      facing: 'south',
      kind: 'comparator',
      mode: 'subtract',
    })
    expect(redstoneObserver('up')).toEqual({ facing: 'up', kind: 'observer' })
    expect(() => redstoneRepeater('up')).toThrow()
    expect(() => redstoneRepeater('east', 0)).toThrow()
    expect(() => redstoneRepeater('east', 5)).toThrow()
    expect(() => redstoneComparator('east', 'invalid' as never)).toThrow()
    expect(() => redstoneObserver('diagonal')).toThrow()
  })
})

describe('redstone update', () => {
  it('propagates a block source with distance attenuation and powers a lamp', () => {
    const redstoneBlock = blockIdOf('redstone_block')
    const wire = blockIdOf('redstone_wire')
    const lamp = blockIdOf('redstone_lamp')
    const source = at(0)
    const firstWire = at(1)
    const secondWire = at(2)
    const thirdWire = at(3)
    const target = at(4)
    let world = place(new Map(), source, redstoneBlock)
    world = place(world, firstWire, wire)
    world = place(world, secondWire, wire)
    world = place(world, thirdWire, wire)
    world = place(world, target, lamp)

    const result = updateRedstone(world)

    expect(redstonePowerAt(result.state, firstWire)).toBe(15)
    expect(redstonePowerAt(result.state, secondWire)).toBe(14)
    expect(redstonePowerAt(result.state, thirdWire)).toBe(13)
    expect(result.world.get(blockPositionKeyOf(target))).toBe(blockIdOf('redstone_lamp_lit'))
    expect(result.changes).toHaveLength(4)
    expect(result.changes).toContainEqual({
      after: 15,
      before: 0,
      kind: 'wire-power',
      position: firstWire,
    })
    expect(result.changes).toContainEqual({
      after: blockIdOf('redstone_lamp_lit'),
      before: lamp,
      kind: 'lamp-state',
      position: target,
    })

    const stable = updateRedstone(result.world, result.state)
    expect(stable.changes).toEqual([])
    expect(stable.world).toBe(result.world)
  })

  it('takes the strongest branch and turns a directly powered lamp on', () => {
    const redstoneBlock = blockIdOf('redstone_block')
    const wire = blockIdOf('redstone_wire')
    const lamp = blockIdOf('redstone_lamp')
    const source = at(0)
    const upperBranch = at(0, 0, 1)
    const lowerBranch = at(0, 0, -1)
    const merge = at(1)
    const directLamp = at(0, 1)
    let world = place(new Map(), source, redstoneBlock)
    world = place(world, upperBranch, wire)
    world = place(world, lowerBranch, wire)
    world = place(world, merge, wire)
    world = place(world, directLamp, lamp)

    const result = updateRedstone(world)

    expect(redstonePowerAt(result.state, upperBranch)).toBe(15)
    expect(redstonePowerAt(result.state, lowerBranch)).toBe(15)
    expect(redstonePowerAt(result.state, merge)).toBe(15)
    expect(result.world.get(blockPositionKeyOf(directLamp))).toBe(blockIdOf('redstone_lamp_lit'))
  })

  it('powers a lamp directly from a comparator output', () => {
    const comparator = at(0)
    const back = at(-1)
    const lamp = at(1)
    let world = place(new Map(), comparator, blockIdOf('comparator'))
    world = place(world, back, blockIdOf('redstone_block'))
    world = place(world, lamp, blockIdOf('redstone_lamp'))
    const state = setRedstoneDevice(
      emptyRedstoneState(),
      comparator,
      redstoneComparator('east'),
    )

    const result = updateRedstone(world, state)

    expect(redstoneDevicePowerAt(result.state, comparator)).toBe(15)
    expect(result.world.get(blockPositionKeyOf(lamp))).toBe(blockIdOf('redstone_lamp_lit'))
  })

  it('treats a device output without a transient power as unpowered', () => {
    const comparator = at(0)
    const target = at(1)
    const world = place(
      place(new Map(), comparator, blockIdOf('comparator')),
      target,
      blockIdOf('stone'),
    )
    const state = setRedstoneDevice(
      emptyRedstoneState(),
      comparator,
      redstoneComparator('east'),
    )
    const layout = collectRedstoneLayout(world, state)

    expect(
      deviceOutputAtTarget({ deviceOutputs: new Map(), devices: layout.devices }, target),
    ).toBe(0)
  })

  it('uses lever and button inputs, and treats an unpowered torch as off', () => {
    const lever = blockIdOf('lever')
    const button = blockIdOf('stone_button')
    const torch = blockIdOf('redstone_torch')
    const wire = blockIdOf('redstone_wire')
    const lamp = blockIdOf('redstone_lamp')
    const leverPosition = at(0)
    const buttonPosition = at(0, 2)
    const torchPosition = at(0, 4)
    const leverWire = at(1)
    const buttonWire = at(1, 2)
    const torchWire = at(1, 4)
    let world = place(new Map(), leverPosition, lever)
    world = place(world, buttonPosition, button)
    world = place(world, torchPosition, torch)
    world = place(world, leverWire, wire)
    world = place(world, buttonWire, wire)
    world = place(world, torchWire, wire)
    world = place(world, at(2), lamp)
    world = place(world, at(2, 2), lamp)
    world = place(world, at(2, 4), lamp)

    const emptyInputs = emptyRedstoneState()
    const off = updateRedstone(world, emptyInputs)
    expect(redstonePowerAt(off.state, leverWire)).toBe(0)
    expect(redstonePowerAt(off.state, buttonWire)).toBe(0)
    expect(redstonePowerAt(off.state, torchWire)).toBe(15)
    expect(off.world.get(blockPositionKeyOf(at(2)))).toBe(blockIdOf('redstone_lamp'))
    expect(off.world.get(blockPositionKeyOf(at(2, 2)))).toBe(blockIdOf('redstone_lamp'))
    expect(off.world.get(blockPositionKeyOf(at(2, 4)))).toBe(blockIdOf('redstone_lamp_lit'))

    const withInputs = setRedstoneInput(
      setRedstoneInput(off.state, leverPosition, true),
      buttonPosition,
      true,
    )
    const on = updateRedstone(off.world, withInputs)
    expect(redstonePowerAt(on.state, leverWire)).toBe(15)
    expect(redstonePowerAt(on.state, buttonWire)).toBe(15)
    expect(on.world.get(blockPositionKeyOf(at(2)))).toBe(blockIdOf('redstone_lamp_lit'))
    expect(on.world.get(blockPositionKeyOf(at(2, 2)))).toBe(blockIdOf('redstone_lamp_lit'))

    const torchOff = updateRedstone(
      on.world,
      setRedstoneInput(on.state, torchPosition, false),
    )
    expect(redstonePowerAt(torchOff.state, torchWire)).toBe(0)
    expect(torchOff.world.get(blockPositionKeyOf(at(2, 4)))).toBe(blockIdOf('redstone_lamp'))
  })

  it('uses a pressure plate input as a redstone source', () => {
    const plate = at(0)
    const lamp = at(1)
    const world = place(
      place(new Map(), plate, blockIdOf('pressure_plate')),
      lamp,
      blockIdOf('redstone_lamp'),
    )

    const off = updateRedstone(world)
    expect(off.world.get(blockPositionKeyOf(lamp))).toBe(blockIdOf('redstone_lamp'))
    expect(collectRedstoneLayout(world, off.state).sources).toContainEqual(plate)

    const on = updateRedstone(
      world,
      setRedstoneInput(emptyRedstoneState(), plate, true),
    )
    expect(on.world.get(blockPositionKeyOf(lamp))).toBe(blockIdOf('redstone_lamp_lit'))

    const released = updateRedstone(
      on.world,
      setRedstoneInput(on.state, plate, false),
    )
    expect(released.world.get(blockPositionKeyOf(lamp))).toBe(blockIdOf('redstone_lamp'))
  })

  it('removes stale wire power when a source is switched off', () => {
    const lever = blockIdOf('lever')
    const wire = blockIdOf('redstone_wire')
    const position = at(0)
    const wirePosition = at(1)
    const world = place(place(new Map(), position, lever), wirePosition, wire)
    const on = updateRedstone(world, setRedstoneInput(emptyRedstoneState(), position, true))
    const off = updateRedstone(
      world,
      setRedstoneInput(on.state, position, false),
    )

    expect(redstonePowerAt(on.state, wirePosition)).toBe(15)
    expect(redstonePowerAt(off.state, wirePosition)).toBe(0)
    expect(off.state.wires.has(blockPositionKeyOf(wirePosition))).toBe(false)
    expect(off.changes).toContainEqual({
      after: 0,
      before: 15,
      kind: 'wire-power',
      position: wirePosition,
    })
  })

  it('ignores unrelated blocks and normalizes a lit lamp without power', () => {
    const stone = blockIdOf('stone')
    const litLamp = blockIdOf('redstone_lamp_lit')
    const lampPosition = at(1)
    let world = place(new Map(), at(0), stone)
    world = place(world, lampPosition, litLamp)

    const result = updateRedstone(world, emptyRedstoneState())

    expect(result.world.get(blockPositionKeyOf(lampPosition))).toBe(blockIdOf('redstone_lamp'))
    expect(result.changes).toEqual([
      {
        after: blockIdOf('redstone_lamp'),
        before: litLamp,
        kind: 'lamp-state',
        position: lampPosition,
      },
    ])
    expect(updateRedstone(new Map(), result.state).changes).toEqual([])
  })

  it('delays repeater transitions and freezes a pending transition while locked', () => {
    const source = at(0)
    const repeater = at(1)
    const outputWire = at(2)
    const sideInput = at(1, 0, 1)
    let world = place(new Map(), source, blockIdOf('redstone_block'))
    world = place(world, repeater, blockIdOf('repeater'))
    world = place(world, outputWire, blockIdOf('redstone_wire'))
    world = place(world, sideInput, blockIdOf('lever'))
    let state = setRedstoneDevice(
      emptyRedstoneState(),
      repeater,
      redstoneRepeater('east', 2),
    )
    state = setRedstoneInput(state, source, true)

    const scheduled = updateRedstone(world, state)
    expect(redstoneDevicePowerAt(scheduled.state, repeater)).toBe(0)
    expect(scheduled.state.repeaterTimers.get(blockPositionKeyOf(repeater))).toEqual({
      power: 15,
      remainingTicks: 2,
    })

    const locked = updateRedstone(
      world,
      setRedstoneInput(scheduled.state, sideInput, true),
    )
    expect(redstoneDevicePowerAt(locked.state, repeater)).toBe(0)
    expect(locked.state.repeaterTimers.get(blockPositionKeyOf(repeater))).toEqual({
      power: 15,
      remainingTicks: 2,
    })

    const unlocked = updateRedstone(
      world,
      setRedstoneInput(locked.state, sideInput, false),
    )
    expect(unlocked.state.repeaterTimers.get(blockPositionKeyOf(repeater))).toEqual({
      power: 15,
      remainingTicks: 1,
    })

    const powered = updateRedstone(world, unlocked.state)
    expect(redstoneDevicePowerAt(powered.state, repeater)).toBe(15)
    expect(redstonePowerAt(powered.state, outputWire)).toBe(15)
    expect(powered.state.repeaterTimers.has(blockPositionKeyOf(repeater))).toBe(false)
  })

  it('does not schedule a repeater that is permanently locked', () => {
    const source = at(0)
    const repeater = at(1)
    const world = place(
      place(new Map(), source, blockIdOf('redstone_block')),
      repeater,
      blockIdOf('repeater'),
    )
    const state = setRedstoneDevice(
      emptyRedstoneState(),
      repeater,
      redstoneRepeater('east', 2, true),
    )

    const result = updateRedstone(world, state)

    expect(result.state.repeaterTimers.has(blockPositionKeyOf(repeater))).toBe(false)
    expect(redstoneDevicePowerAt(result.state, repeater)).toBe(0)
  })

  it('restarts a pending repeater timer when its input changes', () => {
    const source = at(0)
    const repeater = at(1)
    const world = place(
      place(new Map(), source, blockIdOf('lever')),
      repeater,
      blockIdOf('repeater'),
    )
    let state = setRedstoneDevice(
      emptyRedstoneState(),
      repeater,
      redstoneRepeater('east', 2),
    )
    state = setRedstoneInput(state, source, true)

    const scheduled = updateRedstone(world, state)
    const reversed = updateRedstone(
      world,
      setRedstoneInput(scheduled.state, source, false),
    )

    expect(reversed.state.repeaterTimers.get(blockPositionKeyOf(repeater))).toEqual({
      power: 0,
      remainingTicks: 2,
    })
  })

  it('compares and subtracts back and side signals', () => {
    const comparator = at(0)
    const back = at(-1)
    const sideSource = at(0, 0, -3)
    const sideFirstWire = at(0, 0, -2)
    const sideSecondWire = at(0, 0, -1)
    const outputWire = at(1)
    let world = place(new Map(), comparator, blockIdOf('comparator'))
    world = place(world, back, blockIdOf('redstone_block'))
    world = place(world, sideSource, blockIdOf('redstone_block'))
    world = place(world, sideFirstWire, blockIdOf('redstone_wire'))
    world = place(world, sideSecondWire, blockIdOf('redstone_wire'))
    world = place(world, outputWire, blockIdOf('redstone_wire'))

    const compareState = setRedstoneDevice(
      emptyRedstoneState(),
      comparator,
      redstoneComparator('east'),
    )
    const compared = updateRedstone(world, compareState)
    expect(redstoneDevicePowerAt(compared.state, comparator)).toBe(15)
    expect(redstonePowerAt(compared.state, outputWire)).toBe(15)

    const subtractState = setRedstoneDevice(
      compared.state,
      comparator,
      redstoneComparator('east', 'subtract'),
    )
    const subtracted = updateRedstone(world, subtractState)
    expect(redstoneDevicePowerAt(subtracted.state, comparator)).toBe(1)
    expect(redstonePowerAt(subtracted.state, outputWire)).toBe(1)
  })

  it('suppresses comparator output when a side signal is stronger', () => {
    const comparator = at(0)
    const backSource = at(-4)
    const backWires = [at(-3), at(-2), at(-1)]
    const sideSource = at(0, 0, -1)
    let world = place(new Map(), comparator, blockIdOf('comparator'))
    world = place(world, backSource, blockIdOf('redstone_block'))
    for (const position of backWires) {
      world = place(world, position, blockIdOf('redstone_wire'))
    }
    world = place(world, sideSource, blockIdOf('redstone_block'))
    const state = setRedstoneDevice(
      emptyRedstoneState(),
      comparator,
      redstoneComparator('east'),
    )

    const result = updateRedstone(world, state)

    expect(redstoneDevicePowerAt(result.state, comparator)).toBe(0)
  })

  it('emits an observer pulse when the observed block changes', () => {
    const observer = at(0)
    const observed = at(1)
    const comparator = at(2)
    const outputWire = at(-1)
    let world = place(new Map(), observer, blockIdOf('observer'))
    world = place(world, observed, blockIdOf('stone'))
    world = place(world, comparator, blockIdOf('comparator'))
    world = place(world, at(3), blockIdOf('redstone_block'))
    world = place(world, outputWire, blockIdOf('redstone_wire'))
    let state = setRedstoneDevice(
      emptyRedstoneState(),
      observer,
      redstoneObserver('east'),
    )
    state = setRedstoneDevice(state, comparator, redstoneComparator('west'))
    state = setRedstoneInput(state, observed, false)

    const initial = updateRedstone(world, state)
    expect(redstoneDevicePowerAt(initial.state, observer)).toBe(0)
    expect(redstonePowerAt(initial.state, outputWire)).toBe(0)

    const inputPulse = updateRedstone(
      world,
      setRedstoneInput(initial.state, observed, true),
    )
    expect(redstoneDevicePowerAt(inputPulse.state, observer)).toBe(15)
    expect(redstonePowerAt(inputPulse.state, outputWire)).toBe(15)

    world = place(world, observed, blockIdOf('dirt'))
    const pulse = updateRedstone(world, inputPulse.state)
    expect(redstoneDevicePowerAt(pulse.state, observer)).toBe(15)
    expect(redstonePowerAt(pulse.state, outputWire)).toBe(15)

    const finished = updateRedstone(world, pulse.state)
    expect(redstoneDevicePowerAt(finished.state, observer)).toBe(0)
    expect(redstonePowerAt(finished.state, outputWire)).toBe(0)
  })

  it('records an absent observer input as unknown', () => {
    const observer = at(0)
    const observed = at(1)
    const world = place(
      place(new Map(), observer, blockIdOf('observer')),
      observed,
      blockIdOf('stone'),
    )
    const state = setRedstoneDevice(
      emptyRedstoneState(),
      observer,
      redstoneObserver('east'),
    )

    const result = updateRedstone(world, state)

    expect(result.state.observerSnapshots.get(blockPositionKeyOf(observer))).toBe(
      `${blockIdOf('stone')}:unknown:0:0`,
    )
  })
})
