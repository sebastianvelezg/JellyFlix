import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
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
  }
}

function toMediaInfo(dto: BaseItemDto): MediaInfo | undefined {
  const source = dto.MediaSources?.[0]
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

export async function setFavorite(session: Session, id: string, favorite: boolean): Promise<UserState> {
  const api = getUserDataApi(session.api)
  const { data } = favorite
    ? await api.markFavoriteItem({ itemId: id, userId: session.userId })
    : await api.unmarkFavoriteItem({ itemId: id, userId: session.userId })
  return { played: data.Played ?? false, favorite: data.IsFavorite ?? favorite, resumeTicks: data.PlaybackPositionTicks ?? 0 }
}
