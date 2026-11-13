import {
  type BlockId,
  type BlockPositionKey,
  blockIdOf,
  blockPosition,
  blockPositionKeyOf,
} from '@nerima-games/mc-kernel'
import { Schema } from 'effect'
import * as fc from 'fast-check'
import assert from 'node:assert/strict'
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
  repeaterDelayTicks,
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

type Validated<A> =
  | { readonly _tag: 'Valid'; readonly value: A }
  | { readonly _tag: 'Invalid'; readonly error: unknown }

const valid = <A>(result: Validated<A>): A => {
  assert(result._tag === 'Valid')
  return result.value
}

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
    expect(valid(redstonePower(0))).toBe(0)
    expect(valid(redstonePower(15))).toBe(15)
    expect(redstonePower(-1)._tag).toBe('Invalid')
    expect(redstonePower(16)._tag).toBe('Invalid')
    expect(redstonePower(1.5)._tag).toBe('Invalid')

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

    const wirePowers = new Map([[blockPositionKeyOf(position), valid(redstonePower(7))]])
    const withWires = withRedstoneWirePowers(unpowered, wirePowers)
    expect(redstonePowerAt(withWires, position)).toBe(7)
    expect(redstoneInputAt(withWires, position)).toBe(false)
  })

  it('keeps device state isolated and clears transient state with the device', () => {
    const position = at(2)
    const device = valid(redstoneRepeater('east', 2))
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
      deviceOutputs: new Map([[key, valid(redstonePower(7))]]),
      observerSnapshots: new Map([[key, 'stale']]),
      repeaterTimers: new Map([[key, { power: valid(redstonePower(7)), remainingTicks: 2 }]]),
    })
    const pruned = updateRedstone(new Map(), stale)
    expect(redstoneDeviceAt(pruned.state, position)).toEqual(device)
    expect(pruned.state.deviceOutputs.has(key)).toBe(false)
    expect(pruned.state.observerSnapshots.has(key)).toBe(false)
    expect(pruned.state.repeaterTimers.has(key)).toBe(false)
  })

  it('returns typed power failures just outside the legal range', () => {
    expect(redstonePower(0)._tag).toBe('Valid')
    expect(redstonePower(15)._tag).toBe('Valid')
    expect(redstonePower(-1)._tag).toBe('Invalid')
    expect(redstonePower(16)._tag).toBe('Invalid')
    expect(redstonePower(0.5)._tag).toBe('Invalid')
    const invalid = redstonePower(-1)
    if (invalid._tag === 'Invalid') {
      expect(invalid.error[0]?.message).toBe(
        'Redstone power must be an integer between 0 and 15, received -1',
      )
    }
    const invalidObject = redstonePower({ toString: '' })
    expect(invalidObject._tag).toBe('Invalid')
    if (invalidObject._tag === 'Invalid') {
      expect(invalidObject.error[0]?.message).toBe(
        'Redstone power must be an integer between 0 and 15, received object',
      )
    }
  })

  it('property-checks arbitrary power input and schema-decodes valid output', () => {
    fc.assert(fc.property(fc.anything(), (input) => {
      const result = redstonePower(input)
      const validPower = typeof input === 'number' && Number.isInteger(input) && input >= 0 && input <= 15
      expect(result._tag).toBe(validPower ? 'Valid' : 'Invalid')
      if (result._tag === 'Valid') {
        expect(Schema.decodeUnknownOption(Schema.Number)(result.value)._tag).toBe('Some')
      }
    }))
  })
})

describe('redstone device definitions', () => {
  it('validates orientation, delay, and comparator mode at construction', () => {
    expect(valid(redstoneRepeater('north', 4, true))).toEqual({
      delayTicks: 4,
      facing: 'north',
      kind: 'repeater',
      locked: true,
    })
    expect(valid(redstoneComparator('south', 'subtract'))).toEqual({
      facing: 'south',
      kind: 'comparator',
      mode: 'subtract',
    })
    expect(valid(redstoneObserver('up'))).toEqual({ facing: 'up', kind: 'observer' })
    expect(redstoneRepeater('up')._tag).toBe('Invalid')
    expect(redstoneRepeater('east', 0)._tag).toBe('Invalid')
    expect(redstoneRepeater('east', 5)._tag).toBe('Invalid')
    expect(redstoneComparator('east', 'invalid')._tag).toBe('Invalid')
    const invalidFacingComparator = redstoneComparator('up', 'compare')
    expect(invalidFacingComparator._tag).toBe('Invalid')
    if (invalidFacingComparator._tag === 'Invalid') {
      expect(invalidFacingComparator.error[0]?.message).toBe(
        'Redstone device facing must be horizontal, received up',
      )
    }
    expect(redstoneObserver('diagonal')._tag).toBe('Invalid')
    const invalidRepeater = redstoneRepeater('up', 0)
    if (invalidRepeater._tag === 'Invalid') {
      expect(invalidRepeater.error[0]?.message).toBe(
        'Repeater delay must be an integer between 1 and 4, received 0',
      )
    }
    const invalidComparator = redstoneComparator('up', 'invalid')
    if (invalidComparator._tag === 'Invalid') {
      expect(invalidComparator.error[0]?.message).toBe('Redstone comparator mode is invalid: invalid')
    }
  })

  it('returns typed delay failures at and just outside both boundaries', () => {
    expect(repeaterDelayTicks(1)._tag).toBe('Valid')
    expect(repeaterDelayTicks(4)._tag).toBe('Valid')
    expect(repeaterDelayTicks(0)._tag).toBe('Invalid')
    expect(repeaterDelayTicks(5)._tag).toBe('Invalid')
    expect(repeaterDelayTicks(1.5)._tag).toBe('Invalid')
    expect(repeaterDelayTicks(Number.NaN)._tag).toBe('Invalid')
    expect(repeaterDelayTicks(Number.POSITIVE_INFINITY)._tag).toBe('Invalid')
    const invalid = repeaterDelayTicks(0)
    if (invalid._tag === 'Invalid') {
      expect(invalid.error[0]?.message).toBe(
        'Repeater delay must be an integer between 1 and 4, received 0',
      )
    }
    const invalidObject = repeaterDelayTicks({ toString: '' })
    expect(invalidObject._tag).toBe('Invalid')
    if (invalidObject._tag === 'Invalid') {
      expect(invalidObject.error[0]?.message).toBe(
        'Repeater delay must be an integer between 1 and 4, received object',
      )
    }
  })

  it('property-checks repeater delays and schema-decodes valid output', () => {
    fc.assert(fc.property(fc.anything(), (input) => {
      const result = repeaterDelayTicks(input)
      const validDelay = typeof input === 'number' && Number.isInteger(input) && input >= 1 && input <= 4
      expect(result._tag).toBe(validDelay ? 'Valid' : 'Invalid')
      if (result._tag === 'Valid') {
        expect(Schema.decodeUnknownOption(Schema.Number)(result.value)._tag).toBe('Some')
      }
    }))
  })

  it('property-checks redstone device constructors and schema-decodes every valid device', () => {
    const horizontalFaces = new Set(['north', 'south', 'east', 'west'])
    const allFaces = new Set(['north', 'south', 'east', 'west', 'up', 'down'])
    const repeaterSchema = Schema.Struct({
      delayTicks: Schema.Number,
      facing: Schema.Literal('north', 'south', 'east', 'west'),
      kind: Schema.Literal('repeater'),
      locked: Schema.Boolean,
    })
    const comparatorSchema = Schema.Struct({
      facing: Schema.Literal('north', 'south', 'east', 'west'),
      kind: Schema.Literal('comparator'),
      mode: Schema.Literal('compare', 'subtract'),
    })
    const observerSchema = Schema.Struct({
      facing: Schema.Literal('north', 'south', 'east', 'west', 'up', 'down'),
      kind: Schema.Literal('observer'),
    })

    fc.assert(fc.property(fc.string(), fc.integer(), fc.boolean(), (facing, delay, locked) => {
      const result = redstoneRepeater(facing, delay, locked)
      const accepted = horizontalFaces.has(facing) && delay >= 1 && delay <= 4
      expect(result._tag).toBe(accepted ? 'Valid' : 'Invalid')
      if (result._tag === 'Valid') {
        expect(Schema.decodeUnknownOption(repeaterSchema)(result.value)._tag).toBe('Some')
      }
    }))

    fc.assert(fc.property(fc.string(), fc.string(), (facing, mode) => {
      const result = redstoneComparator(facing, mode)
      const accepted = horizontalFaces.has(facing) && (mode === 'compare' || mode === 'subtract')
      expect(result._tag).toBe(accepted ? 'Valid' : 'Invalid')
      if (result._tag === 'Valid') {
        expect(Schema.decodeUnknownOption(comparatorSchema)(result.value)._tag).toBe('Some')
      }
    }))

    fc.assert(fc.property(fc.string(), (facing) => {
      const result = redstoneObserver(facing)
      expect(result._tag).toBe(allFaces.has(facing) ? 'Valid' : 'Invalid')
      if (result._tag === 'Valid') {
        expect(Schema.decodeUnknownOption(observerSchema)(result.value)._tag).toBe('Some')
      }
    }))
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
      valid(redstoneComparator('east')),
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
      valid(redstoneComparator('east')),
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
      valid(redstoneRepeater('east', 2)),
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
      valid(redstoneRepeater('east', 2, true)),
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
      valid(redstoneRepeater('east', 2)),
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
      valid(redstoneComparator('east')),
    )
    const compared = updateRedstone(world, compareState)
    expect(redstoneDevicePowerAt(compared.state, comparator)).toBe(15)
    expect(redstonePowerAt(compared.state, outputWire)).toBe(15)

    const subtractState = setRedstoneDevice(
      compared.state,
      comparator,
      valid(redstoneComparator('east', 'subtract')),
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
      valid(redstoneComparator('east')),
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
      valid(redstoneObserver('east')),
    )
    state = setRedstoneDevice(state, comparator, valid(redstoneComparator('west')))
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
      valid(redstoneObserver('east')),
    )

    const result = updateRedstone(world, state)

    expect(result.state.observerSnapshots.get(blockPositionKeyOf(observer))).toBe(
      `${blockIdOf('stone')}:unknown:0:0`,
    )
  })
})
