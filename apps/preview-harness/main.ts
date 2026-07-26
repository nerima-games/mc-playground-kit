/**
 * `apps/preview-harness` — mc-playground-kit's built-in preview.
 *
 * plan.md §2.3-4 requires a preview to live with the thing it verifies, and
 * plan.md §4.1 puts it under `apps/preview-<name>/`: a dev application INSIDE
 * this repository, not a package, not part of `index.ts`, and not something a
 * consumer can import.
 *
 * ---------------------------------------------------------------------------
 * The harness previews ITSELF, and half of what it is asked to show is missing
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md names this repository's preview 「自身の最小 E2E
 * （起動 → 操作 → スクリーンショット）」 — launch, operate, screenshot.
 *
 * The first two are here. The third cannot be written today, and it is worth
 * being exact about why, because the reason is not effort:
 *
 *   1. There are no real Port Layers. `application/preview-ports.ts` is four
 *      `Context.Tag`s and their service types, with deliberately no
 *      `Layer.succeed` anywhere — a fake shipped from the package would be a
 *      fake every consumer could build a preview on. Real ones need
 *      mc-worldgen, mc-sim and mc-render published and pinned (plan.md §6
 *      Step 3), and nothing is published.
 *   2. A screenshot is of pixels, and mc-render ships no THREE.js and no
 *      `lib.DOM`.
 *   3. `@playwright/test` is a dependency of no repository in the organisation.
 *   4. A screenshot test needs an agreed answer to "what counts as the same
 *      picture", and plan.md §3.10 records that Playwright runs on SwiftShader,
 *      so the baselines cannot come from a developer machine.
 *
 * None of that blocks the property plan.md §3.10 says matters most. kit is
 * 「最も丁寧に作る」 because every other repository's preview startup rides on
 * it, and what has to hold is **starts in about a second, reliably**. That is
 * measurable right now — and measurable BECAUSE the ports are injected. This app
 * programs four fakes and a `ClockPort`, launches, operates, tears down, and
 * relaunches, and prints the boot budget by phase.
 *
 * A boot budget measured against a wall clock would be a benchmark, and a
 * benchmark that fails on a loaded CI machine gets deleted. Every millisecond
 * this app reports comes from a clock the fixture programmed, so the numbers are
 * the same on a laptop and in CI.
 *
 * ---------------------------------------------------------------------------
 * Constraints this app is written under
 * ---------------------------------------------------------------------------
 *
 *  - `apps` is in `SCAN_ROOTS` (scripts/check-dependency-whitelist.ts), so the
 *    preview's imports are gated like any other source here. It imports this
 *    repository's own modules and `effect`, which is already a declared
 *    dependency. No org package, no new npm dependency.
 *  - The `Date.now()` / `new Date()` / `performance.now()` ban applies, and this
 *    app is the one that must take it most seriously, because its subject is a
 *    duration. The `mc-kernel-allow-time-source` escape hatch is NOT used.
 *  - `pnpm verify` does not run this app. `tsconfig.preview.json` typechecks it
 *    and `pnpm lint` lints it, but `pnpm preview` is not a gate.
 */
import { Effect } from 'effect'
import { makeHarness, type Harness } from './harness'
import { parseArguments, USAGE, type PreviewOptions } from './options'
import { statsReport } from './probes'
import { SCENARIO_NAMES, type ScenarioName } from './script'
import { ANSI_STYLE, dim, PLAIN_STYLE, type Style } from './style'
import {
  enterFullScreen,
  isInteractive,
  leaveFullScreen,
  onExit,
  onInputEnd,
  onKey,
  onResize,
  paintFrame,
  screenSize,
  writeLine,
} from './terminal'
import { renderFrame, scenarioCatalogue, VIEW_MODES, type ViewMode, type ViewToggles } from './views'

type State = {
  harness: Harness
  scenario: ScenarioName
  view: ViewMode
  toggles: ViewToggles
  showHelp: boolean
  busy: boolean
}

const frameWidth = (options: PreviewOptions): number =>
  Math.max(70, options.width ?? screenSize().columns)

const styleFor = (options: PreviewOptions): Style => (options.ascii ? PLAIN_STYLE : ANSI_STYLE)

const stepsForKey = (key: string): number | undefined => {
  switch (key) {
    case 'space':
    case '.':
    case 'right':
      return 1
    case '>':
      return 10
    default:
      return undefined
  }
}

const viewForKey = (key: string, current: ViewMode): ViewMode | undefined => {
  switch (key) {
    case '1':
      return 'boot'
    case '2':
      return 'ledger'
    case '3':
      return 'stages'
    case '4':
      return 'options'
    case 'v': {
      const index = VIEW_MODES.indexOf(current)
      return VIEW_MODES[(index + 1) % VIEW_MODES.length] ?? current
    }
    default:
      return undefined
  }
}

const cycleScenario = (current: ScenarioName, by: number): ScenarioName =>
  SCENARIO_NAMES[
    (SCENARIO_NAMES.indexOf(current) + by + SCENARIO_NAMES.length) % SCENARIO_NAMES.length
  ] ?? current

const drawInto = async (state: State, options: PreviewOptions): Promise<ReadonlyArray<string>> => {
  if (state.showHelp) {
    return [...USAGE, '', dim('press any key to return')]
  }
  const view = await state.harness.view()
  return renderFrame(view, state.view, state.scenario, state.toggles, styleFor(options), frameWidth(options))
}

const runInteractive = (state: State, options: PreviewOptions): void => {
  enterFullScreen()

  let restored = false
  const restore = (): void => {
    if (!restored) {
      restored = true
      leaveFullScreen()
    }
  }
  onExit(restore)

  const draw = (): void => {
    void drawInto(state, options).then((lines) => {
      paintFrame(lines)
    })
  }

  const quit = (): void => {
    restore()
    process.exit(0)
  }

  const busyThen = (work: () => Promise<unknown>): void => {
    if (state.busy) {
      return
    }
    state.busy = true
    void work().then(() => {
      state.busy = false
      draw()
    })
  }

  onResize(draw)
  onInputEnd(quit)
  onKey((key) => {
    if (state.showHelp) {
      state.showHelp = false
      draw()
      return
    }

    if (key === 'x' || key === 'escape' || key === 'ctrl-c') {
      quit()
      return
    }

    const steps = stepsForKey(key)
    if (steps !== undefined) {
      busyThen(() => state.harness.advance(steps))
      return
    }

    const nextView = viewForKey(key, state.view)
    if (nextView !== undefined) {
      state.view = nextView
      draw()
      return
    }

    if (key === '[' || key === ']' || key === 'r') {
      const scenario = key === 'r' ? state.scenario : cycleScenario(state.scenario, key === '[' ? -1 : 1)
      busyThen(() =>
        makeHarness({ scenario }).then((harness) => {
          state.harness = harness
          state.scenario = scenario
        }),
      )
      return
    }

    switch (key) {
      case 't':
        state.toggles = { ...state.toggles, timeline: !state.toggles.timeline }
        break
      case 'p':
        state.toggles = { ...state.toggles, findings: !state.toggles.findings }
        break
      case 'h':
      case '?':
        state.showHelp = true
        break
      default:
        break
    }

    draw()
  })

  draw()
}

const main = async (): Promise<number> => {
  const options = parseArguments(process.argv.slice(2))

  if (options.errors.length > 0) {
    for (const error of options.errors) {
      writeLine(`preview-harness: ${error}`)
    }
    writeLine('')
    for (const usage of USAGE) {
      writeLine(usage)
    }
    return 1
  }

  if (options.help) {
    for (const usage of USAGE) {
      writeLine(usage)
    }
    return 0
  }

  if (options.list) {
    for (const entry of scenarioCatalogue(styleFor(options), frameWidth(options))) {
      writeLine(entry)
    }
    return 0
  }

  if (options.stats) {
    for (const entry of await Effect.runPromise(statsReport)) {
      writeLine(entry)
    }
    return 0
  }

  const harness = await makeHarness({ scenario: options.scenario })
  if (options.at > 0) {
    await harness.advance(options.at)
  }

  const state: State = {
    harness,
    scenario: options.scenario,
    view: options.view,
    toggles: { timeline: true, findings: true },
    showHelp: false,
    busy: false,
  }

  if (options.once || !isInteractive()) {
    if (!options.once) {
      writeLine(
        dim('preview-harness: stdin/stdout is not a TTY, drawing a single frame (same as --once)'),
      )
    }
    for (const entry of await drawInto(state, options)) {
      writeLine(entry)
    }
    return 0
  }

  runInteractive(state, options)
  return 0
}

void main().then((exitCode) => {
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
})
