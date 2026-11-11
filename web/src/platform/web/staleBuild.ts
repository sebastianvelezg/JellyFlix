const KEY = 'jellyflix.staleBuildReload'
/** A second failure this soon after a reload is a real problem, not an old tab: it is left to the error screen. */
export const RELOAD_WINDOW_MS = 60_000

/**
 * After an update, a tab that was open before it may ask for a file of the old build that no longer exists (Vite reports it as
 * `vite:preloadError`). Reloading once fetches the new build. Returns whether it reloaded.
 */
export function reloadForStaleBuild(reload: () => void = () => location.reload(), now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (last && now - last < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(now))
  } catch {
    // Without storage it cannot tell a second failure from a first: better not to reload in a loop.
    return false
  }
  reload()
  return true
}

export function watchForStaleBuild(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForStaleBuild()) event.preventDefault()
  })
}
