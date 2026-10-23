import type { SessionStore, StoredSession } from '../../core'

const SESSION_KEY = 'jellyflix.session'
const KEEP_KEY = 'jellyflix.keepSignedIn'

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/**
 * Web session persistence.
 *
 * - Default: `sessionStorage`. The session survives a page reload (and dev-server refreshes) but
 *   ends when the tab is closed, and is not shared with other tabs.
 * - "Keep me signed in on this device": `localStorage`. Survives closing the browser.
 *
 * Either way only the access token and identifiers are stored, never the password. Anything in
 * web storage can be read by script running on this origin, so the "keep me signed in" option is
 * opt-in and sign-out removes the token from both places (and revokes it on the server).
 */
export const webSessionStore: SessionStore & { persistent: boolean } = {
  persistent: false,

  async load() {
    const raw = safe(() => sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY), null)
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as StoredSession
      return value && typeof value.accessToken === 'string' ? value : null
    } catch {
      return null
    }
  },

  async save(session) {
    const json = JSON.stringify(session)
    safe(() => {
      sessionStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(SESSION_KEY)
      ;(this.persistent ? localStorage : sessionStorage).setItem(SESSION_KEY, json)
    }, undefined)
  },

  async clear() {
    safe(() => sessionStorage.removeItem(SESSION_KEY), undefined)
    safe(() => localStorage.removeItem(SESSION_KEY), undefined)
  },
}

export function readKeepSignedIn(): boolean {
  return safe(() => localStorage.getItem(KEEP_KEY) === '1', false)
}

export function writeKeepSignedIn(keep: boolean): void {
  safe(() => (keep ? localStorage.setItem(KEEP_KEY, '1') : localStorage.removeItem(KEEP_KEY)), undefined)
}
