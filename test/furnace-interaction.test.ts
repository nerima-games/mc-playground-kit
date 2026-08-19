import { itemStack, emptyInventory, type Inventory } from '@nerima-games/mc-sim'
import { describe, expect, it } from 'vitest'
import {
  advanceFurnace,
  collectFurnaceOutput,
  makeFurnaceInteractionState,
  transferItemsToFurnace,
} from '../src/domain/furnace-interaction'

const inventoryWith = (...items: ReadonlyArray<ReturnType<typeof itemStack>>): Inventory => ({
  slots: [...items, ...emptyInventory().slots.slice(items.length)],
})

describe('furnace interaction', () => {
  it('composes a caller inventory with a fresh upstream furnace state', () => {
    const inventory = emptyInventory()
    const state = makeFurnaceInteractionState(inventory)

    expect(state.inventory).toBe(inventory)
    expect(state.furnace).toStrictEqual({
      burnRemainingSecs: 0,
      cookElapsedSecs: 0,
      fuel: null,
      input: null,
      output: null,
    })
  })

  it('transfers input and fuel through the upstream atomic transitions', () => {
    const state = makeFurnaceInteractionState(
      inventoryWith(itemStack('raw_iron', 1), itemStack('coal', 1)),
    )
    const input = transferItemsToFurnace(state, {
      count: 1,
      item: 'raw_iron',
      slot: 'input',
    })
    const fuel = transferItemsToFurnace(input.state, {
      count: 1,
      item: 'coal',
      slot: 'fuel',
    })

    expect(input.result).toStrictEqual({ _tag: 'Transferred', count: 1, item: 'raw_iron' })
    expect(fuel.result).toStrictEqual({ _tag: 'Transferred', count: 1, item: 'coal' })
    expect(fuel.state.furnace.input).toEqual(itemStack('raw_iron', 1))
    expect(fuel.state.furnace.fuel).toEqual(itemStack('coal', 1))
    expect(fuel.state.inventory.slots[0]).toBeUndefined()
    expect(fuel.state.inventory.slots[1]).toBeUndefined()
  })

  it('keeps both values unchanged when a furnace transfer is rejected', () => {
    const state = makeFurnaceInteractionState(inventoryWith(itemStack('raw_iron', 1)))
    const transition = transferItemsToFurnace(state, {
      count: 2,
      item: 'raw_iron',
      slot: 'input',
    })

    expect(transition.result).toStrictEqual({ _tag: 'InsufficientItems', available: 1 })
    expect(transition.state.inventory).toBe(state.inventory)
    expect(transition.state.furnace).toBe(state.furnace)
  })

  it('advances the furnace without taking ownership of the inventory', () => {
    const inventory = inventoryWith(itemStack('coal', 1))
    const state = makeFurnaceInteractionState(inventory, {
      burnRemainingSecs: 0,
      cookElapsedSecs: 0,
      fuel: itemStack('coal', 1),
      input: itemStack('raw_iron', 1),
      output: null,
    })
    const transition = advanceFurnace(state, { deltaTimeSecs: 10 })

    expect(transition.fuelConsumed).toBe(1)
    expect(transition.smelted).toBe(1)
    expect(transition.state.inventory).toBe(inventory)
    expect(transition.state.furnace.input).toBeNull()
    expect(transition.state.furnace.output).toEqual(itemStack('iron_ingot', 1))
    expect(transition.state.furnace.burnRemainingSecs).toBe(70)
  })

  it('collects output atomically into the player inventory', () => {
    const state = makeFurnaceInteractionState(
      emptyInventory(),
      {
        burnRemainingSecs: 0,
        cookElapsedSecs: 0,
        fuel: null,
        input: null,
        output: itemStack('iron_ingot', 1),
      },
    )
    const transition = collectFurnaceOutput(state)

    expect(transition.result).toStrictEqual({
      _tag: 'Collected',
      output: itemStack('iron_ingot', 1),
    })
    expect(transition.state.furnace.output).toBeNull()
    expect(transition.state.inventory.slots[0]).toEqual(itemStack('iron_ingot', 1))
  })

  it('does not discard output when the player inventory has no room', () => {
    const fullInventory: Inventory = {
      slots: Array.from({ length: 36 }, () => itemStack('stone', 64)),
    }
    const state = makeFurnaceInteractionState(fullInventory, {
      burnRemainingSecs: 0,
      cookElapsedSecs: 0,
      fuel: null,
      input: null,
      output: itemStack('iron_ingot', 1),
    })
    const transition = collectFurnaceOutput(state)

    expect(transition.result).toStrictEqual({ _tag: 'NoRoom' })
    expect(transition.state.inventory).toBe(fullInventory)
    expect(transition.state.furnace.output).toEqual(itemStack('iron_ingot', 1))
  })
})
