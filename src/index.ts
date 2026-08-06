/**
 * @nerima-games/mc-playground-kit — the preview harness.
 *
 * PRE-AUDIT FIRST CUT (叩き台). See README.md 現状.
 *
 * plan.md §3.10 describes this repository as the glue that stands up
 * 「ミニ平地ワールド + カメラ + レンダラ + 入力」in one second, and calls it
 * **最も丁寧に作る部品** because 全プレビューの開発体験がここの起動速度と安定性に依存する.
 * Every other repository's completion criterion (plan.md §6 Step 2) includes
 * "内蔵プレビューが操作可能", and every one of those previews boots through here.
 *
 * ---------------------------------------------------------------------------
 * THIS PACKAGE IS A devDependency. ALWAYS.
 * ---------------------------------------------------------------------------
 *
 * plan.md §2.3-2. mc-playground-kit is developer tooling and is not in the
 * release build. A `dependencies` entry on it, anywhere, is a CI failure
 * (`scripts/check-dependency-whitelist.ts`: `dev-only-package-in-dependencies`
 * and `dev-only-package-in-shipped-source`).
 *
 * The rule is not bookkeeping. The runtime input service belongs to mc-render
 * precisely because this harness is not shipped: put input here and the released
 * game boots, renders, and responds to nothing at all. `InputPort` below is a
 * Tag with no implementation in this repository, and that absence is the design.
 *
 * ---------------------------------------------------------------------------
 * The barrel
 * ---------------------------------------------------------------------------
 *
 * Deliberately explicit. `export *` from a module is a promise to keep
 * everything in that module stable, and that promise is made here only where it
 * is meant.
 */

// --- Domain: pure values, defaults and arithmetic ---------------------------
export * from './domain/boot-phase'
export * from './domain/launch-options'

// --- Application: the harness and the surfaces it requires ------------------
export * from './application/preview-ports'
export * from './application/playground'
export * from './application/browser-preview'

// --- Provisional --------------------------------------------------------------
// Kernel vocabulary is not re-exported from this barrel: consumers import it
// from `@nerima-games/mc-kernel`, keeping one source of truth. Types that
// appear in this repository's signatures remain structurally compatible with
// the published package.
