/* oxlint-disable curly, func-names, max-statements, no-magic-numbers, no-undefined, no-use-before-define, sort-imports, sort-keys -- Test fixtures favor direct state assertions over production-style decomposition. */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Either, Option } from 'effect'
import {
  makeBrowserPreview,
  type BrowserFrameScheduler,
  type BrowserPreviewRuntime,
} from '../src/index'

const fakeDom = () => {
  const children: Array<unknown> = []
  const rawCanvas = {
    parentNode: undefined as unknown,
    remove() {
      const index = children.indexOf(canvas)
      if (index >= 0) children.splice(index, 1)
      rawCanvas.parentNode = undefined
    },
  }
  const canvas = rawCanvas as unknown as HTMLCanvasElement
  const container = {
    appendChild(child: HTMLCanvasElement) {
      children.push(child)
      ;(child as unknown as { parentNode: unknown }).parentNode = container
      return child
    },
  } as unknown as HTMLElement
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
    const next = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined
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
      const frames: Array<[number, number]> = []
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
            frame: (timestamp, delta) => Effect.sync(() => { frames.push([timestamp, delta]) }),
            stop: Effect.sync(() => { stops += 1 }),
          } satisfies BrowserPreviewRuntime
        }),
      })

      const first = yield* preview.start
      const duplicate = yield* preview.start
      expect(duplicate).toBe(first)
      expect(starts).toBe(1)
      expect(dom.children).toHaveLength(1)

      animation.runNext(100)
      animation.runNext(116)
      yield* Effect.yieldNow()
      expect(frames).toStrictEqual([[100, 0], [116, 0.016]])

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
})
