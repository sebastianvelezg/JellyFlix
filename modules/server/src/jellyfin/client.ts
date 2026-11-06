import { HttpError } from '../http/router.ts'

/** A fetch that can be replaced in tests. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface JellyfinClient {
  /** GET a Jellyfin path, signed as whoever owns `token`. */
  get<T = unknown>(path: string, token: string, query?: Record<string, string | number | boolean | string[] | undefined>): Promise<T>
  /** The same with the container's own API key; undefined when there is none. */
  getAsService<T = unknown>(path: string, query?: Record<string, string | number | boolean | string[] | undefined>): Promise<T>
  hasServiceKey: boolean
}

const TIMEOUT_MS = 20_000

function authorization(token: string): string {
  // Jellyfin 12 refuses the token as a query value; the header is the way. The client name only shows up in its dashboard.
  return `MediaBrowser Client="Jellyflix Modules", Device="modules", DeviceId="jellyflix-modules", Version="0.1.0", Token="${token}"`
}

export function createJellyfinClient(baseUrl: string, apiKey: string | undefined, fetchImpl: FetchLike = fetch): JellyfinClient {
  async function call<T>(path: string, token: string, query: Record<string, string | number | boolean | string[] | undefined> = {}): Promise<T> {
    const url = new URL(baseUrl + path)
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue
      // A list is sent as one repeated key, which is what the Jellyfin apps do.
      if (Array.isArray(value)) for (const one of value) url.searchParams.append(key, one)
      else url.searchParams.set(key, String(value))
    }
    let res: Response
    try {
      res = await fetchImpl(url.toString(), {
        headers: { authorization: authorization(token), accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new HttpError(502, 'Jellyfin did not answer.')
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(res.status, 'Jellyfin refused the request.')
    if (!res.ok) throw new HttpError(502, `Jellyfin answered with an error (HTTP ${res.status}).`)
    return (await res.json()) as T
  }
  return {
    get: call,
    getAsService: <T>(path: string, query?: Record<string, string | number | boolean | string[] | undefined>) => {
      if (!apiKey) throw new HttpError(409, 'This needs a Jellyfin API key (JELLYFIN_API_KEY) in the modules container.')
      return call<T>(path, apiKey, query)
    },
    hasServiceKey: !!apiKey,
  }
}
