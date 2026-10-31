import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info'
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getUserDataApi } from '@jellyfin/sdk/lib/utils/api/user-data-api'
import { itemImageUrl } from './images'
import type { Session } from './jellyfin'
import { toMovie, type Movie } from './library'
import { audioLabel, subtitleLabel, uniqueLabels } from './tracks'

export interface Person {
  id: string
  name: string
  role?: string
  imageTag?: string
}

export interface MediaTrackInfo {
  index: number
  label: string
  language?: string
  codec?: string
  channels?: number
  isDefault: boolean
  /** Subtitles: written as text (the player can show it); a picture-based track cannot be shown. */
  isText?: boolean
}

export interface MediaInfo {
  container?: string
  width?: number
  height?: number
  /** "4K" | "1080p" | "720p" | "SD" */
  resolution?: string
  videoCodec?: string
  /** e.g. "HDR10", "Dolby Vision" when the file says so. */
  videoRange?: string
  bitrate?: number
  sizeBytes?: number
  audio: MediaTrackInfo[]
  subtitles: MediaTrackInfo[]
}

/** A trailer the server knows by its address (almost always a video on YouTube). */
export interface TrailerLink {
  /** Its name, empty when the server gives none (the page then calls it "Trailer"). */
  name: string
  url: string
}

/**
 * The trailers of a title as links, in the server's order: only web addresses (never a script or a file), each once, with its
 * name when the server has one. They open on their own site, in a new tab: the app itself loads nothing from anywhere but your server.
 */
export function trailerLinks(trailers: Array<{ Url?: string | null; Name?: string | null }> | null | undefined): TrailerLink[] {
  const seen = new Set<string>()
  const links: TrailerLink[] = []
  for (const trailer of trailers ?? []) {
    let url: URL
    try {
      url = new URL(trailer.Url ?? '')
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    if (seen.has(url.href)) continue
    seen.add(url.href)
    links.push({ name: trailer.Name?.trim() || '', url: url.href })
  }
  return links
}

/** One version of a title (the same film as 4K and as 1080p, or another edition) with what it holds. */
export interface MediaVersion {
  /** The media source id, which is what the player asks the server for. */
  id: string
  /** How to tell it from the others: "4K HEVC HDR10 · 18.4 GB". */
  label: string
  media: MediaInfo
}

/** Everything the movie page shows. */
export interface MovieDetails extends Movie {
  overview?: string
  tagline?: string
  genres: string[]
  officialRating?: string
  communityRating?: number
  criticRating?: number
  premiereDate?: string
  cast: Person[]
  directors: string[]
  /** Books: who wrote it. */
  authors: string[]
  studios: string[]
  media?: MediaInfo
  /** The trailers the server lists, as links to open. */
  trailers: TrailerLink[]
  /** Every version of the file the server has, in the server's order (only more than one when there are real alternatives). */
  versions: MediaVersion[]
  /** Series only: "Continuing" or "Ended", and how many seasons the server lists. */
  status?: string
  seasonCount?: number
}

/** Marketing resolution name from the frame width (letterboxed films have a short height). */
export function resolutionLabel(width?: number | null, height?: number | null): string | undefined {
  if (!width && !height) return undefined
  const w = width ?? 0
  const h = height ?? 0
  if (w >= 3500 || h >= 2000) return '4K'
  if (w >= 1800 || h >= 1000) return '1080p'
  if (w >= 1200 || h >= 700) return '720p'
  return 'SD'
}

function trackInfo(stream: MediaStream, kind: 'audio' | 'subtitle'): MediaTrackInfo {
  return {
    index: stream.Index ?? 0,
    label: kind === 'audio' ? audioLabel(stream) : subtitleLabel(stream),
    language: stream.Language ?? undefined,
    codec: stream.Codec ?? undefined,
    channels: stream.Channels ?? undefined,
    isDefault: stream.IsDefault ?? false,
    isText: kind === 'subtitle' ? (stream.IsTextSubtitleStream ?? false) : undefined,
  }
}

function toMediaInfo(dto: BaseItemDto, source: MediaSourceInfo | undefined = dto.MediaSources?.[0]): MediaInfo | undefined {
  if (!source) return undefined
  const streams = source.MediaStreams ?? dto.MediaStreams ?? []
  const video = streams.find((s) => s.Type === 'Video')
  return {
    container: source.Container ?? undefined,
    width: video?.Width ?? undefined,
    height: video?.Height ?? undefined,
    resolution: resolutionLabel(video?.Width, video?.Height),
    videoCodec: video?.Codec ?? undefined,
    videoRange: video?.VideoRangeType && video.VideoRangeType !== 'SDR' ? String(video.VideoRangeType) : undefined,
    bitrate: source.Bitrate ?? undefined,
    sizeBytes: source.Size ?? undefined,
    audio: uniqueLabels(streams.filter((s) => s.Type === 'Audio').map((s) => trackInfo(s, 'audio'))),
    subtitles: uniqueLabels(streams.filter((s) => s.Type === 'Subtitle').map((s) => trackInfo(s, 'subtitle'))),
  }
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
function sizeText(bytes?: number): string | undefined {
  if (!bytes || bytes <= 0) return undefined
  const i = Math.min(SIZE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value >= 100 || i < 2 ? Math.round(value) : value.toFixed(1)} ${SIZE_UNITS[i]}`
}

/** The versions a title has, each named by its picture and size ("1080p H264 · 4.2 GB"), or its own name when that is all there is. */
export function toVersions(dto: BaseItemDto): MediaVersion[] {
  const sources = (dto.MediaSources ?? []).filter((s) => s.Id)
  const versions = sources.flatMap((source) => {
    const media = toMediaInfo(dto, source)
    if (!media) return []
    const picture = [media.resolution, media.videoCodec?.toUpperCase(), media.videoRange].filter(Boolean).join(' ')
    const label = [picture || source.Name, sizeText(media.sizeBytes)].filter(Boolean).join(' · ')
    return [{ id: source.Id as string, label: label || (source.Name ?? source.Id) as string, media }]
  })
  // Two versions that read the same get their own names, so a list is never ambiguous.
  const seen = new Map<string, number>()
  return versions.map((v) => {
    const n = (seen.get(v.label) ?? 0) + 1
    seen.set(v.label, n)
    return n === 1 ? v : { ...v, label: `${v.label} (${n})` }
  })
}

export function toMovieDetails(dto: BaseItemDto): MovieDetails | null {
  const base = toMovie(dto)
  if (!base) return null
  const people = dto.People ?? []
  return {
    ...base,
    overview: dto.Overview ?? undefined,
    tagline: dto.Taglines?.[0] ?? undefined,
    genres: dto.Genres ?? [],
    officialRating: dto.OfficialRating ?? undefined,
    communityRating: dto.CommunityRating ?? undefined,
    criticRating: dto.CriticRating ?? undefined,
    premiereDate: dto.PremiereDate ?? undefined,
    cast: people
      .filter((p) => p.Id && p.Name && (p.Type === 'Actor' || p.Type === 'GuestStar'))
      .slice(0, 16)
      .map((p) => ({
        id: p.Id as string,
        name: p.Name as string,
        role: p.Role ?? undefined,
        imageTag: p.PrimaryImageTag ?? undefined,
      })),
    directors: people.filter((p) => p.Type === 'Director' && p.Name).map((p) => p.Name as string),
    authors: people.filter((p) => p.Type === 'Author' && p.Name).map((p) => p.Name as string),
    studios: (dto.Studios ?? []).map((s) => s.Name).filter((n): n is string => !!n),
    media: toMediaInfo(dto),
    versions: toVersions(dto),
    trailers: trailerLinks(dto.RemoteTrailers),
    status: dto.Status ?? undefined,
    seasonCount: dto.Type === 'Series' ? (dto.ChildCount ?? undefined) : undefined,
  }
}

export async function getMovieDetails(session: Session, id: string): Promise<MovieDetails> {
  const { data } = await getLibraryApi(session.api).getItem({ itemId: id, userId: session.userId })
  const details = toMovieDetails(data)
  if (!details) throw new Error('That movie is no longer available.')
  return details
}

/** A series page uses the same model as a movie page (cast, genres, rating); it just has no media file of its own. */
export const getShowDetails = getMovieDetails

/** "More like this": the server's similar-movie suggestions. */
export async function getSimilarMovies(session: Session, id: string, limit = 12): Promise<Movie[]> {
  const { data } = await getLibraryApi(session.api).getSimilarMovies({ itemId: id, userId: session.userId, limit })
  return (data.Items ?? []).map(toMovie).filter((m): m is Movie => m !== null)
}

export function personImageUrl(serverUrl: string, person: Pick<Person, 'id' | 'imageTag'>, size = 160): string | null {
  return person.imageTag ? itemImageUrl(serverUrl, person.id, 'Primary', { tag: person.imageTag, height: size }) : null
}

export function backdropImageUrl(serverUrl: string, movie: Pick<Movie, 'id' | 'backdropTag'>, width = 1600): string | null {
  return movie.backdropTag ? itemImageUrl(serverUrl, movie.id, 'Backdrop', { tag: movie.backdropTag, width }) : null
}

// ---- user actions -----------------------------------------------------------------------------

/** What the server now says about this user's relationship with the movie. */
export interface UserState {
  played: boolean
  favorite: boolean
  resumeTicks: number
}

export async function setWatched(session: Session, id: string, watched: boolean): Promise<UserState> {
  const api = getUserDataApi(session.api)
  const { data } = watched
    ? await api.markPlayedItem({ itemId: id, userId: session.userId })
    : await api.markUnplayedItem({ itemId: id, userId: session.userId })
  return { played: data.Played ?? watched, favorite: data.IsFavorite ?? false, resumeTicks: data.PlaybackPositionTicks ?? 0 }
}

/** Says you liked a title (true), did not (false), or takes it back (null). Returns what the server now has. */
export async function setRating(session: Session, id: string, liked: boolean | null): Promise<boolean | null> {
  const api = getUserDataApi(session.api)
  const { data } =
    liked === null
      ? await api.deleteUserItemRating({ itemId: id, userId: session.userId })
      : await api.updateUserItemRating({ itemId: id, userId: session.userId, likes: liked })
  return data.Likes ?? null
}

export async function setFavorite(session: Session, id: string, favorite: boolean): Promise<UserState> {
  const api = getUserDataApi(session.api)
  const { data } = favorite
    ? await api.markFavoriteItem({ itemId: id, userId: session.userId })
    : await api.unmarkFavoriteItem({ itemId: id, userId: session.userId })
  return { played: data.Played ?? false, favorite: data.IsFavorite ?? favorite, resumeTicks: data.PlaybackPositionTicks ?? 0 }
}
