# Versioning

## Runtime baseline

- Node.js: >=24.0.0
- pnpm: >=11.0.0
- package module format: ESM
- package entry point: dist/index.js
- declaration entry point: dist/index.d.ts

The exact package manager version used by this repository is pinned in
package.json and provisioned through Corepack in the Nix shell.

## Public surface

The root export is the supported import path. Source files under src/ are
implementation details even though they are visible in a checkout. Every
public type change must update the API documentation and its contract tests.

## Breaking changes

Removing a local alias, changing a branded type, changing lifecycle ordering,
or changing an exported Effect error is breaking. This project does not retain
legacy aliases solely to avoid updating callers. Make the migration explicit in
porting.md, then update all in-repository callers and tests.

## Dependency updates

Dependency updates are kept in pnpm-lock.yaml and verified with typechecking,
linting, tests, coverage, package build, and the Node runtime package smoke.
Major updates require an API review of the affected upstream package. A
dependency is not retained merely because a port could theoretically be
implemented with it; unused direct dependencies are removed.

Vitest and `@vitest/coverage-v8` are currently resolved to `4.1.11`, as declared
in `package.json`. `@effect/vitest@0.30.0` still advertises a `vitest: ^3.2.0`
peer range, so this pairing remains a dependency-review point even though the
repository's current typecheck, lint, test, coverage, build, and package smoke
gates pass. Recheck the peer metadata with `pnpm peers check` before changing
either runner dependency.

### Upstream synchronization

The direct runtime pins are intentionally aligned with the published simulation,
physics, save, and world-generation packages. The root package uses
`mc-kernel@0.4.0`, `mc-sim@0.1.42`, `mc-physics@0.1.7`, `mc-save@0.2.2`, and
`mc-worldgen@0.1.14`. The lockfile can still retain older kernel versions for
transitive compatibility, so it must not be treated as a single-version graph.
Check any upgrade with `pnpm why @nerima-games/mc-kernel` and the upstream
package dependency metadata before changing the pins.

## Publishing

package.json controls the registry and access policy. The published payload is
limited to dist, LICENSE, and README.md. Publishing happens through the
release.yaml GitHub Actions workflow, which re-runs
`nix develop --command pnpm verify` and `nix develop --command pnpm package:verify`
against the version-bumped commit before running `pnpm publish --no-git-checks`,
then tags the published commit `v<version>`. Locally, run
nix develop --command pnpm prepublishOnly (typecheck, lint, test, build, and the
packed-archive runtime smoke test) before proposing a version bump, and inspect
`pnpm pack --dry-run --json` to confirm the generated runtime bundle has no
checkout-relative TypeScript imports.
