import type { FetchLike } from '../src/jellyfin/client.ts'

/** A small stand-in for Seerr: enough of its API (and its way of acting as a user) for the module's tests. */
export const SEERR_KEY = 'seerr-key-SECRET-0123456789'

export interface FakeSeerrUser {
  id: number
  permissions: number
}

export interface FakeSeerr {
  fetch: FetchLike
  /** Everything that was asked of it. */
  calls: Array<{ method: string; path: string; query: Record<string, string>; user: string | null; key: string | null; body: unknown }>
  /** Set to change how it answers. */
  version: string
  /** Seerr users by Jellyfin id. */
  users: Record<string, FakeSeerrUser>
  /** The next POST /request answers with this (status, message) instead of creating a request. */
  failNextRequest: { status: number; message: string } | null
  down: boolean
  /** Never answers (until the caller gives up). */
  hang: boolean
  requests: Array<{ id: number; userId: number; body: Record<string, unknown> }>
}

// Seerr's permission bits (the ones the module reads).
export const ADMIN = 2
export const REQUEST = 32

const people = { id: 99, mediaType: 'person', name: 'Somebody', profilePath: '/p.jpg' }

const RESULTS = [
  { id: 603, mediaType: 'movie', title: 'The Matrix', releaseDate: '1999-03-30', overview: 'A hacker learns.', posterPath: '/matrix.jpg', mediaInfo: { status: 5, jellyfinMediaId: 'jf-matrix-0001' } },
  { id: 604, mediaType: 'movie', title: 'The Matrix Reloaded', releaseDate: '2003-05-15', posterPath: '/../evil.jpg', mediaInfo: { status: 3 } },
  { id: 1396, mediaType: 'tv', name: 'Breaking Bad', firstAirDate: '2008-01-20', posterPath: '/bb.jpg', mediaInfo: { status: 4 } },
  { id: 1399, mediaType: 'tv', name: 'Game of Thrones', firstAirDate: '2011-04-17' },
  people,
]

const SHOW = {
  id: 1396,
  name: 'Breaking Bad',
  firstAirDate: '2008-01-20',
  overview: 'A teacher.',
  posterPath: '/bb.jpg',
  seasons: [
    { seasonNumber: 0, name: 'Specials', episodeCount: 3 },
    { seasonNumber: 1, name: 'Season 1', episodeCount: 7 },
    { seasonNumber: 2, name: 'Season 2', episodeCount: 13 },
    { seasonNumber: 3, name: 'Season 3', episodeCount: 13 },
  ],
  mediaInfo: { status: 4, seasons: [{ seasonNumber: 1, status: 5 }, { seasonNumber: 2, status: 2 }] },
}

export function fakeSeerr(): FakeSeerr {
  const state: FakeSeerr = {
    fetch: async () => new Response('{}'),
    calls: [],
    version: '3.5.1',
    users: { 'u-ben': { id: 7, permissions: REQUEST }, 'u-admin': { id: 1, permissions: ADMIN } },
    failNextRequest: null,
    down: false,
    hang: false,
    requests: [],
  }
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  state.fetch = async (rawUrl, init) => {
    if (state.down) throw new Error('connection refused')
    if (state.hang) {
      await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    const url = new URL(rawUrl)
    const headers = (init?.headers ?? {}) as Record<string, string>
    const method = init?.method ?? 'GET'
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
    state.calls.push({ method, path, query: Object.fromEntries(url.searchParams), user: headers['x-api-user'] ?? null, key: headers['x-api-key'] ?? null, body })
    if (path === '/status') return json({ version: state.version })
    if (headers['x-api-key'] !== SEERR_KEY) return json({ message: 'Unauthorized' }, 401)
    const acting = Number(headers['x-api-user'] ?? 1)

    const lookup = /^\/user\/jellyfin\/([^/]+)$/.exec(path)
    if (lookup) {
      const found = state.users[decodeURIComponent(lookup[1] as string)]
      return found ? json({ id: found.id, permissions: found.permissions, displayName: 'x' }) : json({ message: 'User not found.' }, 404)
    }
    if (/^\/user\/\d+\/quota$/.test(path)) {
      return json({ movie: { days: 7, limit: 2, used: 1, remaining: 1, restricted: false }, tv: { restricted: false, used: 0 } })
    }
    // The real Seerr refuses a "+" for a space (and any unencoded reserved character) in the query: HTTP 400.
    if (path === '/search' && (rawUrl.split('?')[1] ?? '').split('&').some((pair) => pair.startsWith('query=') && pair.includes('+'))) {
      return json({ message: "Parameter 'query' must be url encoded. Its value may not contain reserved characters." }, 400)
    }
    if (path === '/search') return json({ page: Number(url.searchParams.get('page')), totalPages: 3, totalResults: 55, results: RESULTS })
    if (path === '/movie/603') return json({ id: 603, title: 'The Matrix', releaseDate: '1999-03-30', tagline: 'Free your mind.', posterPath: '/matrix.jpg', mediaInfo: { status: 5 } })
    if (path === '/tv/1396') {
      // As the real one: the seasons asked for are in the requests of the title, not in its seasons.
      const requests = state.requests
        .filter((r) => r.body.mediaType === 'tv' && r.body.mediaId === 1396)
        .map((r) => ({ id: r.id, status: 1, seasons: (Array.isArray(r.body.seasons) ? (r.body.seasons as number[]) : [1, 2, 3]).map((n) => ({ seasonNumber: n })) }))
      return json({ ...SHOW, mediaInfo: { ...SHOW.mediaInfo, requests } })
    }
    if (path === '/movie/604') return json({ id: 604, title: 'The Matrix Reloaded', releaseDate: '2003-05-15', posterPath: '/reloaded.jpg' })
    if (path === '/request' && method === 'POST') {
      if (state.failNextRequest) {
        const fail = state.failNextRequest
        state.failNextRequest = null
        return json({ message: fail.message }, fail.status)
      }
      const made = { id: 100 + state.requests.length, userId: acting, body: body as Record<string, unknown> }
      state.requests.push(made)
      return json({ id: made.id, status: 1 })
    }
    if (path === '/request' && method === 'GET') {
      const mine = state.requests.filter((r) => r.userId === Number(url.searchParams.get('requestedBy')))
      return json({
        pageInfo: { pages: 2, page: 1, results: mine.length },
        results: mine.map((r) => ({
          id: r.id,
          status: 1,
          createdAt: '2026-11-10T10:00:00.000Z',
          media: { tmdbId: r.body.mediaId, mediaType: r.body.mediaType, status: 2 },
          seasons: Array.isArray(r.body.seasons) ? (r.body.seasons as number[]).map((n) => ({ seasonNumber: n })) : [],
        })),
      })
    }
    return json({ message: 'nope' }, 404)
  }
  return state
}
