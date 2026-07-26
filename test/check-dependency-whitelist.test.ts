/**
 * Tests for the boundary gate itself.
 *
 * plan.md §5.1-4 requires the dependency whitelist CI from the first commit. A
 * gate nobody tests is a gate that quietly stops gating — the reference's
 * `check-package-dag.ts` printed warnings and always exited 0, which is
 * documentation wearing a gate's clothes.
 *
 * This repository has a particular stake in it. `DEV_ONLY_PACKAGES` names
 * exactly one package, and that package is this one: the script running here is
 * the script that defines the rule constraining every consumer of this
 * repository. plan.md §2.3-2 —
 *
 *   kit は devDependency 専用のため、kit に入力を置くと本番ゲームから入力が消える
 *
 * — is not bookkeeping. mc-playground-kit is not in the release build, so a
 * shipped module reaching back through it for the input service would produce a
 * game that boots, renders, and responds to nothing. The `dev-only-*` tests
 * below are the ones that matter most here.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  DEV_ONLY_PACKAGES,
  KERNEL_PACKAGE,
  REPOSITORY_POLICY,
  TIME_SOURCE_ESCAPE_HATCH,
  allowedDirectDependencies,
  checkDeclaredDependencies,
  checkPolicyConfiguration,
  classifyImport,
  extractOrgPackageName,
  findBannedTimeSources,
  findCycles,
  findTransitivePath,
  isToolingOrTestPath,
  parseImports,
  type DeclaredDependencies,
} from '../scripts/check-dependency-whitelist'

const KIT = '@nerima-games/mc-playground-kit'

const NOTHING_DECLARED: DeclaredDependencies = {
  dependencies: new Set<string>(),
  devDependencies: new Set<string>(),
}

const declaring = (
  dependencies: ReadonlyArray<string>,
  dev: ReadonlyArray<string> = [],
): DeclaredDependencies => ({
  dependencies: new Set(dependencies),
  devDependencies: new Set(dev),
})

const shippedImport = (importedPackage: string) => ({
  importedPackage,
  filePath: 'application/playground.ts',
  line: 1,
  isToolingOrTest: false,
})

const testImport = (importedPackage: string) => ({
  importedPackage,
  filePath: 'test/playground.test.ts',
  line: 1,
  isToolingOrTest: true,
})

const graph = (
  entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>,
): Map<string, ReadonlySet<string>> => new Map(entries.map(([node, targets]) => [node, new Set(targets)]))

describe('mc-playground-kit dependency policy', () => {
  it.effect('is this repository, and its allowed set is exactly plan.md §3.10', () =>
    Effect.sync(() => {
      expect(REPOSITORY_POLICY.thisPackage).toBe(KIT)
      expect([...allowedDirectDependencies()].sort()).toStrictEqual([
        '@nerima-games/mc-render',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-worldgen',
      ])
    }),
  )

  it.effect('carries the FULL 16-repository roster, so cycle detection can see a cycle', () =>
    Effect.sync(() => {
      expect([...REPOSITORY_POLICY.dependencyGraph.keys()].sort()).toStrictEqual([
        '@nerima-games/mc-audio',
        '@nerima-games/mc-compose',
        '@nerima-games/mc-dev-meta',
        '@nerima-games/mc-kernel',
        '@nerima-games/mc-meshing',
        '@nerima-games/mc-noise',
        '@nerima-games/mc-physics',
        '@nerima-games/mc-playground-kit',
        '@nerima-games/mc-render',
        '@nerima-games/mc-save',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-worldgen',
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-multiplayer',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
      ])
      expect(REPOSITORY_POLICY.dependencyGraph.size).toBe(16)
    }),
  )

  it.effect('has an internally consistent configuration: no cycles, no dangling rows', () =>
    Effect.sync(() => {
      expect(checkPolicyConfiguration()).toStrictEqual([])
    }),
  )

  it.effect('the declared architecture is acyclic end to end', () =>
    Effect.sync(() => {
      expect(findCycles(REPOSITORY_POLICY.dependencyGraph)).toStrictEqual([])
    }),
  )

  it.effect('never lists mc-kernel as an edge — it is universal, not a dependency', () =>
    Effect.sync(() => {
      for (const [, targets] of REPOSITORY_POLICY.dependencyGraph) {
        expect(targets.has(KERNEL_PACKAGE)).toBe(false)
      }
    }),
  )

  it.effect('this repository sits at the TOP of the runtime graph: nothing depends on it', () =>
    Effect.sync(() => {
      // The structural expression of "devDependency only". A package no runtime
      // row points at cannot become a runtime dependency by accident; it takes
      // an explicit edit to package.json, which is what the gate then catches.
      for (const [source, targets] of REPOSITORY_POLICY.dependencyGraph) {
        expect(`${source} -> ${targets.has(KIT) ? 'kit' : 'not-kit'}`).toBe(`${source} -> not-kit`)
      }
    }),
  )
})

describe('devDependency-only — plan.md §2.3-2, the defining constraint', () => {
  it.effect('this repository is the ONE package DEV_ONLY_PACKAGES names', () =>
    Effect.sync(() => {
      expect([...DEV_ONLY_PACKAGES]).toStrictEqual([KIT])
    }),
  )

  it.effect('REGRESSION: kit in "dependencies" is a package.json-level failure, in ANY repository', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies(declaring([KIT]))

      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('dev-only-package-in-dependencies')
      expect(violations[0]?.message).toContain('input handling')
    }),
  )

  it.effect('kit in "devDependencies" is fine, in any repository', () =>
    Effect.sync(() => {
      // mx-gameplay and mx-redstone do exactly this (plan.md §2.1's dotted
      // edges). It is legal precisely because it creates no runtime edge.
      expect(checkDeclaredDependencies(declaring([], [KIT]))).toStrictEqual([])
    }),
  )

  it.effect('KNOWN LIMIT: from THIS copy, the dev-only IMPORT rules are shadowed by self-import', () =>
    Effect.sync(() => {
      // `classifyImport` reads `REPOSITORY_POLICY.thisPackage`, and here that IS
      // mc-playground-kit — so the self-import branch always wins and
      // `dev-only-package-in-shipped-source` is unreachable from this
      // repository's copy of the script.
      //
      // That is correct behaviour and the right message (a relative import is
      // indeed what this repository should use), but it means the import half of
      // the rule this repository defines can only ever fire in the OTHER fifteen
      // copies. Asserting the shadowing here is the honest thing to do: the
      // alternative is a test that fakes a sibling's policy and therefore tests
      // a configuration no repository actually runs.
      //
      // What IS enforced from here is the package.json half — see the test
      // above — and that half is the one that would catch a kit dependency
      // creeping into this repository's own manifest. See docs/design-notes.md
      // DN-01 for the coverage that the other fifteen repositories owe.
      expect(classifyImport(shippedImport(KIT), NOTHING_DECLARED)?.rule).toBe('self-import')
      expect(classifyImport(testImport(KIT), declaring([], [KIT]))?.rule).toBe('self-import')
    }),
  )

  it.effect('the dev-only rule text names the consequence, not just the rule', () =>
    Effect.sync(() => {
      // A gate that says "policy violation" gets suppressed. A gate that says
      // what breaks gets fixed. plan.md §2.3-2's consequence — 本番ゲームから
      // 入力が消える — has to survive into the message a sibling repository sees.
      const violation = checkDeclaredDependencies(declaring([KIT]))[0]

      expect(violation?.message).toContain('delete input handling from the shipped game')
      expect(violation?.message).toContain('Move it to "devDependencies"')
    }),
  )

  it.effect('the dotted preview edges are deliberately NOT rows in the graph', () =>
    Effect.sync(() => {
      // plan.md §2.1 draws `gameplay -.-> kit` and `redstone -.-> kit`. Neither
      // is a runtime edge, so neither appears in the dependency graph, and
      // DEV_ONLY_PACKAGES is what enforces them instead.
      expect(REPOSITORY_POLICY.dependencyGraph.get('@nerima-games/mx-gameplay')?.has(KIT)).toBe(false)
      expect(REPOSITORY_POLICY.dependencyGraph.get('@nerima-games/mx-redstone')?.has(KIT)).toBe(false)
    }),
  )

  it.effect('REGRESSION: modelling a dotted edge would mislabel a real violation', () =>
    Effect.sync(() => {
      // This is the concrete cost of getting it wrong, and the reason to have a
      // test rather than a comment. mx-gameplay must not import mc-render:
      // today that is a plain `not-whitelisted`, because no runtime path from
      // gameplay reaches render at all.
      const runtime = REPOSITORY_POLICY.dependencyGraph
      expect(findTransitivePath(runtime, '@nerima-games/mx-gameplay', '@nerima-games/mc-render')).toBeUndefined()

      // Add the devDependency as if it were a runtime edge, and gameplay now
      // "reaches" mc-render — through a package that is not in its runtime graph
      // and will not be in the shipped build. The gate would report
      // `transitive-import` and advise declaring a direct dependency, which is
      // advice about a path that does not exist at run time.
      const withDottedEdge = new Map(runtime)
      withDottedEdge.set(
        '@nerima-games/mx-gameplay',
        new Set([...(runtime.get('@nerima-games/mx-gameplay') ?? []), KIT]),
      )

      expect(findTransitivePath(withDottedEdge, '@nerima-games/mx-gameplay', '@nerima-games/mc-render')).toStrictEqual(
        ['@nerima-games/mx-gameplay', KIT, '@nerima-games/mc-render'],
      )
      // It is still not a cycle — a dev-only package has no incoming runtime
      // edges, so it cannot close one. The reason to leave the edge out is that
      // it is not a runtime edge, not that it would loop.
      expect(findCycles(withDottedEdge)).toStrictEqual([])
    }),
  )
})

describe('import classification for mc-playground-kit', () => {
  it.effect('allows each of the three declared direct dependencies from shipped source', () =>
    Effect.sync(() => {
      for (const parent of ['@nerima-games/mc-worldgen', '@nerima-games/mc-sim', '@nerima-games/mc-render']) {
        expect(classifyImport(shippedImport(parent), declaring([parent]))).toBeUndefined()
      }
    }),
  )

  it.effect('allows mc-kernel without it appearing in any allowlist — but it must be declared', () =>
    Effect.sync(() => {
      expect(classifyImport(shippedImport(KERNEL_PACKAGE), declaring([KERNEL_PACKAGE]))).toBeUndefined()
      expect(classifyImport(shippedImport(KERNEL_PACKAGE), NOTHING_DECLARED)?.rule).toBe('undeclared-dependency')
    }),
  )

  it.effect('REGRESSION: mc-meshing is reachable through mc-render and is therefore FORBIDDEN', () =>
    Effect.sync(() => {
      // A harness has no business meshing a chunk. Geometry reaches the screen
      // through mc-render's WorldRenderer, and a second path to it would be a
      // second answer to "what does this chunk look like".
      const violation = classifyImport(
        shippedImport('@nerima-games/mc-meshing'),
        declaring(['@nerima-games/mc-meshing']),
      )

      expect(violation?.rule).toBe('transitive-import')
      expect(violation?.message).toContain('@nerima-games/mc-render -> @nerima-games/mc-meshing')
    }),
  )

  it.effect('REGRESSION: mc-physics is reachable through mc-sim and is therefore FORBIDDEN', () =>
    Effect.sync(() => {
      // The temptation here is real: a harness that "just wants to check the
      // player is standing on something" would reach for an AABB query. Standing
      // on something is mc-sim's answer to give.
      expect(
        classifyImport(shippedImport('@nerima-games/mc-physics'), declaring(['@nerima-games/mc-physics']))?.rule,
      ).toBe('transitive-import')
    }),
  )

  it.effect('REGRESSION: mc-noise is reachable through mc-worldgen and is therefore FORBIDDEN', () =>
    Effect.sync(() => {
      expect(
        classifyImport(shippedImport('@nerima-games/mc-noise'), declaring(['@nerima-games/mc-noise']))?.rule,
      ).toBe('transitive-import')
    }),
  )

  it.effect('rejects mc-audio outright: it is not reachable at all', () =>
    Effect.sync(() => {
      // Nothing this repository depends on depends on audio. A preview that
      // wants sound gets it the way the game does — from a module that depends
      // on mc-audio in its own right.
      expect(classifyImport(shippedImport('@nerima-games/mc-audio'), NOTHING_DECLARED)?.rule).toBe(
        'not-whitelisted',
      )
    }),
  )

  it.effect('rejects every experience module: the harness must not know the game rules', () =>
    Effect.sync(() => {
      // plan.md §2.3-1's noun/verb rule seen from the other side. A harness that
      // imported mx-gameplay would stop being a harness and start being a game.
      for (const experience of [
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
        '@nerima-games/mx-multiplayer',
        '@nerima-games/mc-compose',
      ]) {
        expect(classifyImport(shippedImport(experience), declaring([experience]))?.rule).toBe('not-whitelisted')
      }
    }),
  )

  it.effect('flags a typo as unknown-package rather than guessing', () =>
    Effect.sync(() => {
      expect(classifyImport(shippedImport('@nerima-games/mc-rendr'), NOTHING_DECLARED)?.rule).toBe(
        'unknown-package',
      )
    }),
  )

  it.effect('a dependency in package.json that the policy forbids is caught even if unimported', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies(declaring(['@nerima-games/mc-meshing', 'effect']))

      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('undeclared-in-policy')
    }),
  )
})

describe('shipped vs tooling classification', () => {
  it.effect('index.ts, domain/ and application/ are shipped; everything else is not', () =>
    Effect.sync(() => {
      expect(isToolingOrTestPath('index.ts')).toBe(false)
      expect(isToolingOrTestPath('domain/launch-options.ts')).toBe(false)
      expect(isToolingOrTestPath('application/playground.ts')).toBe(false)
      expect(isToolingOrTestPath('test/playground.test.ts')).toBe(true)
      expect(isToolingOrTestPath('scripts/check-dependency-whitelist.ts')).toBe(true)
    }),
  )
})

describe('graph utilities', () => {
  it.effect('findTransitivePath explains WHY an import is unlicensed', () =>
    Effect.sync(() => {
      expect(
        findTransitivePath(REPOSITORY_POLICY.dependencyGraph, KIT, '@nerima-games/mc-meshing'),
      ).toStrictEqual([KIT, '@nerima-games/mc-render', '@nerima-games/mc-meshing'])
      expect(
        findTransitivePath(REPOSITORY_POLICY.dependencyGraph, KIT, '@nerima-games/mx-gameplay'),
      ).toBeUndefined()
    }),
  )

  it.effect('findCycles rejects a two-node cycle — there is no co-evolution allowlist here', () =>
    Effect.sync(() => {
      expect(findCycles(graph([['a', ['b']], ['b', ['a']]]))[0]?.rule).toBe('cycle')
    }),
  )

  it.effect('a diamond is not a cycle', () =>
    Effect.sync(() => {
      expect(findCycles(graph([['a', ['b', 'c']], ['b', ['d']], ['c', ['d']], ['d', []]]))).toStrictEqual([])
    }),
  )

  it.effect('extractOrgPackageName strips subpaths and ignores non-org specifiers', () =>
    Effect.sync(() => {
      expect(extractOrgPackageName('@nerima-games/mc-render/application/input-service')).toBe(
        '@nerima-games/mc-render',
      )
      expect(extractOrgPackageName('effect')).toBeUndefined()
      expect(extractOrgPackageName('../domain/launch-options')).toBeUndefined()
    }),
  )
})

describe('import extraction', () => {
  it.effect('sees real imports, including multi-line and dynamic ones', () =>
    Effect.sync(() => {
      const source = [
        "import { Effect } from 'effect'",
        'import {',
        '  InputService,',
        "} from '@nerima-games/mc-render'",
        "const later = await import('@nerima-games/mc-sim')",
        "export type { Chunk } from '@nerima-games/mc-worldgen'",
      ].join('\n')

      expect(parseImports(source).map((record) => record.specifier)).toStrictEqual([
        'effect',
        '@nerima-games/mc-render',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-worldgen',
      ])
    }),
  )

  it.effect('does NOT see an import mentioned inside a comment or a string', () =>
    Effect.sync(() => {
      // This file, and every doc in docs/, is full of prose about importing kit
      // from shipped source. A gate that could not tell prose from code would
      // fail on its own documentation.
      const source = [
        `// import { launchPlayground } from '${KIT}'`,
        `/* import { launchPlayground } from '${KIT}' */`,
        `const documentation = "import { X } from '${KIT}'"`,
      ].join('\n')

      expect(parseImports(source).filter((record) => record.specifier.startsWith('@nerima-games'))).toStrictEqual(
        [],
      )
    }),
  )
})

describe('banned time sources', () => {
  it.effect('catches all three raw clock reads, with line numbers', () =>
    Effect.sync(() => {
      // plan.md §4.3 / §5.1-3. `performance.now()` matters especially here: it
      // is the obvious thing to reach for when measuring a boot budget, and
      // domain/boot-phase.ts deliberately does not.
      const source = ['const a = Date.now()', 'const b = new Date()', 'const c = performance.now()'].join('\n')
      const violations = findBannedTimeSources(source, 'application/playground.ts')

      expect(violations.map((violation) => violation.line).sort()).toStrictEqual([1, 2, 3])
      expect(violations.every((violation) => violation.rule === 'banned-time-source')).toBe(true)
    }),
  )

  it.effect('ignores the same text inside a comment or a string', () =>
    Effect.sync(() => {
      const source = ['// Date.now() is banned', 'const message = "call Date.now() and lose"'].join('\n')

      expect(findBannedTimeSources(source, 'application/playground.ts')).toStrictEqual([])
    }),
  )

  it.effect('the escape hatch exempts exactly the line that carries it', () =>
    Effect.sync(() => {
      // The only legitimate raw clock read is the adapter that IMPLEMENTS the
      // clock Port. That adapter lives in whichever repository owns the platform
      // layer — not here. This repository takes ClockPort as a requirement.
      const source = [
        `const now = Date.now() // ${TIME_SOURCE_ESCAPE_HATCH}`,
        'const sneaky = Date.now()',
      ].join('\n')
      const violations = findBannedTimeSources(source, 'application/clock-adapter.ts')

      expect(violations).toHaveLength(1)
      expect(violations[0]?.line).toBe(2)
    }),
  )
})
