import {
  AIR_BLOCK_ID,
  BlockId,
  blockIdOf,
  blockPosition,
  capabilityOfBlockId,
  isKnownBlockId,
  isSupportSensitiveBlockId,
  type ItemType,
} from '@nerima-games/mc-kernel'
import {
  durabilityForItem,
  emptyInventory,
  itemStack,
  storageFromInventory,
  type Inventory,
} from '@nerima-games/mc-sim'
import { describe, expect, it } from 'vitest'
import {
  blockAt,
  blockReaderOf,
  breakBlock,
  emptyBlockWorld,
  makeBlockInteractionState,
  placeBlock,
  removeUnsupportedBlocksAbove,
  readBlockAt,
  setBlockAt,
} from '../src/domain/block-interaction'

const position = blockPosition(4, 64, -3)

const inventoryWith = (item: ItemType, count: number, slot = 0): Inventory => {
  const inventory = emptyInventory()
  const slots = [...inventory.slots]
  slots[slot] = itemStack(item, count)
  return { slots }
}

describe('block interaction', () => {
  it('reads absent cells as air and copies world updates', () => {
    const world = emptyBlockWorld()
    const dirtWorld = setBlockAt(world, position, blockIdOf('dirt'))
    const clearedWorld = setBlockAt(dirtWorld, position, AIR_BLOCK_ID)

    expect(blockAt(world, position)).toBe(AIR_BLOCK_ID)
    expect(blockAt(dirtWorld, position)).toBe(blockIdOf('dirt'))
    expect(readBlockAt(dirtWorld, position)).toBe(blockIdOf('dirt'))
    expect(readBlockAt(blockReaderOf(dirtWorld), position)).toBe(blockIdOf('dirt'))
    expect(blockAt(clearedWorld, position)).toBe(AIR_BLOCK_ID)
    expect(blockAt(world, position)).toBe(AIR_BLOCK_ID)
  })

  it('breaks a known block, resolves its kernel drop, and adds it to inventory', () => {
    const state = makeBlockInteractionState(setBlockAt(emptyBlockWorld(), position, blockIdOf('dirt')))
    const result = breakBlock(state, { position })

    expect(result.outcome).toBe('broken')
    expect(result.blockId).toBe(blockIdOf('dirt'))
    expect(result.drop).toEqual({ item: 'dirt', count: 1, affectedByFortune: false })
    expect(result.experience).toBe(0)
    expect(result.leftover).toBe(0)
    expect(blockAt(result.state.world, position)).toBe(AIR_BLOCK_ID)
    expect(result.state.playerStorage.inventory.slots[0]).toEqual(itemStack('dirt', 1))
  })

  it('damages the selected tool as part of a successful break transition', () => {
    const state = makeBlockInteractionState(
      setBlockAt(emptyBlockWorld(), position, blockIdOf('dirt')),
      storageFromInventory(inventoryWith('wooden_pickaxe', 1)),
    )
    const maximumDurability = durabilityForItem('wooden_pickaxe')?.max ?? 0
    const result = breakBlock(state, {
      position,
      harvestContext: { heldTier: 'wooden' },
      toolLocation: { _tag: 'Inventory', slotIndex: 0 },
    })

    expect(result.toolDamage?._tag).toBe('Damaged')
    expect(result.state.playerStorage.inventory.slots[0]).toEqual(
      itemStack('wooden_pickaxe', 1),
    )
    expect(result.state.playerStorage.inventoryDurability[0]).toEqual({
      current: maximumDurability - 1,
      max: maximumDurability,
    })
    expect(state.playerStorage.inventoryDurability[0]).toEqual({
      current: maximumDurability,
      max: maximumDurability,
    })
    expect(blockAt(state.world, position)).toBe(blockIdOf('dirt'))
  })

  it('breaks a block with no bare-handed drop without inventing an item', () => {
    const state = makeBlockInteractionState(setBlockAt(emptyBlockWorld(), position, blockIdOf('stone')))
    const result = breakBlock(state, { position })

    expect(result.outcome).toBe('broken')
    expect(result.drop).toBeUndefined()
    expect(result.experience).toBe(0)
    expect(result.leftover).toBe(0)
    expect(result.state.playerStorage).toBe(state.playerStorage)
    expect(blockAt(result.state.world, position)).toBe(AIR_BLOCK_ID)
  })

  it('detaches an unsupported vertical chain and adds its kernel drops in order', () => {
    const railPosition = blockPosition(position.x, position.y + 1, position.z)
    const torchPosition = blockPosition(position.x, position.y + 2, position.z)
    const world = setBlockAt(
      setBlockAt(
        setBlockAt(emptyBlockWorld(), position, blockIdOf('stone')),
        railPosition,
        blockIdOf('rail'),
      ),
      torchPosition,
      blockIdOf('torch'),
    )

    const result = breakBlock(makeBlockInteractionState(world), { position })

    expect(result.detached?.map(({ position: detachedPosition }) => detachedPosition)).toEqual([
      railPosition,
      torchPosition,
    ])
    expect(result.detached?.map(({ blockId }) => blockId)).toEqual([
      blockIdOf('rail'),
      blockIdOf('torch'),
    ])
    expect(result.detached?.map(({ transition }) => transition)).toEqual([
      'detached',
      'detached',
    ])
    expect(result.detached?.every(({ leftover }) => leftover === 0)).toBe(true)
    expect(result.state.playerStorage.inventory.slots[0]).toEqual(itemStack('rail', 1))
    expect(result.state.playerStorage.inventory.slots[1]).toEqual(itemStack('torch', 1))
    expect(blockAt(result.state.world, railPosition)).toBe(AIR_BLOCK_ID)
    expect(blockAt(result.state.world, torchPosition)).toBe(AIR_BLOCK_ID)
  })

  it('returns detached leftovers when the inventory cannot accept their drops', () => {
    const abovePosition = blockPosition(position.x, position.y + 1, position.z)
    const fullInventory: Inventory = {
      slots: Array.from({ length: 36 }, () => itemStack('stone', 64)),
    }
    const world = setBlockAt(
      setBlockAt(emptyBlockWorld(), position, blockIdOf('stone')),
      abovePosition,
      blockIdOf('torch'),
    )
    const result = breakBlock(
      makeBlockInteractionState(world, storageFromInventory(fullInventory)),
      { position },
    )

    expect(result.detached?.[0]?.leftover).toBe(1)
    expect(result.state.playerStorage.inventory).toStrictEqual(fullInventory)
  })

  it('preserves supported, ordinary, unknown, and empty cells during support scans', () => {
    const abovePosition = blockPosition(position.x, position.y + 1, position.z)
    const supportWorld = setBlockAt(emptyBlockWorld(), position, blockIdOf('stone'))
    const supportedWorld = setBlockAt(supportWorld, abovePosition, blockIdOf('torch'))
    const supported = removeUnsupportedBlocksAbove(supportedWorld, position)
    const ordinaryWorld = setBlockAt(supportWorld, abovePosition, blockIdOf('dirt'))
    const ordinary = removeUnsupportedBlocksAbove(ordinaryWorld, position)
    const unknownBlockId = BlockId(255)
    const unknownWorld = setBlockAt(supportWorld, abovePosition, unknownBlockId)
    const unknown = removeUnsupportedBlocksAbove(unknownWorld, position)
    const empty = removeUnsupportedBlocksAbove(emptyBlockWorld(), position)

    expect(supported.removed).toEqual([])
    expect(supported.world).toBe(supportedWorld)
    expect(ordinary.removed).toEqual([])
    expect(ordinary.world).toBe(ordinaryWorld)
    expect(unknown.removed).toEqual([])
    expect(unknown.world).toBe(unknownWorld)
    expect(empty.removed).toEqual([])
  })

  it('reports kernel falling transitions without dropping items immediately', () => {
    const sandPosition = blockPosition(position.x, position.y + 1, position.z)
    const sandWorld = setBlockAt(
      setBlockAt(emptyBlockWorld(), position, blockIdOf('stone')),
      sandPosition,
      blockIdOf('sand'),
    )
    const stable = removeUnsupportedBlocksAbove(sandWorld, position)
    const falling = removeUnsupportedBlocksAbove(
      setBlockAt(emptyBlockWorld(), sandPosition, blockIdOf('sand')),
      position,
    )

    expect(capabilityOfBlockId(blockIdOf('sand'), 'fallsWhenUnsupported')).toBe(true)
    expect(stable.removed).toEqual([])
    expect(stable.world).toBe(sandWorld)
    expect(falling.removed).toEqual([
      { blockId: blockIdOf('sand'), position: sandPosition, transition: 'falling' },
    ])
    expect(blockAt(falling.world, sandPosition)).toBe(AIR_BLOCK_ID)
  })

  it('keeps falling blocks out of the inventory while returning the transition', () => {
    const sandPosition = blockPosition(position.x, position.y + 1, position.z)
    const world = setBlockAt(
      setBlockAt(emptyBlockWorld(), position, blockIdOf('stone')),
      sandPosition,
      blockIdOf('sand'),
    )
    const state = makeBlockInteractionState(world)
    const result = breakBlock(state, { position })

    expect(result.detached).toEqual([
      {
        blockId: blockIdOf('sand'),
        position: sandPosition,
        transition: 'falling',
        leftover: 0,
      },
    ])
    expect(result.state.playerStorage).toBe(state.playerStorage)
    expect(blockAt(result.state.world, sandPosition)).toBe(AIR_BLOCK_ID)
  })

  it('removes unsupported blocks without manufacturing a missing drop', () => {
    const abovePosition = blockPosition(position.x, position.y + 1, position.z)
    const pressurePlate = blockIdOf('pressure_plate')
    const result = removeUnsupportedBlocksAbove(
      setBlockAt(emptyBlockWorld(), abovePosition, pressurePlate),
      position,
    )

    expect(isSupportSensitiveBlockId(pressurePlate)).toBe(true)
    expect(result.removed).toEqual([
      { blockId: pressurePlate, position: abovePosition, transition: 'detached' },
    ])
    expect(blockAt(result.world, abovePosition)).toBe(AIR_BLOCK_ID)
  })

  it('stops support scans at the maximum block height', () => {
    const world = emptyBlockWorld()
    const result = removeUnsupportedBlocksAbove(
      world,
      blockPosition(position.x, Number.MAX_SAFE_INTEGER, position.z),
    )

    expect(result.removed).toEqual([])
    expect(result.world).toBe(world)
  })

  it('leaves air and unknown block ids untouched', () => {
    const airState = makeBlockInteractionState()
    const airResult = breakBlock(airState, { position })
    const unknownBlockId = BlockId(255)
    const unknownState = makeBlockInteractionState(setBlockAt(emptyBlockWorld(), position, unknownBlockId))
    const unknownResult = breakBlock(unknownState, { position })

    expect(airResult.outcome).toBe('empty')
    expect(airResult.state).toBe(airState)
    expect(isKnownBlockId(unknownBlockId)).toBe(false)
    expect(unknownResult.outcome).toBe('unknown')
    expect(unknownResult.state).toBe(unknownState)
  })

  it('reports a full inventory instead of discarding a resolved drop', () => {
    const fullInventory: Inventory = {
      slots: Array.from({ length: 36 }, () => itemStack('stone', 64)),
    }
    const state = makeBlockInteractionState(
      setBlockAt(emptyBlockWorld(), position, blockIdOf('dirt')),
      storageFromInventory(fullInventory),
    )
    const result = breakBlock(state, { position })

    expect(result.outcome).toBe('broken')
    expect(result.drop?.item).toBe('dirt')
    expect(result.leftover).toBe(1)
    expect(result.state.playerStorage.inventory).toStrictEqual(fullInventory)
  })

  it('exposes kernel mining experience only for a harvestable non-silk drop', () => {
    const oreState = makeBlockInteractionState(
      setBlockAt(emptyBlockWorld(), position, blockIdOf('coal_ore')),
    )
    const harvested = breakBlock(oreState, {
      position,
      harvestContext: { heldTier: 'wooden' },
    })
    const bareHanded = breakBlock(
      makeBlockInteractionState(setBlockAt(emptyBlockWorld(), position, blockIdOf('coal_ore'))),
      { position },
    )
    const silkTouched = breakBlock(
      makeBlockInteractionState(setBlockAt(emptyBlockWorld(), position, blockIdOf('coal_ore'))),
      {
        position,
        harvestContext: { heldTier: 'wooden', silkTouch: true },
      },
    )

    expect(harvested.drop?.item).toBe('coal')
    expect(harvested.experience).toBe(5)
    expect(bareHanded.drop).toBeUndefined()
    expect(bareHanded.experience).toBe(0)
    expect(silkTouched.drop?.item).toBe('coal_ore')
    expect(silkTouched.experience).toBe(0)
  })

  it('places a selected placeable item and consumes one item', () => {
    const state = makeBlockInteractionState(
      emptyBlockWorld(),
      storageFromInventory(inventoryWith('dirt', 2)),
    )
    const result = placeBlock(state, { position, inventorySlot: 0 })

    expect(result.outcome).toBe('placed')
    expect(result.blockId).toBe(blockIdOf('dirt'))
    expect(result.replacedBlockId).toBeUndefined()
    expect(result.item).toBe('dirt')
    expect(blockAt(result.state.world, position)).toBe(blockIdOf('dirt'))
    expect(result.state.playerStorage.inventory.slots[0]).toEqual(itemStack('dirt', 1))
  })

  it('replaces a kernel-marked replaceable block and records the replacement', () => {
    const replaceableBlockId = blockIdOf('water')
    const state = makeBlockInteractionState(
      setBlockAt(emptyBlockWorld(), position, replaceableBlockId),
      storageFromInventory(inventoryWith('dirt', 1)),
    )
    const result = placeBlock(state, { position, inventorySlot: 0 })

    expect(capabilityOfBlockId(replaceableBlockId, 'replaceable')).toBe(true)
    expect(result.outcome).toBe('placed')
    expect(result.replacedBlockId).toBe(replaceableBlockId)
    expect(blockAt(result.state.world, position)).toBe(blockIdOf('dirt'))
    expect(result.state.playerStorage.inventory.slots[0]).toBeUndefined()
  })

  it('requires kernel-defined support for support-sensitive blocks without consuming the item', () => {
    const torchPosition = blockPosition(position.x, position.y + 1, position.z)
    const state = makeBlockInteractionState(
      emptyBlockWorld(),
      storageFromInventory(inventoryWith('torch', 1)),
    )
    const unsupported = placeBlock(state, { position: torchPosition, inventorySlot: 0 })

    expect(isSupportSensitiveBlockId(blockIdOf('torch'))).toBe(true)
    expect(unsupported.outcome).toBe('unsupported')
    expect(unsupported.state).toBe(state)

    const supportedState = makeBlockInteractionState(
      setBlockAt(emptyBlockWorld(), position, blockIdOf('stone')),
      storageFromInventory(inventoryWith('torch', 1)),
    )
    const supported = placeBlock(supportedState, { position: torchPosition, inventorySlot: 0 })

    expect(supported.outcome).toBe('placed')
    expect(blockAt(supported.state.world, torchPosition)).toBe(blockIdOf('torch'))
    expect(supported.state.playerStorage.inventory.slots[0]).toBeUndefined()
  })

  it('rejects placement without consuming items when the target or slot is unusable', () => {
    const occupiedState = makeBlockInteractionState(
      setBlockAt(emptyBlockWorld(), position, blockIdOf('stone')),
      storageFromInventory(inventoryWith('dirt', 1)),
    )
    const emptySlotState = makeBlockInteractionState()
    const nonPlaceableState = makeBlockInteractionState(
      emptyBlockWorld(),
      storageFromInventory(inventoryWith('stick', 1)),
    )
    const unknownBlockId = BlockId(255)
    const unknownOccupiedState = makeBlockInteractionState(
      setBlockAt(emptyBlockWorld(), position, unknownBlockId),
      storageFromInventory(inventoryWith('dirt', 1)),
    )
    const malformedInventory: Inventory = {
      slots: [...emptyInventory().slots, itemStack('dirt', 1)],
    }
    const invalidSlotState = makeBlockInteractionState(
      emptyBlockWorld(),
      storageFromInventory(malformedInventory),
    )

    expect(placeBlock(occupiedState, { position, inventorySlot: 0 }).outcome).toBe('occupied')
    expect(placeBlock(unknownOccupiedState, { position, inventorySlot: 0 }).outcome).toBe('occupied')
    expect(placeBlock(emptySlotState, { position, inventorySlot: 0 }).outcome).toBe('empty-slot')
    expect(placeBlock(nonPlaceableState, { position, inventorySlot: 0 }).outcome).toBe('not-placeable')
    expect(placeBlock(invalidSlotState, { position, inventorySlot: 36 }).outcome).toBe('invalid-slot')
    expect(blockAt(occupiedState.world, position)).toBe(blockIdOf('stone'))
    expect(blockAt(unknownOccupiedState.world, position)).toBe(unknownBlockId)
    expect(nonPlaceableState.playerStorage.inventory.slots[0]).toEqual(itemStack('stick', 1))
  })
})
