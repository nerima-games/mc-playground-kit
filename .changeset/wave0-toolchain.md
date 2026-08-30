---
"@nerima-games/mc-playground-kit": minor
---

Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added. Adopts the mc-sim 0.2.1 contract: makeControllableSimStagesWithPhysics replaces makeSimStagesForPreviewWithPhysics, ExplosionRequest/PrimedTntRequest are non-generic with a required entities list, PrimedTntState uses kind tags, and physics ResolveOptions takes blockPropertiesAt instead of isBlockSolid
