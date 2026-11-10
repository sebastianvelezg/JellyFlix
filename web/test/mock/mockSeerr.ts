import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A small stand-in for Seerr, behind a real HTTP port, for the browser tests of the Seerr module (the real container talks to it). It
 * answers like Seerr 3.5 does for what the module asks, including how it acts as another user (`X-Api-User`) and that it refuses a "+"
 * for a space in a search. (The container has a fuller one for its own tests, in modules/server/test; this one stays inside web/ so
 * the web image can be built from its own folder.)
 */
export const SEERR_KEY = 'seerr-key-SECRET-0123456789'
/** Seerr's permission bit to request. */
export const REQUEST = 32

export interface MockSeerrUser {
  id: number
  permissions: number
}

export interface MockSeerr {
  url: string
  close: () => void
  /** Seerr users by Jellyfin id. */
  users: Record<string, MockSeerrUser>
  /** Every request made, and as which Seerr user. */
  requests: Array<{ id: number; userId: number; body: Record<string, unknown> }>
  /** What was asked of the search. */
  searches: string[]
}

const RESULTS = [
  { id: 603, mediaType: 'movie', title: 'The Matrix', releaseDate: '1999-03-30', overview: 'A hacker learns.', posterPath: '/matrix.jpg', mediaInfo: { status: 5, jellyfinMediaId: 'jf-matrix-0001' } },
  { id: 604, mediaType: 'movie', title: 'The Matrix Reloaded', releaseDate: '2003-05-15', posterPath: '/reloaded.jpg', mediaInfo: { status: 3 } },
  { id: 1396, mediaType: 'tv', name: 'Breaking Bad', firstAirDate: '2008-01-20', posterPath: '/bb.jpg', mediaInfo: { status: 4 } },
  { id: 99, mediaType: 'person', name: 'Somebody' },
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
  mediaInfo: { status: 4, seasons: [{ seasonNumber: 1, status: 5 }] },
}

export async function startMockSeerr(users: Record<string, MockSeerrUser>): Promise<MockSeerr> {
  const state: MockSeerr = { url: '', close: () => undefined, users, requests: [], searches: [] }
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
      const url = new URL(req.url ?? '/', 'http://seerr.test')
      const path = url.pathname.replace(/^\/api\/v1/, '')
      const text = Buffer.concat(chunks).toString('utf8')
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined
      if (path === '/status') return send(200, { version: '3.5.1' })
      if (req.headers['x-api-key'] !== SEERR_KEY) return send(401, { message: 'Unauthorized' })
      const acting = Number(req.headers['x-api-user'] ?? 1)

      const lookup = /^\/user\/jellyfin\/([^/]+)$/.exec(path)
      if (lookup) {
        const found = state.users[decodeURIComponent(lookup[1] as string)]
        return found ? send(200, { id: found.id, permissions: found.permissions }) : send(404, { message: 'User not found.' })
      }
      if (/^\/user\/\d+\/quota$/.test(path)) return send(200, { movie: { days: 7, limit: 2, used: 1, remaining: 1, restricted: false }, tv: { restricted: false, used: 0 } })
      if (path === '/search') {
        // Seerr refuses a "+" for a space (and any reserved character that is not percent-encoded).
        const rawQuery = (req.url ?? '').split('?')[1] ?? ''
        if (rawQuery.split('&').some((pair) => pair.startsWith('query=') && pair.includes('+'))) return send(400, { message: "Parameter 'query' must be url encoded. Its value may not contain reserved characters." })
        state.searches.push(url.searchParams.get('query') ?? '')
        return send(200, { page: Number(url.searchParams.get('page')), totalPages: 1, totalResults: RESULTS.length, results: RESULTS })
      }
      if (path === '/movie/604') return send(200, { id: 604, title: 'The Matrix Reloaded', releaseDate: '2003-05-15', tagline: 'Free your mind.', posterPath: '/reloaded.jpg' })
      if (path === '/movie/603') return send(200, { id: 603, title: 'The Matrix', releaseDate: '1999-03-30', posterPath: '/matrix.jpg', mediaInfo: { status: 5, jellyfinMediaId: 'jf-matrix-0001' } })
      if (path === '/tv/1396') {
        // The seasons asked for are in the requests of the title, as in the real one.
        const requests = state.requests
          .filter((r) => r.body.mediaType === 'tv' && r.body.mediaId === 1396)
          .map((r) => ({ id: r.id, status: 1, seasons: (Array.isArray(r.body.seasons) ? (r.body.seasons as number[]) : [1, 2, 3]).map((n) => ({ seasonNumber: n })) }))
        return send(200, { ...SHOW, mediaInfo: { ...SHOW.mediaInfo, requests } })
      }
      if (path === '/request' && req.method === 'POST') {
        const made = { id: 100 + state.requests.length, userId: acting, body: body ?? {} }
        state.requests.push(made)
        return send(200, { id: made.id, status: 1 })
      }
      if (path === '/request' && req.method === 'GET') {
        const mine = state.requests.filter((r) => r.userId === Number(url.searchParams.get('requestedBy')))
        return send(200, {
          pageInfo: { pages: 1, page: 1, results: mine.length },
          results: mine.map((r) => ({
            id: r.id,
            status: 1,
            createdAt: '2026-11-10T10:00:00.000Z',
            media: { tmdbId: r.body.mediaId, mediaType: r.body.mediaType, status: 2 },
            seasons: Array.isArray(r.body.seasons) ? (r.body.seasons as number[]).map((n) => ({ seasonNumber: n })) : [],
          })),
        })
      }
      return send(404, { message: 'nope' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  state.close = () => server.close()
  return state
}
