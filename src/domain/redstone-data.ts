import { blockIdOf } from '@nerima-games/mc-kernel'

export const REDSTONE_POWER_MIN = 0
export const REDSTONE_POWER_MAX = 15
export const REDSTONE_POWER_STEP = 1

export const REDSTONE_BLOCK_IDS = {
  block: blockIdOf('redstone_block'),
  comparator: blockIdOf('comparator'),
  lamp: blockIdOf('redstone_lamp'),
  lampLit: blockIdOf('redstone_lamp_lit'),
  lever: blockIdOf('lever'),
  observer: blockIdOf('observer'),
  pressurePlate: blockIdOf('pressure_plate'),
  repeater: blockIdOf('repeater'),
  stoneButton: blockIdOf('stone_button'),
  torch: blockIdOf('redstone_torch'),
  wire: blockIdOf('redstone_wire'),
} as const
