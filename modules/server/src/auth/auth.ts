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

/**
 * Who is calling, to count the tokens Jellyfin refused for each caller: the address the connection comes from, or, when this
 * container is only reached through a proxy that writes `X-Forwarded-For` itself (the web image's `/modules/` proxy, with
 * JELLYFLIX_TRUST_PROXY=1), the address that proxy saw. Without that setting the header is ignored: anybody could write it.
 */
export function clientOf(req: Pick<IncomingMessage, 'headers' | 'socket'>, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .pop()
    if (forwarded) return forwarded
  }
  return req.socket.remoteAddress ?? ''
}

interface Cached {
  user: Omit<AuthUser, 'token'> | null
  expires: number
}

/**
 * How long an answer of Jellyfin is remembered. A token revoked in Jellyfin, or an administrator who stops being one, keeps working
 * here for at most this long.
 */
const CACHE_MS = 60_000
/** A token Jellyfin refused is not asked about again for this long, so a flood of made-up tokens does not become a flood of requests to Jellyfin. */
const REFUSED_MS = 10_000
const MAX_CACHE = 500
/** Tokens Jellyfin may refuse for one caller in a window; after that, tokens it does not know yet are refused without asking Jellyfin. */
export const MAX_REFUSALS = 20
const REFUSAL_WINDOW_MS = 60_000
const MAX_CALLERS = 1000

/**
 * Finds out who a token belongs to by asking Jellyfin. The answer is remembered for a minute under a hash of the token (the token
 * itself is never kept or written anywhere), so a screen that makes several requests asks Jellyfin once. The least recently used
 * answers make room for new ones. A caller that keeps sending tokens Jellyfin refuses is made to wait, while the people already
 * signed in carry on.
 */
export function createAuthenticator(jellyfin: JellyfinClient, now: () => number = Date.now) {
  const cache = new Map<string, Cached>()
  const refusals = new Map<string, { count: number; since: number }>()

  const remember = (key: string, entry: Cached) => {
    cache.delete(key)
    while (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string)
    cache.set(key, entry)
  }

  const tooManyRefusals = (client: string): boolean => {
    const seen = refusals.get(client)
    if (!seen) return false
    if (now() - seen.since > REFUSAL_WINDOW_MS) {
      refusals.delete(client)
      return false
    }
    return seen.count >= MAX_REFUSALS
  }

  const countRefusal = (client: string) => {
    const seen = refusals.get(client)
    if (seen && now() - seen.since <= REFUSAL_WINDOW_MS) {
      seen.count += 1
      return
    }
    refusals.delete(client)
    while (refusals.size >= MAX_CALLERS) refusals.delete(refusals.keys().next().value as string)
    refusals.set(client, { count: 1, since: now() })
  }

  return async function authenticate(token: string | undefined, client = ''): Promise<AuthUser> {
    if (!token) throw new HttpError(401, 'Sign in first.')
    const key = createHash('sha256').update(token).digest('hex')
    const hit = cache.get(key)
    if (hit && hit.expires > now()) {
      if (!hit.user) throw new HttpError(401, 'Jellyfin does not accept this session.')
      // Most recently used last, so it is the last to make room.
      cache.delete(key)
      cache.set(key, hit)
      return { ...hit.user, token }
    }
    if (tooManyRefusals(client)) throw new HttpError(429, 'Too many sessions that Jellyfin does not accept. Wait a minute and try again.')
    let me: { Id?: string; Name?: string; Policy?: { IsAdministrator?: boolean } }
    try {
      me = await jellyfin.get('/Users/Me', token)
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
        countRefusal(client)
        remember(key, { user: null, expires: now() + REFUSED_MS })
        throw new HttpError(401, 'Jellyfin does not accept this session.')
      }
      throw e
    }
    if (!me.Id) throw new HttpError(502, 'Jellyfin did not say who this is.')
    const user = { id: me.Id, name: me.Name ?? '', isAdmin: me.Policy?.IsAdministrator === true }
    remember(key, { user, expires: now() + CACHE_MS })
    return { ...user, token }
  }
}
