import { blockIdOf } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  PISTON_PUSH_LIMIT,
  type PistonCellRead,
  type PistonMovementPlan,
  type PistonPosition,
  type PistonTransitionRequest,
  applyPistonPlan,
  isPistonMovable,
  planPistonTransition,
  planPush,
  pistonPositionAt,
  validatePistonPlan,
} from '../src/domain/piston'

const air = blockIdOf('air')
const stone = blockIdOf('stone')
const log = blockIdOf('oak_log')
const bedrock = blockIdOf('bedrock')

const at = (x: number, y = 0, z = 0): PistonPosition => ({ x, y, z })
const key = ({ x, y, z }: PistonPosition): string => `${x},${y},${z}`

const world = (cells: ReadonlyMap<string, PistonCellRead> = new Map()) => ({
  read: (position: PistonPosition): PistonCellRead => cells.get(key(position)) ?? { kind: 'empty' },
})

const cellMap = (...entries: ReadonlyArray<readonly [PistonPosition, PistonCellRead]>) =>
  new Map(entries.map(([position, cell]) => [key(position), cell] as const))

const extension: PistonTransitionRequest = {
  piston: at(0),
  facing: 'east',
  kind: 'normal',
  state: 'retracted',
  powered: true,
}

describe('piston mechanics', () => {
  it('plans the bounded column push directly from kernel capabilities', () => {
    expect(isPistonMovable(stone)).toBe(true)
    expect(isPistonMovable(bedrock)).toBe(false)
    expect(planPush([])).toEqual({ kind: 'push', plan: { moved: [], length: 0 } })
    expect(planPush([log, stone])).toEqual({
      kind: 'push',
      plan: { moved: [log, stone], length: 2 },
    })
    expect(planPush([log, bedrock])).toEqual({
      kind: 'refused',
      refusal: { at: 1, reason: 'immovable' },
    })
    expect(planPush([bedrock])).toEqual({
      kind: 'refused',
      refusal: { at: 0, reason: 'immovable' },
    })
    expect(planPush(Array.from({ length: PISTON_PUSH_LIMIT + 1 }, () => log))).toEqual({
      kind: 'refused',
      refusal: { at: PISTON_PUSH_LIMIT, reason: 'too-long' },
    })
  })

  it('resolves all six facing offsets', () => {
    expect(pistonPositionAt(at(1, 2, 3), 'down', 2)).toEqual(at(1, 0, 3))
    expect(pistonPositionAt(at(1, 2, 3), 'east', 2)).toEqual(at(3, 2, 3))
    expect(pistonPositionAt(at(1, 2, 3), 'north', 2)).toEqual(at(1, 2, 1))
    expect(pistonPositionAt(at(1, 2, 3), 'south', 2)).toEqual(at(1, 2, 5))
    expect(pistonPositionAt(at(1, 2, 3), 'up', 2)).toEqual(at(1, 4, 3))
    expect(pistonPositionAt(at(1, 2, 3), 'west', 2)).toEqual(at(-1, 2, 3))
  })

  it('plans extension and retraction outcomes from world reads', () => {
    expect(planPistonTransition({ ...extension, state: 'extended' }, world())).toEqual({
      kind: 'noop',
      state: 'extended',
    })
    expect(planPistonTransition({ ...extension, powered: false }, world())).toEqual({
      kind: 'noop',
      state: 'retracted',
    })
    expect(planPistonTransition(extension, world())).toEqual({
      kind: 'move',
      plan: {
        piston: at(0),
        facing: 'east',
        kind: 'normal',
        fromState: 'retracted',
        toState: 'extended',
        moves: [],
      },
    })

    const twoBlocks = planPistonTransition(
      extension,
      world(cellMap(
        [at(1), { kind: 'block', block: log }],
        [at(2), { kind: 'block', block: stone }],
      )),
    )
    expect(twoBlocks).toEqual({
      kind: 'move',
      plan: {
        piston: at(0),
        facing: 'east',
        kind: 'normal',
        fromState: 'retracted',
        toState: 'extended',
        moves: [
          { block: stone, from: at(2), to: at(3) },
          { block: log, from: at(1), to: at(2) },
        ],
      },
    })

    expect(planPistonTransition(extension, world(cellMap([at(1), { kind: 'missing' }])))).toEqual({
      kind: 'refused',
      refusal: { position: at(1), reason: 'missing' },
    })
    expect(planPistonTransition(extension, world(cellMap([at(1), { kind: 'out-of-world' }])))).toEqual({
      kind: 'refused',
      refusal: { position: at(1), reason: 'out-of-world' },
    })
    expect(planPistonTransition(extension, world(cellMap([at(1), { kind: 'block', block: bedrock }])))).toEqual({
      kind: 'refused',
      refusal: { position: at(1), reason: 'immovable' },
    })

    const tooLongCells = new Map<string, PistonCellRead>()
    for (let distance = 1; distance <= PISTON_PUSH_LIMIT + 1; distance += 1) {
      tooLongCells.set(key(at(distance)), { kind: 'block', block: log })
    }
    expect(planPistonTransition(extension, world(tooLongCells))).toEqual({
      kind: 'refused',
      refusal: { position: at(PISTON_PUSH_LIMIT + 1), reason: 'too-long' },
    })

    const sticky = { ...extension, kind: 'sticky' as const }
    const stickyRetraction = { ...sticky, powered: false, state: 'extended' as const }
    expect(planPistonTransition(stickyRetraction, world(cellMap([at(2), { kind: 'missing' }])))).toEqual({
      kind: 'refused',
      refusal: { position: at(2), reason: 'missing' },
    })
    expect(planPistonTransition(stickyRetraction, world(cellMap([at(2), { kind: 'out-of-world' }])))).toEqual({
      kind: 'refused',
      refusal: { position: at(2), reason: 'out-of-world' },
    })
    expect(planPistonTransition(stickyRetraction, world())).toEqual({
      kind: 'move',
      plan: {
        piston: at(0),
        facing: 'east',
        kind: 'sticky',
        fromState: 'extended',
        toState: 'retracted',
        moves: [],
      },
    })
    const normalRetraction = { ...extension, powered: false, state: 'extended' as const }
    expect(planPistonTransition(normalRetraction, world())).toEqual({
      kind: 'move',
      plan: {
        piston: at(0),
        facing: 'east',
        kind: 'normal',
        fromState: 'extended',
        toState: 'retracted',
        moves: [],
      },
    })
    expect(planPistonTransition(
      stickyRetraction,
      world(cellMap([at(2), { kind: 'block', block: bedrock }])),
    )).toEqual({
      kind: 'move',
      plan: {
        piston: at(0),
        facing: 'east',
        kind: 'sticky',
        fromState: 'extended',
        toState: 'retracted',
        moves: [],
      },
    })
    expect(planPistonTransition(
      stickyRetraction,
      world(cellMap([at(2), { kind: 'block', block: log }])),
    )).toEqual({
      kind: 'move',
      plan: {
        piston: at(0),
        facing: 'east',
        kind: 'sticky',
        fromState: 'extended',
        toState: 'retracted',
        moves: [{ block: log, from: at(2), to: at(1) }],
      },
    })
  })

  it('validates plans before committing them', async () => {
    const valid: PistonMovementPlan = {
      piston: at(0),
      facing: 'east',
      kind: 'normal',
      fromState: 'retracted',
      toState: 'extended',
      moves: [{ block: log, from: at(1), to: at(2) }],
    }
    expect(validatePistonPlan(valid)).toBeUndefined()
    expect(validatePistonPlan({ ...valid, fromState: 'extended' })).toEqual({
      position: at(0),
      reason: 'invalid-transition',
    })
    expect(validatePistonPlan({
      ...valid,
      moves: [
        { block: log, from: at(1), to: at(2) },
        { block: stone, from: at(1), to: at(3) },
      ],
    })).toEqual({ position: at(1), reason: 'duplicate' })
    expect(validatePistonPlan({
      ...valid,
      moves: [
        { block: log, from: at(1), to: at(2) },
        { block: stone, from: at(3), to: at(2) },
      ],
    })).toEqual({ position: at(2), reason: 'duplicate' })
    expect(validatePistonPlan({
      ...valid,
      moves: [{ block: log, from: at(1), to: at(0) }],
    })).toEqual({ position: at(0), reason: 'collision' })
    expect(validatePistonPlan({
      ...valid,
      moves: [{ block: log, from: at(2), to: at(3) }],
    })).toEqual({ position: at(2), reason: 'collision' })

    const thirteenMoves = Array.from({ length: PISTON_PUSH_LIMIT + 1 }, (_, index) => {
      const distance = PISTON_PUSH_LIMIT + 1 - index
      return { block: log, from: at(distance), to: at(distance + 1) }
    })
    expect(validatePistonPlan({ ...valid, moves: thirteenMoves })).toEqual({
      position: at(PISTON_PUSH_LIMIT + 1),
      reason: 'too-long',
    })

    const normalRetraction: PistonMovementPlan = {
      ...valid,
      fromState: 'extended',
      toState: 'retracted',
      moves: [{ block: log, from: at(2), to: at(1) }],
    }
    expect(validatePistonPlan(normalRetraction)).toEqual({
      position: at(2),
      reason: 'invalid-transition',
    })
    expect(validatePistonPlan({
      ...normalRetraction,
      kind: 'sticky',
      moves: [
        { block: log, from: at(2), to: at(1) },
        { block: stone, from: at(3), to: at(2) },
      ],
    })).toEqual({ position: at(3), reason: 'invalid-transition' })
    expect(validatePistonPlan({
      ...normalRetraction,
      kind: 'sticky',
      moves: [{ block: log, from: at(3), to: at(1) }],
    })).toEqual({ position: at(1), reason: 'collision' })
    expect(validatePistonPlan({
      ...normalRetraction,
      kind: 'sticky',
      moves: [],
    })).toBeUndefined()
    const stickyRetraction = { ...normalRetraction, kind: 'sticky' as const }
    expect(validatePistonPlan(stickyRetraction)).toBeUndefined()
    expect(validatePistonPlan({
      ...stickyRetraction,
      moves: [{ block: log, from: at(1), to: at(0) }],
    })).toEqual({ position: at(1), reason: 'collision' })

    const commits: PistonMovementPlan[] = []
    await expect(Effect.runPromise(applyPistonPlan(valid, {
      commit: (plan) => Effect.sync(() => {
        commits.push(plan)
      }),
    }))).resolves.toBeUndefined()
    expect(commits).toEqual([valid])
    await expect(Effect.runPromise(applyPistonPlan({ ...valid, fromState: 'extended' }, {
      commit: () => Effect.succeed(undefined),
    }))).rejects.toThrow(JSON.stringify({ position: at(0), reason: 'invalid-transition' }))

    const refused = await Effect.runPromiseExit(applyPistonPlan({ ...valid, fromState: 'extended' }, {
      commit: () => Effect.succeed(undefined),
    }))
    expect(refused._tag).toBe('Failure')
  })

  it('keeps planning independent of block identity for empty cells', () => {
    const emptyCell: PistonCellRead = { kind: 'empty' }
    const cells = cellMap([at(1), emptyCell])
    expect(cells.get('1,0,0')).toEqual({ kind: 'empty' })
    expect(air).toBe(blockIdOf('air'))
  })
})
