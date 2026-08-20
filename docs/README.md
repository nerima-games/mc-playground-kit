# Documentation

- Architecture: architecture.md
- Public API: public-api.md
- Responsibility: responsibility.md
- Testing: testing.md
- Design notes: design-notes.md
- Porting: porting.md
- Versioning: versioning.md

The terminal preview is documented in apps/preview-harness/README.md.

## Verification

Run the CI-equivalent verification from the repository root:

```sh
nix develop --command pnpm verify
```

This runs typechecking, linting, coverage-enabled tests, the package build, and
the package export smoke test. See testing.md for the individual commands and
how to interpret their results.
