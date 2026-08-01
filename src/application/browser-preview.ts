/* oxlint-disable curly, func-names, init-declarations, max-statements, no-magic-numbers, no-ternary, no-undefined, prefer-const, sort-keys -- Lifecycle orchestration is intentionally kept linear; splitting it obscures rollback order. */
import { Effect, Either, Option, Ref } from 'effect'

export type BrowserPreviewSurface = {
  readonly container: HTMLElement
  readonly canvas: HTMLCanvasElement
  readonly signal: AbortSignal
  /** Register listener/resource cleanup owned by this preview generation. */
  readonly onCleanup: (cleanup: () => void) => void
}

/**
 * Structural boundary for adapters around mc-compose's BrowserSession and a
 * renderer/input mount. Keeping it structural avoids making this dev harness a
 * second composition root.
 */
export type BrowserPreviewRuntime = {
  readonly stop: Effect.Effect<void, unknown>
  readonly frame?: (
    timestampMillis: number,
    deltaSeconds: number,
  ) => Effect.Effect<void, unknown>
}

export type BrowserPreviewStartError = {
  readonly _tag: 'BrowserPreviewStartError'
  readonly cause: unknown
  readonly rollbackFailures: ReadonlyArray<unknown>
}

export type BrowserPreviewStopError = {
  readonly _tag: 'BrowserPreviewStopError'
  readonly failures: ReadonlyArray<unknown>
}

export type BrowserFrameScheduler = {
  readonly request: (callback: FrameRequestCallback) => number
  readonly cancel: (requestId: number) => void
}

export type BrowserPreviewOptions = {
  readonly container: HTMLElement
  readonly canvas?: HTMLCanvasElement
  readonly signal?: AbortSignal
  readonly scheduler?: BrowserFrameScheduler
  readonly createCanvas?: () => HTMLCanvasElement
  readonly startRuntime: (
    surface: BrowserPreviewSurface,
  ) => Effect.Effect<BrowserPreviewRuntime, unknown>
}

export type BrowserPreviewHandle = {
  readonly container: HTMLElement
  readonly canvas: HTMLCanvasElement
  readonly signal: AbortSignal
  readonly isRunning: Effect.Effect<boolean>
  readonly stop: Effect.Effect<void, BrowserPreviewStopError>
}

export type BrowserPreviewApi = {
  /** Idempotent while running: concurrent/double starts return one generation. */
  readonly start: Effect.Effect<BrowserPreviewHandle, BrowserPreviewStartError>
  /** Hot-reload/remount entry point: stop the old generation, then start fresh. */
  readonly restart: Effect.Effect<BrowserPreviewHandle, BrowserPreviewStartError | BrowserPreviewStopError>
  readonly current: Effect.Effect<Option.Option<BrowserPreviewHandle>>
  readonly stop: Effect.Effect<void, BrowserPreviewStopError>
}

type Generation = {
  readonly handle: BrowserPreviewHandle
  readonly stop: Effect.Effect<void, BrowserPreviewStopError>
}

const browserScheduler = (): BrowserFrameScheduler => ({
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (requestId) => window.cancelAnimationFrame(requestId),
})

export const makeBrowserPreview = (
  options: BrowserPreviewOptions,
): Effect.Effect<BrowserPreviewApi> => Effect.gen(function* () {
  const current = yield* Ref.make(Option.none<Generation>())
  const mutex = yield* Effect.makeSemaphore(1)

  const stopGeneration = (generation: Generation) => generation.stop

  const stopUnlocked = Effect.gen(function* () {
    const previous = yield* Ref.getAndSet(current, Option.none())
    if (Option.isSome(previous)) yield* stopGeneration(previous.value)
  })

  const startUnlocked: Effect.Effect<BrowserPreviewHandle, BrowserPreviewStartError> =
    Effect.gen(function* () {
      const existing = yield* Ref.get(current)
      if (Option.isSome(existing)) return existing.value.handle

      if (options.signal?.aborted === true) {
        return yield* Effect.fail({
          _tag: 'BrowserPreviewStartError' as const,
          cause: options.signal.reason,
          rollbackFailures: [],
        })
      }

      const ownedCanvas = options.canvas === undefined
      const canvas = options.canvas ?? options.createCanvas?.() ?? document.createElement('canvas')
      if (ownedCanvas) options.container.appendChild(canvas)

      const controller = new AbortController()
      const cleanups: Array<() => void> = []
      const rollbackFailures: Array<unknown> = []
      let runtime: BrowserPreviewRuntime | undefined
      let requestId: number | undefined
      let previousTimestamp: number | undefined
      let stopped = false

      const registerCleanup = (cleanup: () => void) => cleanups.push(cleanup)
      const runCleanup = (cleanup: () => void) => {
        try { cleanup() } catch (cause) { rollbackFailures.push(cause) }
      }
      const scheduler = options.scheduler ?? browserScheduler()

      const stop = Effect.gen(function* () {
        if (stopped) return
        stopped = true
        controller.abort()
        if (requestId !== undefined) scheduler.cancel(requestId)
        if (runtime !== undefined) {
          yield* Effect.match(runtime.stop, {
            onFailure: (cause) => { rollbackFailures.push(cause) },
            onSuccess: () => undefined,
          })
        }
        for (const cleanup of [...cleanups].reverse()) runCleanup(cleanup)
        if (ownedCanvas && canvas.parentNode === options.container) canvas.remove()
        if (rollbackFailures.length > 0) {
          return yield* Effect.fail({
            _tag: 'BrowserPreviewStopError' as const,
            failures: [...rollbackFailures],
          })
        }
      })

      if (options.signal !== undefined) {
        const onAbort = () => { Effect.runFork(mutex.withPermits(1)(stopUnlocked)) }
        options.signal.addEventListener('abort', onAbort, { once: true })
        registerCleanup(() => options.signal?.removeEventListener('abort', onAbort))
      }

      const started = yield* Effect.either(options.startRuntime({
        container: options.container,
        canvas,
        signal: controller.signal,
        onCleanup: registerCleanup,
      }))
      if (Either.isLeft(started)) {
        yield* Effect.ignore(stop)
        return yield* Effect.fail({
          _tag: 'BrowserPreviewStartError' as const,
          cause: started.left,
          rollbackFailures: [...rollbackFailures],
        })
      }
      runtime = started.right

      if (runtime.frame !== undefined) {
        const tick: FrameRequestCallback = (timestamp) => {
          if (stopped || runtime?.frame === undefined) return
          const deltaSeconds = previousTimestamp === undefined
            ? 0
            : Math.max(0, (timestamp - previousTimestamp) / 1_000)
          previousTimestamp = timestamp
          Effect.runFork(Effect.match(runtime.frame(timestamp, deltaSeconds), {
            onFailure: () => Effect.runFork(mutex.withPermits(1)(stopUnlocked)),
            onSuccess: () => undefined,
          }))
          requestId = scheduler.request(tick)
        }
        requestId = scheduler.request(tick)
      }

      const handle: BrowserPreviewHandle = {
        container: options.container,
        canvas,
        signal: controller.signal,
        isRunning: Effect.sync(() => !stopped),
        stop: mutex.withPermits(1)(Effect.gen(function* () {
          const active = yield* Ref.get(current)
          if (Option.isSome(active) && active.value.handle === handle) {
            yield* Ref.set(current, Option.none())
          }
          yield* stop
        })),
      }
      yield* Ref.set(current, Option.some({ handle, stop }))
      return handle
    })

  const start = mutex.withPermits(1)(startUnlocked)
  const stop = mutex.withPermits(1)(stopUnlocked)
  const restart = mutex.withPermits(1)(Effect.zipRight(stopUnlocked, startUnlocked))

  return {
    start,
    restart,
    current: Ref.get(current).pipe(Effect.map(Option.map((generation) => generation.handle))),
    stop,
  }
})
