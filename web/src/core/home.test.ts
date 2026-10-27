// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as capabilities } from '../../test/fixtures'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import {
  buildHomeLineup,
  distinctSeeds,
  getBecauseYouWatched,
  getRecommendations,
  getContinueAll,
  getFreshSeries,
  getHomePool,
  getLatestTitles,
  getRandomMovieAcross,
  interleave,
  newestFirst,
} from './home'
import type { Session } from './jellyfin'
import type { Movie } from './library'
import { negotiatePlayback } from './playback'
import { PlaybackSession } from './playbackSession'
import { setFavorite, setWatched } from './details'
import { isEpisode } from './shows'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 20, seriesCount: 6, animeCount: 4 })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

const device = { paused: true, muted: false, volume: 1 }
async function watch(id: string, seconds: number) {
  const plan = await negotiatePlayback(session, id, { capabilities })
  const playback = new PlaybackSession(session, plan, seconds)
  playback.playing(seconds, device)
  await playback.stop(device)
}

const title = (id: string, extra: Partial<Movie> = {}): Movie => ({
  id,
  name: id,
  resumeTicks: 0,
  played: false,
  favorite: false,
  backdropTag: 'bd',
  ...extra,
})

describe('interleave', () => {
  it('takes one from each list in turn and keeps going when one runs out', () => {
    expect(interleave<number | string>([[1, 2, 3], ['a'], ['x', 'y']])).toEqual([1, 'a', 'x', 2, 'y', 3])
    expect(interleave([])).toEqual([])
    expect(interleave([[], []])).toEqual([])
  })
})

describe('buildHomeLineup', () => {
  const movies = { recent: ['m1', 'm2'].map((id) => title(id)), pool: ['m3', 'm4', 'm5', 'm6', 'm7', 'm8'].map((id) => title(id)) }
  const series = { recent: ['s1'].map((id) => title(id, { isSeries: true })), pool: ['s2', 's3', 's4'].map((id) => title(id, { isSeries: true })) }

  it('mixes movies and series, with the newest of each first', () => {
    const lineup = buildHomeLineup(movies, series, { count: 8, random: () => 0.3 })
    expect(lineup).toHaveLength(8)
    expect(lineup[0]?.id).toBe('m1')
    expect(lineup[1]?.id).toBe('s1')
    expect(lineup.filter((m) => m.isSeries).length).toBeGreaterThanOrEqual(2)
    expect(lineup.filter((m) => !m.isSeries).length).toBeGreaterThanOrEqual(4)
    expect(new Set(lineup.map((m) => m.id)).size).toBe(8)
  })

  it('is all movies, or all series, when only one kind exists', () => {
    const none = { recent: [], pool: [] }
    expect(buildHomeLineup(movies, none, { count: 5 }).every((m) => !m.isSeries)).toBe(true)
    expect(buildHomeLineup(movies, none, { count: 5 })).toHaveLength(5)
    expect(buildHomeLineup(none, series, { count: 5 }).every((m) => m.isSeries)).toBe(true)
    expect(buildHomeLineup(none, none)).toEqual([])
  })
})

describe('across libraries', () => {
  it('reads the latest titles from every library of a kind and merges them', async () => {
    const latest = await getLatestTitles(session, 'series', ['lib-shows', 'lib-anime'], 6)
    expect(latest).toHaveLength(6)
    expect(latest.some((s) => s.id.startsWith('s'))).toBe(true)
    expect(latest.some((s) => s.id.startsWith('a'))).toBe(true)
  })

  it('builds a featured pool with only titles that have a backdrop', async () => {
    const pool = await getHomePool(session, 'movie', ['lib-movies'])
    expect(pool.length).toBeGreaterThan(0)
    expect(pool.every((m) => m.backdropTag)).toBe(true)
  })

  it('raises the error when every library fails, not an empty list', async () => {
    await expect(getLatestTitles(session, 'movie', ['lib-movies'], 4)).resolves.toHaveLength(4)
    const broken = await startMockJellyfin({ movieCount: 3, flaky: { path: '/Items/Latest', status: 400, times: 5 } })
    try {
      const s = await connect(broken.url, 'tester', 'secret')
      await expect(getLatestTitles(s, 'movie', ['lib-movies'])).rejects.toThrow()
    } finally {
      await broken.close()
    }
  })
})

describe('continue watching (movies and episodes together)', () => {
  it('lists what was left half-way, newest first, as movies or episodes', async () => {
    await watch('m0003', 10)
    await watch('s0002-ep-1-2', 12)
    const items = await getContinueAll(session)
    expect(items.map((m) => m.id).slice(0, 2)).toEqual(['s0002-ep-1-2', 'm0003'])
    expect(isEpisode(items[0] as Movie)).toBe(true)
    expect(isEpisode(items[1] as Movie)).toBe(false)
    expect(items.every((m) => m.resumeTicks > 0)).toBe(true)
    // Movies and episodes are asked for separately (a single request for both was slow on a real server).
    const asked = mock.requests.filter((r) => r.path === '/UserItems/Resume').slice(-2).map((r) => r.query.includeItemTypes)
    expect([...asked].sort()).toEqual(['Episode', 'Movie'])
  })

  it('orders by when each was last played', () => {
    const t = (id: string, lastPlayedAt?: number) => ({ id, lastPlayedAt })
    expect(newestFirst([t('old', 1), t('none'), t('new', 5), t('mid', 3)]).map((x) => x.id)).toEqual(['new', 'mid', 'old', 'none'])
  })
})

describe('random picks', () => {
  it('picks a movie, preferring unwatched ones', async () => {
    const movie = await getRandomMovieAcross(session, ['lib-movies'])
    expect(movie).not.toBeNull()
    expect(movie?.played).toBe(false)
  })

  it('finds a series you have not started, with its first episode (not a special)', async () => {
    const fresh = await getFreshSeries(session, ['lib-shows', 'lib-anime'])
    expect(fresh).not.toBeNull()
    expect(fresh?.episode.id).toBe(`${fresh?.show.id}-ep-1-1`)
    expect(fresh?.episode.seasonNumber).toBe(1)
    // Not the one that was started above.
    expect(fresh?.show.id).not.toBe('s0002')
  })

  it('finds nothing new when every series has been started', async () => {
    const small = await startMockJellyfin({ movieCount: 1, seriesCount: 2 })
    try {
      const s = await connect(small.url, 'tester', 'secret')
      for (const show of ['s0001', 's0002']) {
        const plan = await negotiatePlayback(s, `${show}-ep-1-1`, { capabilities })
        const playback = new PlaybackSession(s, plan, 12)
        playback.playing(12, device)
        await playback.stop(device)
      }
      expect(await getFreshSeries(s, ['lib-shows'])).toBeNull()
    } finally {
      await small.close()
    }
  })

  it('finds nothing in a library that is still being scanned', async () => {
    const empty = await startMockJellyfin({ movieCount: 1, seriesCount: 0 })
    try {
      const s = await connect(empty.url, 'tester', 'secret')
      expect(await getFreshSeries(s, ['lib-shows'])).toBeNull()
    } finally {
      await empty.close()
    }
  })
})

describe('because you watched', () => {
  it('suggests titles like the movie finished last', async () => {
    await watch('m0003', 10)
    await setWatched(session, 'm0003', true)
    const row = await getBecauseYouWatched(session)
    expect(row?.seed.id).toBe('m0003')
    expect(row?.items.map((m) => m.id)).toEqual(['m0004', 'm0005', 'm0006'])
  })

  it('leaves out what has been seen already', async () => {
    await setWatched(session, 'm0005', true)
    const row = await getBecauseYouWatched(session)
    // The suggestions are m0004..m0006 for m0003 (still the last one played): m0005 is seen, which leaves too few for a row.
    expect(row).toBeNull()
  })
})

describe('recommendations', () => {
  it('keeps each seed once, with an episode standing for its series', () => {
    const seeds = distinctSeeds([{ id: 's1', name: 'Show' }, { id: 'm1', name: 'Film' }, { id: 's1', name: 'Show' }])
    expect(seeds.map((m) => m.id)).toEqual(['s1', 'm1'])
  })

  it('makes several rows from different titles, with one for a favourite, and no title twice', async () => {
    const own = await startMockJellyfin({ movieCount: 30, seriesCount: 0 })
    try {
      const s = await connect(own.url, 'tester', 'secret')
      for (const id of ['m0003', 'm0010', 'm0020']) {
        const plan = await negotiatePlayback(s, id, { capabilities })
        const playback = new PlaybackSession(s, plan, 10)
        playback.playing(10, device)
        await playback.stop(device)
        await setWatched(s, id, true)
      }
      await setFavorite(s, 'm0025', true)
      const rows = await getRecommendations(s)
      // The last one watched, then the favourite, then the one watched before: alternating, so the rows do not look alike.
      expect(rows.map((r) => [r.kind, r.seed.id])).toEqual([
        ['watched', 'm0020'],
        ['liked', 'm0025'],
        ['watched', 'm0010'],
      ])
      expect(rows[0]?.items.map((m) => m.id)).toEqual(['m0021', 'm0022', 'm0023'])
      expect(rows[1]?.items.map((m) => m.id)).toEqual(['m0026', 'm0027', 'm0028'])
      const all = rows.flatMap((r) => r.items.map((m) => m.id))
      expect(new Set(all).size).toBe(all.length)

      // Without a favourite the rows are all about what was watched.
      await setFavorite(s, 'm0025', false)
      const plain = await getRecommendations(s)
      expect(plain.map((r) => [r.kind, r.seed.id])).toEqual([
        ['watched', 'm0020'],
        ['watched', 'm0010'],
        ['watched', 'm0003'],
      ])
      expect(await getRecommendations(s, { rows: 1 })).toHaveLength(1)
    } finally {
      await own.close()
    }
  })

  it('has nothing to say before anything has been watched', async () => {
    const fresh = await startMockJellyfin({ movieCount: 10, seriesCount: 0 })
    try {
      const s = await connect(fresh.url, 'tester', 'secret')
      expect(await getRecommendations(s)).toEqual([])
    } finally {
      await fresh.close()
    }
  })
})
