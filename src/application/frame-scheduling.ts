export type FrameRequestScheduler = {
  readonly request: (callback: FrameRequestCallback) => number
}

export const requestNextFrameIfActive = (
  stopped: boolean,
  scheduler: FrameRequestScheduler,
  callback: FrameRequestCallback,
): number | undefined => {
  if (stopped) {
    return
  }
  return scheduler.request(callback)
}
