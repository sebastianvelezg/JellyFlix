import axios from 'axios'
import { getAuthenticationApi } from '@jellyfin/sdk/lib/utils/api/authentication-api'
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api'
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api'
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api'
import type { Api } from '@jellyfin/sdk'
import { createApi, newDeviceId, type Session } from './jellyfin'
import { rememberUser } from './me'
import { normalizeServerUrl, ServerUrlError } from './serverUrl'

export type ConnectionErrorKind =
  | 'invalid-url'
  | 'unreachable'
  | 'not-jellyfin'
  | 'bad-credentials'
  | 'quick-connect-off'
  | 'forbidden'
  | 'server-error'
  | 'unknown'

export class ConnectionError extends Error {
  readonly kind: ConnectionErrorKind
  constructor(kind: ConnectionErrorKind, message: string) {
    super(message)
    this.name = 'ConnectionError'
    this.kind = kind
  }
}

type Stage = 'reach' | 'login' | 'verify'

/** Maps a thrown transport/HTTP error to a message a person can act on. */
export function describeConnectionFailure(
  error: unknown,
  stage: Stage,
  serverUrl = '',
  /** Protocol of the page making the request ('https:' enables the mixed-content hint). Web only. */
  pageProtocol = '',
): ConnectionError {
  if (error instanceof ConnectionError) return error
  if (error instanceof ServerUrlError) return new ConnectionError('invalid-url', error.message)

  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === undefined) {
      if (error.code === 'ECONNABORTED') {
        return new ConnectionError(
          'unreachable',
          'The server did not answer in time. Check the address and that the server is running.',
        )
      }
      const mixed = pageProtocol === 'https:' && serverUrl.startsWith('http:')
      return new ConnectionError(
        'unreachable',
        mixed
          ? 'This page is served over HTTPS, so the browser blocks requests to an http:// server. Use an https:// server address, or open this app over http://.'
          : 'Could not reach the server. Check the address and port. If they are correct, the server may be blocking cross-origin (CORS) requests from this page.',
      )
    }
    if (stage === 'login' && (status === 401 || status === 400)) {
      return new ConnectionError('bad-credentials', 'Incorrect username or password.')
    }
    if (status === 401) {
      return new ConnectionError('bad-credentials', 'The server rejected the session token.')
    }
    if (status === 403) {
      return new ConnectionError(
        'forbidden',
        'This account is not allowed to sign in (it may be disabled or restricted to certain networks).',
      )
    }
    if (stage === 'reach' && status === 404) {
      return new ConnectionError(
        'not-jellyfin',
        'The address answered, but it does not look like a Jellyfin server. Check the port and any URL path.',
      )
    }
    if (status >= 500) {
      return new ConnectionError('server-error', `The server reported an error (HTTP ${status}).`)
    }
    return new ConnectionError('unknown', `Unexpected response from the server (HTTP ${status}).`)
  }

  return new ConnectionError('unknown', 'Something went wrong while connecting.')
}

export interface ConnectOptions {
  /** Identifies this client install/session to Jellyfin. Defaults to a fresh random id. */
  deviceId?: string
  /** Web only: `location.protocol`, used to explain mixed-content failures. */
  pageProtocol?: string
  /** Shown in Jellyfin's dashboard device list (default "Web browser"). */
  deviceName?: string
  /** Called if the session later turns out to be expired/revoked (HTTP 401 on any request). */
  onUnauthorized?: () => void
}

/**
 * Connects to a server, signs in, then confirms the token with an authenticated
 * request (`GET /Users/Me`). A reachable server root alone is not treated as success.
 */
export async function connect(
  rawUrl: string,
  username: string,
  password: string,
  options: ConnectOptions = {},
): Promise<Session> {
  let serverUrl: string
  try {
    serverUrl = normalizeServerUrl(rawUrl)
  } catch (e) {
    throw describeConnectionFailure(e, 'reach')
  }
  const name = username.trim()
  if (!name) throw new ConnectionError('bad-credentials', 'Enter your Jellyfin username.')

  const deviceId = options.deviceId ?? newDeviceId()
  const anonymous = createApi(serverUrl, deviceId, undefined, { deviceName: options.deviceName })

  const info = await reachServer(anonymous, serverUrl, options)

  let accessToken: string
  try {
    const { data } = await getAuthenticationApi(anonymous).authenticateUserByName({
      authenticateUserByName: { Username: name, Pw: password },
    })
    if (!data.AccessToken || !data.User?.Id) {
      throw new ConnectionError('bad-credentials', 'The server did not return a session token.')
    }
    accessToken = data.AccessToken
  } catch (e) {
    throw describeConnectionFailure(e, 'login', serverUrl, options.pageProtocol)
  }

  return confirmSession(serverUrl, deviceId, accessToken, info, name, options)
}

/** Asks the server who it is, and refuses anything that is not Jellyfin. */
export async function reachServer(anonymous: Api, serverUrl: string, options: ConnectOptions): Promise<{ name: string; version: string }> {
  return getSystemApi(anonymous)
    .getPublicSystemInfo()
    .then(({ data }) => {
      if (!data || typeof data !== 'object' || !data.Version || !data.ProductName) {
        throw new ConnectionError('not-jellyfin', 'The address answered, but it is not a Jellyfin server.')
      }
      return { name: data.ServerName ?? 'Jellyfin', version: data.Version }
    })
    .catch((e: unknown) => {
      throw describeConnectionFailure(e, 'reach', serverUrl, options.pageProtocol)
    })
}

/** Confirms a fresh token with an authenticated request and turns it into a [Session]. */
export async function confirmSession(
  serverUrl: string,
  deviceId: string,
  accessToken: string,
  info: { name: string; version: string },
  fallbackUserName: string,
  options: ConnectOptions,
): Promise<Session> {
  const api = createApi(serverUrl, deviceId, accessToken, {
    deviceName: options.deviceName,
    onUnauthorized: options.onUnauthorized,
  })
  try {
    const { data: me } = await getUserApi(api).getCurrentUser()
    if (!me.Id) throw new ConnectionError('bad-credentials', 'The session token was not accepted.')
    const session: Session = {
      api,
      serverUrl,
      serverName: info.name,
      serverVersion: info.version,
      userId: me.Id,
      userName: me.Name ?? fallbackUserName,
      accessToken,
      deviceId,
    }
    rememberUser(session, me)
    return session
  } catch (e) {
    throw describeConnectionFailure(e, 'verify', serverUrl, options.pageProtocol)
  }
}

/** Ends the server-side session (best effort) so the token stops working. */
export async function logout(session: Session): Promise<void> {
  try {
    await getSessionApi(session.api).reportSessionEnded()
  } catch {
    // The token is dropped locally regardless; a failed revoke must not block sign-out.
  }
}
