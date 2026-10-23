import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api'
import axios from 'axios'
import { ConnectionError, describeConnectionFailure } from './auth'
import { createApi, type Session } from './jellyfin'
import { currentUser } from './me'

/** What must be remembered to resume a signed-in session later. Never the password. */
export interface StoredSession {
  serverUrl: string
  serverName: string
  serverVersion: string
  accessToken: string
  deviceId: string
  userId: string
  userName: string
}

/**
 * Where a platform keeps the session between launches. The web uses sessionStorage (survives a
 * reload, ends with the tab) or localStorage ("keep me signed in"); a TV app would use encrypted
 * storage. Async so secure/native stores fit.
 */
export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

export function toStoredSession(session: Session): StoredSession {
  return {
    serverUrl: session.serverUrl,
    serverName: session.serverName,
    serverVersion: session.serverVersion,
    accessToken: session.accessToken,
    deviceId: session.deviceId,
    userId: session.userId,
    userName: session.userName,
  }
}

/**
 * Re-creates a session from storage **without asking the server**, so the app can be drawn straight away. Whether the
 * token still works is found out by {@link verifySession} (and by the first request that fails with 401, which
 * calls `onUnauthorized`). `null` when nothing is stored.
 */
export async function resumeSession(
  store: SessionStore,
  options: { onUnauthorized?: () => void } = {},
): Promise<Session | null> {
  const stored = await store.load()
  if (!stored?.accessToken || !stored.serverUrl || !stored.userId) return null
  const api = createApi(stored.serverUrl, stored.deviceId, stored.accessToken, { onUnauthorized: options.onUnauthorized })
  return { ...stored, api }
}

/**
 * Asks the server whether a resumed session is still valid. `rejected`: the token was refused (sign in again);
 * `unreachable`: no answer, which says nothing about the token.
 */
export async function verifySession(session: Session): Promise<'valid' | 'rejected' | 'unreachable'> {
  try {
    const me = await currentUser(session, { fresh: true })
    return me.Id === session.userId ? 'valid' : 'rejected'
  } catch (e) {
    return axios.isAxiosError(e) && (e.response?.status === 401 || e.response?.status === 403) ? 'rejected' : 'unreachable'
  }
}

/**
 * Re-creates a session from storage, proving the token is still valid with `GET /Users/Me`.
 *
 * - `null`: nothing stored, or the server rejected the token (the store is cleared).
 * - throws `ConnectionError`: the server could not be reached; the stored session is kept so a
 *   later retry can succeed.
 */
export async function restoreSession(
  store: SessionStore,
  options: { onUnauthorized?: () => void; pageProtocol?: string } = {},
): Promise<Session | null> {
  const stored = await store.load()
  if (!stored?.accessToken || !stored.serverUrl) return null

  const api = createApi(stored.serverUrl, stored.deviceId, stored.accessToken, {
    onUnauthorized: options.onUnauthorized,
  })
  try {
    const { data: me } = await getUserApi(api).getCurrentUser()
    if (!me.Id) throw new ConnectionError('bad-credentials', 'The saved session was not accepted.')
    return { ...stored, api, userId: me.Id, userName: me.Name ?? stored.userName }
  } catch (e) {
    if (axios.isAxiosError(e) && (e.response?.status === 401 || e.response?.status === 403)) {
      await store.clear()
      return null
    }
    if (e instanceof ConnectionError && e.kind === 'bad-credentials') {
      await store.clear()
      return null
    }
    throw describeConnectionFailure(e, 'verify', stored.serverUrl, options.pageProtocol)
  }
}
