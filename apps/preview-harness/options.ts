/**
 * Command-line options for the preview.
 *
 * A dev application, not shipped API.
 *
 * Pure: `parseArguments` reads an array and returns a value. It never touches
 * `process`, so the whole option surface is exercisable without running the app
 * — which matters because `--scenario X --at N` is the entire reproduction
 * recipe for everything this app finds.
 */
import { SCENARIO_NAMES, type ScenarioName } from './script'
import { VIEW_MODES, type ViewMode } from './views'

export type PreviewOptions = {
  readonly scenario: ScenarioName
  readonly view: ViewMode
  /** Steps to run before drawing anything. The reproduction handle. */
  readonly at: number
  readonly once: boolean
  readonly ascii: boolean
  readonly stats: boolean
  readonly list: boolean
  readonly help: boolean
  readonly width: number | undefined
  readonly errors: ReadonlyArray<string>
}

const DEFAULTS = {
  scenario: 'cold-boot',
  view: 'boot',
  at: 0,
  once: false,
  ascii: false,
  stats: false,
  list: false,
  help: false,
  width: undefined,
  errors: [],
} satisfies PreviewOptions

const isScenario = (value: string): value is ScenarioName =>
  (SCENARIO_NAMES as ReadonlyArray<string>).includes(value)

const isViewMode = (value: string): value is ViewMode =>
  (VIEW_MODES as ReadonlyArray<string>).includes(value)

type Accumulator = {
  -readonly [Key in keyof PreviewOptions]: PreviewOptions[Key]
}

const readNumber = (
  accumulator: Accumulator,
  flag: string,
  raw: string | undefined,
): number | undefined => {
  if (raw === undefined) {
    accumulator.errors = [...accumulator.errors, `${flag} needs a value`]
    return undefined
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    accumulator.errors = [...accumulator.errors, `${flag}: "${raw}" is not a number`]
    return undefined
  }
  return value
}

/**
 * Accepts `--flag value` and `--flag=value`.
 *
 * Unknown flags are collected as errors rather than ignored. A silently dropped
 * `--scenario` is a preview confidently showing the wrong run.
 */
export const parseArguments = (argv: ReadonlyArray<string>): PreviewOptions => {
  const accumulator: Accumulator = { ...DEFAULTS }
  const queue = [...argv]

  while (queue.length > 0) {
    const token = queue.shift()
    if (token === undefined) {
      break
    }

    const equalsAt = token.indexOf('=')
    const flag = equalsAt === -1 ? token : token.slice(0, equalsAt)
    const inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1)
    const takeValue = (): string | undefined => inlineValue ?? queue.shift()

    switch (flag) {
      // pnpm 9 forwards a literal `--` into argv when someone writes
      // `pnpm preview -- --stats` out of npm habit.
      case '--':
        break
      case '--help':
      case '-h':
        accumulator.help = true
        break
      case '--list':
        accumulator.list = true
        break
      case '--stats':
        accumulator.stats = true
        break
      case '--once':
        accumulator.once = true
        break
      case '--ascii':
        accumulator.ascii = true
        break
      case '--scenario': {
        const value = takeValue()
        if (value !== undefined && isScenario(value)) {
          accumulator.scenario = value
        } else {
          accumulator.errors = [
            ...accumulator.errors,
            `--scenario: "${String(value)}" is not one of ${SCENARIO_NAMES.join(', ')}`,
          ]
        }
        break
      }
      case '--view': {
        const value = takeValue()
        if (value !== undefined && isViewMode(value)) {
          accumulator.view = value
        } else {
          accumulator.errors = [
            ...accumulator.errors,
            `--view: "${String(value)}" is not one of ${VIEW_MODES.join(', ')}`,
          ]
        }
        break
      }
      case '--at':
        accumulator.at = Math.max(
          0,
          Math.trunc(readNumber(accumulator, flag, takeValue()) ?? accumulator.at),
        )
        break
      case '--width':
        accumulator.width = readNumber(accumulator, flag, takeValue()) ?? accumulator.width
        break
      default:
        accumulator.errors = [...accumulator.errors, `unknown option: ${flag}`]
        break
    }
  }

  return { ...accumulator }
}

export const USAGE: ReadonlyArray<string> = [
  'pnpm preview [options]        the harness previewing itself, for @nerima-games/mc-playground-kit',
  '',
  'options',
  `  --scenario <name>   ${SCENARIO_NAMES.join(' | ')}`,
  '                      (default cold-boot; --list describes them)',
  `  --view <mode>       ${VIEW_MODES.join(' | ')}   (default boot)`,
  '  --at <n>            run n script steps before drawing — the reproduction handle',
  '  --once              render one frame to stdout and exit (no raw mode, pipe-safe)',
  '  --ascii             glyphs instead of colour — pasteable into an issue or a diff',
  '  --stats             print the numeric probe report instead of a picture',
  '  --list              describe the scenarios and exit',
  '  --width <n>         force the panel width in terminal cells',
  '  --help              this text',
  '',
  'keys (interactive)',
  '  space  .      run the next scripted step        |   >   run 10',
  '  1..4          boot | ledger | stages | options',
  '  v             cycle the view                    |   [ ]  previous / next scenario',
  '  r             restart the scenario from step 0',
  '  t             toggle the timeline               |   p  toggle the findings',
  '  ? h           this help                         |   x  Esc  Ctrl-C   quit',
]
