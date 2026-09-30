# mc-playground-kit P3 handoff

## done

- Branch: `takeokunn-p3-kernel-0-8`.
- `ea52a94`: exact pins for kernel 0.8.0, physics 0.3.0, save 0.5.0, worldgen 0.5.0, sim 0.5.0; workspace release-age exclusions; regenerated lockfile. The lockfile resolves kernel 0.8.0 as the single kernel version.
- `2bdfdef`: moved `Dimension` imports to kernel in `src/application/generated-gameplay.ts`, `src/application/generated-world-provider.ts`, `src/domain/end-portal-interaction.ts`, and `src/domain/flat-chunk.ts`.
- `061caa4`: migrated sim 0.5.0 fixed-step expectations and canonical `ItemStack` fixtures/helpers; resolved the explicit kernel `addItemStack` export; updated related runtime comments/tests.
- `6b110b9`: added `test/brand-boundaries.compile.ts` with kernel, physics, save, worldgen, and sim brand checks.
- `8ce4bdb`: updated `docs/public-api.md`, `docs/responsibility.md`, `docs/versioning.md`, and added the minor changeset `.changeset/bright-kits-follow.md`.
- Verified typecheck, tests, coverage, and lint before this handoff. Coverage was 100% for statements, branches, functions, and lines.
- `package:verify` was run once and stopped at npm HTTP 403 (`permission_denied`, token scope mismatch); no retry was made.

## remaining

- Typecheck residuals: none observed; `nix develop --command pnpm typecheck` exited 0 after the sim pin. Re-run after any follow-up edits.
- The declaration inventory still needs a final diff-driven update to `docs/public-api.md` after the final `dist/*.d.ts` build; the current prose update is not that final inventory.
- Full gates after handoff, including package verification if credentials are corrected, remain for the successor. Browser/load-sensitive gates remain pending.
- PR creation, CI observation, merge, release branch, publish, and tag were intentionally not started.

## next action

Run `nix develop --command pnpm build`, inspect the generated declaration diff against `origin/main`, and finish the `docs/public-api.md` inventory before running the remaining gates.

## traps

- If Nix reports `eval-cache SQLite busy`, wait about one minute and retry `nix develop --command pnpm install` (maximum five attempts).
- `package:verify` hit HTTP 403 once; stop on that gap rather than looping until credentials are corrected.
- Browser tests become slow when load exceeds 100; run browser checks only when load is below 30.
- Do not place expanded environment values, tokens, or other secrets in handoffs, commits, PR text, or docs.
- Do not merge, publish, tag, create a release branch, or create the PR from this continuation.

## related paths

- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `src/application/`
- `src/domain/`
- `src/index.ts`
- `test/`
- `apps/`
- `docs/public-api.md`
- `docs/responsibility.md`
- `docs/versioning.md`
- `.changeset/bright-kits-follow.md`
