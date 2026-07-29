/**
 * `LaunchOptions` normalisation.
 *
 * plan.md §3.10's public API is `launchPlayground(options: {world?, spawnKit?,
 * modules?})`, every field optional. The promise that makes that API worth
 * having is that `launchPlayground()` with nothing at all is a complete
 * configuration — so these tests are about the DEFAULTS and about the merge,
 * not about the types being spelled correctly.
 *
 * They are also the `exactOptionalPropertyTypes` tests. Several assertions below
 * would not compile if `LaunchOptions` used bare `?:` fields, and that is the
 * point of writing them: the compiler is the assertion.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  DEFAULT_FLAT_WORLD,
  DEFAULT_SPAWN_KIT,
  flattenStages,
  normalizeLaunchOptions,
  stageOrderViolations,
  type LaunchOptions,
  type PreviewModule,
} from '../domain/launch-options'
import { DeltaTimeSecs, StageId, WorldId, position, type StageRegistration } from "@nerima-games/mc-kernel"

const stage = (id: string, after?: ReadonlyArray<string>): StageRegistration => ({
  id: StageId(id),
  ...(after === undefined ? {} : { after: after.map(StageId) }),
  run: (_dt: DeltaTimeSecs) => Effect.void,
})

const moduleOf = (...stages: ReadonlyArray<StageRegistration>): PreviewModule => ({
  frameStages: Effect.succeed(stages),
})

describe('defaults', () => {
  it.effect('launchPlayground() with NO options is a complete configuration', () =>
    Effect.sync(() => {
      // The whole reason this repository exists. If this assertion ever needs a
      // caveat, every preview in the project grows a paragraph of boilerplate.
      const resolved = normalizeLaunchOptions()

      expect(resolved.world).toStrictEqual(DEFAULT_FLAT_WORLD)
      expect(resolved.spawnKit).toStrictEqual(DEFAULT_SPAWN_KIT)
      expect(resolved.modules).toStrictEqual([])
    }),
  )

  it.effect('an explicitly undefined options bag is the same as no options bag', () =>
    Effect.sync(() => {
      expect(normalizeLaunchOptions(undefined)).toStrictEqual(normalizeLaunchOptions())
      expect(normalizeLaunchOptions({})).toStrictEqual(normalizeLaunchOptions())
    }),
  )

  it.effect('the world is flat, small, seeded and reproducible', () =>
    Effect.sync(() => {
      // Literals, not arithmetic over the constants: a test whose both sides
      // read the same constant stays green when the constant is "tidied".
      expect(DEFAULT_FLAT_WORLD.seed).toBe(0)
      expect(DEFAULT_FLAT_WORLD.surfaceY).toBe(49)
      expect(DEFAULT_FLAT_WORLD.radiusChunks).toBe(1)
      expect(String(DEFAULT_FLAT_WORLD.worldId)).toBe('playground')
    }),
  )

  it.effect('REGRESSION: the player spawns at surfaceY + 1, standing ON the block', () =>
    Effect.sync(() => {
      // plan.md §3.4: ブロックは [y, y+1] を占有。スポーンと物理平面は surfaceY+1 基準.
      // Spawning at surfaceY itself puts the feet inside the block, and the AABB
      // resolver then ejects the player upward on frame one — visibly.
      expect(DEFAULT_SPAWN_KIT.feetPosition.y).toBe(50)
      expect(DEFAULT_SPAWN_KIT.feetPosition.y).toBe(DEFAULT_FLAT_WORLD.surfaceY + 1)
    }),
  )

  it.effect('the default hotbar is not empty, so a preview is usable on frame one', () =>
    Effect.sync(() => {
      expect(DEFAULT_SPAWN_KIT.hotbar.length).toBeGreaterThan(0)
      expect(DEFAULT_SPAWN_KIT.hotbar.every((slot) => slot.count > 0)).toBe(true)
    }),
  )
})

describe('merging', () => {
  it.effect('a partial world override keeps every field it did not mention', () =>
    Effect.sync(() => {
      const resolved = normalizeLaunchOptions({ world: { seed: 1234 } })

      expect(resolved.world.seed).toBe(1234)
      expect(resolved.world.surfaceY).toBe(DEFAULT_FLAT_WORLD.surfaceY)
      expect(resolved.world.radiusChunks).toBe(DEFAULT_FLAT_WORLD.radiusChunks)
      expect(resolved.world.worldId).toBe(DEFAULT_FLAT_WORLD.worldId)
    }),
  )

  it.effect('an explicit undefined FIELD means "not supplied", not "blank it out"', () =>
    Effect.sync(() => {
      // This call is the exactOptionalPropertyTypes test: it does not compile if
      // the option fields are declared `?: T` rather than `?: T | undefined`.
      // Ordinary calling code produces exactly this shape:
      //   { world: { seed: flag ? 7 : undefined } }
      const resolved = normalizeLaunchOptions({
        world: { seed: undefined, surfaceY: 80 },
        spawnKit: undefined,
        modules: undefined,
      })

      expect(resolved.world.seed).toBe(DEFAULT_FLAT_WORLD.seed)
      expect(resolved.world.surfaceY).toBe(80)
      expect(resolved.spawnKit).toStrictEqual(DEFAULT_SPAWN_KIT)
      expect(resolved.modules).toStrictEqual([])
    }),
  )

  it.effect('zero and empty are supplied values, not missing ones', () =>
    Effect.sync(() => {
      // `pick` tests against undefined, not falsiness. A `??`, a `||` or a
      // truthiness check here would silently replace a deliberate 0 with the
      // default, and `radiusChunks: 0` (a single chunk) is a real request.
      const resolved = normalizeLaunchOptions({
        world: { radiusChunks: 0, surfaceY: 0 },
        spawnKit: { hotbar: [], yawRadians: 0 },
      })

      expect(resolved.world.radiusChunks).toBe(0)
      expect(resolved.world.surfaceY).toBe(0)
      expect(resolved.spawnKit.hotbar).toStrictEqual([])
      expect(resolved.spawnKit.yawRadians).toBe(0)
    }),
  )

  it.effect('the spawn point does NOT follow an overridden surface height', () =>
    Effect.sync(() => {
      // Deliberate: a default that is a function of another caller-supplied
      // value turns "what do I get if I pass nothing" into "what do I get if I
      // pass this particular subset", and the subsets multiply. Documented in
      // domain/launch-options.ts, asserted here so it cannot drift silently.
      const resolved = normalizeLaunchOptions({ world: { surfaceY: 200 } })

      expect(resolved.world.surfaceY).toBe(200)
      expect(resolved.spawnKit.feetPosition.y).toBe(DEFAULT_SPAWN_KIT.feetPosition.y)
    }),
  )

  it.effect('normalisation is pure: it does not mutate the caller, or the defaults', () =>
    Effect.sync(() => {
      const supplied: LaunchOptions = { world: { seed: 9 } }
      const first = normalizeLaunchOptions(supplied)
      const second = normalizeLaunchOptions(supplied)

      expect(first).toStrictEqual(second)
      expect(first).not.toBe(second)
      expect(DEFAULT_FLAT_WORLD.seed).toBe(0)
      expect(normalizeLaunchOptions().world).toStrictEqual(DEFAULT_FLAT_WORLD)
    }),
  )

  it.effect('a fully specified options bag passes straight through', () =>
    Effect.sync(() => {
      const resolved = normalizeLaunchOptions({
        world: { worldId: WorldId('redstone-bench'), seed: 42, surfaceY: 64, radiusChunks: 2 },
        spawnKit: {
          feetPosition: position(8, 65, -8),
          yawRadians: 1.5,
          pitchRadians: -0.2,
          hotbar: [{ item: 'REDSTONE_TORCH', count: 16 }],
        },
        modules: [moduleOf(stage('redstone:tick'))],
      })

      expect(resolved.world).toStrictEqual({
        worldId: WorldId('redstone-bench'),
        seed: 42,
        surfaceY: 64,
        radiusChunks: 2,
      })
      expect(resolved.spawnKit.feetPosition).toStrictEqual({ x: 8, y: 65, z: -8 })
      expect(resolved.modules).toHaveLength(1)
    }),
  )
})

describe('stage order is CHECKED, never resolved', () => {
  it.effect('flattens modules in declaration order, stages within a module in declaration order', () =>
    Effect.gen(function* () {
      const flattened = yield* flattenStages([
        moduleOf(stage('a'), stage('b')),
        moduleOf(stage('c')),
      ])

      expect(flattened.map((registration) => String(registration.id))).toStrictEqual(['a', 'b', 'c'])
    }),
  )

  it.effect('a correctly ordered set of stages produces no warnings', () =>
    Effect.gen(function* () {
      const modules = [moduleOf(stage('input'), stage('sim', ['input']), stage('render', ['sim', 'input']))]

      expect(yield* stageOrderViolations(modules)).toStrictEqual([])
    }),
  )

  it.effect('reports a stage declared BEFORE something it said it must follow', () =>
    Effect.gen(function* () {
      const violations = yield* stageOrderViolations([moduleOf(stage('render', ['sim']), stage('sim'))])

      expect(violations).toHaveLength(1)
      expect(String(violations[0]?.stage)).toBe('render')
      expect(String(violations[0]?.mustFollow)).toBe('sim')
      expect(violations[0]?.declaredIndex).toBe(0)
      expect(violations[0]?.constraintIndex).toBe(1)
    }),
  )

  it.effect('catches an ordering violation that spans two modules', () =>
    Effect.gen(function* () {
      // The interesting case: neither module is wrong on its own. Only the order
      // the caller listed them in is.
      const violations = yield* stageOrderViolations([
        moduleOf(stage('redstone:tick', ['gameplay:fluids'])),
        moduleOf(stage('gameplay:fluids')),
      ])

      expect(violations.map((violation) => String(violation.stage))).toStrictEqual(['redstone:tick'])
    }),
  )

  it.effect('an `after` naming an ABSENT stage is not a violation — kernel says the edge is absent', () =>
    Effect.gen(function* () {
      // mc-kernel/domain/frame.ts:46-54. This is the common case here: a preview
      // is by construction a subset of the game, so "run me after input, if
      // there is input" must stay legal in a preview that has no input stage.
      expect(yield* stageOrderViolations([moduleOf(stage('gameplay:mining', ['input', 'physics']))])).toStrictEqual([])
    }),
  )

  it.effect('a self-edge is ignored rather than reported as an impossible constraint', () =>
    Effect.gen(function* () {
      expect(yield* stageOrderViolations([moduleOf(stage('loop', ['loop']))])).toStrictEqual([])
    }),
  )

  it.effect('a duplicate stage id resolves to its FIRST occurrence', () =>
    Effect.gen(function* () {
      // What a duplicate id MEANS is mc-compose's call, not a harness's. This
      // pins the harness's behaviour so the ambiguity is at least deterministic.
      expect(yield* stageOrderViolations([moduleOf(stage('x'), stage('y', ['x']), stage('x'))])).toStrictEqual([])
    }),
  )

  it.effect('no modules, no stages, no warnings', () =>
    Effect.gen(function* () {
      expect(yield* flattenStages([])).toStrictEqual([])
      expect(yield* stageOrderViolations([])).toStrictEqual([])
      expect(yield* stageOrderViolations([moduleOf()])).toStrictEqual([])
    }),
  )
})
