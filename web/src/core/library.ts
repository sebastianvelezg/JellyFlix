import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type'
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { ItemFilter } from '@jellyfin/sdk/lib/generated-client/models/item-filter'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { getFilterApi } from '@jellyfin/sdk/lib/utils/api/filter-api'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getUserViewApi } from '@jellyfin/sdk/lib/utils/api/user-view-api'
import { filterQuery, toFacets, type AdvancedFilters, type FilterFacets } from './filters'
import { itemImageUrl } from './images'
import type { Session } from './jellyfin'
import { TICKS_PER_SECOND } from './ticks'

export interface MovieLibrary {
  id: string
  name: string
}

/**
 * What a library is shown as: Jellyfin knows "movies", "tvshows", "music" and "musicvideos"; anime is a TV library named like anime.
 * Books (and audiobooks) are a library of type "Books"; Live TV is the server's one "live TV" view.
 */
export type Section = 'movies' | 'series' | 'anime' | 'musicvideos' | 'books' | 'livetv' | 'music'

/** The sections that list titles in a catalog page: everything except music (which has its own pages). */
export type VideoSection = Exclude<Section, 'music'>

/** The user's libraries, grouped by section. Libraries that are still being scanned are included (they are just empty). */
export type LibrarySections = Record<Section, MovieLibrary[]>

/** Matches "Anime", "Animes", "Animé" but not "Animation" (cartoons stay under Series). */
const ANIME_NAME = /anim[eé]s?(?![a-z])/i

export const isAnimeLibraryName = (name: string): boolean => ANIME_NAME.test(name)

/** The light model used by lists and rows. See `details.ts` for the full movie page model. */
export interface Movie {
  id: string
  name: string
  year?: number
  imageTag?: string
  /** Image tag of the first backdrop, for wide cards. */
  backdropTag?: string
  runtimeTicks?: number
  /** Saved resume position in ticks, 0 when there is none worth resuming. */
  resumeTicks: number
  played: boolean
  favorite: boolean
  /** Your own rating: true you liked it, false you did not, not set when you have not said. */
  liked?: boolean
  /** True for a series (its page lists seasons and episodes instead of playing directly). */
  isSeries?: boolean
  /** Series only: episodes not watched yet. */
  unwatchedCount?: number
  /** When it was last played (ms since the epoch), to order mixed lists such as "Continue watching". */
  lastPlayedAt?: number
  /** True for a music video: it is drawn as a wide card and its artist is shown under the title. */
  musicVideo?: boolean
  /** Music videos: who performs it ("Artist" or "Artist & Artist"). */
  artist?: string
  /** Music videos: the folder (or library) the video is in, so the next video of that folder can follow it. */
  parentId?: string
  /** A book to read, or an audiobook to listen to. */
  book?: 'book' | 'audiobook'
  /** Books: the file's format in lower case ("epub", "pdf", "cbz"), when the server says. */
  format?: string
  /** Books: who wrote it, when the list says (a title page reads it from the credits). */
  author?: string
}

/** The format of a book's file: the container the server reports, or the extension of its path. */
function formatOf(dto: BaseItemDto): string | undefined {
  const container = dto.Container?.split(',')[0]?.trim().toLowerCase()
  if (container) return container
  const extension = /\.([a-z0-9]{2,5})$/i.exec(dto.Path ?? '')?.[1]
  return extension?.toLowerCase()
}

/** Who a music video is by: its artists, joined the way a song's are. */
function artistsOf(dto: BaseItemDto): string | undefined {
  const names = (dto.Artists ?? []).filter((a): a is string => !!a)
  return names.length > 0 ? names.join(', ') : undefined
}

export interface MoviePage {
  movies: Movie[]
  total: number
}

export const PAGE_SIZE = 60

/** Positions under this are treated as "not started" so a stray click doesn't force a resume. */
export const MIN_RESUME_TICKS = 10 * TICKS_PER_SECOND

const RELEASE_MARKER = /^(480p|576p|720p|1080p|2160p|4k|bluray|blu-ray|bdrip|brrip|web|web-dl|webrip|hdrip|dvdrip|hdtv|x264|x265|h264|h265|hevc|remux|proper|repack)/i

/**
 * Library items scanned from badly named files carry the file name as their title
 * ("Escape.from.Pretoria.2020.1080p.BluRay.x265-RARBG"). Show that as "Escape from Pretoria".
 * Titles that already contain spaces or no dots/underscores are left exactly as they are.
 */
export function cleanTitle(name: string): string {
  if (/\s/.test(name) || !/[._]/.test(name)) return name
  const words = name.split(/[._]+/).filter(Boolean)
  const year = words.findIndex((w, i) => i > 0 && /^(19|20)\d{2}$/.test(w))
  const looksLikeRelease = year > 0 && words.slice(year + 1).some((w) => RELEASE_MARKER.test(w))
  return (looksLikeRelease ? words.slice(0, year) : words).join(' ')
}

function toTime(date: string | null | undefined): number | undefined {
  const time = date ? Date.parse(date) : NaN
  return Number.isNaN(time) ? undefined : time
}

export function toMovie(dto: BaseItemDto): Movie | null {
  if (!dto.Id || !dto.Name) return null
  const resume = dto.UserData?.PlaybackPositionTicks ?? 0
  return {
    id: dto.Id,
    name: cleanTitle(dto.Name),
    year: dto.ProductionYear ?? undefined,
    imageTag: dto.ImageTags?.Primary ?? undefined,
    backdropTag: dto.BackdropImageTags?.[0] ?? undefined,
    runtimeTicks: dto.RunTimeTicks ?? undefined,
    resumeTicks: resume >= MIN_RESUME_TICKS ? resume : 0,
    played: dto.UserData?.Played ?? false,
    favorite: dto.UserData?.IsFavorite ?? false,
    liked: dto.UserData?.Likes ?? undefined,
    isSeries: dto.Type === BaseItemKind.Series ? true : undefined,
    unwatchedCount: dto.Type === BaseItemKind.Series ? (dto.UserData?.UnplayedItemCount ?? undefined) : undefined,
    lastPlayedAt: toTime(dto.UserData?.LastPlayedDate),
    ...(dto.Type === BaseItemKind.MusicVideo ? { musicVideo: true, artist: artistsOf(dto), parentId: dto.ParentId ?? undefined } : {}),
    ...(dto.Type === BaseItemKind.Book || dto.Type === BaseItemKind.AudioBook
      ? { book: dto.Type === BaseItemKind.Book ? ('book' as const) : ('audiobook' as const), format: formatOf(dto), author: artistsOf(dto) ?? dto.AlbumArtist ?? undefined }
      : {}),
  }
}

export function toMovies(items: BaseItemDto[] | null | undefined): Movie[] {
  return (items ?? []).map(toMovie).filter((m): m is Movie => m !== null)
}

// ---- browsing -------------------------------------------------------------------------------

export type SortKey = 'title' | 'added' | 'released' | 'rating'
export type WatchFilter = 'all' | 'unwatched' | 'watched' | 'favorites' | 'liked' | 'disliked'

export const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title (A–Z)',
  added: 'Recently added',
  released: 'Release year (newest)',
  rating: 'Rating (highest)',
}

export const FILTER_LABELS: Record<WatchFilter, string> = {
  all: 'All movies',
  unwatched: 'Unwatched',
  watched: 'Watched',
  favorites: 'Favorites',
  liked: 'Liked by me',
  disliked: 'Disliked by me',
}

export interface BrowseOptions {
  /** Omit to search every library (used for a person's filmography). */
  libraryId?: string
  /** Only movies this person (actor, director...) is credited in. */
  personId?: string
  startIndex: number
  limit?: number
  sort?: SortKey
  filter?: WatchFilter
  genre?: string
  /** Decade, minimum rating, age rating, tag and picture quality. */
  advanced?: AdvancedFilters
  /** Only titles that sort from this letter on (the A-Z jump). Meaningful with the title sort. */
  fromLetter?: string
  /** Have the server count every match for `total` (the default). A row that shows no total leaves it out: it is the slow part of a short list. */
  withTotal?: boolean
}

const SORTS: Record<SortKey, { by: ItemSortBy[]; order: SortOrder }> = {
  title: { by: [ItemSortBy.SortName], order: SortOrder.Ascending },
  added: { by: [ItemSortBy.DateCreated, ItemSortBy.SortName], order: SortOrder.Descending },
  released: { by: [ItemSortBy.ProductionYear, ItemSortBy.SortName], order: SortOrder.Descending },
  rating: { by: [ItemSortBy.CommunityRating, ItemSortBy.SortName], order: SortOrder.Descending },
}

const FILTERS: Record<WatchFilter, ItemFilter[] | undefined> = {
  all: undefined,
  unwatched: [ItemFilter.IsUnplayed],
  watched: [ItemFilter.IsPlayed],
  favorites: [ItemFilter.IsFavorite],
  liked: [ItemFilter.Likes],
  disliked: [ItemFilter.Dislikes],
}

export async function getLibrarySections(session: Session): Promise<LibrarySections> {
  const { data } = await getUserViewApi(session.api).getUserViews({ userId: session.userId })
  const sections: LibrarySections = { movies: [], series: [], anime: [], musicvideos: [], books: [], livetv: [], music: [] }
  for (const view of data.Items ?? []) {
    if (!view.Id) continue
    if (view.CollectionType === CollectionType.Movies) sections.movies.push({ id: view.Id, name: view.Name ?? 'Movies' })
    else if (view.CollectionType === CollectionType.Music) sections.music.push({ id: view.Id, name: view.Name ?? 'Music' })
    else if (view.CollectionType === CollectionType.Musicvideos) sections.musicvideos.push({ id: view.Id, name: view.Name ?? 'Music videos' })
    else if (view.CollectionType === CollectionType.Books) sections.books.push({ id: view.Id, name: view.Name ?? 'Books' })
    else if (view.CollectionType === CollectionType.Livetv) sections.livetv.push({ id: view.Id, name: view.Name ?? 'Live TV' })
    else if (view.CollectionType === CollectionType.Tvshows) {
      const name = view.Name ?? 'Series'
      sections[isAnimeLibraryName(name) ? 'anime' : 'series'].push({ id: view.Id, name })
    }
  }
  return sections
}

export async function getMovieLibraries(session: Session): Promise<MovieLibrary[]> {
  return (await getLibrarySections(session)).movies
}

/** What a browse/search call looks for. */
export type TitleKind = 'movie' | 'series' | 'musicvideo' | 'book'
const KIND_TYPES: Record<TitleKind, BaseItemKind[]> = {
  movie: [BaseItemKind.Movie],
  series: [BaseItemKind.Series],
  musicvideo: [BaseItemKind.MusicVideo],
  book: [BaseItemKind.Book, BaseItemKind.AudioBook],
}

/** One page of titles (movies or series). Paged (not "everything") so large libraries stay responsive. */
export async function getTitlePage(session: Session, kind: TitleKind, opts: BrowseOptions): Promise<MoviePage> {
  const sort = SORTS[opts.sort ?? 'title']
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId: opts.libraryId,
    personIds: opts.personId ? [opts.personId] : undefined,
    includeItemTypes: KIND_TYPES[kind],
    recursive: true,
    sortBy: sort.by,
    sortOrder: [sort.order],
    filters: FILTERS[opts.filter ?? 'all'],
    genres: opts.genre ? [opts.genre] : undefined,
    ...filterQuery(opts.advanced ?? {}),
    nameStartsWithOrGreater: opts.fromLetter || undefined,
    startIndex: opts.startIndex,
    limit: opts.limit ?? PAGE_SIZE,
    fields: [ItemFields.PrimaryImageAspectRatio],
    enableUserData: true,
    enableTotalRecordCount: opts.withTotal ?? true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const movies = toMovies(data.Items)
  return { movies, total: data.TotalRecordCount ?? movies.length }
}

export const getMoviePage = (session: Session, opts: BrowseOptions) => getTitlePage(session, 'movie', opts)
export const getShowPage = (session: Session, opts: BrowseOptions) => getTitlePage(session, 'series', opts)

/** Random titles, in no particular order. Omit `libraryId` to draw from every library. */
export async function getRandomTitles(
  session: Session,
  kind: TitleKind,
  opts: { libraryId?: string; unwatched?: boolean; limit?: number } = {},
): Promise<Movie[]> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId: opts.libraryId,
    includeItemTypes: KIND_TYPES[kind],
    recursive: true,
    sortBy: [ItemSortBy.Random],
    filters: opts.unwatched ? [ItemFilter.IsUnplayed] : undefined,
    limit: opts.limit ?? 1,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return toMovies(data.Items)
}

/** A random title for "Surprise me": unwatched if there is any, otherwise any. */
export async function getRandomTitle(session: Session, kind: TitleKind, libraryId?: string): Promise<Movie | null> {
  for (const unwatched of [true, false]) {
    const [movie] = await getRandomTitles(session, kind, { libraryId, unwatched })
    if (movie) return movie
  }
  return null
}

export const getRandomMovie = (session: Session, libraryId: string) => getRandomTitle(session, 'movie', libraryId)

/**
 * Genre names that occur in a library, alphabetical. Read from the query-filters endpoint: on some servers
 * (seen on Jellyfin 12.2) `GET /Genres` returns an empty list even though movies have genres.
 */
export async function getTitleGenres(session: Session, kind: TitleKind, libraryId: string): Promise<string[]> {
  return (await getTitleFilterOptions(session, kind, libraryId)).genres
}

/** What a library can be filtered by: the decades its titles come from, their age ratings and their tags. */
export async function getTitleFacets(session: Session, kind: TitleKind, libraryId: string): Promise<FilterFacets> {
  return (await getTitleFilterOptions(session, kind, libraryId)).facets
}

/**
 * Genres, decades, age ratings and tags of a library from ONE request: the server answers all of them with the same scan of the
 * library (5 s measured on 3,800 movies), so asking twice only doubles the work.
 */
export async function getTitleFilterOptions(session: Session, kind: TitleKind, libraryId: string): Promise<{ genres: string[]; facets: FilterFacets }> {
  const { data } = await getFilterApi(session.api).getQueryFiltersLegacy({
    userId: session.userId,
    parentId: libraryId,
    includeItemTypes: KIND_TYPES[kind],
  })
  return {
    genres: [...new Set((data.Genres ?? []).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b)),
    facets: toFacets(data.Years, data.OfficialRatings, data.Tags),
  }
}

export const getMovieGenres = (session: Session, libraryId: string) => getTitleGenres(session, 'movie', libraryId)

/** Search across all of the user's libraries by title (server-side). */
export async function searchTitles(
  session: Session,
  kind: TitleKind,
  term: string,
  opts: { startIndex?: number; limit?: number } = {},
): Promise<MoviePage> {
  const searchTerm = term.trim()
  if (!searchTerm) return { movies: [], total: 0 }
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    searchTerm,
    includeItemTypes: KIND_TYPES[kind],
    recursive: true,
    sortBy: [ItemSortBy.SortName],
    sortOrder: [SortOrder.Ascending],
    startIndex: opts.startIndex ?? 0,
    limit: opts.limit ?? PAGE_SIZE,
    enableUserData: true,
    enableTotalRecordCount: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const movies = toMovies(data.Items)
  return { movies, total: data.TotalRecordCount ?? movies.length }
}

export const searchMovies = (session: Session, term: string, opts: { startIndex?: number; limit?: number } = {}) =>
  searchTitles(session, 'movie', term, opts)
export const searchShows = (session: Session, term: string, opts: { startIndex?: number; limit?: number } = {}) =>
  searchTitles(session, 'series', term, opts)
export const searchMusicVideos = (session: Session, term: string, opts: { startIndex?: number; limit?: number } = {}) =>
  searchTitles(session, 'musicvideo', term, opts)
export const searchBooks = (session: Session, term: string, opts: { startIndex?: number; limit?: number } = {}) =>
  searchTitles(session, 'book', term, opts)

/** Partially watched movies (or music videos, or audiobooks), most recently watched first (Jellyfin's "Continue Watching"). */
export async function getContinueWatching(session: Session, limit = 12, kind: 'movie' | 'musicvideo' | 'book' = 'movie'): Promise<Movie[]> {
  const { data } = await getLibraryApi(session.api).getResumeItems({
    userId: session.userId,
    limit,
    includeItemTypes: KIND_TYPES[kind],
    enableUserData: true,
    enableImages: true,
    enableImageTypes: [ImageType.Primary, ImageType.Backdrop],
    imageTypeLimit: 1,
  })
  return toMovies(data.Items).filter((m) => m.resumeTicks > 0)
}

/**
 * Newest additions to a library. For series (and music videos) this is a plain list sorted by date added: Jellyfin's
 * "latest" endpoint is built around new episodes and answered with nothing at all for series on a real server.
 */
export async function getRecentTitles(session: Session, kind: TitleKind, libraryId: string, limit = 16): Promise<Movie[]> {
  if (kind !== 'movie') return (await getTitlePage(session, kind, { libraryId, startIndex: 0, limit, sort: 'added', withTotal: false })).movies
  const { data } = await getLibraryApi(session.api).getLatestMedia({
    userId: session.userId,
    parentId: libraryId,
    includeItemTypes: KIND_TYPES[kind],
    limit,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return toMovies(data)
}

export const getRecentlyAdded = (session: Session, libraryId: string, limit = 16) =>
  getRecentTitles(session, 'movie', libraryId, limit)

/** Fresh copy of one movie, so the resume position is current when playback starts. */
export async function getMovie(session: Session, id: string): Promise<Movie> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    ids: [id],
    enableUserData: true,
  })
  const movie = toMovies(data.Items)[0]
  if (!movie) throw new Error('That movie is no longer available.')
  return movie
}

// ---- images ----------------------------------------------------------------------------------

export function posterUrl(
  serverUrl: string,
  movie: Pick<Movie, 'id' | 'imageTag'>,
  width = 300,
): string | null {
  return movie.imageTag ? itemImageUrl(serverUrl, movie.id, 'Primary', { tag: movie.imageTag, width }) : null
}

/** Wide image for "continue watching" cards; falls back to the poster when there is no backdrop. */
export function wideImageUrl(serverUrl: string, movie: Pick<Movie, 'id' | 'imageTag' | 'backdropTag'>, width = 480): string | null {
  if (movie.backdropTag) return itemImageUrl(serverUrl, movie.id, 'Backdrop', { tag: movie.backdropTag, width })
  return posterUrl(serverUrl, movie, width)
}

/** A shuffled copy (Fisher–Yates). Pass `random` to make it repeatable. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
  }
  return copy
}

/** Same title, different file: libraries often hold a movie twice (two qualities, or a stray copy). */
export function titleKey(title: Pick<Movie, 'name' | 'year'>): string {
  return `${title.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}|${title.year ?? ''}`
}

/**
 * Titles worth recommending, picked at random from the whole library rather than only the newest ones: they have a
 * backdrop to show, a decent rating and you have not watched them. If that is too strict for a small library it is
 * relaxed (any rating, watched or not) so there is always something to show.
 */
export async function getFeaturedPool(session: Session, kind: TitleKind, libraryId: string, limit = 30): Promise<Movie[]> {
  const ask = async (strict: boolean) => {
    const { data } = await getLibraryApi(session.api).getItems({
      userId: session.userId,
      parentId: libraryId,
      includeItemTypes: KIND_TYPES[kind],
      recursive: true,
      sortBy: [ItemSortBy.Random],
      imageTypes: [ImageType.Backdrop],
      filters: strict ? [ItemFilter.IsUnplayed] : undefined,
      minCommunityRating: strict ? 6 : undefined,
      limit,
      enableUserData: true,
      enableImages: true,
      imageTypeLimit: 1,
    })
    return toMovies(data.Items).filter((m) => m.backdropTag)
  }
  const strict = await ask(true)
  return strict.length >= 8 ? strict : [...strict, ...(await ask(false))]
}

/**
 * The titles for the home banner: the newest one or two (so what you just added is seen), then random picks from
 * the whole library. Copies of the same title are shown once. Pure; pass `random` to make it repeatable.
 */
export function buildLineup<T extends Pick<Movie, 'name' | 'year' | 'backdropTag'>>(
  recent: T[],
  pool: T[],
  { count = 8, newest = 2, random = Math.random }: { count?: number; newest?: number; random?: () => number } = {},
): T[] {
  const seen = new Set<string>()
  const lineup: T[] = []
  const add = (title: T) => {
    const key = titleKey(title)
    if (lineup.length >= count || seen.has(key) || !title.backdropTag) return
    seen.add(key)
    lineup.push(title)
  }
  for (const title of recent) if (lineup.length < newest) add(title)
  for (const title of shuffle(pool, random)) add(title)
  for (const title of recent) add(title) // a small library: fall back to whatever else is new
  return lineup
}
