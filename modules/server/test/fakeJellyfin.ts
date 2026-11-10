import type { FetchLike } from '../src/jellyfin/client.ts'

/** A very small stand-in for Jellyfin: enough of its API for the modules' tests. */
export interface FakeUser {
  id: string
  name: string
  admin: boolean
}

export const ADMIN: FakeUser = { id: 'u-admin', name: 'Ana', admin: true }
export const BEN: FakeUser = { id: 'u-ben', name: 'Ben', admin: false }
/** The container's own Jellyfin key in tests. */
export const SERVICE_KEY = 'svc-key'
export const TOKENS: Record<string, FakeUser> = { 'tok-admin': ADMIN, 'tok-ben': BEN }

const MIN = 60 * 10_000_000

interface Item {
  Id: string
  Name: string
  Type: string
  RunTimeTicks: number
  Genres: string[]
  ProductionYear: number
  SeriesId?: string
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  Overview?: string
}

export const MOVIES: Item[] = Array.from({ length: 30 }, (_, i) => ({
  Id: `m${String(i + 1).padStart(2, '0')}`,
  Name: `Film ${i + 1}`,
  Type: 'Movie',
  RunTimeTicks: (80 + (i % 5) * 10) * MIN,
  Genres: [['Action', 'Comedy', 'Drama'][i % 3] as string],
  ProductionYear: 1990 + i,
  Overview: `About film ${i + 1}`,
}))

export const EPISODES: Item[] = [1, 2, 3, 4].map((n) => ({
  Id: `e${n}`,
  Name: `Episode ${n}`,
  Type: 'Episode',
  RunTimeTicks: 22 * MIN,
  Genres: ['Comedy'],
  ProductionYear: 2010,
  SeriesId: 's1',
  SeriesName: 'The Show',
  ParentIndexNumber: 1,
  IndexNumber: n,
}))

const SERIES: Item = { Id: 's1', Name: 'The Show', Type: 'Series', RunTimeTicks: 0, Genres: ['Comedy'], ProductionYear: 2010 }
const ALL: Item[] = [...MOVIES, ...EPISODES, SERIES]

export interface FakeJellyfin {
  fetch: FetchLike
  /** The Jellyfin paths that were asked for, with the token used. */
  calls: Array<{ path: string; token: string }>
  /** Ids already watched, per user id. */
  watched: Record<string, Set<string>>
  /** Ids a user may not see (a library hidden from them, an age limit), per user id. */
  hidden: Record<string, Set<string>>
  /** While set, every list of items fails (Jellyfin is struggling). */
  failItems: boolean
  /** While set, what the container asks with its own key fails. */
  failService: boolean
}

export function fakeJellyfin(): FakeJellyfin {
  const calls: FakeJellyfin['calls'] = []
  const watched: FakeJellyfin['watched'] = { [ADMIN.id]: new Set(), [BEN.id]: new Set() }
  const hidden: FakeJellyfin['hidden'] = { [ADMIN.id]: new Set(), [BEN.id]: new Set() }
  const state = { failItems: false, failService: false }
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl)
    const header = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '')
    const token = /Token="([^"]+)"/.exec(header)?.[1] ?? ''
    calls.push({ path: url.pathname, token })
    // The container's own key (when it has one) is the administrator for the questions it asks about other people.
    const user = TOKENS[token] ?? (token === SERVICE_KEY ? ADMIN : undefined)
    if (token === SERVICE_KEY && state.failService) return json({}, 500)
    if (!user) return json({}, 401)
    const q = url.searchParams
    if (url.pathname === '/Users/Me') return json({ Id: user.id, Name: user.name, Policy: { IsAdministrator: user.admin } })
    if (url.pathname === '/Items/Filters') return json({ Genres: ['Drama', 'Action', 'Comedy'] })
    const episodes = /^\/Shows\/([^/]+)\/Episodes$/.exec(url.pathname)
    if (episodes) return json({ Items: EPISODES.filter((e) => e.SeriesId === episodes[1]) })
    if (url.pathname === '/Items') {
      if (state.failItems) return json({}, 500)
      const forUser = q.get('userId') ?? user.id
      let list = ALL.filter((i) => !hidden[forUser]?.has(i.Id))
      const ids = q.getAll('ids').flatMap((x) => x.split(','))
      if (ids.length) list = list.filter((i) => ids.includes(i.Id))
      const types = q.getAll('includeItemTypes').flatMap((x) => x.split(','))
      if (types.length) list = list.filter((i) => types.includes(i.Type))
      const genres = q.getAll('genres')
      if (genres.length) list = list.filter((i) => i.Genres.some((g) => genres.includes(g)))
      const years = q.getAll('years').flatMap((x) => x.split(','))
      if (years.length) list = list.filter((i) => years.includes(String(i.ProductionYear)))
      if (q.getAll('filters').includes('IsUnplayed')) list = list.filter((i) => !watched[forUser]?.has(i.Id))
      const limit = Number(q.get('limit') ?? list.length)
      return json({ Items: list.slice(0, limit), TotalRecordCount: list.length })
    }
    return json({}, 404)
  }
  return {
    fetch,
    calls,
    watched,
    hidden,
    get failItems() {
      return state.failItems
    },
    set failItems(value: boolean) {
      state.failItems = value
    },
    get failService() {
      return state.failService
    },
    set failService(value: boolean) {
      state.failService = value
    },
  }
}
