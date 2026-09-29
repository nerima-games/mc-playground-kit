/* oxlint-disable curly, func-names, max-statements, no-magic-numbers, no-undefined, no-use-before-define, sort-imports, sort-keys -- Test fixtures favor direct state assertions over production-style decomposition. */
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Either, Option } from 'effect'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  makeBrowserPreview,
  type BrowserFrameScheduler,
  type BrowserPreviewRuntime,
} from '../src/index'

const fakeDom = () => {
  const children: Array<unknown> = []
  const isRecord = (value: unknown): value is Record<PropertyKey, unknown> => (
    typeof value === 'object' && value !== null
  )
  const isCanvas = (value: unknown): value is HTMLCanvasElement => (
    isRecord(value) && 'parentNode' in value && typeof value['remove'] === 'function'
  )
  const isContainer = (value: unknown): value is HTMLElement => (
    isRecord(value) && typeof value['appendChild'] === 'function'
  )
  const rawCanvas: { parentNode: HTMLElement | null; remove: () => void } = {
    parentNode: null,
    remove() {
      const index = children.indexOf(canvas)
      if (index >= 0) children.splice(index, 1)
      rawCanvas.parentNode = null
    },
  }
  if (!isCanvas(rawCanvas)) throw new Error('fake canvas shape is invalid')
  const canvas = rawCanvas
  const container = {
    appendChild(child: HTMLCanvasElement) {
      children.push(child)
      if (!Reflect.set(child, 'parentNode', container)) throw new Error('fake canvas parent assignment failed')
      return child
    },
  }
  if (!isContainer(container)) throw new Error('fake container shape is invalid')
  return { canvas, container, children }
}

const fakeScheduler = () => {
  let nextId = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  const cancelled: Array<number> = []
  const scheduler: BrowserFrameScheduler = {
    request(callback) {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    },
    cancel(id) {
      cancelled.push(id)
      callbacks.delete(id)
    },
  }
  const runNext = (timestamp: number) => {
    const next = callbacks.entries().next().value
    if (next === undefined) return
    callbacks.delete(next[0])
    next[1](timestamp)
  }
  return { scheduler, callbacks, cancelled, runNext }
}

describe('browser preview', () => {
  it.effect('owns one canvas/runtime and restarts as a fresh generation', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const frames: Array<number> = []
      let starts = 0
      let stops = 0
      let listenerCleanup = 0
      const animation = fakeScheduler()
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler: animation.scheduler,
        startRuntime: (surface) => Effect.sync(() => {
          starts += 1
          surface.onCleanup(() => { listenerCleanup += 1 })
          return {
            frame: (deltaSeconds) => Effect.sync(() => { frames.push(deltaSeconds) }),
            stop: Effect.sync(() => { stops += 1 }),
          } satisfies BrowserPreviewRuntime
        }),
      })

      const first = yield* preview.start
      const current = yield* preview.current
      expect(Option.isSome(current) && current.value === first).toBe(true)
      const duplicate = yield* preview.start
      expect(duplicate).toBe(first)
      expect(starts).toBe(1)
      expect(dom.children).toHaveLength(1)

      animation.runNext(100)
      yield* Effect.yieldNow()
      animation.runNext(116)
      yield* Effect.yieldNow()
      animation.runNext(1_000)
      yield* Effect.yieldNow()
      expect(frames).toStrictEqual([0.016, 0.016, 0.05])

      const second = yield* preview.restart
      expect(second).not.toBe(first)
      expect(starts).toBe(2)
      expect(stops).toBe(1)
      expect(listenerCleanup).toBe(1)
      expect(dom.children).toHaveLength(1)

      yield* preview.stop
      yield* preview.stop
      expect(stops).toBe(2)
      expect(listenerCleanup).toBe(2)
      expect(dom.children).toHaveLength(0)
      expect(animation.callbacks.size).toBe(0)
      expect(animation.cancelled.length).toBeGreaterThanOrEqual(2)
    }),
  )

  it.effect('serializes asynchronous frames instead of overlapping RAF work', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const animation = fakeScheduler()
      const firstFrame = yield* Deferred.make<void>()
      const frames: Array<DeltaTimeSecs> = []
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler: animation.scheduler,
        startRuntime: () => Effect.succeed({
          frame: (deltaSeconds) => Effect.gen(function* () {
            frames.push(deltaSeconds)
            if (frames.length === 1) yield* Deferred.await(firstFrame)
          }),
          stop: Effect.void,
        }),
      })

      yield* preview.start
      animation.runNext(100)
      yield* Effect.yieldNow()
      expect(frames).toStrictEqual([0.016])
      expect(animation.callbacks.size).toBe(1)

      animation.runNext(116)
      yield* Effect.yieldNow()
      expect(frames).toStrictEqual([0.016])
      yield* Deferred.succeed(firstFrame, undefined)
      yield* Effect.yieldNow()
      expect(animation.callbacks.size).toBe(1)
      animation.runNext(132)
      yield* Effect.yieldNow()
      expect(frames).toStrictEqual([0.016, 0.016])
      yield* preview.stop
    }),
  )

  it.effect('captures the frame handler once for the RAF loop', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const animation = fakeScheduler()
      const frames: Array<DeltaTimeSecs> = []
      let frameReads = 0
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler: animation.scheduler,
        startRuntime: () => Effect.succeed({
          get frame() {
            frameReads += 1
            return (deltaSeconds: DeltaTimeSecs) => Effect.sync(() => { frames.push(deltaSeconds) })
          },
          stop: Effect.void,
        } satisfies BrowserPreviewRuntime),
      })

      yield* preview.start
      animation.runNext(100)
      yield* Effect.yieldNow()
      animation.runNext(116)
      yield* Effect.yieldNow()

      expect(frames).toStrictEqual([0.016, 0.016])
      expect(frameReads).toBe(1)
      yield* preview.stop
    }),
  )

  it.effect('interrupts an active frame before releasing runtime resources', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const animation = fakeScheduler()
      const neverFinish = yield* Deferred.make<void>()
      const events: Array<string> = []
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler: animation.scheduler,
        startRuntime: () => Effect.succeed({
          frame: () => Effect.acquireUseRelease(
            Effect.sync(() => { events.push('frame:start') }),
            () => Deferred.await(neverFinish),
            () => Effect.sync(() => { events.push('frame:release') }),
          ),
          stop: Effect.sync(() => { events.push('runtime:stop') }),
        }),
      })

      const handle = yield* preview.start
      animation.runNext(100)
      yield* Effect.yieldNow()
      yield* handle.stop
      expect(events).toStrictEqual(['frame:start', 'frame:release', 'runtime:stop'])
      expect(animation.callbacks.size).toBe(0)
    }),
  )

  it.effect('rolls back owned resources when startup fails', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      let cleaned = 0
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler: fakeScheduler().scheduler,
        startRuntime: (surface) => Effect.gen(function* () {
          surface.onCleanup(() => { cleaned += 1 })
          return yield* Effect.fail('webgl-unavailable')
        }),
      })

      const result = yield* Effect.either(preview.start)
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isRight(result)) return
      expect(result.left).toMatchObject({ cause: 'webgl-unavailable', rollbackFailures: [] })
      expect(cleaned).toBe(1)
      expect(dom.children).toHaveLength(0)
      expect(Option.isNone(yield* preview.current)).toBe(true)
    }),
  )

  it.effect('stops on an external abort and preserves a caller-owned canvas', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      dom.container.appendChild(dom.canvas)
      const external = new AbortController()
      let stops = 0
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        canvas: dom.canvas,
        signal: external.signal,
        scheduler: fakeScheduler().scheduler,
        startRuntime: () => Effect.succeed({
          stop: Effect.sync(() => { stops += 1 }),
        }),
      })

      const handle = yield* preview.start
      external.abort()
      yield* Effect.yieldNow()
      yield* Effect.yieldNow()
      expect(stops).toBe(1)
      expect(yield* handle.isRunning).toBe(false)
      expect(dom.children).toStrictEqual([dom.canvas])
      expect(Option.isNone(yield* preview.current)).toBe(true)
    }),
  )

  it.effect('uses the real browser scheduler when none is injected', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const requested: Array<number> = []
      const cancelled: Array<number> = []
      let nextId = 0
      const fakeWindow = {
        requestAnimationFrame: () => {
          nextId += 1
          requested.push(nextId)
          return nextId
        },
        cancelAnimationFrame: (id: number) => { cancelled.push(id) },
      }
      const originalWindow = Reflect.get(globalThis, 'window')
      Reflect.set(globalThis, 'window', fakeWindow)
      try {
        const preview = yield* makeBrowserPreview({
          container: dom.container,
          createCanvas: () => dom.canvas,
          startRuntime: () => Effect.succeed({
            frame: () => Effect.void,
            stop: Effect.void,
          }),
        })
        yield* preview.start
        expect(requested).toStrictEqual([1])
        yield* preview.stop
        expect(cancelled).toStrictEqual([1])
      } finally {
        if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
        else Reflect.set(globalThis, 'window', originalWindow)
      }
    }),
  )

  it.effect('fails fast when the signal is already aborted before start', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const controller = new AbortController()
      controller.abort('reason-x')
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        signal: controller.signal,
        scheduler: fakeScheduler().scheduler,
        startRuntime: () => Effect.succeed({ stop: Effect.void }),
      })

      const result = yield* Effect.either(preview.start)
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isRight(result)) return
      expect(result.left).toMatchObject({ cause: 'reason-x', rollbackFailures: [] })
      expect(dom.children).toHaveLength(0)
    }),
  )

  it.effect('reports accumulated rollback failures when the runtime fails to stop', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler: fakeScheduler().scheduler,
        startRuntime: () => Effect.succeed({
          stop: Effect.fail('runtime-stop-boom'),
        }),
      })

      yield* preview.start
      const result = yield* Effect.either(preview.stop)
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isRight(result)) return
      expect(result.left).toMatchObject({
        _tag: 'BrowserPreviewStopError',
        failures: ['runtime-stop-boom'],
      })
    }),
  )

  it.effect('stops the generation when a frame effect fails', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const animation = fakeScheduler()
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler: animation.scheduler,
        startRuntime: () => Effect.succeed({
          frame: () => Effect.fail('frame-boom'),
          stop: Effect.void,
        }),
      })

      const handle = yield* preview.start
      animation.runNext(100)
      yield* Effect.yieldNow()
      yield* Effect.yieldNow()
      expect(yield* handle.isRunning).toBe(false)
      expect(Option.isNone(yield* preview.current)).toBe(true)
    }),
  )

  it.effect('creates its own canvas via document.createElement when no factory is given', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const created: Array<string> = []
      const fakeDocument = {
        createElement: (tag: string) => {
          created.push(tag)
          return dom.canvas
        },
      }
      const originalDocument = Reflect.get(globalThis, 'document')
      Reflect.set(globalThis, 'document', fakeDocument)
      try {
        const preview = yield* makeBrowserPreview({
          container: dom.container,
          scheduler: fakeScheduler().scheduler,
          startRuntime: () => Effect.succeed({ stop: Effect.void }),
        })
        const handle = yield* preview.start
        expect(created).toStrictEqual(['canvas'])
        expect(handle.canvas).toBe(dom.canvas)
      } finally {
        if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
        else Reflect.set(globalThis, 'document', originalDocument)
      }
    }),
  )

  it.effect('captures a cleanup that throws into rollback failures', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const boom = new Error('cleanup-boom')
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler: fakeScheduler().scheduler,
        startRuntime: (surface) => Effect.sync(() => {
          surface.onCleanup(() => { throw boom })
          return { stop: Effect.void }
        }),
      })

      yield* preview.start
      const result = yield* Effect.either(preview.stop)
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isRight(result)) return
      expect(result.left).toMatchObject({ _tag: 'BrowserPreviewStopError', failures: [boom] })
    }),
  )

  it.effect('is idempotent when the same handle.stop is awaited twice directly', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      let stops = 0
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler: fakeScheduler().scheduler,
        startRuntime: () => Effect.succeed({
          stop: Effect.sync(() => { stops += 1 }),
        }),
      })

      const handle = yield* preview.start
      yield* handle.stop
      yield* handle.stop
      expect(stops).toBe(1)
    }),
  )

  it.effect('ignores a frame callback that fires after stop (RAF/cancel race)', () =>
    Effect.gen(function* () {
      const dom = fakeDom()
      const captured: { callback: FrameRequestCallback | undefined } = { callback: undefined }
      const cancelled: Array<number> = []
      const scheduler: BrowserFrameScheduler = {
        request: (callback) => {
          captured.callback = callback
          return 1
        },
        cancel: (id) => { cancelled.push(id) },
      }
      const frames: Array<DeltaTimeSecs> = []
      const preview = yield* makeBrowserPreview({
        container: dom.container,
        createCanvas: () => dom.canvas,
        scheduler,
        startRuntime: () => Effect.succeed({
          frame: (deltaSeconds) => Effect.sync(() => { frames.push(deltaSeconds) }),
          stop: Effect.void,
        }),
      })

      yield* preview.start
      yield* preview.stop
      expect(cancelled).toStrictEqual([1])
      const stale = captured.callback
      if (stale === undefined) throw new Error('scheduler never requested a frame')
      stale(999)
      expect(frames).toStrictEqual([])
    }),
  )
})
