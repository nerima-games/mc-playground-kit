import {
  type AABB,
  type BlockId,
  type BlockPosition,
  type BlockPositionKey,
  LIGHT_LEVEL_MAX,
  type LightLevel,
  aabbIntersects,
  aabbOfBlock,
  blockNeighbours,
  blockPosition,
  blockPositionKeyOf,
  isKnownBlockId,
  position as kernelPosition,
  lightEmissionOfBlockId,
  LightLevel as makeLightLevel,
  transmitsLight,
} from '@nerima-games/mc-kernel'
import { type BlockSource, readBlockAt } from './block-world.js'

const GRID_STEP = 1
const DARK_LIGHT_LEVEL = 0
const NO_EMITTED_LIGHT = makeLightLevel(DARK_LIGHT_LEVEL)
const LIGHT_ATTENUATION = 1
const MAX_BLOCK_LIGHT_LEVEL = LIGHT_LEVEL_MAX

type LightQueueEntry = {
  readonly level: LightLevel
  readonly position: BlockPosition
}

type MutableBlockLightField = {
  readonly levels: Map<BlockPositionKey, LightLevel>
  readonly visible: Map<BlockPositionKey, LightLevel>
  readonly queue: Array<LightQueueEntry>
}

export type BlockLightSource = {
  readonly blockId: BlockId
  readonly bounds: AABB
  readonly level: LightLevel
  readonly position: BlockPosition
}

export type BlockLightField = ReadonlyMap<BlockPositionKey, LightLevel>

type LightPropagationContext = {
  readonly field: MutableBlockLightField
  readonly searchBounds: AABB
  readonly source: BlockSource
  readonly visibleBounds: AABB
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

export const blockLightSourceAt = (
  source: BlockSource,
  position: BlockPosition,
): BlockLightSource | null => {
  const blockId = readBlockAt(source, position)
  if (!isKnownBlockId(blockId)) {
    return null
  }

  const level = lightEmissionOfBlockId(blockId)
  if (level <= NO_EMITTED_LIGHT) {
    return null
  }

  return {
    blockId,
    bounds: aabbOfBlock(position),
    level,
    position,
  }
}

export const blockLightSourcesIn = (
  source: BlockSource,
  bounds: AABB,
): ReadonlyArray<BlockLightSource> => {
  const sources: Array<BlockLightSource> = []

  for (const blockX of coordinatesIn(bounds.min.x, bounds.max.x)) {
    for (const blockY of coordinatesIn(bounds.min.y, bounds.max.y)) {
      for (const blockZ of coordinatesIn(bounds.min.z, bounds.max.z)) {
        const position = blockPosition(blockX, blockY, blockZ)
        const sourceBlock = blockLightSourceAt(source, position)
        if (sourceBlock && aabbIntersects(sourceBlock.bounds, bounds)) {
          sources.push(sourceBlock)
        }
      }
    }
  }

  return sources
}

export const blockLightAt = (
  field: BlockLightField,
  position: BlockPosition,
): LightLevel => field.get(blockPositionKeyOf(position)) ?? NO_EMITTED_LIGHT

export const boundsExpandedForBlockLight = (bounds: AABB): AABB => ({
  max: kernelPosition(
    bounds.max.x + MAX_BLOCK_LIGHT_LEVEL,
    bounds.max.y + MAX_BLOCK_LIGHT_LEVEL,
    bounds.max.z + MAX_BLOCK_LIGHT_LEVEL,
  ),
  min: kernelPosition(
    bounds.min.x - MAX_BLOCK_LIGHT_LEVEL,
    bounds.min.y - MAX_BLOCK_LIGHT_LEVEL,
    bounds.min.z - MAX_BLOCK_LIGHT_LEVEL,
  ),
})

const blockOccupiesBounds = (position: BlockPosition, bounds: AABB): boolean =>
  aabbIntersects(aabbOfBlock(position), bounds)

const newMutableBlockLightField = (): MutableBlockLightField => ({
  levels: new Map(),
  queue: [],
  visible: new Map(),
})

const addBrighterLight = (
  context: LightPropagationContext,
  position: BlockPosition,
  level: LightLevel,
): void => {
  const key = blockPositionKeyOf(position)
  const knownLevel = context.field.levels.get(key) ?? NO_EMITTED_LIGHT
  if (knownLevel >= level) {
    return
  }

  context.field.levels.set(key, level)
  if (blockOccupiesBounds(position, context.visibleBounds)) {
    context.field.visible.set(key, level)
  }
  context.field.queue.push({ level, position })
}

const seedBlockLight = (context: LightPropagationContext): void => {
  for (const lightSource of blockLightSourcesIn(context.source, context.searchBounds)) {
    addBrighterLight(context, lightSource.position, lightSource.level)
  }
}

const transmitsBlockLight = (source: BlockSource, position: BlockPosition): boolean => {
  const blockId = readBlockAt(source, position)
  return isKnownBlockId(blockId) && transmitsLight(blockId)
}

const spreadLightFrom = (
  context: LightPropagationContext,
  current: LightQueueEntry,
): void => {
  const nextLevel = makeLightLevel(current.level - LIGHT_ATTENUATION)
  if (nextLevel <= NO_EMITTED_LIGHT) {
    return
  }

  for (const neighbour of blockNeighbours(current.position)) {
    if (
      blockOccupiesBounds(neighbour, context.searchBounds) &&
      transmitsBlockLight(context.source, neighbour)
    ) {
      addBrighterLight(context, neighbour, nextLevel)
    }
  }
}

export const propagateBlockLight = (
  source: BlockSource,
  bounds: AABB,
): BlockLightField => {
  const searchBounds = boundsExpandedForBlockLight(bounds)
  const field = newMutableBlockLightField()
  const context: LightPropagationContext = {
    field,
    searchBounds,
    source,
    visibleBounds: bounds,
  }
  seedBlockLight(context)

  // Array iteration re-reads the length on each step, so cells enqueued by
  // `spreadLightFrom` are still visited while draining the queue.
  for (const [, entry] of field.queue.entries()) {
    spreadLightFrom(context, entry)
  }

  return field.visible
}
