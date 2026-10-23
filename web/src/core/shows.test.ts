// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as capabilities } from '../../test/fixtures'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import { setFavorite, setWatched } from './details'
import type { Session } from './jellyfin'
import { getLibrarySections, getRecentTitles, getShowPage, getTitleGenres, getRandomTitle, isAnimeLibraryName, searchShows } from './library'
import { negotiatePlayback } from './playback'
import { PlaybackSession } from './playbackSession'
import {
  episodeCode,
  getContinueEpisodes,
  getEpisodes,
  getNextEpisode,
  getNextUp,
  getPlayable,
  getSeasons,
  getSeriesPlayTarget,
  getSimilarShows,
  isEpisode,
  playbackTitle,
  searchEpisodes,
} from './shows'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 5, seriesCount: 4, animeCount: 3 })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

const device = { paused: true, muted: false, volume: 1 }

/** Plays an episode and stops at `seconds` (the mock marks an episode watched when stopped near its end). */
async function watch(id: string, seconds: number) {
  const plan = await negotiatePlayback(session, id, { capabilities })
  const playback = new PlaybackSession(session, plan, seconds)
  playback.playing(seconds, device)
  await playback.stop(device)
}

describe('library sections', () => {
  it('groups TV libraries into series and anime by name, and keeps movies apart', async () => {
    const sections = await getLibrarySections(session)
    expect(sections.movies.map((l) => l.name)).toEqual(['Movies'])
    expect(sections.series.map((l) => l.name)).toEqual(['Shows'])
    expect(sections.anime.map((l) => l.name)).toEqual(['Anime'])
  })

  it('recognises anime by library name but not "Animation"', () => {
    for (const name of ['Anime', 'anime', 'My Anime', 'Animes', 'Animé', 'Anime (Sub)']) expect(isAnimeLibraryName(name)).toBe(true)
    for (const name of ['Animation', 'Animated Movies', 'Shows', 'Cartoons', 'Animals']) expect(isAnimeLibraryName(name)).toBe(false)
  })

  it('shows an empty TV library that has no content yet', async () => {
    const empty = await startMockJellyfin({ movieCount: 1, seriesCount: 0 })
    try {
      const s = await connect(empty.url, 'tester', 'secret')
      expect((await getLibrarySections(s)).series).toHaveLength(1)
      expect(await getShowPage(s, { libraryId: 'lib-shows', startIndex: 0 })).toEqual({ movies: [], total: 0 })
      expect(await getRecentTitles(s, 'series', 'lib-shows')).toEqual([])
      expect(await getNextUp(s)).toEqual([])
    } finally {
      await empty.close()
    }
  })
})

describe('browsing series', () => {
  it('lists only the series of the chosen library, with the unwatched count', async () => {
    const shows = await getShowPage(session, { libraryId: 'lib-shows', startIndex: 0 })
    expect(shows.total).toBe(4)
    expect(shows.movies[0]).toMatchObject({ id: 's0001', name: 'Test Show 001', unwatchedCount: 6, played: false })
    const anime = await getShowPage(session, { libraryId: 'lib-anime', startIndex: 0 })
    expect(anime.movies.map((m) => m.name)).toEqual(['Test Anime 001', 'Test Anime 002', 'Test Anime 003'])
    const types = mock.requests.filter((r) => r.path === '/Items').at(-1)?.queryAll.includeItemTypes
    expect(types).toEqual(['Series'])
  })

  it('sorts, filters by genre and by favourites', async () => {
    const newest = await getShowPage(session, { libraryId: 'lib-shows', startIndex: 0, sort: 'added', limit: 2 })
    expect(newest.movies.map((m) => m.id)).toEqual(['s0004', 's0003'])
    expect((await getShowPage(session, { libraryId: 'lib-shows', startIndex: 0, genre: 'Drama' })).movies.map((m) => m.id)).toEqual(['s0001', 's0004'])
    expect(await getTitleGenres(session, 'series', 'lib-shows')).toEqual(['Action', 'Comedy', 'Drama'])
    await setFavorite(session, 's0002', true)
    expect((await getShowPage(session, { libraryId: 'lib-shows', startIndex: 0, filter: 'favorites' })).movies.map((m) => m.id)).toEqual(['s0002'])
    await setFavorite(session, 's0002', false)
  })

  it('finds series by name, newest series per library, a random series and similar series', async () => {
    expect((await searchShows(session, 'Show 00')).total).toBe(4)
    expect((await searchShows(session, 'anime 002')).movies.map((m) => m.id)).toEqual(['a0002'])
    expect((await getRecentTitles(session, 'series', 'lib-anime')).map((m) => m.id)).toEqual(['a0003', 'a0002', 'a0001'])
    expect((await getRandomTitle(session, 'series', 'lib-shows'))?.id).toMatch(/^s000[1-4]$/)
    expect((await getSimilarShows(session, 's0001')).map((m) => m.id)).toEqual(['s0002', 's0003'])
  })
})

describe('seasons and episodes', () => {
  it('lists seasons, then the episodes of one season in order', async () => {
    const seasons = await getSeasons(session, 's0001')
    expect(seasons).toMatchObject([
      { id: 's0001-season-1', name: 'Season 1', number: 1, episodeCount: 3, unwatchedCount: 3 },
      { id: 's0001-season-2', name: 'Season 2', number: 2 },
    ])
    const episodes = await getEpisodes(session, 's0001', { seasonId: 's0001-season-2' })
    expect(episodes.map((e) => e.id)).toEqual(['s0001-ep-2-1', 's0001-ep-2-2', 's0001-ep-2-3'])
    expect(episodes[0]).toMatchObject({
      name: 'Episode Title 2-1',
      seriesId: 's0001',
      seriesName: 'Test Show 001',
      seasonId: 's0001-season-2',
      seasonNumber: 2,
      episodeNumber: 1,
      overview: 'Overview of episode 2x1.',
      played: false,
    })
  })

  it('formats episode codes and playback titles', () => {
    expect(episodeCode({ seasonNumber: 2, episodeNumber: 5 })).toBe('S2 E5')
    expect(episodeCode({ seasonNumber: 0, episodeNumber: 3 })).toBe('Special 3')
    expect(episodeCode({ episodeNumber: 7 })).toBe('E7')
    expect(episodeCode({})).toBe('')
  })

  it('reads an episode or a movie by id', async () => {
    const episode = await getPlayable(session, 's0001-ep-1-2')
    expect(isEpisode(episode)).toBe(true)
    expect(playbackTitle(episode)).toBe('Test Show 001 · S1 E2 · Episode Title 1-2')
    const movie = await getPlayable(session, 'm0001')
    expect(isEpisode(movie)).toBe(false)
    expect(playbackTitle(movie)).toBe('Test Movie 001')
    await expect(getPlayable(session, 'nope')).rejects.toThrow(/no longer available/)
  })

  it('finds the next episode, across seasons, and none after the last one', async () => {
    const e12 = await getPlayable(session, 's0001-ep-1-2')
    expect((await getNextEpisode(session, e12 as never))?.id).toBe('s0001-ep-1-3')
    const e13 = await getPlayable(session, 's0001-ep-1-3')
    expect((await getNextEpisode(session, e13 as never))?.id).toBe('s0001-ep-2-1')
    const last = await getPlayable(session, 's0001-ep-2-3')
    expect(await getNextEpisode(session, last as never)).toBeNull()
  })

  it('searches episodes by title', async () => {
    const found = await searchEpisodes(session, '2-3')
    expect(found).toHaveLength(7) // one per series (4 shows + 3 anime)
    expect(found.every((e) => e.seasonNumber === 2 && e.episodeNumber === 3)).toBe(true)
    expect(await searchEpisodes(session, '  ')).toEqual([])
  })

  it('can negotiate playback for an episode like for a movie', async () => {
    const plan = await negotiatePlayback(session, 's0002-ep-1-1', { capabilities })
    expect(plan.itemId).toBe('s0002-ep-1-1')
    expect(plan.playMethod).toBe('DirectPlay')
  })
})

describe('next up, continue watching and play target', () => {
  it('has no next up until a series is started, and plays the first episode', async () => {
    expect(await getNextUp(session, { libraryId: 'lib-anime' })).toEqual([])
    expect((await getSeriesPlayTarget(session, 'a0001'))?.id).toBe('a0001-ep-1-1')
  })

  it('moves next up forward as episodes are finished, per library', async () => {
    await watch('a0001-ep-1-1', 29) // finished
    expect((await getNextUp(session, { libraryId: 'lib-anime' })).map((e) => e.id)).toEqual(['a0001-ep-1-2'])
    const query = mock.requests.filter((r) => r.path === '/Shows/NextUp').at(-1)?.query
    expect(query).toMatchObject({ parentId: 'lib-anime', enableResumable: 'false' })
    expect(await getNextUp(session, { libraryId: 'lib-shows' })).toEqual([])
    expect((await getSeriesPlayTarget(session, 'a0001'))?.id).toBe('a0001-ep-1-2')
    // The series shows one episode fewer to watch.
    expect((await getShowPage(session, { libraryId: 'lib-anime', startIndex: 0 })).movies[0]?.unwatchedCount).toBe(5)
  })

  it('lists a half-watched episode under continue watching, not next up, and resumes it from the play target', async () => {
    await watch('a0001-ep-1-2', 12)
    const resume = await getContinueEpisodes(session, { libraryId: 'lib-anime' })
    expect(resume.map((e) => e.id)).toEqual(['a0001-ep-1-2'])
    expect(resume[0]?.resumeTicks).toBe(120_000_000)
    expect(await getContinueEpisodes(session, { libraryId: 'lib-shows' })).toEqual([])
    expect(await getNextUp(session, { libraryId: 'lib-anime' })).toEqual([])
    const target = await getSeriesPlayTarget(session, 'a0001')
    expect(target).toMatchObject({ id: 'a0001-ep-1-2', resumeTicks: 120_000_000 })
  })

  it('orders next up by what you watched last', async () => {
    await watch('s0003-ep-1-1', 29)
    await watch('s0001-ep-1-1', 29)
    expect((await getNextUp(session, { libraryId: 'lib-shows' })).map((e) => e.seriesId)).toEqual(['s0001', 's0003'])
  })
})

describe('marking watched', () => {
  it('marks a whole series (and un-marks it)', async () => {
    await setWatched(session, 's0004', true)
    const [done] = (await getShowPage(session, { libraryId: 'lib-shows', startIndex: 0, filter: 'watched' })).movies
    expect(done).toMatchObject({ id: 's0004', played: true, unwatchedCount: 0 })
    expect((await getSeasons(session, 's0004')).every((s) => s.unwatchedCount === 0)).toBe(true)
    await setWatched(session, 's0004', false)
    expect((await getShowPage(session, { libraryId: 'lib-shows', startIndex: 0, filter: 'watched' })).total).toBe(0)
  })

  it('marks one episode', async () => {
    await setWatched(session, 's0002-ep-1-1', true)
    expect((await getEpisodes(session, 's0002', { seasonId: 's0002-season-1' }))[0]?.played).toBe(true)
    expect((await getSeasons(session, 's0002'))[0]?.unwatchedCount).toBe(2)
  })
})
