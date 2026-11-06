import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { HttpError, type AuthUser } from '../http/router.ts'
import type { JellyfinClient } from '../jellyfin/client.ts'

/** The token an app sent: `Authorization: MediaBrowser ... Token="x"` (like Jellyfin's own) or `Authorization: Bearer x`. */
export function tokenFrom(req: Pick<IncomingMessage, 'headers'>): string | undefined {
  const header = String(req.headers.authorization ?? '')
  const found = /Token="([^"]+)"/.exec(header)?.[1] ?? /^Bearer\s+(\S+)$/i.exec(header)?.[1]
  // Jellyfin tokens are plain letters and digits; anything else is not one, and is never passed on to Jellyfin.
  return found && /^[A-Za-z0-9._~+/=-]{4,256}$/.test(found) ? found : undefined
}

interface Cached {
  user: Omit<AuthUser, 'token'> | null
  expires: number
}

const CACHE_MS = 60_000
/** A token Jellyfin refused is not asked about again for this long, so a flood of made-up tokens does not become a flood of requests to Jellyfin. */
const REFUSED_MS = 10_000
const MAX_CACHE = 500

/**
 * Finds out who a token belongs to by asking Jellyfin. The answer is remembered for a minute under a hash of the token (the token
 * itself is never kept or written anywhere), so a screen that makes several requests asks Jellyfin once.
 */
export function createAuthenticator(jellyfin: JellyfinClient, now: () => number = Date.now) {
  const cache = new Map<string, Cached>()
  return async function authenticate(token: string | undefined): Promise<AuthUser> {
    if (!token) throw new HttpError(401, 'Sign in first.')
    const key = createHash('sha256').update(token).digest('hex')
    const hit = cache.get(key)
    if (hit && hit.expires > now()) {
      if (!hit.user) throw new HttpError(401, 'Jellyfin does not accept this session.')
      return { ...hit.user, token }
    }
    let me: { Id?: string; Name?: string; Policy?: { IsAdministrator?: boolean } }
    try {
      me = await jellyfin.get('/Users/Me', token)
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
        if (cache.size >= MAX_CACHE) cache.clear()
        cache.set(key, { user: null, expires: now() + REFUSED_MS })
        throw new HttpError(401, 'Jellyfin does not accept this session.')
      }
      throw e
    }
    if (!me.Id) throw new HttpError(502, 'Jellyfin did not say who this is.')
    const user = { id: me.Id, name: me.Name ?? '', isAdmin: me.Policy?.IsAdministrator === true }
    if (cache.size >= MAX_CACHE) cache.clear()
    cache.set(key, { user, expires: now() + CACHE_MS })
    return { ...user, token }
  }
}
