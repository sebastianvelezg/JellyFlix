/**
 * Integrates the player with the operating system, best effort and feature-detected:
 * the OS media overlay / hardware media keys, and keeping the screen awake while playing.
 */
export function bindMediaSession(video: HTMLVideoElement, title: string): () => void {
  if (!('mediaSession' in navigator)) return () => undefined
  const session = navigator.mediaSession
  try {
    session.metadata = new MediaMetadata({ title })
  } catch {
    // Unsupported metadata: the handlers below still work.
  }
  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ['play', () => void video.play().catch(() => undefined)],
    ['pause', () => video.pause()],
    ['seekbackward', (d) => void (video.currentTime = Math.max(0, video.currentTime - (d.seekOffset ?? 10)))],
    ['seekforward', (d) => void (video.currentTime = video.currentTime + (d.seekOffset ?? 10))],
  ]
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler)
    } catch {
      // Action not supported by this browser.
    }
  }
  return () => {
    for (const [action] of handlers) {
      try {
        session.setActionHandler(action, null)
      } catch {
        // ignore
      }
    }
    session.metadata = null
  }
}

/** Keeps the screen from dimming while a video plays. Returns a release function. */
export function keepScreenAwake(): () => void {
  let sentinel: WakeLockSentinel | null = null
  let released = false
  const acquire = async () => {
    try {
      const lock = await navigator.wakeLock?.request('screen')
      if (!lock) return
      if (released) void lock.release().catch(() => undefined)
      else sentinel = lock
    } catch {
      // Denied (e.g. low battery) or unsupported: playback is unaffected.
    }
  }
  // The lock is dropped when the tab is hidden; take it again when it becomes visible.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !released) void acquire()
  }
  void acquire()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    released = true
    document.removeEventListener('visibilitychange', onVisible)
    void sentinel?.release().catch(() => undefined)
  }
}
