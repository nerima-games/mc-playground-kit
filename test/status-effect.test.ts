import { describe, expect, it } from 'vitest'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  PLAYER_MAXIMUM_HEALTH_POINTS,
  POISON_DAMAGE_POINTS,
  REGENERATION_HEAL_POINTS,
  SPEED_MOVEMENT_MULTIPLIER,
  applyStatusEffect,
  copyStatusEffectState,
  emptyStatusEffectState,
  isValidStatusEffectState,
  tickStatusEffects,
} from '../src/domain/status-effect'

const effect = (
  type: 'poison' | 'regeneration' | 'speed' | 'hunger' | 'nausea',
  remainingSecs: number,
  pulseClockSecs = 0,
  amplifier?: number,
) => ({ type, remainingSecs, pulseClockSecs, ...(amplifier === undefined ? {} : { amplifier }) })
const seconds = (value: number): DeltaTimeSecs => value as DeltaTimeSecs

describe('status effects', () => {
  it('validates the persisted shape and copies nested state', () => {
    const valid = {
      effects: [
        effect('poison', 2, 0, 1),
        effect('regeneration', 4, 0),
      ],
    }

    expect(isValidStatusEffectState(null)).toBe(false)
    expect(isValidStatusEffectState([])).toBe(false)
    expect(isValidStatusEffectState({})).toBe(false)
    expect(isValidStatusEffectState({ effects: [null] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), type: 'unknown' }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), remainingSecs: '1' }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), remainingSecs: Number.NaN }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), remainingSecs: 0 }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), pulseClockSecs: '0' }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), pulseClockSecs: Number.NaN }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), pulseClockSecs: -1 }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [effect('poison', 1), effect('poison', 2)] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), amplifier: '1' }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), amplifier: 1.5 }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), amplifier: -1 }] })).toBe(false)
    expect(isValidStatusEffectState({ effects: [{ ...effect('poison', 1), amplifier: Number.NaN }] })).toBe(false)
    expect(isValidStatusEffectState(valid)).toBe(true)
    expect(isValidStatusEffectState({ effects: [] })).toBe(true)

    const copied = copyStatusEffectState(valid)
    expect(copied).toEqual(valid)
    expect(copied).not.toBe(valid)
    expect(copied.effects[0]).not.toBe(valid.effects[0])
  })

  it('applies, refreshes, upgrades, and removes effects', () => {
    const empty = emptyStatusEffectState()
    expect(empty).toEqual({ effects: [] })
    expect(applyStatusEffect(empty, { type: 'poison', durationSecs: 0 })).toEqual(empty)
    expect(applyStatusEffect(empty, { type: 'poison', durationSecs: -1 })).toEqual(empty)
    expect(applyStatusEffect(empty, { type: 'poison', durationSecs: Number.NaN })).toEqual(empty)

    const current = {
      effects: [
        effect('nausea', 1, 0, 1),
        effect('poison', 2, 0, 2),
        effect('speed', 3, 0),
      ],
    }
    expect(applyStatusEffect(current, { type: 'poison', durationSecs: 5, amplifier: 1 })).toBe(current)

    const upgraded = applyStatusEffect(current, {
      type: 'poison',
      durationSecs: 1,
      amplifier: 3.8,
    })
    expect(upgraded.effects).toEqual([
      effect('poison', 1, 0, 3),
      effect('speed', 3, 0),
      effect('nausea', 1, 0, 1),
    ])

    const refreshed = applyStatusEffect(
      { effects: [effect('poison', 5, 0, 1)] },
      { type: 'poison', durationSecs: 2, amplifier: 1 },
    )
    expect(refreshed.effects).toEqual([effect('poison', 5, 0, 1)])

    const newlyApplied = applyStatusEffect(empty, {
      type: 'regeneration',
      durationSecs: 2,
      amplifier: Number.NaN,
    })
    expect(newlyApplied.effects).toEqual([effect('regeneration', 2, 0, 0)])

    expect(applyStatusEffect(empty, {
      type: 'speed',
      durationSecs: 1,
    })).toEqual({ effects: [effect('speed', 1, 0, 0)] })

    expect(applyStatusEffect(current, { type: 'poison', durationSecs: 0 })).toEqual({
      effects: [effect('nausea', 1, 0, 1), effect('speed', 3, 0)],
    })
  })

  it('ticks pulses, timed attributes, and expiry', () => {
    const tick = tickStatusEffects(
      {
        effects: [
          effect('poison', 3, 0),
          effect('regeneration', 5, 0, 1),
          effect('speed', 3, 0, 2),
          effect('hunger', 0.5, 0, 1),
          effect('nausea', 2, 0, 3),
        ],
      },
      seconds(1.1),
    )
    expect(tick.poisonPulses).toBe(1)
    expect(tick.regenerationPulses).toBe(0)
    expect(tick.hungerExhaustion).toBeCloseTo(0.1)
    expect(tick.movementSpeedMultiplier).toBe(SPEED_MOVEMENT_MULTIPLIER)
    expect(tick.nauseaAmplifier).toBe(3)
    expect(tick.state.effects.map(({ type }) => type)).toEqual([
      'poison',
      'regeneration',
      'speed',
      'nausea',
    ])
    expect(tick.state.effects[0]?.remainingSecs).toBeCloseTo(1.9)
    expect(tick.state.effects[0]?.pulseClockSecs).toBeCloseTo(0.1)
    expect(tick.state.effects[1]?.remainingSecs).toBeCloseTo(3.9)
    expect(tick.state.effects[1]?.pulseClockSecs).toBeCloseTo(1.1)
    expect(tick.state.effects[2]?.remainingSecs).toBeCloseTo(1.9)
    expect(tick.state.effects[3]?.remainingSecs).toBeCloseTo(0.9)

    const expired = tickStatusEffects(
      {
        effects: [
          effect('poison', 1, 0),
          effect('regeneration', 1, 0),
          effect('speed', 1, 0),
          effect('hunger', 1, 0),
          effect('nausea', 1, 0),
        ],
      },
      seconds(3),
    )
    expect(expired.poisonPulses).toBe(1)
    expect(expired.regenerationPulses).toBe(0)
    expect(expired.hungerExhaustion).toBeCloseTo(0.1)
    expect(expired.movementSpeedMultiplier).toBe(1)
    expect(expired.nauseaAmplifier).toBeNull()
    expect(expired.state).toEqual({ effects: [] })

    const sustainedHunger = tickStatusEffects(
      { effects: [effect('hunger', 3)] },
      seconds(1),
    )
    expect(sustainedHunger).toEqual({
      state: { effects: [effect('hunger', 2)] },
      poisonPulses: 0,
      regenerationPulses: 0,
      movementSpeedMultiplier: 1,
      hungerExhaustion: 0.1,
      nauseaAmplifier: null,
    })

    const amplified = tickStatusEffects(
      { effects: [effect('poison', 1, 0, 2), effect('regeneration', 3, 2, 1)] },
      seconds(1),
    )
    expect(amplified.poisonPulses).toBe(4)
    expect(amplified.regenerationPulses).toBe(2)

    expect(tickStatusEffects({ effects: [] }, seconds(-1))).toEqual({
      state: { effects: [] },
      poisonPulses: 0,
      regenerationPulses: 0,
      movementSpeedMultiplier: 1,
      hungerExhaustion: 0,
      nauseaAmplifier: null,
    })
    expect(tickStatusEffects({ effects: [] }, seconds(Number.NaN)).state).toEqual({ effects: [] })
    const invalidState = {
      effects: [{ type: 'invalid', remainingSecs: 1, pulseClockSecs: 0 }],
    } as unknown as Parameters<typeof tickStatusEffects>[0]
    expect(() => tickStatusEffects(invalidState, seconds(0))).toThrow(TypeError)
    expect(POISON_DAMAGE_POINTS).toBe(1)
    expect(REGENERATION_HEAL_POINTS).toBe(1)
    expect(PLAYER_MAXIMUM_HEALTH_POINTS).toBe(20)
  })
})
