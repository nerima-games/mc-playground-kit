import { type BlockFace, type BlockId, capabilityOfBlockId } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'

export const PISTON_PUSH_LIMIT = 12

const X_COORDINATE = 'x' as const
const Y_COORDINATE = 'y' as const
const Z_COORDINATE = 'z' as const
const ZERO_DISTANCE = 0
const POSITIVE_DISTANCE = 1
const NEGATIVE_DISTANCE = -1
const FIRST_BLOCK_DISTANCE = POSITIVE_DISTANCE
const SECOND_BLOCK_DISTANCE = POSITIVE_DISTANCE + POSITIVE_DISTANCE
const NO_MOVES = ZERO_DISTANCE
const MAX_RETRACTION_MOVES = POSITIVE_DISTANCE

export type PushPlan = {
  readonly moved: ReadonlyArray<BlockId>
  readonly length: number
}

export type PushRefusal = {
  readonly reason: 'immovable' | 'too-long'
  readonly at: number
}

export type PushOutcome =
  | { readonly kind: 'push'; readonly plan: PushPlan }
  | { readonly kind: 'refused'; readonly refusal: PushRefusal }

export const isPistonMovable = (block: BlockId): boolean =>
  !capabilityOfBlockId(block, 'pistonImmovable')

export const planPush = (column: ReadonlyArray<BlockId>): PushOutcome => {
  for (const [index, block] of column.entries()) {
    if (!isPistonMovable(block)) {
      return { kind: 'refused', refusal: { at: index, reason: 'immovable' } }
    }
    if (index >= PISTON_PUSH_LIMIT) {
      return { kind: 'refused', refusal: { at: index, reason: 'too-long' } }
    }
  }

  return { kind: 'push', plan: { length: column.length, moved: [...column] } }
}

export type PistonKind = 'normal' | 'sticky'
export type PistonState = 'extended' | 'retracted'

export type PistonPosition = {
  readonly [X_COORDINATE]: number
  readonly [Y_COORDINATE]: number
  readonly [Z_COORDINATE]: number
}

export type PistonCell =
  | { readonly kind: 'block'; readonly block: BlockId }
  | { readonly kind: 'empty' }

export type PistonCellRead =
  | PistonCell
  | { readonly kind: 'missing' }
  | { readonly kind: 'out-of-world' }

export type PistonWorldView = {
  readonly read: (position: PistonPosition) => PistonCellRead
}

export type PistonMove = {
  readonly block: BlockId
  readonly from: PistonPosition
  readonly to: PistonPosition
}

export type PistonMovementPlan = {
  readonly piston: PistonPosition
  readonly facing: BlockFace
  readonly kind: PistonKind
  readonly fromState: PistonState
  readonly toState: PistonState
  readonly moves: ReadonlyArray<PistonMove>
}

export type PistonPlanRefusal = {
  readonly reason:
    | 'collision'
    | 'duplicate'
    | 'immovable'
    | 'invalid-transition'
    | 'missing'
    | 'out-of-world'
    | 'too-long'
  readonly position: PistonPosition
}

export type PistonMovementOutcome =
  | { readonly kind: 'move'; readonly plan: PistonMovementPlan }
  | { readonly kind: 'noop'; readonly state: PistonState }
  | { readonly kind: 'refused'; readonly refusal: PistonPlanRefusal }

export type PistonTransitionRequest = {
  readonly piston: PistonPosition
  readonly facing: BlockFace
  readonly kind: PistonKind
  readonly state: PistonState
  readonly powered: boolean
}

const OFFSETS: Readonly<Record<BlockFace, PistonPosition>> = {
  down: { [X_COORDINATE]: ZERO_DISTANCE, [Y_COORDINATE]: NEGATIVE_DISTANCE, [Z_COORDINATE]: ZERO_DISTANCE },
  east: { [X_COORDINATE]: POSITIVE_DISTANCE, [Y_COORDINATE]: ZERO_DISTANCE, [Z_COORDINATE]: ZERO_DISTANCE },
  north: { [X_COORDINATE]: ZERO_DISTANCE, [Y_COORDINATE]: ZERO_DISTANCE, [Z_COORDINATE]: NEGATIVE_DISTANCE },
  south: { [X_COORDINATE]: ZERO_DISTANCE, [Y_COORDINATE]: ZERO_DISTANCE, [Z_COORDINATE]: POSITIVE_DISTANCE },
  up: { [X_COORDINATE]: ZERO_DISTANCE, [Y_COORDINATE]: POSITIVE_DISTANCE, [Z_COORDINATE]: ZERO_DISTANCE },
  west: { [X_COORDINATE]: NEGATIVE_DISTANCE, [Y_COORDINATE]: ZERO_DISTANCE, [Z_COORDINATE]: ZERO_DISTANCE },
}

export const pistonPositionAt = (
  origin: PistonPosition,
  facing: BlockFace,
  distance: number,
): PistonPosition => {
  const offset = OFFSETS[facing]
  return {
    [X_COORDINATE]: origin[X_COORDINATE] + offset[X_COORDINATE] * distance,
    [Y_COORDINATE]: origin[Y_COORDINATE] + offset[Y_COORDINATE] * distance,
    [Z_COORDINATE]: origin[Z_COORDINATE] + offset[Z_COORDINATE] * distance,
  }
}

const positionKey = (position: PistonPosition): string => [
  String(position[X_COORDINATE]),
  String(position[Y_COORDINATE]),
  String(position[Z_COORDINATE]),
].join(',')

const baseRetractionPlan = (request: PistonTransitionRequest): PistonMovementPlan => ({
  facing: request.facing,
  fromState: request.state,
  kind: request.kind,
  moves: [],
  piston: request.piston,
  toState: 'retracted',
})

const planRetraction = (
  request: PistonTransitionRequest,
  world: PistonWorldView,
): PistonMovementOutcome => {
  const base = baseRetractionPlan(request)
  if (request.kind === 'normal') {
    return { kind: 'move', plan: base }
  }

  const source = pistonPositionAt(request.piston, request.facing, SECOND_BLOCK_DISTANCE)
  const cell = world.read(source)
  if (cell.kind === 'missing' || cell.kind === 'out-of-world') {
    return { kind: 'refused', refusal: { position: source, reason: cell.kind } }
  }
  if (cell.kind === 'empty' || !isPistonMovable(cell.block)) {
    return { kind: 'move', plan: base }
  }
  return {
    kind: 'move',
    plan: {
      ...base,
      moves: [{
        block: cell.block,
        from: source,
        to: pistonPositionAt(request.piston, request.facing, FIRST_BLOCK_DISTANCE),
      }],
    },
  }
}

type ExtensionBlock = { readonly block: BlockId; readonly position: PistonPosition }

type ExtensionStep =
  | { readonly kind: 'block'; readonly block: ExtensionBlock }
  | { readonly kind: 'complete' }
  | { readonly kind: 'refused'; readonly refusal: PistonPlanRefusal }

const extensionStepForCell = (
  position: PistonPosition,
  cell: PistonCellRead,
  blockCount: number,
): ExtensionStep => {
  if (cell.kind === 'missing' || cell.kind === 'out-of-world') {
    return { kind: 'refused', refusal: { position, reason: cell.kind } }
  }
  if (cell.kind === 'empty') {
    return { kind: 'complete' }
  }
  if (!isPistonMovable(cell.block)) {
    return { kind: 'refused', refusal: { position, reason: 'immovable' } }
  }
  if (blockCount >= PISTON_PUSH_LIMIT) {
    return { kind: 'refused', refusal: { position, reason: 'too-long' } }
  }
  return { block: { block: cell.block, position }, kind: 'block' }
}

const extensionStep = (context: {
  readonly request: PistonTransitionRequest
  readonly world: PistonWorldView
  readonly distance: number
  readonly blockCount: number
}): ExtensionStep => {
  const position = pistonPositionAt(context.request.piston, context.request.facing, context.distance)
  return extensionStepForCell(position, context.world.read(position), context.blockCount)
}

const extensionPlan = (
  request: PistonTransitionRequest,
  blocks: ReadonlyArray<ExtensionBlock>,
): PistonMovementOutcome => ({
  kind: 'move',
  plan: {
    facing: request.facing,
    fromState: request.state,
    kind: request.kind,
    moves: [...blocks].reverse().map(({ block, position: from }) => ({
      block,
      from,
      to: pistonPositionAt(from, request.facing, FIRST_BLOCK_DISTANCE),
    })),
    piston: request.piston,
    toState: 'extended',
  },
})

const planExtension = (
  request: PistonTransitionRequest,
  world: PistonWorldView,
): PistonMovementOutcome => {
  const blocks: Array<ExtensionBlock> = []
  let distance = FIRST_BLOCK_DISTANCE
  while (true) {
    const step = extensionStep({ blockCount: blocks.length, distance, request, world })
    if (step.kind === 'complete') {
      return extensionPlan(request, blocks)
    }
    if (step.kind === 'refused') {
      return step
    }
    blocks.push(step.block)
    distance += POSITIVE_DISTANCE
  }
}

const targetPistonStateOf = (powered: boolean): PistonState => {
  if (powered) {
    return 'extended'
  }
  return 'retracted'
}

export const planPistonTransition = (
  request: PistonTransitionRequest,
  world: PistonWorldView,
): PistonMovementOutcome => {
  const targetState = targetPistonStateOf(request.powered)
  if (request.state === targetState) {
    return { kind: 'noop', state: request.state }
  }
  if (targetState === 'retracted') {
    return planRetraction(request, world)
  }
  return planExtension(request, world)
}

export type PistonApplyPort<Err = never> = {
  readonly commit: (plan: PistonMovementPlan) => Effect.Effect<void, Err>
}

const conflictPosition = (sourceClaimed: boolean, move: PistonMove): PistonPosition => {
  if (sourceClaimed) {
    return move.from
  }
  return move.to
}

const duplicateMoveRefusal = (context: {
  readonly move: PistonMove
  readonly sources: ReadonlySet<string>
  readonly targets: ReadonlySet<string>
}): PistonPlanRefusal | null => {
  const source = positionKey(context.move.from)
  const target = positionKey(context.move.to)
  const sourceClaimed = context.sources.has(source)
  const targetClaimed = context.targets.has(target)
  if (sourceClaimed || targetClaimed) {
    return { position: conflictPosition(sourceClaimed, context.move), reason: 'duplicate' }
  }
  return null
}

const moveCollisionRefusal = (
  move: PistonMove,
  plan: PistonMovementPlan,
): PistonPlanRefusal | null => {
  let direction = NEGATIVE_DISTANCE
  if (plan.toState === 'extended') {
    direction = POSITIVE_DISTANCE
  }
  if (positionKey(move.to) !== positionKey(pistonPositionAt(move.from, plan.facing, direction))) {
    return { position: move.to, reason: 'collision' }
  }
  return null
}

const checkMoveAgainstClaims = (context: {
  readonly move: PistonMove
  readonly plan: PistonMovementPlan
  readonly sources: Set<string>
  readonly targets: Set<string>
}): PistonPlanRefusal | null => {
  const duplicate = duplicateMoveRefusal(context)
  if (duplicate !== null) {
    return duplicate
  }
  const source = positionKey(context.move.from)
  const target = positionKey(context.move.to)
  context.sources.add(source)
  context.targets.add(target)
  return moveCollisionRefusal(context.move, context.plan)
}

const findMoveConflict = (plan: PistonMovementPlan): PistonPlanRefusal | null => {
  const sources = new Set<string>()
  const targets = new Set<string>()
  for (const move of plan.moves) {
    const conflict = checkMoveAgainstClaims({ move, plan, sources, targets })
    if (conflict !== null) {
      return conflict
    }
  }
  return null
}

const validateExtendedPlan = (plan: PistonMovementPlan): PistonPlanRefusal | undefined => {
  if (plan.moves.length > PISTON_PUSH_LIMIT) {
    return {
      position: pistonPositionAt(plan.piston, plan.facing, PISTON_PUSH_LIMIT + POSITIVE_DISTANCE),
      reason: 'too-long',
    }
  }
  for (const [index, move] of plan.moves.entries()) {
    const expectedDistance = plan.moves.length - index
    if (positionKey(move.from) !== positionKey(pistonPositionAt(plan.piston, plan.facing, expectedDistance))) {
      return { position: move.from, reason: 'collision' }
    }
  }
  return
}

const validateRetractionPull = (
  plan: PistonMovementPlan,
  firstMove: PistonMove | null,
): PistonPlanRefusal | undefined => {
  if (firstMove !== null) {
    const expectedSource = pistonPositionAt(plan.piston, plan.facing, SECOND_BLOCK_DISTANCE)
    const expectedTarget = pistonPositionAt(plan.piston, plan.facing, FIRST_BLOCK_DISTANCE)
    if (
      positionKey(firstMove.from) !== positionKey(expectedSource) ||
      positionKey(firstMove.to) !== positionKey(expectedTarget)
    ) {
      return { position: firstMove.from, reason: 'collision' }
    }
  }
  return
}

const validateRetractionPlan = (plan: PistonMovementPlan): PistonPlanRefusal | undefined => {
  const [firstMove = null, secondMove = null] = plan.moves
  if (plan.kind === 'normal' && plan.moves.length > NO_MOVES && firstMove !== null) {
    return { position: firstMove.from, reason: 'invalid-transition' }
  }
  if (plan.moves.length > MAX_RETRACTION_MOVES && secondMove !== null) {
    return { position: secondMove.from, reason: 'invalid-transition' }
  }
  return validateRetractionPull(plan, firstMove)
}

export const validatePistonPlan = (plan: PistonMovementPlan): PistonPlanRefusal | undefined => {
  if (plan.fromState === plan.toState) {
    return { position: plan.piston, reason: 'invalid-transition' }
  }
  const conflict = findMoveConflict(plan)
  if (conflict !== null) {
    return conflict
  }
  if (plan.toState === 'extended') {
    return validateExtendedPlan(plan)
  }
  return validateRetractionPlan(plan)
}

export const applyPistonPlan = <Err>(
  plan: PistonMovementPlan,
  port: PistonApplyPort<Err>,
): Effect.Effect<void, Err | PistonPlanRefusal> => {
  const refusal = validatePistonPlan(plan) ?? null
  if (refusal !== null) {
    return Effect.fail(refusal)
  }
  return port.commit(plan)
}
