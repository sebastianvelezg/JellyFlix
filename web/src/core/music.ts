import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { ItemFilter } from '@jellyfin/sdk/lib/generated-client/models/item-filter'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { getArtistApi } from '@jellyfin/sdk/lib/utils/api/artist-api'
import { getFilterApi } from '@jellyfin/sdk/lib/utils/api/filter-api'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getPlaylistApi } from '@jellyfin/sdk/lib/utils/api/playlist-api'
import { itemImageUrl } from './images'
import type { Session } from './jellyfin'
import { PAGE_SIZE } from './library'

// ---- models -------------------------------------------------------------------------------------------

/** What untagged music is credited to. */
export const UNKNOWN_ARTIST = 'Unknown artist'

export interface Album {
  id: string
  name: string
  /** Album artist, as shown on a card ("Various Artists" for compilations). */
  artist: string
  artistId?: string
  year?: number
  imageTag?: string
  trackCount?: number
  runtimeTicks?: number
  genres: string[]
  favorite: boolean
}

export interface Artist {
  id: string
  name: string
  imageTag?: string
  backdropTag?: string
  overview?: string
  genres: string[]
  favorite: boolean
}

export interface Track {
  id: string
  name: string
  /** All credited artists, joined ("Daft Punk, Pharrell Williams"). */
  artist: string
  artistId?: string
  albumId?: string
  album: string
  albumArtist?: string
  trackNumber?: number
  discNumber?: number
  runtimeTicks?: number
  /** The track's own picture, if it has one; usually the cover is its album's. */
  imageTag?: string
  albumImageTag?: string
  favorite: boolean
  playCount: number
}

export interface Playlist {
  id: string
  name: string
  imageTag?: string
  trackCount?: number
  runtimeTicks?: number
}

export interface Page<T> {
  items: T[]
  total: number
}

/** "(1974) - Kiss - Hotter Than Hell [24Bit-96kHz]": what a folder name looks like when the files carry no tags. */
const FOLDER_NAME = /^\((\d{4})\)\s*-\s*(.+?)\s+-\s+(.+)$/

/** "Nelly - Sweatsuit": artist and album separated by a dash. */
const ARTIST_DASH_ALBUM = /^(.+?)\s+-\s+(.+)$/

/**
 * Albums scanned from untagged files take the folder name as their title and have no artist or year. When the
 * name follows the common "(year) - artist - album" or "artist - album" pattern, show those parts properly.
 */
export function cleanAlbumName(name: string): { name: string; artist?: string; year?: number } {
  const m = FOLDER_NAME.exec(name)
  if (m) return { year: Number(m[1]), artist: m[2], name: m[3] as string }
  const plain = ARTIST_DASH_ALBUM.exec(name)
  return plain ? { artist: plain[1], name: plain[2] as string } : { name }
}

/** A song title that still starts with its track number ("01. Got To Choose") when the file has no tags. */
export function cleanTrackName(name: string): { name: string; number?: number } {
  const m = /^(\d{1,3})\s*[.\-)]\s+(\S.*)$/.exec(name)
  return m ? { number: Number(m[1]), name: m[2] as string } : { name }
}

export function toAlbum(dto: BaseItemDto): Album | null {
  if (!dto.Id || !dto.Name) return null
  const tagged = !!(dto.AlbumArtist || dto.Artists?.[0])
  const parsed = tagged ? { name: dto.Name } : cleanAlbumName(dto.Name)
  return {
    id: dto.Id,
    name: parsed.name,
    artist: dto.AlbumArtist || dto.Artists?.[0] || parsed.artist || UNKNOWN_ARTIST,
    artistId: dto.AlbumArtists?.[0]?.Id ?? dto.ArtistItems?.[0]?.Id ?? undefined,
    year: dto.ProductionYear ?? ('year' in parsed ? parsed.year : undefined),
    imageTag: dto.ImageTags?.Primary ?? undefined,
    trackCount: dto.ChildCount ?? dto.SongCount ?? undefined,
    runtimeTicks: dto.RunTimeTicks ?? undefined,
    genres: dto.Genres ?? [],
    favorite: dto.UserData?.IsFavorite ?? false,
  }
}

export function toArtist(dto: BaseItemDto): Artist | null {
  if (!dto.Id || !dto.Name) return null
  return {
    id: dto.Id,
    name: dto.Name,
    imageTag: dto.ImageTags?.Primary ?? undefined,
    backdropTag: dto.BackdropImageTags?.[0] ?? undefined,
    overview: dto.Overview ?? undefined,
    genres: dto.Genres ?? [],
    favorite: dto.UserData?.IsFavorite ?? false,
  }
}

export function toTrack(dto: BaseItemDto): Track | null {
  if (!dto.Id || !dto.Name) return null
  const parsed = dto.IndexNumber == null ? cleanTrackName(dto.Name) : { name: dto.Name }
  return {
    id: dto.Id,
    name: parsed.name,
    artist: dto.Artists?.length ? dto.Artists.join(', ') : dto.AlbumArtist || UNKNOWN_ARTIST,
    artistId: dto.ArtistItems?.[0]?.Id ?? undefined,
    albumId: dto.AlbumId ?? undefined,
    album: dto.Album ?? '',
    albumArtist: dto.AlbumArtist ?? undefined,
    trackNumber: dto.IndexNumber ?? ('number' in parsed ? parsed.number : undefined),
    discNumber: dto.ParentIndexNumber ?? undefined,
    runtimeTicks: dto.RunTimeTicks ?? undefined,
    imageTag: dto.ImageTags?.Primary ?? undefined,
    albumImageTag: dto.AlbumPrimaryImageTag ?? undefined,
    favorite: dto.UserData?.IsFavorite ?? false,
    playCount: dto.UserData?.PlayCount ?? 0,
  }
}

const list = <T>(items: BaseItemDto[] | null | undefined, map: (dto: BaseItemDto) => T | null): T[] =>
  (items ?? []).map(map).filter((x): x is T => x !== null)

/** Albums that tracks belong to, once each, in the order they first appear. */
export function albumsOfTracks(tracks: Track[]): Album[] {
  const seen = new Set<string>()
  const albums: Album[] = []
  for (const t of tracks) {
    if (!t.albumId || seen.has(t.albumId)) continue
    seen.add(t.albumId)
    albums.push({
      id: t.albumId,
      name: t.album || 'Unknown album',
      artist: t.albumArtist ?? t.artist,
      imageTag: t.albumImageTag,
      genres: [],
      favorite: false,
    })
  }
  return albums
}

// ---- images -------------------------------------------------------------------------------------------

/** Square cover for an album, artist, playlist or track (a track shows its album's cover unless it has its own). */
export function coverUrl(
  serverUrl: string,
  item: { id: string; imageTag?: string; albumId?: string; albumImageTag?: string },
  width = 300,
): string | null {
  if (item.imageTag) return itemImageUrl(serverUrl, item.id, 'Primary', { tag: item.imageTag, width })
  if (item.albumId && item.albumImageTag) return itemImageUrl(serverUrl, item.albumId, 'Primary', { tag: item.albumImageTag, width })
  return null
}

// ---- browsing -----------------------------------------------------------------------------------------

export type AlbumSort = 'name' | 'artist' | 'added' | 'year'
export type TrackSort = 'name' | 'artist' | 'album' | 'added' | 'played'
export type ArtistSort = 'name' | 'added'
export type MusicFilter = 'all' | 'favorites'

export const ALBUM_SORT_LABELS: Record<AlbumSort, string> = {
  name: 'Title (A–Z)',
  artist: 'Artist (A–Z)',
  added: 'Recently added',
  year: 'Release year (newest)',
}
export const TRACK_SORT_LABELS: Record<TrackSort, string> = {
  name: 'Title (A–Z)',
  artist: 'Artist (A–Z)',
  album: 'Album (A–Z)',
  added: 'Recently added',
  played: 'Most played',
}
export const ARTIST_SORT_LABELS: Record<ArtistSort, string> = { name: 'Name (A–Z)', added: 'Recently added' }

const ALBUM_SORTS: Record<AlbumSort, { by: ItemSortBy[]; order: SortOrder }> = {
  name: { by: [ItemSortBy.SortName], order: SortOrder.Ascending },
  artist: { by: [ItemSortBy.AlbumArtist, ItemSortBy.SortName], order: SortOrder.Ascending },
  added: { by: [ItemSortBy.DateCreated, ItemSortBy.SortName], order: SortOrder.Descending },
  year: { by: [ItemSortBy.ProductionYear, ItemSortBy.SortName], order: SortOrder.Descending },
}
const TRACK_SORTS: Record<TrackSort, { by: ItemSortBy[]; order: SortOrder }> = {
  name: { by: [ItemSortBy.SortName], order: SortOrder.Ascending },
  artist: { by: [ItemSortBy.Artist, ItemSortBy.Album, ItemSortBy.SortName], order: SortOrder.Ascending },
  album: { by: [ItemSortBy.Album, ItemSortBy.ParentIndexNumber, ItemSortBy.IndexNumber], order: SortOrder.Ascending },
  added: { by: [ItemSortBy.DateCreated, ItemSortBy.SortName], order: SortOrder.Descending },
  played: { by: [ItemSortBy.PlayCount, ItemSortBy.SortName], order: SortOrder.Descending },
}

const LIST_FIELDS = [ItemFields.Genres]
const favoriteOnly = (filter: MusicFilter | undefined) => (filter === 'favorites' ? [ItemFilter.IsFavorite] : undefined)

/** A small set of common options shared by every list: which library (all music if omitted) and where to start. */
interface PageOptions {
  libraryId?: string
  startIndex: number
  limit?: number
  /** Have the server count every match for `total` (the default). Later pages of a list and rows that show no total leave it out: counting is the slow part. */
  withTotal?: boolean
}

export async function getAlbumPage(
  session: Session,
  opts: PageOptions & { artistId?: string; sort?: AlbumSort; filter?: MusicFilter; genre?: string },
): Promise<Page<Album>> {
  const sort = ALBUM_SORTS[opts.sort ?? 'name']
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId: opts.libraryId,
    includeItemTypes: [BaseItemKind.MusicAlbum],
    recursive: true,
    albumArtistIds: opts.artistId ? [opts.artistId] : undefined,
    genres: opts.genre ? [opts.genre] : undefined,
    filters: favoriteOnly(opts.filter),
    sortBy: sort.by,
    sortOrder: [sort.order],
    startIndex: opts.startIndex,
    limit: opts.limit ?? PAGE_SIZE,
    fields: LIST_FIELDS,
    enableUserData: true,
    enableTotalRecordCount: opts.withTotal ?? true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const items = list(data.Items, toAlbum)
  return { items, total: data.TotalRecordCount ?? items.length }
}

/** Album artists (people who have an album of their own), not every name that ever featured on a song. */
export async function getArtistPage(
  session: Session,
  opts: PageOptions & { sort?: ArtistSort; filter?: MusicFilter; search?: string },
): Promise<Page<Artist>> {
  const added = opts.sort === 'added'
  const { data } = await getArtistApi(session.api).getAlbumArtists({
    userId: session.userId,
    parentId: opts.libraryId,
    searchTerm: opts.search?.trim() || undefined,
    isFavorite: opts.filter === 'favorites' ? true : undefined,
    sortBy: added ? [ItemSortBy.DateCreated, ItemSortBy.SortName] : [ItemSortBy.SortName],
    sortOrder: [added ? SortOrder.Descending : SortOrder.Ascending],
    startIndex: opts.startIndex,
    limit: opts.limit ?? PAGE_SIZE,
    enableUserData: true,
    enableTotalRecordCount: opts.withTotal ?? true,
    enableImages: true,
    imageTypeLimit: 1,
    enableImageTypes: [ImageType.Primary],
  })
  const items = list(data.Items, toArtist)
  return { items, total: data.TotalRecordCount ?? items.length }
}

export async function getTrackPage(
  session: Session,
  opts: PageOptions & { artistId?: string; sort?: TrackSort; filter?: MusicFilter; search?: string; genre?: string },
): Promise<Page<Track>> {
  const sort = TRACK_SORTS[opts.sort ?? 'name']
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId: opts.libraryId,
    includeItemTypes: [BaseItemKind.Audio],
    recursive: true,
    artistIds: opts.artistId ? [opts.artistId] : undefined,
    searchTerm: opts.search?.trim() || undefined,
    genres: opts.genre ? [opts.genre] : undefined,
    filters: favoriteOnly(opts.filter),
    sortBy: sort.by,
    sortOrder: [sort.order],
    startIndex: opts.startIndex,
    limit: opts.limit ?? PAGE_SIZE,
    enableUserData: true,
    enableTotalRecordCount: opts.withTotal ?? true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const items = list(data.Items, toTrack)
  return { items, total: data.TotalRecordCount ?? items.length }
}

/** Genres of the albums in the library, alphabetical (from the query-filters endpoint, which works where `/Genres` is empty). */
export async function getMusicGenres(session: Session, libraryId?: string): Promise<string[]> {
  const { data } = await getFilterApi(session.api).getQueryFiltersLegacy({
    userId: session.userId,
    parentId: libraryId,
    includeItemTypes: [BaseItemKind.MusicAlbum],
  })
  return [...new Set((data.Genres ?? []).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b))
}

// ---- details --------------------------------------------------------------------------------------------

export async function getAlbum(session: Session, id: string): Promise<Album> {
  const { data } = await getLibraryApi(session.api).getItem({ itemId: id, userId: session.userId })
  const album = toAlbum(data)
  if (!album) throw new Error('That album is no longer available.')
  return album
}

/** Every track of an album, in disc and track order. */
export async function getAlbumTracks(session: Session, albumId: string): Promise<Track[]> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId: albumId,
    includeItemTypes: [BaseItemKind.Audio],
    sortBy: [ItemSortBy.ParentIndexNumber, ItemSortBy.IndexNumber, ItemSortBy.SortName],
    sortOrder: [SortOrder.Ascending],
    limit: 1000,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return list(data.Items, toTrack)
}

export async function getArtist(session: Session, id: string): Promise<Artist> {
  const { data } = await getLibraryApi(session.api).getItem({ itemId: id, userId: session.userId })
  const artist = toArtist(data)
  if (!artist) throw new Error('That artist is no longer available.')
  return artist
}

/** An artist's most played songs (falls back to alphabetical for songs never played). */
export async function getPopularTracks(session: Session, opts: { artistId?: string; libraryId?: string; limit?: number }): Promise<Track[]> {
  return (await getTrackPage(session, { startIndex: 0, limit: opts.limit ?? 10, sort: 'played', ...opts })).items
}

// ---- home rows ----------------------------------------------------------------------------------------------

export async function getRecentAlbums(session: Session, libraryId: string | undefined, limit = 16): Promise<Album[]> {
  return (await getAlbumPage(session, { libraryId, startIndex: 0, limit, sort: 'added' })).items
}

/** Random albums to try ("Discover"). */
export async function getRandomAlbums(session: Session, libraryId: string | undefined, limit = 16): Promise<Album[]> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId: libraryId,
    includeItemTypes: [BaseItemKind.MusicAlbum],
    recursive: true,
    sortBy: [ItemSortBy.Random],
    limit,
    fields: LIST_FIELDS,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return list(data.Items, toAlbum)
}

/** What you played last, newest first. */
export async function getRecentlyPlayedTracks(session: Session, libraryId: string | undefined, limit = 30): Promise<Track[]> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId: libraryId,
    includeItemTypes: [BaseItemKind.Audio],
    recursive: true,
    filters: [ItemFilter.IsPlayed],
    sortBy: [ItemSortBy.DatePlayed],
    sortOrder: [SortOrder.Descending],
    limit,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return list(data.Items, toTrack)
}

export async function getFavoriteTracks(session: Session, libraryId: string | undefined, limit = 100): Promise<Track[]> {
  return (await getTrackPage(session, { libraryId, startIndex: 0, limit, filter: 'favorites', sort: 'added' })).items
}

/** A mix of songs for "Shuffle everything". */
export async function getRandomTracks(session: Session, libraryId: string | undefined, limit = 50): Promise<Track[]> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId: libraryId,
    includeItemTypes: [BaseItemKind.Audio],
    recursive: true,
    sortBy: [ItemSortBy.Random],
    limit,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return list(data.Items, toTrack)
}

// ---- playlists ----------------------------------------------------------------------------------------------

/** Playlists of songs (video playlists are left out). They live outside the music library. */
export async function getPlaylists(session: Session): Promise<Playlist[]> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    includeItemTypes: [BaseItemKind.Playlist],
    mediaTypes: ['Audio'],
    recursive: true,
    sortBy: [ItemSortBy.SortName],
    sortOrder: [SortOrder.Ascending],
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return list(data.Items, (dto): Playlist | null =>
    dto.Id && dto.Name
      ? {
          id: dto.Id,
          name: dto.Name,
          imageTag: dto.ImageTags?.Primary ?? undefined,
          trackCount: dto.ChildCount ?? undefined,
          runtimeTicks: dto.RunTimeTicks ?? undefined,
        }
      : null,
  )
}

export async function getPlaylist(session: Session, id: string): Promise<Playlist> {
  const { data } = await getLibraryApi(session.api).getItem({ itemId: id, userId: session.userId })
  if (!data.Id || !data.Name) throw new Error('That playlist is no longer available.')
  return {
    id: data.Id,
    name: data.Name,
    imageTag: data.ImageTags?.Primary ?? undefined,
    trackCount: data.ChildCount ?? undefined,
    runtimeTicks: data.RunTimeTicks ?? undefined,
  }
}

export async function getPlaylistTracks(session: Session, playlistId: string): Promise<Track[]> {
  const { data } = await getPlaylistApi(session.api).getPlaylistItems({
    playlistId,
    userId: session.userId,
    limit: 1000,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return list(data.Items, toTrack)
}

// ---- search ---------------------------------------------------------------------------------------------------

export interface MusicSearchResults {
  albums: Album[]
  artists: Artist[]
  tracks: Track[]
}

/** Albums, artists and songs matching the text, a handful of each. */
export async function searchMusic(session: Session, term: string, limit = 12): Promise<MusicSearchResults> {
  const searchTerm = term.trim()
  if (!searchTerm) return { albums: [], artists: [], tracks: [] }
  const items = (kind: BaseItemKind) =>
    getLibraryApi(session.api).getItems({
      userId: session.userId,
      searchTerm,
      includeItemTypes: [kind],
      recursive: true,
      limit,
      enableUserData: true,
      enableImages: true,
      imageTypeLimit: 1,
    })
  const [albums, artists, tracks] = await Promise.all([
    items(BaseItemKind.MusicAlbum).then((r) => list(r.data.Items, toAlbum)),
    getArtistPage(session, { startIndex: 0, limit, search: searchTerm }).then((r) => r.items),
    items(BaseItemKind.Audio).then((r) => list(r.data.Items, toTrack)),
  ])
  return { albums, artists, tracks }
}

/** Total play time of some tracks, in ticks. */
export function totalTicks(tracks: Array<Pick<Track, 'runtimeTicks'>>): number {
  return tracks.reduce((sum, t) => sum + (t.runtimeTicks ?? 0), 0)
}
