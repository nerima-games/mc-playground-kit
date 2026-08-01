/**
 * The views.
 *
 * A dev application, not shipped API.
 *
 * Every function here is a pure function of a `HarnessView` (or of the library's
 * own data) and a `Style`. That is not tidiness: the views ARE the claim this
 * preview makes, and a claim that can only be evaluated by running a terminal UI
 * is a claim nobody checks.
 *
 * The rule they are written to: **print the number the picture is claiming.**
 * "boot is fast" is unfalsifiable; a phase table against `BOOT_PHASE_BUDGET_MILLIS`
 * can be recomputed by hand and found wrong.
 */
import {
  BOOT_BUDGET_MILLIS,
  BOOT_PHASE_BUDGET_MILLIS,
  BOOT_PHASE_ORDER,
  classifyBootTimings,
  describeBootVerdict,
  DurationMillis,
  type BootPhase,
} from '../../src/domain/boot-phase'
import {
  DEFAULT_FLAT_WORLD,
  DEFAULT_SPAWN_KIT,
  normalizeLaunchOptions,
} from '../../src/domain/launch-options'
import { describeCommand, scenarioFor, scenarioLength, type ScenarioName } from './script'
import type { HarnessView } from './harness'
import {
  BAD,
  bar,
  fixed,
  GOOD,
  LABEL,
  NOTE,
  pad,
  padStart,
  VALUE,
  WARN,
  yesNo,
  type Style,
} from './style'

const LABEL_WIDTH = 16

const row = (style: Style, label: string, value: string): string =>
  `${style.paint(pad(label, LABEL_WIDTH), LABEL)}${value}`

const heading = (style: Style, text: string, width: number): string => {
  const prefix = `-- ${text} `
  return style.dim(prefix + '-'.repeat(Math.max(0, width - prefix.length)))
}

export const VIEW_MODES = ['boot', 'ledger', 'stages', 'options'] as const

export type ViewMode = (typeof VIEW_MODES)[number]

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

/**
 * The phase table.
 *
 * `BOOT_PHASE_BUDGET_MILLIS` sums to exactly `BOOT_BUDGET_MILLIS`, which is the
 * arithmetic that makes the per-phase shares mean something: a phase that
 * overruns can only be paid for by another phase underrunning, so a verdict that
 * is "within budget" overall while a phase is over is a real and reportable
 * state rather than a rounding artefact.
 */
export const bootView = (view: HarnessView, style: Style, width: number): ReadonlyArray<string> => {
  const record = view.current
  const budgetSum = BOOT_PHASE_ORDER.reduce(
    (total, phase) => total + BOOT_PHASE_BUDGET_MILLIS[phase],
    0,
  )

  const lines: Array<string> = [
    heading(style, 'boot  (plan.md §3.10: "starts in about a second, reliably")', width),
    row(
      style,
      'launches',
      `${style.paint(String(view.launches), VALUE)}   ` +
        `${view.isRunning ? style.paint('running', GOOD) : style.paint('stopped', LABEL)}   ` +
        `playground.current ${style.paint(view.currentIsSome ? 'Some' : 'None', view.currentIsSome ? GOOD : LABEL)}`,
    ),
    row(
      style,
      'clock',
      `${style.paint(`${fixed(view.clockMillis, 1)} ms`, VALUE)}   ` +
        style.dim('an injected ClockPort the fixture programs — not a wall clock'),
    ),
  ]

  if (record === undefined) {
    lines.push('')
    lines.push(row(style, '', style.dim('nothing has launched yet')))
    return lines
  }

  lines.push('')
  lines.push(heading(style, 'phases, in causal order', width))
  lines.push(
    row(style, '', style.dim(`${pad('phase', 18)}${padStart('took', 10)}${padStart('budget', 10)}  share`)),
  )

  for (const phase of BOOT_PHASE_ORDER) {
    const timing = record.timings.find((entry) => entry.phase === phase)
    const budget = BOOT_PHASE_BUDGET_MILLIS[phase]
    const took = timing?.durationMillis ?? 0
    const over = timing !== undefined && took > budget
    const missing = timing === undefined
    lines.push(
      row(
        style,
        '',
        `${style.paint(pad(phase, 18), missing ? BAD : over ? WARN : VALUE)}` +
          `${style.paint(padStart(missing ? '(missing)' : `${fixed(took, 1)} ms`, 10), missing ? BAD : over ? WARN : VALUE)}` +
          `${style.dim(padStart(`${String(budget)} ms`, 10))}  ` +
          `${style.paint(bar(took, budget, 18), over ? WARN : GOOD)}` +
          (over ? style.paint(`  +${fixed(took - budget, 1)} ms`, WARN) : ''),
      ),
    )
  }

  lines.push('')
  lines.push(
    row(
      style,
      'total',
      `${style.paint(`${fixed(record.totalMillis, 1)} ms`, record.withinBudget ? GOOD : BAD)} of ` +
        `${style.paint(`${String(BOOT_BUDGET_MILLIS)} ms`, VALUE)}   ` +
        `${style.paint(record.withinBudget ? 'WITHIN BUDGET' : 'OVER', record.withinBudget ? GOOD : BAD)}`,
    ),
  )
  lines.push(
    row(
      style,
      'per-phase sum',
      `${style.paint(`${String(budgetSum)} ms`, budgetSum === BOOT_BUDGET_MILLIS ? GOOD : BAD)}   ` +
        style.dim(
          budgetSum === BOOT_BUDGET_MILLIS
            ? 'equals the total, so an overrun must be paid for by an underrun'
            : 'does NOT equal the total',
        ),
    ),
  )
  lines.push(row(style, 'verdict', style.dim(describeBootVerdict(classifyBootTimings(record.timings)))))

  if (record.overrunPhases.length > 0) {
    lines.push('')
    for (const overrun of record.overrunPhases) {
      lines.push(
        row(
          style,
          '',
          style.paint(
            `${overrun.phase} took ${fixed(overrun.durationMillis, 1)} ms against a ${String(overrun.budgetMillis)} ms share — over by ${fixed(overrun.overByMillis, 1)} ms`,
            WARN,
          ),
        ),
      )
    }
  }

  lines.push('')
  lines.push(heading(style, 'the preview it produced', width))
  lines.push(
    row(
      style,
      'frames',
      `submitted ${style.paint(String(view.framesSubmitted), VALUE)}   ` +
        `framesRendered ${style.paint(String(view.framesRendered), VALUE)}   ` +
        style.dim('framesRendered starts at 1: launch runs one whole frame, so a handle is a LIVE preview'),
    ),
  )
  lines.push(
    row(
      style,
      'camera pose',
      view.cameraPose === undefined
        ? style.dim('(none read)')
        : `${style.paint(`${fixed(view.cameraPose.position.x, 2)}, ${fixed(view.cameraPose.position.y, 2)}, ${fixed(view.cameraPose.position.z, 2)}`, VALUE)}   ` +
          style.dim('read FROM the simulation; there is no way to write one back'),
    ),
  )

  return lines
}

// ---------------------------------------------------------------------------
// ledger
// ---------------------------------------------------------------------------

/**
 * Every call the harness made into a Port, in order.
 *
 * This is the view the `stale-stop` finding lives in. Teardown order is a
 * documented, load-bearing property — input first because a `window` listener
 * outlives whatever added it, world last because it is the only participant that
 * persists — and a ledger is the only way to see that it held.
 */
export const ledgerView = (view: HarnessView, style: Style, width: number): ReadonlyArray<string> => {
  // By `seq`, not by name. A relaunch's OWN teardown calls the same four methods
  // in the same order, and marking by name would accuse it of the finding.
  const ghost = new Set(view.ghostSeqs)

  return [
    heading(style, 'port calls, in the order they happened', width),
    row(style, '', style.dim(`${padStart('#', 4)}  ${padStart('at', 9)}  ${pad('port', 12)}${pad('method', 16)}`)),
    ...(view.calls.length === 0
      ? [row(style, '', style.dim('(nothing yet)'))]
      : view.calls.map((call) => {
          const isGhost = ghost.has(call.seq)
          const colour = call.failed ? BAD : isGhost ? BAD : VALUE
          return row(
            style,
            '',
            `${style.dim(padStart(String(call.seq), 4))}  ${style.dim(padStart(`${fixed(call.atMillis, 1)} ms`, 9))}  ` +
              `${style.paint(pad(call.port, 12), colour)}${style.paint(pad(call.method, 16), colour)}` +
              (call.failed ? style.paint('THREW (the fixture made it)', BAD) : '') +
              (isGhost ? style.paint('  <- fired by a SUPERSEDED handle, against the LIVE ports', BAD) : ''),
          )
        })),
    '',
    heading(style, 'teardown order', width),
    row(
      style,
      'documented',
      style.dim('input -> renderer -> simulation -> world; the REVERSE of boot, and never partial'),
    ),
    row(
      style,
      'input first',
      style.dim('a window listener outlives whatever added it; one still firing into a half-detached renderer is the relaunch crash'),
    ),
    row(
      style,
      'world last',
      style.dim('the only participant that persists; releasing it while the simulation ticks is how a last autosave writes a world that is gone'),
    ),
    ...(view.ghostTeardowns.length === 0
      ? []
      : [
          '',
          row(
            style,
            '',
            style.paint(
              `${String(view.ghostTeardowns.length)} teardown step(s) were run by a handle that had already been superseded.`,
              BAD,
            ),
          ),
          row(
            style,
            '',
            style.paint(
              'The four port teardowns belong INSIDE the identity guard in application/playground.ts.',
              BAD,
            ),
          ),
          row(
            style,
            '',
            style.paint(
              '`services` comes from the caller\'s Layer, so a stale handle holds the live preview\'s ports.',
              BAD,
            ),
          ),
        ]),
  ]
}

// ---------------------------------------------------------------------------
// stages
// ---------------------------------------------------------------------------

export const stagesView = (view: HarnessView, style: Style, width: number): ReadonlyArray<string> => {
  const record = view.current

  return [
    heading(style, 'stage order  (a CHECKER, never a sort)', width),
    row(
      style,
      'does',
      style.dim('answers a local question: does the order the author WROTE contradict a constraint the author DECLARED?'),
    ),
    row(
      style,
      'will not',
      style.dim('resolve a total order. mc-compose owns that; a preview that reordered stages would stop previewing the game'),
    ),
    row(
      style,
      'not violations',
      style.dim('an `after` naming an absent stage (a preview is a subset of the game), and a self-edge or duplicate id'),
    ),
    '',
    ...(record === undefined
      ? [row(style, '', style.dim('nothing has launched yet'))]
      : record.stageOrderWarnings.length === 0
        ? [row(style, 'warnings', `${style.paint('none', GOOD)}   ${style.dim('the declared order and the declared edges agree')}`)]
        : record.stageOrderWarnings.map((violation) =>
            row(
              style,
              '',
              `${style.paint(pad(String(violation.stage), 22), WARN)}` +
                style.paint(
                  `runs at index ${String(violation.declaredIndex)} but declares after ${String(violation.mustFollow)}, which is at index ${String(violation.constraintIndex)}`,
                  WARN,
                ),
            ),
          )),
    '',
    heading(style, 'module registration', width),
    row(
      style,
      'evaluations',
      `${style.paint(String(view.frameStagesEvaluations), view.frameStagesEvaluations > view.launches ? BAD : VALUE)} ` +
        `for ${style.paint(String(view.launches), VALUE)} launch(es)   ` +
        (view.frameStagesEvaluations > view.launches
          ? style.paint(
              `each module's frameStages Effect ran ${String(Math.round(view.frameStagesEvaluations / Math.max(1, view.launches)))}x per launch`,
              BAD,
            )
          : style.dim('once per launch')),
    ),
    ...(view.frameStagesEvaluations > view.launches
      ? [
          row(
            style,
            '',
            style.paint(
              'The boot path must flatten ONCE, inside phase("modules"), and derive the warnings from',
              BAD,
            ),
          ),
          row(
            style,
            '',
            style.paint(
              'that array via flattenedStageOrderViolations — not by re-running the modules.',
              BAD,
            ),
          ),
        ]
      : []),
  ]
}

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

export const optionsView = (style: Style, width: number): ReadonlyArray<string> => {
  const empty = normalizeLaunchOptions()
  const partial = normalizeLaunchOptions({ world: { seed: 42 }, spawnKit: { yawRadians: 1.5 } })
  const explicitUndefined = normalizeLaunchOptions({ world: { seed: undefined } })

  return [
    heading(style, 'normalizeLaunchOptions  (every field optional, every default named)', width),
    row(style, '', style.dim(`${pad('call', 44)}${pad('seed', 8)}${pad('surfaceY', 10)}${pad('yaw', 8)}hotbar`)),
    row(
      style,
      '',
      `${style.paint(pad('normalizeLaunchOptions()', 44), VALUE)}` +
        `${style.dim(pad(String(empty.world.seed), 8))}${style.dim(pad(String(empty.world.surfaceY), 10))}` +
        `${style.dim(pad(fixed(empty.spawnKit.yawRadians, 2), 8))}${style.dim(String(empty.spawnKit.hotbar.length))}`,
    ),
    row(
      style,
      '',
      `${style.paint(pad('{ world: { seed: 42 }, spawnKit: { yaw: 1.5 } }', 44), VALUE)}` +
        `${style.dim(pad(String(partial.world.seed), 8))}${style.dim(pad(String(partial.world.surfaceY), 10))}` +
        `${style.dim(pad(fixed(partial.spawnKit.yawRadians, 2), 8))}${style.dim(String(partial.spawnKit.hotbar.length))}`,
    ),
    row(
      style,
      '',
      `${style.paint(pad('{ world: { seed: undefined } }', 44), VALUE)}` +
        `${style.dim(pad(String(explicitUndefined.world.seed), 8))}${style.dim(pad(String(explicitUndefined.world.surfaceY), 10))}` +
        `${style.dim(pad(fixed(explicitUndefined.spawnKit.yawRadians, 2), 8))}${style.dim(String(explicitUndefined.spawnKit.hotbar.length))}`,
    ),
    '',
    row(
      style,
      'Supplied<T>',
      style.dim('an explicitly-undefined field falls back to the default, exactly as an absent one does'),
    ),
    '',
    heading(style, 'the defaults, and why they are these numbers', width),
    row(
      style,
      'flat world',
      `${style.paint(`seed ${String(DEFAULT_FLAT_WORLD.seed)}, surfaceY ${String(DEFAULT_FLAT_WORLD.surfaceY)}, radius ${String(DEFAULT_FLAT_WORLD.radiusChunks)} chunk(s)`, VALUE)}`,
    ),
    row(
      style,
      'spawn feet',
      `${style.paint(`${String(DEFAULT_SPAWN_KIT.feetPosition.x)}, ${String(DEFAULT_SPAWN_KIT.feetPosition.y)}, ${String(DEFAULT_SPAWN_KIT.feetPosition.z)}`, VALUE)}   ` +
        style.dim(
          DEFAULT_SPAWN_KIT.feetPosition.y === DEFAULT_FLAT_WORLD.surfaceY + 1
            ? 'surfaceY + 1 — the player stands ON the ground, and the two constants agree'
            : 'NOT surfaceY + 1 — the player spawns inside or above the ground',
        ),
    ),
    row(
      style,
      'hotbar',
      style.paint(
        DEFAULT_SPAWN_KIT.hotbar.map((slot) => `${slot.item} x${String(slot.count)}`).join(', '),
        VALUE,
      ),
    ),
    '',
    heading(style, 'the budget table', width),
    row(style, '', style.dim(`${pad('phase', 18)}${padStart('budget', 10)}  share of ${String(BOOT_BUDGET_MILLIS)} ms`)),
    ...BOOT_PHASE_ORDER.map((phase: BootPhase) =>
      row(
        style,
        '',
        `${style.paint(pad(phase, 18), VALUE)}${style.dim(padStart(`${String(BOOT_PHASE_BUDGET_MILLIS[phase])} ms`, 10))}  ` +
          style.dim(bar(BOOT_PHASE_BUDGET_MILLIS[phase], BOOT_BUDGET_MILLIS, 30)),
      ),
    ),
    '',
    row(
      style,
      'classifier',
      style.dim(
        describeBootVerdict(
          classifyBootTimings(
            BOOT_PHASE_ORDER.map((phase) => ({
              phase,
              durationMillis: DurationMillis(BOOT_PHASE_BUDGET_MILLIS[phase]),
            })),
          ),
        ),
      ),
    ),
  ]
}

// ---------------------------------------------------------------------------
// timeline / findings / log
// ---------------------------------------------------------------------------

export const timelineView = (
  scenarioName: ScenarioName,
  step: number,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const scenario = scenarioFor(scenarioName)
  const upcoming = scenario.steps.filter((scripted) => scripted.step >= step).slice(0, 4)

  return [
    heading(style, `timeline · ${scenario.name}  (${String(step)}/${String(scenarioLength(scenario))})`, width),
    ...(upcoming.length === 0
      ? [row(style, '', style.dim('script exhausted — the harness keeps its state'))]
      : upcoming.map((scripted) =>
          row(
            style,
            '',
            `${style.paint(padStart(`s${String(scripted.step)}`, 5), scripted.step === step ? WARN : LABEL)} ` +
              `${style.paint(pad(describeCommand(scripted.command), 34), scripted.step === step ? VALUE : LABEL)}` +
              style.dim(scripted.why),
          ),
        )),
  ]
}

export const findingsView = (view: HarnessView, style: Style, width: number): ReadonlyArray<string> => {
  const findings: ReadonlyArray<{ readonly id: string; readonly hit: boolean; readonly text: string }> = [
    {
      id: 'ports',
      hit: view.ghostTeardowns.length > 0,
      text:
        view.ghostTeardowns.length > 0
          ? `a superseded handle's stop() ran ${view.ghostTeardowns.join(', ')} against the LIVE preview's ports, while isRunning still says ${yesNo(view.isRunning)} and current is ${view.currentIsSome ? 'Some' : 'None'}`
          : 'a superseded handle\'s stop() touches no live port: the four teardowns are inside the same identity guard as the two Ref slots',
    },
    {
      id: 'stages',
      hit: view.frameStagesEvaluations > view.launches,
      text:
        view.frameStagesEvaluations > view.launches
          ? `each module's frameStages Effect ran more than once per launch (${String(view.frameStagesEvaluations)} for ${String(view.launches)} launch(es)); the extra run is outside phase("modules") and is what stageOrderWarnings would describe`
          : `one frameStages evaluation per launch (${String(view.frameStagesEvaluations)} for ${String(view.launches)} launch(es)), inside phase("modules"); the warnings come from that same array`,
    },
    {
      id: 'budget',
      hit: view.current !== undefined && !view.current.withinBudget,
      text: 'the boot budget was exceeded; the verdict names the phase rather than reporting one number',
    },
  ]

  return [
    heading(style, 'invariants (live predicates, not assertions)', width),
    ...findings.map((finding) =>
      row(
        style,
        '',
        `${style.paint(pad(finding.id, 7), finding.hit ? BAD : LABEL)}` +
          `${style.paint(pad(finding.hit ? 'BROKEN' : 'ok', 8), finding.hit ? BAD : LABEL)}` +
          (finding.hit ? style.paint(finding.text, BAD) : style.dim(finding.text)),
      ),
    ),
  ]
}

export const logView = (view: HarnessView, style: Style, width: number): ReadonlyArray<string> => [
  heading(style, 'log', width),
  ...(view.log.length === 0
    ? [row(style, '', style.dim('(nothing yet)'))]
    : view.log.slice(-6).map((entry) => row(style, '', style.paint(entry, NOTE)))),
]

export type ViewToggles = {
  readonly timeline: boolean
  readonly findings: boolean
}

export const renderFrame = (
  view: HarnessView,
  mode: ViewMode,
  scenarioName: ScenarioName,
  toggles: ViewToggles,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const body =
    mode === 'boot'
      ? bootView(view, style, width)
      : mode === 'ledger'
        ? ledgerView(view, style, width)
        : mode === 'stages'
          ? stagesView(view, style, width)
          : optionsView(style, width)

  const tabs = VIEW_MODES.map((candidate) =>
    style.paint(candidate === mode ? `[${candidate}]` : ` ${candidate} `, candidate === mode ? VALUE : LABEL),
  ).join('')

  return [
    style.bold('mc-playground-kit · the harness, previewing itself'),
    tabs,
    row(
      style,
      'step',
      `${style.paint(padStart(String(view.step), 5), VALUE)}   ${style.dim(view.lastCommand)}`,
    ),
    '',
    ...body,
    ...(toggles.timeline ? ['', ...timelineView(scenarioName, view.step, style, width)] : []),
    ...(toggles.findings ? ['', ...findingsView(view, style, width)] : []),
    '',
    ...logView(view, style, width),
  ]
}

export const scenarioCatalogue = (style: Style, width: number): ReadonlyArray<string> => {
  const lines: Array<string> = [heading(style, 'scenarios', width)]
  for (const name of [
    'cold-boot',
    'slow-world',
    'stage-contradiction',
    'relaunch',
    'stale-stop',
    'failing-teardown',
  ] as const) {
    const scenario = scenarioFor(name)
    lines.push('')
    lines.push(`${style.bold(scenario.name)}  ${style.dim(scenario.headline)}`)
    for (const detail of scenario.detail) {
      lines.push(`  ${style.dim(detail)}`)
    }
    lines.push(`  ${style.dim(`${String(scenarioLength(scenario))} steps`)}`)
  }
  return lines
}
