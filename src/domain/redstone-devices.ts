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

export const repeaterDelayTicks: Brand.Brand.Constructor<RepeaterDelayTicks> = Brand.refined<RepeaterDelayTicks>(
  (value) =>
    Number.isInteger(value) &&
    value >= REDSTONE_REPEATER_DELAY_MIN_TICKS &&
    value <= REDSTONE_REPEATER_DELAY_MAX_TICKS,
  (value) =>
    Brand.error(
      `Repeater delay must be an integer between ${REDSTONE_REPEATER_DELAY_MIN_TICKS} and ${REDSTONE_REPEATER_DELAY_MAX_TICKS}, received ${value}`,
    ),
)

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
  HORIZONTAL_BLOCK_FACES.includes(value as HorizontalRedstoneFace)

const requireHorizontalFace = (facing: string): HorizontalRedstoneFace => {
  if (!isHorizontalRedstoneFace(facing)) {
    throw new RangeError(`Redstone device facing must be horizontal, received ${facing}`)
  }

  return facing
}

export const redstoneRepeater = (
  facing: string,
  delayTicks: number = REDSTONE_REPEATER_DELAY_MIN_TICKS,
  locked = false,
): RedstoneRepeater => ({
  delayTicks: repeaterDelayTicks(delayTicks),
  facing: requireHorizontalFace(facing),
  kind: 'repeater',
  locked,
})

export const redstoneComparator = (
  facing: string,
  mode: RedstoneComparatorMode = 'compare',
): RedstoneComparator => {
  if (mode !== 'compare' && mode !== 'subtract') {
    throw new RangeError(`Redstone comparator mode is invalid: ${mode}`)
  }

  return {
    facing: requireHorizontalFace(facing),
    kind: 'comparator',
    mode,
  }
}

export const redstoneObserver = (facing: string): RedstoneObserver => {
  if (!isBlockFace(facing)) {
    throw new RangeError(
      `Redstone observer facing must be one of ${BLOCK_FACES.join(', ')}, received ${facing}`,
    )
  }

  return { facing, kind: 'observer' }
}
