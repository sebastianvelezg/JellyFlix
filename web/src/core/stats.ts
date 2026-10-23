import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { ItemFilter } from '@jellyfin/sdk/lib/generated-client/models/item-filter'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import type { Session } from './jellyfin'
import { TICKS_PER_SECOND } from './ticks'

/**
 * What you have watched, worked out here from what the server already knows (each title's play count and last play date). Nothing
 * is sent anywhere. The numbers are for the titles read: on a very large library that is the latest ones (see `capped`).
 */

export interface WatchedTitle {
  id: string
  name: string
  kind: 'movie' | 'episode'
  /** The series an episode belongs to. */
  seriesName?: string
  runtimeSeconds: number
  playCount: number
  /** When it was last played (milliseconds since the epoch). */
  lastPlayedAt?: number
  genres: string[]
}

export function toWatchedTitle(dto: BaseItemDto): WatchedTitle | null {
  if (!dto.Id || !dto.Name) return null
  const kind = dto.Type === BaseItemKind.Episode ? 'episode' : dto.Type === BaseItemKind.Movie ? 'movie' : null
  if (!kind) return null
  const last = dto.UserData?.LastPlayedDate ? Date.parse(dto.UserData.LastPlayedDate) : NaN
  return {
    id: dto.Id,
    name: dto.Name,
    kind,
    seriesName: dto.SeriesName ?? undefined,
    runtimeSeconds: dto.RunTimeTicks ? dto.RunTimeTicks / TICKS_PER_SECOND : 0,
    playCount: Math.max(1, dto.UserData?.PlayCount ?? 1),
    lastPlayedAt: Number.isFinite(last) ? last : undefined,
    genres: (dto.Genres ?? []).filter((g): g is string => !!g),
  }
}

export interface MonthStat {
  /** "2026-10". */
  key: string
  /** Titles last played that month. */
  count: number
}

export interface WatchStats {
  movies: number
  episodes: number
  /** Time spent, counting a title once for every time it was played. */
  hours: number
  topGenres: Array<{ name: string; count: number }>
  /** The last twelve months, oldest first, with the months nothing was played in. */
  months: MonthStat[]
  /** Titles you have played more than once, the most often first. */
  rewatched: Array<{ id: string; name: string; plays: number }>
}

export const MONTHS_SHOWN = 12

/** "2026-10" for a time, in the local calendar. */
export function monthKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** The keys of the last `count` months up to the one of `now`, oldest first. */
export function lastMonths(now: number, count = MONTHS_SHOWN): string[] {
  const d = new Date(now)
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i -= 1) keys.push(monthKey(new Date(d.getFullYear(), d.getMonth() - i, 1).getTime()))
  return keys
}

/** Pure: the numbers of the stats page. */
export function buildStats(titles: WatchedTitle[], now = Date.now()): WatchStats {
  const genreCounts = new Map<string, number>()
  const perMonth = new Map<string, number>()
  let seconds = 0
  let movies = 0
  let episodes = 0
  for (const title of titles) {
    if (title.kind === 'movie') movies += 1
    else episodes += 1
    seconds += title.runtimeSeconds * title.playCount
    for (const genre of title.genres) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
    if (title.lastPlayedAt !== undefined) perMonth.set(monthKey(title.lastPlayedAt), (perMonth.get(monthKey(title.lastPlayedAt)) ?? 0) + 1)
  }
  return {
    movies,
    episodes,
    hours: Math.round((seconds / 3600) * 10) / 10,
    topGenres: [...genreCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6),
    months: lastMonths(now).map((key) => ({ key, count: perMonth.get(key) ?? 0 })),
    rewatched: titles
      .filter((t) => t.playCount > 1)
      .map((t) => ({ id: t.id, name: t.kind === 'episode' && t.seriesName ? `${t.seriesName}: ${t.name}` : t.name, plays: t.playCount }))
      .sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name))
      .slice(0, 5),
  }
}

export interface WatchedTitles {
  titles: WatchedTitle[]
  /** How many titles there are in all; more than `titles` when only the latest were read. */
  total: number
}

/** Titles read per kind: enough for any normal library, and bounded so a huge one is still quick. */
export const STATS_LIMIT = { movie: 1500, episode: 2500 } as const

/** The titles you have watched, the latest first. */
export async function getWatchedTitles(session: Session): Promise<WatchedTitles> {
  const read = (kind: BaseItemKind, limit: number) =>
    getLibraryApi(session.api).getItems({
      userId: session.userId,
      includeItemTypes: [kind],
      recursive: true,
      filters: [ItemFilter.IsPlayed],
      sortBy: [ItemSortBy.DatePlayed],
      sortOrder: [SortOrder.Descending],
      fields: [ItemFields.Genres],
      limit,
      enableUserData: true,
      enableTotalRecordCount: true,
      enableImages: false,
    })
  const [movies, episodes] = await Promise.all([read(BaseItemKind.Movie, STATS_LIMIT.movie), read(BaseItemKind.Episode, STATS_LIMIT.episode)])
  const titles = [...(movies.data.Items ?? []), ...(episodes.data.Items ?? [])].map(toWatchedTitle).filter((t): t is WatchedTitle => t !== null)
  const total = (movies.data.TotalRecordCount ?? movies.data.Items?.length ?? 0) + (episodes.data.TotalRecordCount ?? episodes.data.Items?.length ?? 0)
  return { titles, total }
}
