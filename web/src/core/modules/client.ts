import { API_VERSION, type Manifest } from './contract'

/** The versions of the modules API this app understands. */
export const SUPPORTED_API: readonly number[] = [API_VERSION]

export class ModulesError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ModulesClient {
  baseUrl: string
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
  del<T>(path: string): Promise<T>
}

export { isTrustedModulesAddress, normalizeModulesUrl } from './url'

const REQUEST_TIMEOUT_MS = 15_000

/** Signs requests with the same session token Jellyfin gave this app (the container asks Jellyfin who it is). */
export function createModulesClient(baseUrl: string, token: string, fetchImpl: FetchLike = (url, init) => fetch(url, init), timeoutMs = REQUEST_TIMEOUT_MS): ModulesClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers: { authorization: `MediaBrowser Token="${token}"`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new ModulesError(0, 'The modules container did not answer.')
    }
    if (res.status === 204) return undefined as T
    let data: unknown
    try {
      data = await res.json()
    } catch {
      data = undefined
    }
    if (!res.ok) throw new ModulesError(res.status, (data as { error?: string } | undefined)?.error ?? `The modules container answered with an error (HTTP ${res.status}).`)
    return data as T
  }
  return {
    baseUrl,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body ?? {}),
    put: (path, body) => request('PUT', path, body ?? {}),
    del: (path) => request('DELETE', path),
  }
}

export type ModulesGate =
  | { status: 'absent' }
  | { status: 'incompatible'; api: number; version: string }
  | { status: 'ready'; manifest: Manifest; client: ModulesClient; skew: number }

const PROBE_TIMEOUT_MS = 2500

/**
 * Finds out whether a modules container is there: one request, quickly given up on. Any failure (nothing listening, refused, an old
 * or odd answer) is simply "absent": the app then looks and behaves as if modules did not exist.
 */
export async function probeModules(baseUrl: string | null, token: string, fetchImpl?: FetchLike, nowMs: () => number = Date.now): Promise<ModulesGate> {
  if (!baseUrl) return { status: 'absent' }
  try {
    const client = createModulesClient(baseUrl, token, fetchImpl, PROBE_TIMEOUT_MS)
    const manifest = await client.get<Manifest>('/v1/manifest')
    if (typeof manifest?.api !== 'number' || !Array.isArray(manifest.modules)) return { status: 'absent' }
    if (!SUPPORTED_API.includes(manifest.api)) return { status: 'incompatible', api: manifest.api, version: String(manifest.version ?? '') }
    return { status: 'ready', manifest, client: createModulesClient(baseUrl, token, fetchImpl), skew: manifest.serverTime - Math.floor(nowMs() / 1000) }
  } catch {
    return { status: 'absent' }
  }
}
