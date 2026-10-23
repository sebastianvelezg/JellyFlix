import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getShowApi } from '@jellyfin/sdk/lib/utils/api/show-api'
import type { Session } from './jellyfin'
import { toMovie, type Movie } from './library'

/** One episode. It is also a `Movie` (same list/player fields), so anything that plays or lists movies handles it. */
export interface Episode extends Movie {
  seriesId: string
  seriesName: string
  seasonId?: string
  seasonName?: string
  /** 0 is Jellyfin's "Specials" season. */
  seasonNumber?: number
  episodeNumber?: number
  overview?: string
}

export interface Season {
  id: string
  name: string
  number?: number
  imageTag?: string
  episodeCount?: number
  unwatchedCount?: number
}

/** Fields episode lists need beyond the defaults (the description, and the still's aspect ratio). */
const EPISODE_FIELDS = [ItemFields.Overview, ItemFields.PrimaryImageAspectRatio]

export function isEpisode(item: Movie): item is Episode {
  return 'seriesId' in item
}

export function toEpisode(dto: BaseItemDto): Episode | null {
  const base = toMovie(dto)
  if (!base || dto.Type !== BaseItemKind.Episode || !dto.SeriesId) return null
  return {
    ...base,
    seriesId: dto.SeriesId,
    seriesName: dto.SeriesName ?? '',
    seasonId: dto.SeasonId ?? undefined,
    seasonName: dto.SeasonName ?? undefined,
    seasonNumber: dto.ParentIndexNumber ?? undefined,
    episodeNumber: dto.IndexNumber ?? undefined,
    overview: dto.Overview ?? undefined,
  }
}

function toEpisodes(items: BaseItemDto[] | null | undefined): Episode[] {
  return (items ?? []).map(toEpisode).filter((e): e is Episode => e !== null)
}

/** "S2 E5", "Special 3", "E5" — whatever the numbering allows. */
export function episodeCode(episode: Pick<Episode, 'seasonNumber' | 'episodeNumber'>): string {
  const { seasonNumber: season, episodeNumber: number } = episode
  if (season === 0) return number != null ? `Special ${number}` : 'Special'
  const parts = [season != null ? `S${season}` : '', number != null ? `E${number}` : '']
  return parts.filter(Boolean).join(' ')
}

/** The title shown while playing: movies by name, episodes as "Series · S2 E5 · Episode name". */
export function playbackTitle(item: Movie): string {
  if (!isEpisode(item)) return item.name
  return [item.seriesName, episodeCode(item), item.name].filter(Boolean).join(' · ')
}

// ---- reading -----------------------------------------------------------------------------------

/** Fresh copy of one playable item (a movie or an episode), so the resume position is current. */
export async function getPlayable(session: Session, id: string): Promise<Movie | Episode> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    ids: [id],
    fields: EPISODE_FIELDS,
    enableUserData: true,
  })
  const dto = data.Items?.[0]
  const item = dto ? (toEpisode(dto) ?? toMovie(dto)) : null
  if (!item) throw new Error('That title is no longer available.')
  return item
}

export async function getSeasons(session: Session, seriesId: string): Promise<Season[]> {
  const { data } = await getShowApi(session.api).getSeasons({
    seriesId,
    userId: session.userId,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return (data.Items ?? [])
    .filter((s) => s.Id)
    .map((s) => ({
      id: s.Id as string,
      name: s.Name ?? (s.IndexNumber === 0 ? 'Specials' : `Season ${s.IndexNumber ?? ''}`.trim()),
      number: s.IndexNumber ?? undefined,
      imageTag: s.ImageTags?.Primary ?? undefined,
      episodeCount: s.ChildCount ?? undefined,
      unwatchedCount: s.UserData?.UnplayedItemCount ?? undefined,
    }))
}

export interface EpisodeQuery {
  seasonId?: string
  /** Start the list at this episode (inclusive), continuing into the following seasons. */
  startItemId?: string
  limit?: number
}

export async function getEpisodes(session: Session, seriesId: string, query: EpisodeQuery = {}): Promise<Episode[]> {
  const { data } = await getShowApi(session.api).getEpisodes({
    seriesId,
    userId: session.userId,
    seasonId: query.seasonId,
    startItemId: query.startItemId,
    limit: query.limit,
    fields: EPISODE_FIELDS,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return toEpisodes(data.Items)
}

/** The episode that follows `episode` (also across seasons), or null at the end of the series. */
export async function getNextEpisode(session: Session, episode: Episode): Promise<Episode | null> {
  const [first, second] = await getEpisodes(session, episode.seriesId, { startItemId: episode.id, limit: 2 })
  return first?.id === episode.id ? (second ?? null) : null
}

export interface NextUpQuery {
  /** Only series in this library. */
  libraryId?: string
  /** Only this series. */
  seriesId?: string
  limit?: number
  /** Include episodes that are already partly watched (they are also in "Continue watching"). */
  includeInProgress?: boolean
}

/** "Next up": for each series you have started, the next episode you have not watched. */
export async function getNextUp(session: Session, query: NextUpQuery = {}): Promise<Episode[]> {
  const { data } = await getShowApi(session.api).getNextUp({
    userId: session.userId,
    parentId: query.libraryId,
    seriesId: query.seriesId,
    limit: query.limit ?? 16,
    fields: EPISODE_FIELDS,
    enableResumable: query.includeInProgress ?? false,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return toEpisodes(data.Items)
}

/** An episode that has not aired yet (or just did), with when it airs. */
export interface UpcomingEpisode extends Episode {
  /** When it airs, in milliseconds since the epoch. */
  airsAt?: number
}

/** Episodes of the series you follow that are about to air, soonest first. A server with nothing scheduled answers with an empty list. */
export async function getUpcomingEpisodes(session: Session, query: { libraryId?: string; limit?: number } = {}): Promise<UpcomingEpisode[]> {
  const { data } = await getShowApi(session.api).getUpcomingEpisodes({
    userId: session.userId,
    parentId: query.libraryId,
    limit: query.limit ?? 16,
    fields: EPISODE_FIELDS,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const out: UpcomingEpisode[] = []
  for (const dto of data.Items ?? []) {
    const episode = toEpisode(dto)
    if (!episode) continue
    const airs = dto.PremiereDate ? Date.parse(dto.PremiereDate) : NaN
    out.push(Number.isFinite(airs) ? { ...episode, airsAt: airs } : episode)
  }
  return out.sort((a, b) => (a.airsAt ?? Infinity) - (b.airsAt ?? Infinity))
}

/** Partly watched episodes, most recently watched first. */
export async function getContinueEpisodes(session: Session, query: { libraryId?: string; limit?: number } = {}): Promise<Episode[]> {
  const { data } = await getLibraryApi(session.api).getResumeItems({
    userId: session.userId,
    parentId: query.libraryId,
    limit: query.limit ?? 12,
    includeItemTypes: [BaseItemKind.Episode],
    fields: EPISODE_FIELDS,
    enableUserData: true,
    enableImages: true,
    enableImageTypes: [ImageType.Primary],
    imageTypeLimit: 1,
  })
  return toEpisodes(data.Items).filter((e) => e.resumeTicks > 0)
}

/**
 * What the Play button of a series should start: the episode you were on (or the next one), or the
 * first real episode when you have not started. Null when the series has no episodes (yet).
 */
export async function getSeriesPlayTarget(session: Session, seriesId: string): Promise<Episode | null> {
  const [next] = await getNextUp(session, { seriesId, limit: 1, includeInProgress: true })
  if (next) return next
  const episodes = await getEpisodes(session, seriesId, { limit: 20 })
  return episodes.find((e) => e.seasonNumber !== 0) ?? episodes[0] ?? null
}

/** Episodes whose title matches the search text. */
export async function searchEpisodes(session: Session, term: string, limit = 12): Promise<Episode[]> {
  const searchTerm = term.trim()
  if (!searchTerm) return []
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    searchTerm,
    includeItemTypes: [BaseItemKind.Episode],
    recursive: true,
    limit,
    fields: EPISODE_FIELDS,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return toEpisodes(data.Items)
}

/** "More like this" for a series. */
export async function getSimilarShows(session: Session, id: string, limit = 12): Promise<Movie[]> {
  const { data } = await getLibraryApi(session.api).getSimilarShows({ itemId: id, userId: session.userId, limit })
  return (data.Items ?? []).map(toMovie).filter((m): m is Movie => m !== null)
}
