import { Jellyfin } from '@jellyfin/sdk'
import type { Api } from '@jellyfin/sdk'
import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'
import { createGate, priorityOf } from './requestGate'

export const CLIENT_NAME = 'Jellyflix Web'
export const CLIENT_VERSION = '1.2.0'

const REQUEST_TIMEOUT_MS = 15_000

let defaultDeviceName = 'Web browser'

/**
 * The name this device gives itself to Jellyfin (what other devices list in "Play on…"). The platform sets it once at start, so every
 * request, including the ones after a page reload, carries the same name.
 */
export function setDefaultDeviceName(name: string): void {
  if (name.trim()) defaultDeviceName = name.trim()
}

/** Waits before each retry of a read request that failed because the network or server hiccuped. */
export const RETRY_DELAYS_MS = [400, 1200]

/**
 * Only reads are retried (they cannot do any harm twice), and only for failures that are likely to be
 * temporary: no answer at all (network drop, timeout) or a gateway/availability error. A 401, 404 or other
 * answer from the server itself is final.
 */
export function isRetryable(error: AxiosError): boolean {
  const method = error.config?.method?.toLowerCase()
  if (method !== 'get' && method !== 'head') return false
  if (error.code === 'ERR_CANCELED') return false
  if (!error.response) return true
  return [502, 503, 504].includes(error.response.status)
}

/** Reads on their way to the server at once; the browser allows six per server, and the pictures need some of them. */
export const MAX_READS_AT_ONCE = 4

/** The lists that count everything they could return, however few of it is asked for. */
const COUNTED_LISTS = /\/(Items|Users\/[^/]+\/Items|Users\/[^/]+\/Items\/Resume|UserItems\/Resume|Shows\/NextUp|Artists|Artists\/AlbumArtists|Genres|MusicGenres)$/i

/**
 * Without being told otherwise the server counts every title that matches before it answers, to report "3,778 in all".
 * That doubles the time of a row of sixteen. A list that shows a total asks for it (`enableTotalRecordCount: true`);
 * every other list is asked not to count. Pure.
 */
export function withoutTotals(url: string): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url)
  let parsed: URL
  try {
    parsed = new URL(url, 'http://placeholder.invalid')
  } catch {
    return url
  }
  if (!COUNTED_LISTS.test(parsed.pathname) || parsed.searchParams.has('enableTotalRecordCount')) return url
  parsed.searchParams.set('enableTotalRecordCount', 'false')
  return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}`
}

/** Marks a request that holds a place in the queue of reads. */
type Queued = AxiosRequestConfig & { holdsPlace?: boolean }

export interface ApiOptions {
  /** Shown in Jellyfin's dashboard device list. */
  deviceName?: string
  /**
   * Called when the server answers 401 to an authenticated request (token expired or revoked).
   * The platform should drop the session and send the user back to sign-in.
   */
  onUnauthorized?: () => void
}

/**
 * Creates an SDK `Api` for one server. Each login gets its own random device id:
 * Jellyfin revokes the previous token when the same user re-authenticates with the
 * same device id, so a shared id would let two browser tabs sign each other out.
 */
export function createApi(serverUrl: string, deviceId: string, accessToken?: string, options: ApiOptions = {}): Api {
  const jellyfin = new Jellyfin({
    clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
    deviceInfo: { name: options.deviceName ?? defaultDeviceName, id: deviceId },
  })
  const http = axios.create({ timeout: REQUEST_TIMEOUT_MS })
  if (accessToken) {
    // Reads wait their turn (most important first); anything that writes, and the reports of what is playing, never wait.
    const gate = createGate(MAX_READS_AT_ONCE)
    http.interceptors.request.use(async (config) => {
      if ((config.method ?? 'get').toLowerCase() !== 'get') return config
      const url = withoutTotals(`${config.url ?? ''}`)
      config.url = url
      await gate.acquire(priorityOf(url), config.signal as AbortSignal | undefined)
      ;(config as Queued).holdsPlace = true
      return config
    })
    // Registered before the retry below, so the place is given back before a failed read waits to try again.
    const giveBack = (config: Queued | undefined) => {
      if (config?.holdsPlace) {
        config.holdsPlace = false
        gate.release()
      }
    }
    http.interceptors.response.use(
      (response) => {
        giveBack(response.config)
        return response
      },
      (error: unknown) => {
        if (axios.isAxiosError(error)) giveBack(error.config)
        return Promise.reject(error)
      },
    )
  }
  // Signed-in requests ride out short hiccups. Before sign-in there is no token, and a wrong address should fail at once.
  if (accessToken)
    http.interceptors.response.use(undefined, async (error: unknown) => {
      if (!axios.isAxiosError(error) || !error.config || !isRetryable(error)) return Promise.reject(error)
      const config = error.config as AxiosRequestConfig & { retryCount?: number }
      const attempt = config.retryCount ?? 0
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined) return Promise.reject(error)
      config.retryCount = attempt + 1
      await new Promise((resolve) => setTimeout(resolve, delay))
      return http.request(config)
    })
  const { onUnauthorized } = options
  if (accessToken && onUnauthorized) {
    http.interceptors.response.use(undefined, (error: unknown) => {
      if (axios.isAxiosError(error) && error.response?.status === 401) onUnauthorized()
      return Promise.reject(error)
    })
  }
  return jellyfin.createApi(serverUrl, accessToken, http)
}

export function newDeviceId(): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `jellyflix-${random}`
}

export interface Session {
  api: Api
  serverUrl: string
  serverName: string
  serverVersion: string
  userId: string
  userName: string
  accessToken: string
  deviceId: string
}
