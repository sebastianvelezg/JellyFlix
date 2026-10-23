import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type'
import { ItemFilter } from '@jellyfin/sdk/lib/generated-client/models/item-filter'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import type { Session } from './jellyfin'
import {
  buildLineup,
  getFeaturedPool,
  getRandomTitles,
  getRecentTitles,
  shuffle,
  toMovie,
  type Movie,
  type TitleKind,
} from './library'
import { getSimilarMovies } from './details'
import { toEpisode, getEpisodes, getSimilarShows, type Episode } from './shows'

/**
 * What the app's main page is made of. Everything here reads across all of the libraries of a kind (a movie page has
 * one library, but a home page may have several: two movie libraries, or "Series" and "Anime" together).
 */

/**
 * Titles added to the libraries after `sinceMs` (milliseconds since the epoch), newest first: "new since your last visit".
 * A library that cannot be read is skipped.
 */
export async function getAddedSince(session: Session, sinceMs: number, libraryIds: string[], limit = 30): Promise<Movie[]> {
  const settled = await Promise.allSettled(
    libraryIds.map((id) =>
      getLibraryApi(session.api).getItems({
        userId: session.userId,
        parentId: id,
        includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series],
        recursive: true,
        sortBy: [ItemSortBy.DateCreated],
        sortOrder: [SortOrder.Descending],
        fields: [ItemFields.DateCreated],
        limit,
        enableUserData: true,
        enableImages: true,
        imageTypeLimit: 1,
      }),
    ),
  )
  const added: Array<{ at: number; title: Movie }> = []
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const dto of result.value.data.Items ?? []) {
      const at = dto.DateCreated ? Date.parse(dto.DateCreated) : NaN
      const title = toMovie(dto)
      if (title && Number.isFinite(at) && at > sinceMs) added.push({ at, title })
    }
  }
  return added.sort((a, b) => b.at - a.at).slice(0, limit).map((x) => x.title)
}

/** Round-robin merge: the first of each list, then the second of each... Pure. */
export function interleave<T>(lists: T[][]): T[] {
  const merged: T[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) if (i < list.length) merged.push(list[i] as T)
  }
  return merged
}

/**
 * Runs `read` for each library and merges what comes back. A library that fails is skipped, unless every one
 * fails: then the error is raised so it does not look like "nothing here".
 */
async function acrossLibraries<T>(libraryIds: string[], read: (libraryId: string) => Promise<T[]>): Promise<T[]> {
  const settled = await Promise.allSettled(libraryIds.map(read))
  const failed = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed.length > 0 && failed.length === settled.length) throw failed[0]?.reason
  return interleave(settled.map((r) => (r.status === 'fulfilled' ? r.value : [])))
}

/** The newest additions across libraries. */
export function getLatestTitles(session: Session, kind: TitleKind, libraryIds: string[], limit = 16): Promise<Movie[]> {
  return acrossLibraries(libraryIds, (id) => getRecentTitles(session, kind, id, limit)).then((all) => all.slice(0, limit))
}

/** Random titles with a backdrop worth featuring, across libraries. */
export function getHomePool(session: Session, kind: TitleKind, libraryIds: string[]): Promise<Movie[]> {
  return acrossLibraries(libraryIds, (id) => getFeaturedPool(session, kind, id, 20))
}

/**
 * The banner of the main page: movies and series taken in turns, so both are seen. `movies` and `series` are each the
 * newest titles plus a random pool (see {@link buildLineup}); a kind with nothing in it just gives way to the other.
 * Pure; pass `random` to make it repeatable.
 */
export function buildHomeLineup(
  movies: { recent: Movie[]; pool: Movie[] },
  series: { recent: Movie[]; pool: Movie[] },
  { count = 8, random = Math.random }: { count?: number; random?: () => number } = {},
): Movie[] {
  const hasMovies = movies.recent.length + movies.pool.length > 0
  const hasSeries = series.recent.length + series.pool.length > 0
  const seriesShare = hasMovies && hasSeries ? Math.floor(count * 0.4) : hasSeries ? count : 0
  const movieShare = count - seriesShare
  const first = buildLineup(movies.recent, movies.pool, { count: movieShare, newest: 1, random })
  const second = buildLineup(series.recent, series.pool, { count: seriesShare, newest: 1, random })
  return interleave([first, second]).slice(0, count)
}

/**
 * Movies and episodes (and music videos, when the account has a library of them) you stopped half-way, most recently
 * watched first. Each kind is asked for separately and at the same time: on a real server one request for both took
 * several seconds, each alone a fraction of that.
 */
export async function getContinueAll(session: Session, limit = 16, withMusicVideos = false): Promise<Movie[]> {
  const read = async (type: BaseItemKind) => {
    const { data } = await getLibraryApi(session.api).getResumeItems({
      userId: session.userId,
      limit,
      includeItemTypes: [type],
      fields: [ItemFields.PrimaryImageAspectRatio],
      enableUserData: true,
      enableImages: true,
      enableImageTypes: [ImageType.Primary, ImageType.Backdrop],
      imageTypeLimit: 1,
    })
    return (data.Items ?? []).map((dto) => toEpisode(dto) ?? toMovie(dto)).filter((m): m is Movie => m !== null && m.resumeTicks > 0)
  }
  const [movies, episodes, videos] = await Promise.all([
    read(BaseItemKind.Movie),
    read(BaseItemKind.Episode),
    withMusicVideos ? read(BaseItemKind.MusicVideo) : Promise.resolve([]),
  ])
  return newestFirst([...movies, ...episodes, ...videos]).slice(0, limit)
}

/** Most recently played first; titles without a date keep their order after the dated ones. Pure. */
export function newestFirst<T extends Pick<Movie, 'lastPlayedAt'>>(titles: T[]): T[] {
  return titles
    .map((title, index) => ({ title, index }))
    .sort((a, b) => (b.title.lastPlayedAt ?? 0) - (a.title.lastPlayedAt ?? 0) || a.index - b.index)
    .map((entry) => entry.title)
}

/** A random unwatched movie from any of the libraries, or null when there are none. */
export async function getRandomMovieAcross(session: Session, libraryIds: string[], random = Math.random): Promise<Movie | null> {
  for (const libraryId of libraryIds.length ? shuffle(libraryIds, random) : [undefined]) {
    for (const unwatched of [true, false]) {
      const [movie] = await getRandomTitles(session, 'movie', { libraryId, unwatched })
      if (movie) return movie
    }
  }
  return null
}

/** A series you have never started, and the episode to begin with. */
export interface FreshSeries {
  show: Movie
  episode: Episode
}

/** How many random series are tried before giving up (each one needs a look at its first episodes). */
const FRESH_TRIES = 8

/**
 * A random series none of whose episodes you have watched, with its first real episode (not a special), for
 * "start something new". Null when everything picked has been started or has no episodes yet.
 */
export async function getFreshSeries(session: Session, libraryIds: string[], random = Math.random): Promise<FreshSeries | null> {
  for (const libraryId of libraryIds.length ? shuffle(libraryIds, random) : [undefined]) {
    const candidates = await getRandomTitles(session, 'series', { libraryId, unwatched: true, limit: FRESH_TRIES })
    for (const show of candidates) {
      const episodes = (await getEpisodes(session, show.id, { limit: 30 }).catch(() => [])).filter((e) => e.seasonNumber !== 0)
      const first = episodes[0]
      if (first && !episodes.some((e) => e.played || e.resumeTicks > 0)) return { show, episode: first }
    }
  }
  return null
}

/** A row of suggestions: titles like the one you watched last, that you have not seen yourself. */
export interface BecauseYouWatched {
  /** The movie or series the suggestions are based on. */
  seed: Movie
  items: Movie[]
}

/**
 * "Because you watched X": the server's similar-title suggestions for the movie (or series, for an episode) you finished last,
 * without what you have already seen. Null when nothing has been watched yet or there are too few suggestions for a row.
 */
export async function getBecauseYouWatched(session: Session, limit = 16): Promise<BecauseYouWatched | null> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Episode],
    recursive: true,
    filters: [ItemFilter.IsPlayed],
    sortBy: [ItemSortBy.DatePlayed],
    sortOrder: [SortOrder.Descending],
    limit: 1,
    enableImages: true,
    enableImageTypes: [ImageType.Primary, ImageType.Backdrop],
    enableUserData: true,
  })
  const last = data.Items?.[0]
  if (!last) return null
  const episode = toEpisode(last)
  const seed = episode
    ? { id: episode.seriesId, name: episode.seriesName, resumeTicks: 0, played: true, favorite: false, isSeries: true }
    : toMovie(last)
  if (!seed) return null
  const similar = episode ? await getSimilarShows(session, episode.seriesId, limit + 8) : await getSimilarMovies(session, seed.id, limit + 8)
  const items = similar.filter((m) => !m.played && m.id !== seed.id).slice(0, limit)
  return items.length >= 3 ? { seed, items } : null
}
