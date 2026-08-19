import {
  type AABB,
  type BlockId,
  type BlockPosition,
  aabbIntersects,
  aabbOfBlock,
  blockPosition,
  isKnownBlockId,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import { type BlockSource, readBlockAt } from './block-world.js'
import { type Damage } from '@nerima-games/mc-sim'
import { blockCollisionFor } from './block-collision.js'

export const BLOCK_CONTACT_DAMAGE_CAUSE = 'block_contact'

const GRID_STEP = 1
const NO_CONTACT_DAMAGE = 0

export type BlockContact = {
  readonly blockId: BlockId
  readonly bounds: AABB
  readonly damage: number
  readonly position: BlockPosition
}

const coordinatesIn = (min: number, max: number): ReadonlyArray<number> => {
  const first = Math.floor(min)
  const exclusiveLast = Math.ceil(max)
  const coordinates: Array<number> = []

  for (
    let coordinate = first;
    coordinate < exclusiveLast;
    coordinate += GRID_STEP
  ) {
    coordinates.push(coordinate)
  }

  return coordinates
}

const contactBoundsAt = (blockId: BlockId, position: BlockPosition): AABB =>
  blockCollisionFor(blockId, position)?.bounds ?? aabbOfBlock(position)

export const blockContactAt = (
  source: BlockSource,
  position: BlockPosition,
): BlockContact | null => {
  const blockId = readBlockAt(source, position)
  if (!isKnownBlockId(blockId)) {
    return null
  }

  const damage = propertyOfBlockId(blockId, 'contactDamage')
  if (damage <= NO_CONTACT_DAMAGE) {
    return null
  }

  return {
    blockId,
    bounds: contactBoundsAt(blockId, position),
    damage,
    position,
  }
}

export const blockContactsIn = (
  source: BlockSource,
  bounds: AABB,
): ReadonlyArray<BlockContact> => {
  const contacts: Array<BlockContact> = []

  for (const blockX of coordinatesIn(bounds.min.x, bounds.max.x)) {
    for (const blockY of coordinatesIn(bounds.min.y, bounds.max.y)) {
      for (const blockZ of coordinatesIn(bounds.min.z, bounds.max.z)) {
        const position = blockPosition(blockX, blockY, blockZ)
        const contact = blockContactAt(source, position)
        if (contact && aabbIntersects(contact.bounds, bounds)) {
          contacts.push(contact)
        }
      }
    }
  }

  return contacts
}

export const blockContactDamageIn = (
  source: BlockSource,
  bounds: AABB,
): Damage | undefined => {
  const amount = blockContactsIn(source, bounds).reduce(
    (total, contact) => total + contact.damage,
    NO_CONTACT_DAMAGE,
  )
  if (amount <= NO_CONTACT_DAMAGE) {
    return
  }

  return { amount, cause: BLOCK_CONTACT_DAMAGE_CAUSE }
}
