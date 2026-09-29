import {
  AIR_BLOCK_ID,
  type BlockId,
  blockIdOf,
  capabilityOfBlockId,
} from '@nerima-games/mc-kernel'
import type { Damage, Weather } from '@nerima-games/mc-sim'

const X_COORDINATE = 'x' as const
const Y_COORDINATE = 'y' as const
const Z_COORDINATE = 'z' as const
const ZERO = 0
const ONE = 1
const NEGATIVE_ONE = -1
const TWO = 2
const TICKS_PER_SECOND = 20
const RNG_MULTIPLIER = 16_807
const RNG_MODULUS = 2_147_483_647

export type SurvivalDifficulty = 'peaceful' | 'easy' | 'normal' | 'hard'

export type FirePosition = {
  readonly [X_COORDINATE]: number
  readonly [Y_COORDINATE]: number
  readonly [Z_COORDINATE]: number
}

export type FireCell = {
  readonly position: FirePosition
  readonly block: BlockId | typeof FIRE_UNAVAILABLE_BLOCK
  readonly exposedToSky?: boolean
}

export type ActiveFire = {
  readonly position: FirePosition
  readonly ageTicks: number
  readonly unloadedRetries?: number
}

export type BurningActor = {
  readonly id: string
  readonly kind: 'player' | 'entity'
  readonly position: FirePosition
  readonly remainingTicks: number
  readonly damageCooldownTicks: number
}

export type FireLifecycleState = {
  readonly fires: ReadonlyArray<ActiveFire>
  readonly burningActors?: ReadonlyArray<BurningActor>
  readonly seed: number
}

export type FireLifecycleSnapshot = {
  readonly version: typeof FIRE_LIFECYCLE_SNAPSHOT_VERSION
  readonly fires: ReadonlyArray<ActiveFire>
  readonly burningActors: ReadonlyArray<BurningActor>
  readonly seed: number
  readonly tickAccumulatorSecs: number
}

export type FireMutation = {
  readonly position: FirePosition
  readonly block: BlockId
}

export type FireActorContact = {
  readonly id: string
  readonly kind: 'player' | 'entity'
  readonly position: FirePosition
  readonly alive?: boolean
  readonly inWater?: boolean
  readonly exposedToSky?: boolean
}

export type FireContactDamage = {
  readonly _tag: 'FireContact'
  readonly at: FirePosition
  readonly damage: Damage
}

export type FireEntityDamage = {
  readonly actorId: string
  readonly at: FirePosition
  readonly damage: Damage
}

export type FireLifecycleStep = {
  readonly state: FireLifecycleState
  readonly mutations: ReadonlyArray<FireMutation>
  readonly damages: ReadonlyArray<FireContactDamage>
  readonly entityDamages: ReadonlyArray<FireEntityDamage>
}

export const FIRE_LIFECYCLE_SNAPSHOT_VERSION: number = ONE
export const FIRE_NATURAL_LIFETIME_TICKS = 8
export const FIRE_TICK_INTERVAL_SECS: number = ONE / TICKS_PER_SECOND
export const FIRE_SPREAD_CHANCE = 0.3
export const FIRE_BLOCK_ID: BlockId = blockIdOf('fire')
export const WATER_BLOCK_ID: BlockId = blockIdOf('water')
export const FIRE_CONTACT_DAMAGE: Damage = { amount: 1, cause: 'fire' }
export const FIRE_BURN_DURATION_TICKS = 80
export const FIRE_DAMAGE_INTERVAL_TICKS = 20
export const FIRE_UNLOADED_RETRY_LIMIT = 3
export const FIRE_FRAME_TICK_BUDGET = 4
export const FIRE_WORK_BUDGET = 128
export const FIRE_UNAVAILABLE_BLOCK = '__fire_chunk_unavailable__'

const OFFSETS: ReadonlyArray<FirePosition> = [
  { [X_COORDINATE]: ZERO, [Y_COORDINATE]: NEGATIVE_ONE, [Z_COORDINATE]: ZERO },
  { [X_COORDINATE]: ZERO, [Y_COORDINATE]: ONE, [Z_COORDINATE]: ZERO },
  { [X_COORDINATE]: NEGATIVE_ONE, [Y_COORDINATE]: ZERO, [Z_COORDINATE]: ZERO },
  { [X_COORDINATE]: ONE, [Y_COORDINATE]: ZERO, [Z_COORDINATE]: ZERO },
  { [X_COORDINATE]: ZERO, [Y_COORDINATE]: ZERO, [Z_COORDINATE]: NEGATIVE_ONE },
  { [X_COORDINATE]: ZERO, [Y_COORDINATE]: ZERO, [Z_COORDINATE]: ONE },
]

const key = (position: FirePosition): string =>
  [
    String(position[X_COORDINATE]),
    String(position[Y_COORDINATE]),
    String(position[Z_COORDINATE]),
  ].join(',')

const compare = (left: FirePosition, right: FirePosition): number =>
  left[X_COORDINATE] - right[X_COORDINATE] ||
  left[Y_COORDINATE] - right[Y_COORDINATE] ||
  left[Z_COORDINATE] - right[Z_COORDINATE]

const copyPosition = (position: FirePosition): FirePosition => ({ ...position })

const normaliseSeed = (seed: number): number => {
  if (!Number.isFinite(seed)) {
    return ONE
  }
  const folded = Math.abs(Math.trunc(seed)) % RNG_MODULUS
  if (folded === ZERO) {
    return ONE
  }
  return folded
}

const nextRoll = (seed: number): { readonly roll: number; readonly seed: number } => {
  const state = (RNG_MULTIPLIER * normaliseSeed(seed)) % RNG_MODULUS
  return { roll: (state - ONE) / RNG_MODULUS, seed: state }
}

export const fireDamageFor = (difficulty: SurvivalDifficulty): Damage | undefined => {
  if (difficulty === 'peaceful') {
    return
  }
  let amount = ONE
  if (difficulty === 'hard') {
    amount = TWO
  }
  return { amount, cause: 'fire' }
}

const actorForContact = (contact: FirePosition | FireActorContact): FireActorContact => {
  if ('id' in contact) {
    return contact
  }
  return { id: 'player', kind: 'player', position: contact }
}

const actorInput = (
  contacted: ReadonlyArray<FirePosition | FireActorContact>,
): ReadonlyArray<FireActorContact> => {
  const actors = new Map<string, FireActorContact>()
  for (const contact of contacted) {
    const actor = actorForContact(contact)
    actors.set(actor.id, actor)
  }
  return [...actors.values()].sort((left, right) => left.id.localeCompare(right.id))
}

const isFlammable = (cell: FireCell | null): boolean => {
  if (cell === null || cell.block === FIRE_UNAVAILABLE_BLOCK) {
    return false
  }
  return capabilityOfBlockId(cell.block, 'flammable')
}

const supported = (
  position: FirePosition,
  cellByKey: ReadonlyMap<string, FireCell>,
): boolean => {
  const below = cellByKey.get(key({
    [X_COORDINATE]: position[X_COORDINATE],
    [Y_COORDINATE]: position[Y_COORDINATE] - ONE,
    [Z_COORDINATE]: position[Z_COORDINATE],
  })) ?? null
  if (below === null || below.block === FIRE_UNAVAILABLE_BLOCK) {
    return true
  }
  if (below.block !== AIR_BLOCK_ID && below.block !== WATER_BLOCK_ID) {
    return true
  }
  for (const offset of OFFSETS) {
    const candidate = cellByKey.get(key({
      [X_COORDINATE]: position[X_COORDINATE] + offset[X_COORDINATE],
      [Y_COORDINATE]: position[Y_COORDINATE] + offset[Y_COORDINATE],
      [Z_COORDINATE]: position[Z_COORDINATE] + offset[Z_COORDINATE],
    })) ?? null
    if (isFlammable(candidate)) {
      return true
    }
  }
  return false
}

export const makeFireLifecycleState = (
  positions: ReadonlyArray<FirePosition>,
  seed: number,
): FireLifecycleState => ({
  fires: [...new Map(positions.map((position) => [
    key(position),
    { ageTicks: ZERO, position: copyPosition(position) },
  ])).values()].sort((left, right) => compare(left.position, right.position)),
  seed: normaliseSeed(seed),
})

export const extinguishFire = (
  state: FireLifecycleState,
  position: FirePosition,
): FireLifecycleState => ({
  ...state,
  fires: state.fires.filter((fire) => key(fire.position) !== key(position)),
})

const copyFire = (fire: ActiveFire): ActiveFire => ({
  ...fire,
  position: copyPosition(fire.position),
})

const copyBurningActor = (actor: BurningActor): BurningActor => ({
  ...actor,
  position: copyPosition(actor.position),
})

const boundedTickAccumulator = (value: number): number => {
  if (!Number.isFinite(value)) {
    return ZERO
  }
  return Math.max(ZERO, Math.min(FIRE_TICK_INTERVAL_SECS * FIRE_FRAME_TICK_BUDGET, value))
}

export const makeFireLifecycleSnapshot = (
  state: FireLifecycleState,
  tickAccumulatorSecs: number,
): FireLifecycleSnapshot => ({
  burningActors: (state.burningActors ?? []).map(copyBurningActor),
  fires: state.fires.map(copyFire),
  seed: normaliseSeed(state.seed),
  tickAccumulatorSecs: boundedTickAccumulator(tickAccumulatorSecs),
  version: FIRE_LIFECYCLE_SNAPSHOT_VERSION,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFirePositionValue = (value: unknown): value is FirePosition =>
  isRecord(value) &&
  Number.isFinite(value[X_COORDINATE]) &&
  Number.isFinite(value[Y_COORDINATE]) &&
  Number.isFinite(value[Z_COORDINATE])

const isActiveFireValue = (value: unknown): value is ActiveFire => {
  if (!isRecord(value)) {
    return false
  }
  const { ageTicks, position, unloadedRetries } = value
  const hasValidRetries = typeof unloadedRetries === 'undefined' ||
    (typeof unloadedRetries === 'number' &&
      Number.isInteger(unloadedRetries) &&
      unloadedRetries >= ZERO)
  return isFirePositionValue(position) &&
    typeof ageTicks === 'number' &&
    Number.isInteger(ageTicks) && ageTicks >= ZERO &&
    hasValidRetries
}

const isBurningActorValue = (value: unknown): value is BurningActor => {
  if (!isRecord(value)) {
    return false
  }
  const { damageCooldownTicks, id, kind, position, remainingTicks } = value
  return typeof id === 'string' &&
    (kind === 'player' || kind === 'entity') &&
    isFirePositionValue(position) &&
    typeof remainingTicks === 'number' &&
    Number.isInteger(remainingTicks) && remainingTicks > ZERO &&
    typeof damageCooldownTicks === 'number' &&
    Number.isInteger(damageCooldownTicks) && damageCooldownTicks >= ZERO
}

export const isFireLifecycleSnapshot = (value: unknown): value is FireLifecycleSnapshot => {
  if (!isRecord(value)) {
    return false
  }
  const { burningActors, fires, seed, tickAccumulatorSecs, version } = value
  return version === FIRE_LIFECYCLE_SNAPSHOT_VERSION &&
    Array.isArray(fires) && fires.every(isActiveFireValue) &&
    Array.isArray(burningActors) && burningActors.every(isBurningActorValue) &&
    typeof seed === 'number' && Number.isFinite(seed) &&
    typeof tickAccumulatorSecs === 'number' &&
    Number.isFinite(tickAccumulatorSecs) && tickAccumulatorSecs >= ZERO
}

export const restoreFireLifecycleSnapshot = (
  snapshot: FireLifecycleSnapshot,
): { readonly state: FireLifecycleState; readonly tickAccumulatorSecs: number } => ({
  state: {
    burningActors: snapshot.burningActors.map(copyBurningActor),
    fires: snapshot.fires.map(copyFire),
    seed: normaliseSeed(snapshot.seed),
  },
  tickAccumulatorSecs: boundedTickAccumulator(snapshot.tickAccumulatorSecs),
})

type BurningActorAdvance = {
  readonly actor: BurningActor | null
  readonly contactDamage: FireContactDamage | null
  readonly entityDamage: FireEntityDamage | null
}

type BurningActorBuckets = {
  readonly burningActors: Array<BurningActor>
  readonly damages: Array<FireContactDamage>
  readonly entityDamages: Array<FireEntityDamage>
}

type BurningActorLifecycleInput = {
  readonly state: FireLifecycleState
  readonly contacts: ReadonlyArray<FireActorContact>
  readonly fireKeys: ReadonlySet<string>
  readonly weather: Weather
  readonly difficulty: SurvivalDifficulty
}

type BurningActorAdvanceInput = {
  readonly actor: BurningActor
  readonly contact: FireActorContact | null
  readonly damage: Damage | null
  readonly weather: Weather
}

type ActiveBurningActorAdvanceInput = {
  readonly actor: BurningActor
  readonly contact: FireActorContact
  readonly damage: Damage | null
}

type NextBurningActorInput = {
  readonly actor: BurningActor
  readonly contact: FireActorContact
  readonly remainingTicks: number
  readonly shouldDamage: boolean
}

const updateBurningActorForContact = (
  burningById: Map<string, BurningActor>,
  contact: FireActorContact,
  fireKeys: ReadonlySet<string>,
): void => {
  if (contact.alive === false || contact.inWater === true) {
    burningById.delete(contact.id)
    return
  }
  if (!fireKeys.has(key(contact.position))) {
    return
  }
  const current = burningById.get(contact.id)
  burningById.set(contact.id, {
    damageCooldownTicks: current?.damageCooldownTicks ?? ZERO,
    id: contact.id,
    kind: contact.kind,
    position: copyPosition(contact.position),
    remainingTicks: Math.max(current?.remainingTicks ?? ZERO, FIRE_BURN_DURATION_TICKS),
  })
}

const burningActorMapFor = (
  state: FireLifecycleState,
  contacts: ReadonlyArray<FireActorContact>,
  fireKeys: ReadonlySet<string>,
): Map<string, BurningActor> => {
  const burningById = new Map((state.burningActors ?? []).map((actor) => [actor.id, actor]))
  for (const contact of contacts) {
    updateBurningActorForContact(burningById, contact, fireKeys)
  }
  return burningById
}

const stopsBurning = (contact: FireActorContact, weather: Weather): boolean =>
  contact.alive === false || contact.inWater === true ||
  (weather !== 'clear' && contact.exposedToSky === true)

const nextDamageCooldown = (actor: BurningActor, shouldDamage: boolean): number => {
  if (shouldDamage) {
    return FIRE_DAMAGE_INTERVAL_TICKS - ONE
  }
  return Math.max(ZERO, actor.damageCooldownTicks - ONE)
}

const nextBurningActor = ({
  actor,
  contact,
  remainingTicks,
  shouldDamage,
}: NextBurningActorInput): BurningActor => ({
  damageCooldownTicks: nextDamageCooldown(actor, shouldDamage),
  id: actor.id,
  kind: actor.kind,
  position: copyPosition(contact.position),
  remainingTicks,
})

const damageForActor = (
  actor: BurningActor,
  contact: FireActorContact,
  damage: Damage | null,
): Pick<BurningActorAdvance, 'contactDamage' | 'entityDamage'> => {
  if (damage === null) {
    return { contactDamage: null, entityDamage: null }
  }
  const position = copyPosition(contact.position)
  if (actor.kind === 'player') {
    return {
      contactDamage: { _tag: 'FireContact', at: position, damage },
      entityDamage: null,
    }
  }
  return {
    contactDamage: null,
    entityDamage: { actorId: actor.id, at: position, damage },
  }
}

const damageInputFor = (damage: Damage | null, shouldDamage: boolean): Damage | null => {
  if (shouldDamage) {
    return damage
  }
  return null
}

const activeBurningActorAdvance = ({
  actor,
  contact,
  damage,
}: ActiveBurningActorAdvanceInput): BurningActorAdvance => {
  const remainingTicks = actor.remainingTicks - ONE
  if (remainingTicks <= ZERO) {
    return { actor: null, contactDamage: null, entityDamage: null }
  }
  const shouldDamage = actor.damageCooldownTicks <= ZERO && damage !== null
  const damages = damageForActor(actor, contact, damageInputFor(damage, shouldDamage))
  return {
    actor: nextBurningActor({ actor, contact, remainingTicks, shouldDamage }),
    contactDamage: damages.contactDamage,
    entityDamage: damages.entityDamage,
  }
}

const advanceBurningActor = ({
  actor,
  contact,
  damage,
  weather,
}: BurningActorAdvanceInput): BurningActorAdvance => {
  if (contact === null) {
    return { actor, contactDamage: null, entityDamage: null }
  }
  if (stopsBurning(contact, weather)) {
    return { actor: null, contactDamage: null, entityDamage: null }
  }
  return activeBurningActorAdvance({ actor, contact, damage })
}

const appendBurningActorAdvance = (
  buckets: BurningActorBuckets,
  advance: BurningActorAdvance,
): void => {
  if (advance.actor !== null) {
    buckets.burningActors.push(advance.actor)
  }
  if (advance.contactDamage !== null) {
    buckets.damages.push(advance.contactDamage)
  }
  if (advance.entityDamage !== null) {
    buckets.entityDamages.push(advance.entityDamage)
  }
}

const advanceBurningActors = ({
  state,
  contacts,
  fireKeys,
  weather,
  difficulty,
}: BurningActorLifecycleInput): Pick<FireLifecycleStep, 'damages' | 'entityDamages'> & {
  readonly burningActors: ReadonlyArray<BurningActor>
} => {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))
  const burningById = burningActorMapFor(state, contacts, fireKeys)
  const buckets: BurningActorBuckets = {
    burningActors: [],
    damages: [],
    entityDamages: [],
  }
  const damage = fireDamageFor(difficulty) ?? null
  for (const actor of [...burningById.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const advance = advanceBurningActor({
      actor,
      contact: contactById.get(actor.id) ?? null,
      damage,
      weather,
    })
    appendBurningActorAdvance(buckets, advance)
  }
  return buckets
}

type FireSpreadInput = {
  readonly additions: ReadonlySet<string>
  readonly cellByKey: ReadonlyMap<string, FireCell>
  readonly fire: ActiveFire
  readonly offset: FirePosition
  readonly seed: number
}

type FireSpreadResult = {
  readonly addition: ActiveFire | null
  readonly mutation: FireMutation | null
  readonly seed: number
}

type FireSpreadCollection = {
  readonly additions: ReadonlyArray<ActiveFire>
  readonly mutations: ReadonlyArray<FireMutation>
  readonly seed: number
}

type FireSpreadAccumulator = {
  readonly reserved: Set<string>
  readonly nextAdditions: Array<ActiveFire>
  readonly mutations: Array<FireMutation>
  seed: number
}

type FireAdvanceInput = {
  readonly additions: ReadonlyMap<string, ActiveFire>
  readonly cellByKey: ReadonlyMap<string, FireCell>
  readonly fire: ActiveFire
  readonly seed: number
  readonly weather: Weather
}

type FireExtinguishingInput = {
  readonly cell: FireCell
  readonly cellByKey: ReadonlyMap<string, FireCell>
  readonly fire: ActiveFire
  readonly weather: Weather
}

type LoadedFireAdvanceInput = Omit<FireAdvanceInput, 'weather'> & {
  readonly cell: FireCell
  readonly weather: Weather
}

type FireAdvanceResult = {
  readonly additions: ReadonlyArray<ActiveFire>
  readonly mutations: ReadonlyArray<FireMutation>
  readonly seed: number
  readonly survivor: ActiveFire | null
}

type FireAdvanceBuckets = {
  readonly additions: Map<string, ActiveFire>
  readonly mutations: Map<string, FireMutation>
  readonly survivors: Array<ActiveFire>
}

type FireCollectionInput = {
  readonly active: ReadonlyArray<ActiveFire>
  readonly cellByKey: ReadonlyMap<string, FireCell>
  readonly seed: number
  readonly weather: Weather
}

type FireCollectionResult = {
  readonly additions: Map<string, ActiveFire>
  readonly mutations: Map<string, FireMutation>
  readonly seed: number
  readonly survivors: Array<ActiveFire>
}

type FireStateInput = {
  readonly actors: ReadonlyArray<BurningActor>
  readonly fires: ReadonlyArray<ActiveFire>
  readonly seed: number
  readonly state: FireLifecycleState
}

type AdvanceFireLifecycleArguments = readonly [
  state: FireLifecycleState,
  cells: ReadonlyArray<FireCell>,
  weather: Weather,
  contacted?: ReadonlyArray<FirePosition | FireActorContact>,
  difficulty?: SurvivalDifficulty,
]

const fireMutationAt = (position: FirePosition, block: BlockId): FireMutation => ({
  block,
  position,
})

const emptyFireAdvance = (seed: number): FireAdvanceResult => ({
  additions: [],
  mutations: [],
  seed,
  survivor: null,
})

const unavailableFireAdvance = (fire: ActiveFire, seed: number): FireAdvanceResult => {
  const nextRetries = (fire.unloadedRetries ?? ZERO) + ONE
  let survivor: ActiveFire | null = null
  if (nextRetries <= FIRE_UNLOADED_RETRY_LIMIT) {
    survivor = { ...fire, unloadedRetries: nextRetries }
  }
  return { ...emptyFireAdvance(seed), survivor }
}

const spreadAt = ({
  additions,
  cellByKey,
  fire,
  offset,
  seed,
}: FireSpreadInput): FireSpreadResult => {
  const position: FirePosition = {
    [X_COORDINATE]: fire.position[X_COORDINATE] + offset[X_COORDINATE],
    [Y_COORDINATE]: fire.position[Y_COORDINATE] + offset[Y_COORDINATE],
    [Z_COORDINATE]: fire.position[Z_COORDINATE] + offset[Z_COORDINATE],
  }
  const positionKey = key(position)
  const neighbour = cellByKey.get(positionKey) ?? null
  if (!isFlammable(neighbour) || additions.has(positionKey)) {
    return { addition: null, mutation: null, seed }
  }
  const draw = nextRoll(seed)
  if (draw.roll >= FIRE_SPREAD_CHANCE) {
    return { addition: null, mutation: null, seed: draw.seed }
  }
  return {
    addition: { ageTicks: ZERO, position },
    mutation: fireMutationAt(position, FIRE_BLOCK_ID),
    seed: draw.seed,
  }
}

const spreadFromFire = ({
  additions,
  cellByKey,
  fire,
  seed,
}: Omit<FireAdvanceInput, 'weather'>): FireSpreadCollection => {
  const accumulator: FireSpreadAccumulator = {
    mutations: [],
    nextAdditions: [],
    reserved: new Set(additions.keys()),
    seed,
  }
  for (const offset of OFFSETS) {
    const result = spreadAt({
      additions: accumulator.reserved,
      cellByKey,
      fire,
      offset,
      seed: accumulator.seed,
    })
    accumulator.seed = result.seed
    if (result.addition !== null) {
      accumulator.reserved.add(key(result.addition.position))
      accumulator.nextAdditions.push(result.addition)
    }
    if (result.mutation !== null) {
      accumulator.mutations.push(result.mutation)
    }
  }
  return {
    additions: accumulator.nextAdditions,
    mutations: accumulator.mutations,
    seed: accumulator.seed,
  }
}

const fireNeedsExtinguishing = (
  { fire, cell, cellByKey, weather }: FireExtinguishingInput,
): boolean => (weather !== 'clear' && cell.exposedToSky === true) || !supported(fire.position, cellByKey)

const advanceLoadedFire = ({
  additions,
  cell,
  cellByKey,
  fire,
  seed,
  weather,
}: LoadedFireAdvanceInput): FireAdvanceResult => {
  if (fireNeedsExtinguishing({ cell, cellByKey, fire, weather })) {
    return {
      ...emptyFireAdvance(seed),
      mutations: [fireMutationAt(fire.position, AIR_BLOCK_ID)],
    }
  }
  const ageTicks = fire.ageTicks + ONE
  if (ageTicks >= FIRE_NATURAL_LIFETIME_TICKS) {
    return {
      ...emptyFireAdvance(seed),
      mutations: [fireMutationAt(fire.position, AIR_BLOCK_ID)],
    }
  }
  const spread = spreadFromFire({ additions, cellByKey, fire, seed })
  return {
    additions: spread.additions,
    mutations: spread.mutations,
    seed: spread.seed,
    survivor: { ageTicks, position: fire.position },
  }
}

const advanceFire = ({
  additions,
  cellByKey,
  fire,
  seed,
  weather,
}: FireAdvanceInput): FireAdvanceResult => {
  const cell = cellByKey.get(key(fire.position)) ?? null
  if (cell === null || cell.block === FIRE_UNAVAILABLE_BLOCK) {
    return unavailableFireAdvance(fire, seed)
  }
  if (cell.block !== FIRE_BLOCK_ID) {
    return emptyFireAdvance(seed)
  }
  return advanceLoadedFire({ additions, cell, cellByKey, fire, seed, weather })
}

const appendFireAdvance = (buckets: FireAdvanceBuckets, advance: FireAdvanceResult): void => {
  if (advance.survivor !== null) {
    buckets.survivors.push(advance.survivor)
  }
  for (const mutation of advance.mutations) {
    buckets.mutations.set(key(mutation.position), mutation)
  }
  for (const addition of advance.additions) {
    buckets.additions.set(key(addition.position), addition)
  }
}

const collectFireAdvances = ({
  active,
  cellByKey,
  seed,
  weather,
}: FireCollectionInput): FireCollectionResult => {
  const buckets: FireAdvanceBuckets = {
    additions: new Map(),
    mutations: new Map(),
    survivors: [],
  }
  let nextSeed = seed
  for (const fire of active.slice(ZERO, FIRE_WORK_BUDGET)) {
    const advance = advanceFire({
      additions: buckets.additions,
      cellByKey,
      fire,
      seed: nextSeed,
      weather,
    })
    nextSeed = advance.seed
    appendFireAdvance(buckets, advance)
  }
  buckets.survivors.push(...active.slice(FIRE_WORK_BUDGET))
  return {
    additions: buckets.additions,
    mutations: buckets.mutations,
    seed: nextSeed,
    survivors: buckets.survivors,
  }
}

const orderedFires = (
  survivors: ReadonlyArray<ActiveFire>,
  additions: ReadonlyMap<string, ActiveFire>,
): ReadonlyArray<ActiveFire> => {
  const fireByKey = new Map([
    ...survivors,
    ...additions.values(),
  ].map((fire) => [key(fire.position), fire]))
  return [...fireByKey.values()].sort((left, right) => compare(left.position, right.position))
}

const orderedMutations = (mutations: ReadonlyMap<string, FireMutation>): ReadonlyArray<FireMutation> =>
  [...mutations.values()].sort((left, right) => compare(left.position, right.position))

const stateAfterFire = ({ actors, fires, seed, state }: FireStateInput): FireLifecycleState => {
  if (actors.length > ZERO || Object.hasOwn(state, 'burningActors')) {
    return { burningActors: actors, fires, seed }
  }
  return { fires, seed }
}

export const advanceFireLifecycle = (...args: AdvanceFireLifecycleArguments): FireLifecycleStep => {
  const [state, cells, weather, contacted = [], difficulty = 'normal'] = args
  const { fires: currentFires } = state
  const cellByKey = new Map(cells.map((cell) => [key(cell.position), cell]))
  const active = [...currentFires].sort((left, right) => compare(left.position, right.position))
  const collection = collectFireAdvances({ active, cellByKey, seed: state.seed, weather })
  const fires = orderedFires(collection.survivors, collection.additions)
  const fireKeys = new Set(fires.map((fire) => key(fire.position)))
  const actors = advanceBurningActors({
    contacts: actorInput(contacted),
    difficulty,
    fireKeys,
    state,
    weather,
  })
  return {
    damages: actors.damages,
    entityDamages: actors.entityDamages,
    mutations: orderedMutations(collection.mutations),
    state: stateAfterFire({ actors: actors.burningActors, fires, seed: collection.seed, state }),
  }
}
