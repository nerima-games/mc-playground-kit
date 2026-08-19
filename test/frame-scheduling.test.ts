import { describe, expect, it } from 'vitest'
import { requestNextFrameIfActive } from '../src/application/frame-scheduling'

describe('frame scheduling', () => {
  it('requests only when the preview generation is active', () => {
    const callbacks: Array<FrameRequestCallback> = []
    const callback = (() => undefined) as FrameRequestCallback
    const scheduler = {
      request: (next: FrameRequestCallback) => {
        callbacks.push(next)
        return callbacks.length
      },
    }

    expect(requestNextFrameIfActive(true, scheduler, callback)).toBeUndefined()
    expect(callbacks).toStrictEqual([])
    expect(requestNextFrameIfActive(false, scheduler, callback)).toBe(1)
    expect(callbacks).toStrictEqual([callback])
  })
})
