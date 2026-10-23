// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as capabilities } from '../../test/fixtures'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import { backdropImageUrl, getMovieDetails, getSimilarMovies, personImageUrl, resolutionLabel, setFavorite, setWatched } from './details'
import type { Session } from './jellyfin'
import { buildLineup, cleanTitle, getContinueWatching, getRandomMovie, getMovieGenres, getMoviePage, getRecentlyAdded, getFeaturedPool, searchMovies, shuffle, wideImageUrl } from './library'
import { negotiatePlayback } from './playback'
import { PlaybackSession } from './playbackSession'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 130 })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

const lastItems = () => mock.requests.filter((r) => r.path === '/Items').at(-1)
const lastItemsQuery = () => lastItems()?.query ?? {}
const lastItemsAll = () => lastItems()?.queryAll ?? {}

describe('browsing', () => {
  it('sorts: title ascending by default, others descending, sent to the server', async () => {
    await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 0 })
    expect(lastItemsAll()).toMatchObject({ sortBy: ['SortName'], sortOrder: ['Ascending'] })

    const added = await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 0, sort: 'added', limit: 3 })
    expect(lastItemsAll()).toMatchObject({ sortBy: ['DateCreated', 'SortName'], sortOrder: ['Descending'] })
    expect(added.movies.map((m) => m.id)).toEqual(['m0130', 'm0129', 'm0128'])

    const released = await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 0, sort: 'released', limit: 2 })
    expect(released.movies.every((m) => m.year === 2024)).toBe(true)

    const rated = await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 0, sort: 'rating', limit: 1 })
    expect(lastItemsAll().sortBy).toEqual(['CommunityRating', 'SortName'])
    expect(rated.movies).toHaveLength(1)
  })

  it('filters by genre and by watch state', async () => {
    const action = await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 0, genre: 'Action', limit: 200 })
    expect(lastItemsAll().genres).toEqual(['Action'])
    expect(action.total).toBe(43) // n % 3 === 0 among 1..130

    await setFavorite(session, 'm0005', true)
    const favorites = await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 0, filter: 'favorites' })
    expect(lastItemsAll().filters).toEqual(['IsFavorite'])
    expect(favorites.movies.map((m) => m.id)).toEqual(['m0005'])
    expect(favorites.movies[0]?.favorite).toBe(true)

    await setWatched(session, 'm0006', true)
    expect((await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 0, filter: 'watched' })).movies.map((m) => m.id)).toEqual(['m0006'])
    expect((await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 0, filter: 'unwatched' })).total).toBe(129)
  })

  it('lists genres alphabetically', async () => {
    expect(await getMovieGenres(session, 'lib-movies')).toEqual(['Action', 'Comedy', 'Drama'])
  })

  it('searches by title across libraries and ignores blank terms', async () => {
    const result = await searchMovies(session, ' Movie 07 ')
    expect(lastItemsQuery()).toMatchObject({ searchTerm: 'Movie 07', includeItemTypes: 'Movie' })
    expect(lastItemsQuery().parentId).toBeUndefined()
    expect(result.total).toBe(10)
    expect(result.movies[0]?.name).toBe('Test Movie 070')

    const before = mock.requests.length
    expect(await searchMovies(session, '   ')).toEqual({ movies: [], total: 0 })
    expect(mock.requests.length).toBe(before)
    expect((await searchMovies(session, 'zzz-no-match')).total).toBe(0)
  })

  it('returns recently added movies, newest first', async () => {
    const recent = await getRecentlyAdded(session, 'lib-movies', 4)
    expect(recent.map((m) => m.id)).toEqual(['m0130', 'm0129', 'm0128', 'm0127'])
  })

  it('shows continue watching from stopped playback, most recent first', async () => {
    expect(await getContinueWatching(session)).toEqual([])
    for (const id of ['m0010', 'm0011']) {
      const plan = await negotiatePlayback(session, id, { capabilities })
      const s = new PlaybackSession(session, plan, 0)
      s.playing(0, { paused: false, muted: false, volume: 1 })
      await s.ended(0, { paused: true, muted: false, volume: 1 }) // position unchanged
      s.moved(12)
    }
    // Stop both at 12 s using fresh sessions (stop uses the last trusted position).
    for (const id of ['m0010', 'm0011']) {
      const plan = await negotiatePlayback(session, id, { capabilities })
      const s = new PlaybackSession(session, plan, 12)
      s.playing(12, { paused: false, muted: false, volume: 1 })
      await s.stop({ paused: true, muted: false, volume: 1 })
    }
    const rows = await getContinueWatching(session)
    expect(rows.map((m) => m.id)).toEqual(['m0011', 'm0010'])
    expect(rows[0]?.resumeTicks).toBe(120_000_000)
  })
})

describe('people and surprise', () => {
  it("lists a person's filmography across all libraries", async () => {
    const page = await getMoviePage(session, { personId: 'p1', startIndex: 0, limit: 5, sort: 'released' })
    expect(lastItemsAll().personIds).toEqual(['p1'])
    expect(lastItemsQuery().parentId).toBeUndefined()
    expect(page.movies).toHaveLength(5)
    expect(page.total).toBe(130)
    expect((await getMoviePage(session, { personId: 'nobody', startIndex: 0 })).total).toBe(0)
  })

  it('picks a random unwatched movie, falling back to any movie', async () => {
    const movie = await getRandomMovie(session, 'lib-movies')
    expect(movie?.id).toMatch(/^m\d{4}$/)
    expect(lastItemsAll()).toMatchObject({ sortBy: ['Random'], filters: ['IsUnplayed'], limit: ['1'] })
    // A library that does not exist has nothing to pick from.
    expect(await getRandomMovie(session, 'lib-shows')).toBeNull()
    const queries = mock.requests.filter((r) => r.path === '/Items' && r.queryAll.parentId?.[0] === 'lib-shows')
    expect(queries.at(-1)?.queryAll.filters).toBeUndefined() // second attempt without the unwatched filter
  })
})

describe('movie details', () => {
  it('maps the full item: text, ratings, cast, directors, studios, media info', async () => {
    const d = await getMovieDetails(session, 'm0001')
    expect(d).toMatchObject({
      id: 'm0001',
      name: 'Test Movie 001',
      overview: expect.stringContaining('Overview of test movie 1'),
      tagline: 'Tagline 1',
      genres: ['Drama'],
      officialRating: 'PG-13',
      communityRating: 7.5,
      directors: ['Dee Director'],
      studios: ['Mock Studios'],
      backdropTag: 'bd1',
    })
    expect(d.cast.map((p) => p.name)).toEqual(['Ada Actor', 'Bo Actor'])
    expect(d.cast[0]).toMatchObject({ id: 'p1', role: 'Hero', imageTag: 'ptag' })
    expect(d.media).toMatchObject({ container: 'mp4', width: 1920, resolution: '1080p', videoCodec: 'h264' })
    expect(d.media?.audio.map((a) => a.index)).toEqual([1, 2])
    expect(d.media?.subtitles.map((a) => a.index)).toEqual([3])
  })

  it('reports a missing movie clearly', async () => {
    await expect(getMovieDetails(session, 'm9999')).rejects.toThrow()
  })

  it('lists similar movies', async () => {
    expect((await getSimilarMovies(session, 'm0001')).map((m) => m.id)).toEqual(['m0002', 'm0003', 'm0004'])
  })

  it('toggles watched and favorite on the server and returns the new state', async () => {
    expect(await setFavorite(session, 'm0020', true)).toMatchObject({ favorite: true })
    expect((await getMovieDetails(session, 'm0020')).favorite).toBe(true)
    expect(await setFavorite(session, 'm0020', false)).toMatchObject({ favorite: false })

    expect(await setWatched(session, 'm0021', true)).toMatchObject({ played: true })
    expect((await getMovieDetails(session, 'm0021')).played).toBe(true)
    expect(await setWatched(session, 'm0021', false)).toMatchObject({ played: false, resumeTicks: 0 })
    // They use the documented endpoints with the Authorization header.
    const toggles = mock.requests.filter((r) => /^\/User(Played|Favorite)Items\/m00(20|21)$/.test(r.path))
    expect(toggles.map((r) => r.method)).toEqual(['POST', 'DELETE', 'POST', 'DELETE'])
    expect(toggles.every((r) => r.auth === 'header' && r.status === 200)).toBe(true)
  })
})

describe('cleanTitle', () => {
  it('turns file-name titles into readable ones and leaves real titles alone', () => {
    expect(cleanTitle('Escape.from.Pretoria.2020.1080p.BluRay.x265-RARBG')).toBe('Escape from Pretoria')
    expect(cleanTitle('101.Dalmations.1961.1080p.BluRay.x265-RARBG')).toBe('101 Dalmations')
    expect(cleanTitle('American.Primeval.S01E06')).toBe('American Primeval S01E06')
    expect(cleanTitle('The.Worlds.Fastest.Indian')).toBe('The Worlds Fastest Indian')
    expect(cleanTitle('2001: A Space Odyssey')).toBe('2001: A Space Odyssey')
    expect(cleanTitle('A.C.O.D.')).toBe('A C O D')
    expect(cleanTitle('Mr. Nobody')).toBe('Mr. Nobody')
    expect(cleanTitle('1917')).toBe('1917')
  })
})

describe('helpers', () => {
  it('labels resolutions by width, so letterboxed films are not downgraded', () => {
    expect(resolutionLabel(3840, 1600)).toBe('4K')
    expect(resolutionLabel(1920, 800)).toBe('1080p')
    expect(resolutionLabel(1280, 536)).toBe('720p')
    expect(resolutionLabel(720, 400)).toBe('SD')
    expect(resolutionLabel(undefined, undefined)).toBeUndefined()
  })

  it('builds credential-free image URLs', () => {
    expect(backdropImageUrl('http://h', { id: 'a', backdropTag: 't' })).toBe('http://h/Items/a/Images/Backdrop?fillWidth=1600&quality=90&tag=t')
    expect(backdropImageUrl('http://h', { id: 'a' })).toBeNull()
    expect(personImageUrl('http://h', { id: 'p', imageTag: 't' })).toBe('http://h/Items/p/Images/Primary?fillHeight=160&quality=80&tag=t')
    expect(wideImageUrl('http://h', { id: 'a', imageTag: 'x', backdropTag: 'b' }, 400)).toContain('/Images/Backdrop')
    expect(wideImageUrl('http://h', { id: 'a', imageTag: 'x' }, 400)).toContain('/Images/Primary')
  })
})

describe('home banner lineup', () => {
  const t = (name: string, year = 2020, backdropTag = 'bd') => ({ name, year, backdropTag })

  it('features the newest titles first, then random ones from the whole library', () => {
    const recent = [t('New A'), t('New B'), t('New C')]
    const pool = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => t(`Old ${n}`))
    const lineup = buildLineup(recent, pool, { random: () => 0.4 })
    expect(lineup).toHaveLength(8)
    expect(lineup.slice(0, 2).map((x) => x.name)).toEqual(['New A', 'New B'])
    expect(lineup.slice(2).every((x) => x.name.startsWith('Old'))).toBe(true)
  })

  it('shows a title once even when the library holds several copies of it', () => {
    const recent = [t('Romancham', 2023), t('Romancham', 2023), t('Romancham', 2023)]
    const pool = [t('romancham!', 2023), t('11:14', 2004), t('Anora', 2024), t('11 14', 2004)]
    const names = buildLineup(recent, pool, { random: () => 0.1 }).map((x) => x.name)
    expect(names.filter((n) => /romancham/i.test(n))).toHaveLength(1)
    expect(names.filter((n) => /11/.test(n))).toHaveLength(1)
    expect(names).toContain('Anora')
  })

  it('skips titles without a backdrop, falls back to the new ones for a small library, and handles nothing', () => {
    expect(buildLineup([t('A', 1, ''), t('B')], [t('C', 1, '')]).map((x) => x.name)).toEqual(['B'])
    expect(buildLineup([t('A'), t('B'), t('C'), t('D')], [], { count: 3 }).map((x) => x.name)).toEqual(['A', 'B', 'C'])
    expect(buildLineup([], [])).toEqual([])
  })

  it('is repeatable for a given random source', () => {
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const pool = Array.from({ length: 20 }, (_, i) => t(`Movie ${i}`))
    const first = buildLineup([], pool, { random })
    seed = 7
    expect(buildLineup([], pool, { random })).toEqual(first)
  })
})

describe('featured pool', () => {
  it('asks for unwatched, well-rated titles that have a backdrop, picked at random from the library', async () => {
    const pool = await getFeaturedPool(session, 'movie', 'lib-movies')
    const query = lastItemsAll()
    expect(query).toMatchObject({ sortBy: ['Random'], imageTypes: ['Backdrop'], filters: ['IsUnplayed'], minCommunityRating: ['6'] })
    expect(pool.length).toBeGreaterThanOrEqual(8)
    expect(pool.every((m) => m.backdropTag && m.id.length > 0)).toBe(true)
  })

  it('relaxes the conditions when a small library cannot satisfy them', async () => {
    const small = await startMockJellyfin({ movieCount: 4 })
    try {
      const s = await connect(small.url, 'tester', 'secret')
      const pool = await getFeaturedPool(s, 'movie', 'lib-movies')
      expect(pool.length).toBeGreaterThan(0) // 2 of the 4 movies have a backdrop
      const asked = small.requests.filter((r) => r.path === '/Items')
      expect(asked).toHaveLength(2)
      expect(asked[1]?.queryAll.minCommunityRating).toBeUndefined()
    } finally {
      await small.close()
    }
  })
})

describe('shuffle', () => {
  it('returns every item once, leaves the original alone, and is repeatable with a fixed random source', () => {
    const original = [1, 2, 3, 4, 5]
    const out = shuffle(original, () => 0.3)
    expect([...out].sort()).toEqual(original)
    expect(original).toEqual([1, 2, 3, 4, 5])
    expect(shuffle(original, () => 0.3)).toEqual(out)
    expect(shuffle([], () => 0.5)).toEqual([])
  })
})
