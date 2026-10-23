import { describe, expect, it } from 'vitest'
import { buildStats, lastMonths, monthKey, toWatchedTitle, type WatchedTitle } from './stats'

const at = (y: number, m: number, d = 15) => new Date(y, m - 1, d, 12).getTime()
const title = (over: Partial<WatchedTitle>): WatchedTitle => ({
  id: 'x',
  name: 'X',
  kind: 'movie',
  runtimeSeconds: 7200,
  playCount: 1,
  genres: [],
  ...over,
})

describe('months', () => {
  it('names a month in the local calendar and lists the last twelve, oldest first', () => {
    expect(monthKey(at(2026, 10))).toBe('2026-10')
    const months = lastMonths(at(2026, 2))
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2025-03')
    expect(months[11]).toBe('2026-02')
  })
})

describe('buildStats', () => {
  const now = at(2026, 10, 22)

  it('counts movies and episodes, and the hours (a title counts once per time it was played)', () => {
    const stats = buildStats(
      [
        title({ id: 'a', runtimeSeconds: 7200, playCount: 2 }),
        title({ id: 'b', kind: 'episode', runtimeSeconds: 1800 }),
        title({ id: 'c', kind: 'episode', runtimeSeconds: 1800 }),
      ],
      now,
    )
    expect(stats).toMatchObject({ movies: 1, episodes: 2, hours: 5 })
  })

  it('ranks genres, and fills the months, even those with nothing', () => {
    const stats = buildStats(
      [
        title({ id: 'a', genres: ['Drama', 'Comedy'], lastPlayedAt: at(2026, 10) }),
        title({ id: 'b', genres: ['Drama'], lastPlayedAt: at(2026, 10, 2) }),
        title({ id: 'c', genres: ['Action'], lastPlayedAt: at(2026, 8) }),
        title({ id: 'd', genres: ['Drama'], lastPlayedAt: at(2020, 1) }), // too old for the chart
        title({ id: 'e' }), // no date
      ],
      now,
    )
    expect(stats.topGenres).toEqual([
      { name: 'Drama', count: 3 },
      { name: 'Action', count: 1 },
      { name: 'Comedy', count: 1 },
    ])
    expect(stats.months).toHaveLength(12)
    expect(stats.months.at(-1)).toEqual({ key: '2026-10', count: 2 })
    expect(stats.months.find((m) => m.key === '2026-08')?.count).toBe(1)
    expect(stats.months.find((m) => m.key === '2026-09')?.count).toBe(0)
  })

  it('lists what was played more than once, most often first', () => {
    const stats = buildStats(
      [
        title({ id: 'a', name: 'Alien', playCount: 3 }),
        title({ id: 'b', name: 'Heat', playCount: 1 }),
        title({ id: 'c', name: 'Pilot', kind: 'episode', seriesName: 'Lost', playCount: 5 }),
      ],
      now,
    )
    expect(stats.rewatched).toEqual([
      { id: 'c', name: 'Lost: Pilot', plays: 5 },
      { id: 'a', name: 'Alien', plays: 3 },
    ])
  })

  it('has nothing to say about nothing', () => {
    expect(buildStats([], now)).toMatchObject({ movies: 0, episodes: 0, hours: 0, topGenres: [], rewatched: [] })
  })
})

describe('toWatchedTitle', () => {
  it('reads what the server says, and skips what is not a movie or an episode', () => {
    expect(
      toWatchedTitle({
        Id: 'm1',
        Name: 'Alien',
        Type: 'Movie',
        RunTimeTicks: 7200 * 10_000_000,
        Genres: ['Horror', 'Sci-Fi'],
        UserData: { Key: 'k', PlayCount: 2, LastPlayedDate: '2026-10-01T10:00:00Z', IsFavorite: false, Played: true, PlaybackPositionTicks: 0 },
      }),
    ).toMatchObject({ id: 'm1', kind: 'movie', runtimeSeconds: 7200, playCount: 2, genres: ['Horror', 'Sci-Fi'] })
    expect(toWatchedTitle({ Id: 's1', Name: 'Show', Type: 'Series' })).toBeNull()
    expect(toWatchedTitle({ Name: 'No id', Type: 'Movie' })).toBeNull()
    // A title that is marked watched without a play count still counts once.
    expect(toWatchedTitle({ Id: 'm2', Name: 'B', Type: 'Movie' })?.playCount).toBe(1)
  })
})
