import { HttpError } from '../../http/router.ts'
import type { FetchLike } from '../../jellyfin/client.ts'

/**
 * Talks to Seerr with the container's API key. Everything that goes out is built here from fixed paths and numbers the service has
 * already checked: no address, path or header ever comes from a person. When `asUser` is given, Seerr acts as that Seerr user
 * (`X-Api-User`), so that person's permissions and quota apply and the request is theirs.
 */
export interface SeerrClient {
  get<T = unknown>(path: string, options?: { asUser?: number; query?: Record<string, string | number | undefined>; timeoutMs?: number }): Promise<T>
  post<T = unknown>(path: string, body: unknown, options: { asUser: number }): Promise<T>
}

const TIMEOUT_MS = 15_000
/** More than this from Seerr is not something this module asked for. */
const MAX_BYTES = 4 * 1024 * 1024

export function createSeerrClient(baseUrl: string, apiKey: string, fetchImpl: FetchLike = fetch): SeerrClient {
  async function call<T>(method: 'GET' | 'POST', path: string, asUser: number | undefined, query: Record<string, string | number | undefined> = {}, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
    // Seerr wants every reserved character percent-encoded, and a space as %20: a "+" is refused (HTTP 400), which URLSearchParams would send.
    const pairs = Object.entries(query).filter((pair): pair is [string, string | number] => pair[1] !== undefined)
    const url = `${baseUrl}/api/v1${path}${pairs.length ? '?' + pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&') : ''}`
    const headers: Record<string, string> = { 'x-api-key': apiKey, accept: 'application/json' }
    if (asUser !== undefined) headers['x-api-user'] = String(asUser)
    if (body !== undefined) headers['content-type'] = 'application/json'
    let res: Response
    try {
      // A redirect is not followed: it could carry the key somewhere else.
      res = await fetchImpl(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    } catch {
      throw new HttpError(502, 'Seerr did not answer.')
    }
    if (!res.ok) throw await failure(res)
    const text = await readLimited(res)
    try {
      return (text ? JSON.parse(text) : undefined) as T
    } catch {
      throw new HttpError(502, 'Seerr sent an answer that could not be read.')
    }
  }
  return {
    get: (path, options = {}) => call('GET', path, options.asUser, options.query, undefined, options.timeoutMs),
    post: (path, body, options) => call('POST', path, options.asUser, {}, body),
  }
}

async function readLimited(res: Response): Promise<string> {
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > MAX_BYTES) throw new HttpError(502, 'Seerr sent more than expected.')
  if (!res.body) return ''
  // Read by pieces and stop at the limit, so an answer with no (or a false) length cannot fill the memory.
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new HttpError(502, 'Seerr sent more than expected.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * What Seerr's refusals mean, in this container's own words: Seerr's text (and its address) is not passed on. 409 is how it says a
 * request already exists or a quota is used up; the message it sends tells which.
 */
async function failure(res: Response): Promise<HttpError> {
  let said = ''
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown }
    said = String(body.message ?? body.error ?? '').toLowerCase()
  } catch {
    // No readable reason: the status alone decides.
  }
  if (res.status === 401) return new HttpError(502, 'Seerr did not accept the container’s API key.')
  if (res.status === 403) {
    if (said.includes('quota')) return new HttpError(409, 'The request limit has been reached for now.')
    return new HttpError(403, 'Seerr does not let this account do that.')
  }
  if (res.status === 404) return new HttpError(404, 'Seerr does not have that.')
  if (res.status === 409 || res.status === 400) {
    if (said.includes('quota')) return new HttpError(409, 'The request limit has been reached for now.')
    if (said.includes('already') || said.includes('exist')) return new HttpError(409, 'That has already been requested.')
    if (said.includes('block')) return new HttpError(409, 'Seerr does not take requests for that title.')
    return new HttpError(res.status, 'Seerr could not take that request.')
  }
  return new HttpError(502, `Seerr answered with an error (HTTP ${res.status}).`)
}
