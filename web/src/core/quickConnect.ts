import axios from 'axios'
import { getAuthenticationApi } from '@jellyfin/sdk/lib/utils/api/authentication-api'
import { confirmSession, ConnectionError, describeConnectionFailure, reachServer, type ConnectOptions } from './auth'
import { createApi, newDeviceId, type Session } from './jellyfin'
import { normalizeServerUrl } from './serverUrl'

/**
 * Quick Connect: signing in without typing a password. The app asks the server for a short code and shows it; the person
 * types that code in Jellyfin on a device that is already signed in (user menu, Quick Connect); the app then receives its own
 * session. The server must have it switched on (Dashboard, General).
 */
export interface QuickConnectRequest {
  serverUrl: string
  /** The six digits to type on the other device. */
  code: string
  /** Proves the request is ours; never shown. */
  secret: string
  /** The same device id is used for the whole exchange. */
  deviceId: string
}

/** Asks the server for a code. Throws a [ConnectionError] of kind `quick-connect-off` when the server does not offer it. */
export async function startQuickConnect(rawUrl: string, options: ConnectOptions = {}): Promise<QuickConnectRequest> {
  let serverUrl: string
  try {
    serverUrl = normalizeServerUrl(rawUrl)
  } catch (e) {
    throw describeConnectionFailure(e, 'reach')
  }
  const deviceId = options.deviceId ?? newDeviceId()
  const anonymous = createApi(serverUrl, deviceId, undefined, { deviceName: options.deviceName })
  await reachServer(anonymous, serverUrl, options)
  const auth = getAuthenticationApi(anonymous)
  try {
    const { data: enabled } = await auth.getQuickConnectEnabled()
    if (enabled === false) throw new ConnectionError('quick-connect-off', 'Quick Connect is off on this server. Turn it on in Jellyfin (Dashboard, General) or use a password.')
    const { data } = await auth.initiateQuickConnect()
    if (!data.Code || !data.Secret) throw new ConnectionError('unknown', 'The server did not give a code.')
    return { serverUrl, code: data.Code, secret: data.Secret, deviceId }
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 401) {
      throw new ConnectionError('quick-connect-off', 'Quick Connect is off on this server. Turn it on in Jellyfin (Dashboard, General) or use a password.')
    }
    throw describeConnectionFailure(e, 'login', serverUrl, options.pageProtocol)
  }
}

/** True once somebody has typed the code on a signed-in device. */
export async function isQuickConnectApproved(request: QuickConnectRequest): Promise<boolean> {
  const anonymous = createApi(request.serverUrl, request.deviceId)
  try {
    const { data } = await getAuthenticationApi(anonymous).getQuickConnectState({ secret: request.secret })
    return data.Authenticated === true
  } catch (e) {
    throw describeConnectionFailure(e, 'login', request.serverUrl)
  }
}

/** Exchanges an approved request for a session. */
export async function completeQuickConnect(request: QuickConnectRequest, options: ConnectOptions = {}): Promise<Session> {
  const anonymous = createApi(request.serverUrl, request.deviceId, undefined, { deviceName: options.deviceName })
  const info = await reachServer(anonymous, request.serverUrl, options)
  let accessToken: string
  let userName: string
  try {
    const { data } = await getAuthenticationApi(anonymous).authenticateWithQuickConnect({ quickConnectDto: { Secret: request.secret } })
    if (!data.AccessToken || !data.User?.Id) throw new ConnectionError('bad-credentials', 'The server did not return a session token.')
    accessToken = data.AccessToken
    userName = data.User.Name ?? ''
  } catch (e) {
    throw describeConnectionFailure(e, 'login', request.serverUrl, options.pageProtocol)
  }
  return confirmSession(request.serverUrl, request.deviceId, accessToken, info, userName, { ...options, deviceId: request.deviceId })
}

/**
 * The other half: approves the code another device (a TV) is showing, using this signed-in session. The code is the six digits
 * on that screen.
 */
export async function authorizeQuickConnect(session: Session, code: string): Promise<void> {
  const clean = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) throw new ConnectionError('unknown', 'The code is six digits.')
  try {
    await getAuthenticationApi(session.api).authorizeQuickConnect({ code: clean })
  } catch (e) {
    if (axios.isAxiosError(e) && (e.response?.status === 404 || e.response?.status === 400)) {
      throw new ConnectionError('unknown', 'That code was not found. Check the digits on the other screen.')
    }
    throw describeConnectionFailure(e, 'verify', session.serverUrl)
  }
}
