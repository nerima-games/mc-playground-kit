import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'

export const STATUS_EFFECT_TYPES = [
  'poison',
  'regeneration',
  'speed',
  'hunger',
  'nausea',
] as const

export type StatusEffectType = (typeof STATUS_EFFECT_TYPES)[number]

export type StatusEffectApplication = {
  readonly type: StatusEffectType
  readonly durationSecs: number
  readonly amplifier?: number
}

export type ActiveStatusEffect = {
  readonly type: StatusEffectType
  readonly remainingSecs: number
  readonly pulseClockSecs: number
  readonly amplifier?: number
}

export type StatusEffectState = {
  readonly effects: ReadonlyArray<ActiveStatusEffect>
}

export type StatusEffectTick = {
  readonly state: StatusEffectState
  readonly poisonPulses: number
  readonly regenerationPulses: number
  readonly movementSpeedMultiplier: number
  readonly hungerExhaustion: number
  readonly nauseaAmplifier: number | null
}

export type PlayerHealingEvent = {
  readonly _tag: 'StatusEffect'
  readonly effect: 'regeneration'
  readonly amount: number
  readonly maximumHealthPoints: number
}

export const POISON_INTERVAL_SECS = 1
export const REGENERATION_INTERVAL_SECS = 2.5
export const SPEED_MOVEMENT_MULTIPLIER = 1.2
export const POISON_DAMAGE_POINTS = 1
export const POISON_MINIMUM_HEALTH_POINTS = 1
export const REGENERATION_HEAL_POINTS = 1
export const PLAYER_MAXIMUM_HEALTH_POINTS = 20

const ZERO_SECONDS = 0
const ONE_SPEED_MULTIPLIER = 1
const HUNGER_EXHAUSTION_PER_SECOND = 0.1
const EFFECT_AMPLIFIER_BASE = 1
const EFFECT_INTERVAL_DIVISOR = 2

export const emptyStatusEffectState = (): StatusEffectState => ({ effects: [] })

const finiteDuration = (durationSecs: number): number => {
  if (!Number.isFinite(durationSecs)) {
    return ZERO_SECONDS
  }
  return Math.max(ZERO_SECONDS, durationSecs)
}

const finiteAmplifier = (amplifier: number | undefined): number => {
  const candidate = amplifier ?? ZERO_SECONDS
  if (!Number.isFinite(candidate)) {
    return ZERO_SECONDS
  }
  return Math.max(ZERO_SECONDS, Math.floor(candidate))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStatusEffectType = (value: unknown): value is StatusEffectType =>
  typeof value === 'string' && STATUS_EFFECT_TYPES.includes(value as StatusEffectType)

type OptionalProperty = {
  readonly present: boolean
  readonly value: unknown
}

const optionalProperty = (value: unknown, name: string): OptionalProperty => {
  if (!isRecord(value) || !(name in value)) {
    return { present: false, value: null }
  }
  return { present: true, value: value[name] }
}

export const isValidStatusEffectState = (
  value: unknown,
): value is StatusEffectState => {
  if (!isRecord(value) || !Array.isArray(value['effects'])) {
    return false
  }

  const effectTypes = new Set<StatusEffectType>()
  return value['effects'].every((effect) => {
    const amplifierProperty = optionalProperty(effect, 'amplifier')
    const hasAmplifier =
      amplifierProperty.present && typeof amplifierProperty.value !== 'undefined'
    if (
      !isRecord(effect) ||
      !isStatusEffectType(effect['type']) ||
      effectTypes.has(effect['type']) ||
      typeof effect['remainingSecs'] !== 'number' ||
      !Number.isFinite(effect['remainingSecs']) ||
      effect['remainingSecs'] <= ZERO_SECONDS ||
      typeof effect['pulseClockSecs'] !== 'number' ||
      !Number.isFinite(effect['pulseClockSecs']) ||
      effect['pulseClockSecs'] < ZERO_SECONDS ||
      (hasAmplifier &&
        (typeof amplifierProperty.value !== 'number' ||
          !Number.isSafeInteger(amplifierProperty.value) ||
          amplifierProperty.value < ZERO_SECONDS))
    ) {
      return false
    }

    effectTypes.add(effect['type'])
    return true
  })
}

export const copyStatusEffectState = (state: StatusEffectState): StatusEffectState => ({
  effects: state.effects.map((effect) => ({ ...effect })),
})

const appliedStatusEffectOf = ({
  current,
  type,
  durationSecs,
  amplifier,
}: {
  readonly current: ActiveStatusEffect | null
  readonly type: StatusEffectType
  readonly durationSecs: number
  readonly amplifier: number
}): ActiveStatusEffect => {
  if (current === null || finiteAmplifier(current.amplifier) < amplifier) {
    return {
      amplifier,
      pulseClockSecs: ZERO_SECONDS,
      remainingSecs: durationSecs,
      type,
    }
  }

  return {
    ...current,
    amplifier,
    remainingSecs: Math.max(current.remainingSecs, durationSecs),
  }
}

const statusEffectStateWith = (
  others: ReadonlyArray<ActiveStatusEffect>,
  next: ActiveStatusEffect,
): StatusEffectState => ({
  effects: STATUS_EFFECT_TYPES.flatMap((type) => {
    if (type === next.type) {
      return [next]
    }
    return others.filter((effect) => effect.type === type)
  }),
})

export const applyStatusEffect = (
  state: StatusEffectState,
  application: StatusEffectApplication,
): StatusEffectState => {
  const durationSecs = finiteDuration(application.durationSecs)
  const others = state.effects.filter((effect) => effect.type !== application.type)
  if (durationSecs === ZERO_SECONDS) {
    return { effects: others }
  }

  const amplifier = finiteAmplifier(application.amplifier)
  const current = state.effects.find((effect) => effect.type === application.type) ?? null
  if (current !== null && finiteAmplifier(current.amplifier) > amplifier) {
    return state
  }

  const next = appliedStatusEffectOf({
    amplifier,
    current,
    durationSecs,
    type: application.type,
  })

  return statusEffectStateWith(others, next)
}

const advancePulsingEffect = (
  effect: ActiveStatusEffect,
  elapsedSecs: number,
  intervalSecs: number,
): { readonly effect: ActiveStatusEffect | null; readonly pulses: number } => {
  const activeElapsed = Math.min(effect.remainingSecs, elapsedSecs)
  const accumulated = effect.pulseClockSecs + activeElapsed
  const pulses = Math.floor((accumulated + Number.EPSILON) / intervalSecs)
  const remainingSecs = Math.max(ZERO_SECONDS, effect.remainingSecs - elapsedSecs)
  let nextEffect: ActiveStatusEffect | null = null
  if (remainingSecs > ZERO_SECONDS) {
    nextEffect = {
      ...effect,
      pulseClockSecs: accumulated - pulses * intervalSecs,
      remainingSecs,
    }
  }
  return {
    effect: nextEffect,
    pulses,
  }
}

type AdvancedStatusEffect = {
  readonly effect: ActiveStatusEffect | null
  readonly hungerExhaustion: number
  readonly poisonPulses: number
  readonly regenerationPulses: number
}

type AdvancedStatusEffects = {
  readonly effects: ReadonlyArray<ActiveStatusEffect>
  readonly hungerExhaustion: number
  readonly poisonPulses: number
  readonly regenerationPulses: number
}

const activeEffectAfter = (
  effect: ActiveStatusEffect,
  elapsedSecs: number,
): ActiveStatusEffect | null => {
  if (effect.remainingSecs <= elapsedSecs) {
    return null
  }
  return { ...effect, remainingSecs: effect.remainingSecs - elapsedSecs }
}

const advanceStatusEffect = (
  effect: ActiveStatusEffect,
  elapsedSecs: number,
): AdvancedStatusEffect => {
  const amplifier = finiteAmplifier(effect.amplifier)
  const activeElapsedSecs = Math.min(effect.remainingSecs, elapsedSecs)

  switch (effect.type) {
    case 'poison': {
      const advanced = advancePulsingEffect(
        effect,
        elapsedSecs,
        POISON_INTERVAL_SECS / EFFECT_INTERVAL_DIVISOR ** amplifier,
      )
      return {
        effect: advanced.effect,
        hungerExhaustion: ZERO_SECONDS,
        poisonPulses: advanced.pulses,
        regenerationPulses: ZERO_SECONDS,
      }
    }
    case 'regeneration': {
      const advanced = advancePulsingEffect(
        effect,
        elapsedSecs,
        REGENERATION_INTERVAL_SECS / EFFECT_INTERVAL_DIVISOR ** amplifier,
      )
      return {
        effect: advanced.effect,
        hungerExhaustion: ZERO_SECONDS,
        poisonPulses: ZERO_SECONDS,
        regenerationPulses: advanced.pulses,
      }
    }
    case 'hunger':
      return {
        effect: activeEffectAfter(effect, elapsedSecs),
        hungerExhaustion:
          activeElapsedSecs *
          HUNGER_EXHAUSTION_PER_SECOND *
          (amplifier + EFFECT_AMPLIFIER_BASE),
        poisonPulses: ZERO_SECONDS,
        regenerationPulses: ZERO_SECONDS,
      }
    case 'nausea':
    case 'speed':
      return {
        effect: activeEffectAfter(effect, elapsedSecs),
        hungerExhaustion: ZERO_SECONDS,
        poisonPulses: ZERO_SECONDS,
        regenerationPulses: ZERO_SECONDS,
      }
    /* V8 ignore start -- Exhaustive safety net for the closed status-effect union. */
    default: {
      const exhaustiveEffect: never = effect.type
      return exhaustiveEffect
    }
    /* V8 ignore stop */
  }
}

const movementSpeedMultiplierOf = (
  effects: ReadonlyArray<ActiveStatusEffect>,
): number => {
  if (effects.some((effect) => effect.type === 'speed')) {
    return SPEED_MOVEMENT_MULTIPLIER
  }
  return ONE_SPEED_MULTIPLIER
}

const nauseaAmplifierOf = (
  effects: ReadonlyArray<ActiveStatusEffect>,
): number | null => {
  const nausea = effects.find((effect) => effect.type === 'nausea') ?? null
  if (nausea === null) {
    return null
  }
  return finiteAmplifier(nausea.amplifier)
}

const sumNumbers = (values: ReadonlyArray<number>): number =>
  values.reduce((total, value) => total + value, ZERO_SECONDS)

const advanceStatusEffects = (
  effects: ReadonlyArray<ActiveStatusEffect>,
  elapsedSecs: number,
): AdvancedStatusEffects => {
  const advanced = effects.map((effect) => advanceStatusEffect(effect, elapsedSecs))
  const activeEffects = advanced.flatMap((entry) => {
    if (entry.effect === null) {
      return []
    }
    return [entry.effect]
  })
  return {
    effects: activeEffects,
    hungerExhaustion: sumNumbers(
      advanced.map((entry) => entry.hungerExhaustion),
    ),
    poisonPulses: sumNumbers(advanced.map((entry) => entry.poisonPulses)),
    regenerationPulses: sumNumbers(
      advanced.map((entry) => entry.regenerationPulses),
    ),
  }
}

export const tickStatusEffects = (
  state: StatusEffectState,
  dt: DeltaTimeSecs,
): StatusEffectTick => {
  const elapsedSecs = finiteDuration(dt)
  const advanced = advanceStatusEffects(state.effects, elapsedSecs)

  return {
    hungerExhaustion: advanced.hungerExhaustion,
    movementSpeedMultiplier: movementSpeedMultiplierOf(advanced.effects),
    nauseaAmplifier: nauseaAmplifierOf(advanced.effects),
    poisonPulses: advanced.poisonPulses,
    regenerationPulses: advanced.regenerationPulses,
    state: { effects: advanced.effects },
  }
}
