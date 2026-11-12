import {
  BLOCK_FACES,
  type BlockFace,
  HORIZONTAL_BLOCK_FACES,
  isBlockFace,
} from '@nerima-games/mc-kernel'
import { Brand } from 'effect'

export type HorizontalRedstoneFace = (typeof HORIZONTAL_BLOCK_FACES)[number]

export const REDSTONE_REPEATER_DELAY_MIN_TICKS = 1
export const REDSTONE_REPEATER_DELAY_MAX_TICKS = 4

export type RepeaterDelayTicks = number & Brand.Brand<'RepeaterDelayTicks'>

type RepeaterDelayTicksResult =
  | { readonly _tag: 'Valid'; readonly value: RepeaterDelayTicks }
  | { readonly _tag: 'Invalid'; readonly error: ReturnType<typeof Brand.error> }

type RedstoneDeviceResult<A> =
  | { readonly _tag: 'Valid'; readonly value: A }
  | { readonly _tag: 'Invalid'; readonly error: ReturnType<typeof Brand.error> }

const repeaterDelayTicksBrand = Brand.nominal<RepeaterDelayTicks>()

const safeValueLabel = (value: unknown): string => {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    return typeof value
  }
  return String(value)
}

const isRepeaterDelayTicks = (value: unknown): value is RepeaterDelayTicks =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= REDSTONE_REPEATER_DELAY_MIN_TICKS &&
  value <= REDSTONE_REPEATER_DELAY_MAX_TICKS

export const repeaterDelayTicks = (value: unknown): RepeaterDelayTicksResult => {
  if (!isRepeaterDelayTicks(value)) {
    return {
      _tag: 'Invalid',
      error: Brand.error(
        `Repeater delay must be an integer between ${REDSTONE_REPEATER_DELAY_MIN_TICKS} and ${REDSTONE_REPEATER_DELAY_MAX_TICKS}, received ${safeValueLabel(value)}`,
      ),
    }
  }

  return { _tag: 'Valid', value: repeaterDelayTicksBrand(value) }
}

export type RedstoneRepeater = {
  readonly kind: 'repeater'
  readonly facing: HorizontalRedstoneFace
  readonly delayTicks: RepeaterDelayTicks
  readonly locked: boolean
}

export type RedstoneComparatorMode = 'compare' | 'subtract'

export type RedstoneComparator = {
  readonly kind: 'comparator'
  readonly facing: HorizontalRedstoneFace
  readonly mode: RedstoneComparatorMode
}

export type RedstoneObserver = {
  readonly kind: 'observer'
  readonly facing: BlockFace
}

export type RedstoneDevice =
  | RedstoneComparator
  | RedstoneObserver
  | RedstoneRepeater

const isHorizontalRedstoneFace = (
  value: string,
): value is HorizontalRedstoneFace =>
  HORIZONTAL_BLOCK_FACES.some((face) => face === value)

export const redstoneRepeater = (
  facing: string,
  delayTicks: number = REDSTONE_REPEATER_DELAY_MIN_TICKS,
  locked = false,
): RedstoneDeviceResult<RedstoneRepeater> => {
  const delayResult = repeaterDelayTicks(delayTicks)
  if (delayResult._tag === 'Invalid') {
    return delayResult
  }
  if (!isHorizontalRedstoneFace(facing)) {
    return {
      _tag: 'Invalid',
      error: Brand.error(`Redstone device facing must be horizontal, received ${safeValueLabel(facing)}`),
    }
  }

  return {
    _tag: 'Valid',
    value: {
      delayTicks: delayResult.value,
      facing,
      kind: 'repeater',
      locked,
    },
  }
}

export const redstoneComparator = (
  facing: string,
  mode: string = 'compare',
): RedstoneDeviceResult<RedstoneComparator> => {
  if (mode !== 'compare' && mode !== 'subtract') {
    return {
      _tag: 'Invalid',
      error: Brand.error(`Redstone comparator mode is invalid: ${safeValueLabel(mode)}`),
    }
  }
  if (!isHorizontalRedstoneFace(facing)) {
    return {
      _tag: 'Invalid',
      error: Brand.error(`Redstone device facing must be horizontal, received ${safeValueLabel(facing)}`),
    }
  }

  return {
    _tag: 'Valid',
    value: { facing, kind: 'comparator', mode },
  }
}

export const redstoneObserver = (facing: string): RedstoneDeviceResult<RedstoneObserver> => {
  if (!isBlockFace(facing)) {
    return {
      _tag: 'Invalid',
      error: Brand.error(
        `Redstone observer facing must be one of ${BLOCK_FACES.join(', ')}, received ${safeValueLabel(facing)}`,
      ),
    }
  }

  return { _tag: 'Valid', value: { facing, kind: 'observer' } }
}
