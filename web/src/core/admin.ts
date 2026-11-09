import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import type { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type'
import type { RemoteSearchResult } from '@jellyfin/sdk/lib/generated-client/models/remote-search-result'
import { getImageApi } from '@jellyfin/sdk/lib/utils/api/image-api'
import { getItemLookupApi } from '@jellyfin/sdk/lib/utils/api/item-lookup-api'
import { getItemUpdateApi } from '@jellyfin/sdk/lib/utils/api/item-update-api'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getRemoteImageApi } from '@jellyfin/sdk/lib/utils/api/remote-image-api'
import { itemImageUrl } from './images'
import { fieldsOf, type MetadataFields } from './adminFields'
import type { Session } from './jellyfin'

/**
 * Administrator tools for one title: edit its details, identify it, refresh it, change its pictures. Everything here is the
 * server's own API and the server decides who may use it (it answers 403 to anyone who is not an administrator); the app
 * only shows the tools to administrators, asks before it writes, and keeps a local note of what it changed.
 */

export * from './adminFields'

/** What the editor needs to open: the whole item, its fields, and the parental ratings the server knows. */
export interface EditableItem {
  dto: BaseItemDto
  fields: MetadataFields
  parentalRatings: string[]
}

export async function getEditableItem(session: Session, id: string): Promise<EditableItem> {
  const { data } = await getLibraryApi(session.api).getItem({ itemId: id, userId: session.userId })
  // The list of ratings is a convenience: an old or locked-down server can do without it.
  const parentalRatings = await getItemUpdateApi(session.api)
    .getMetadataEditorInfo({ itemId: id })
    .then(({ data: info }) => [...new Set((info.ParentalRatingOptions ?? []).map((r) => r.Name ?? '').filter(Boolean))])
    .catch(() => [] as string[])
  return { dto: data, fields: fieldsOf(data), parentalRatings }
}

/** Writes the new details. The server rejects it (403) when this account is not an administrator. */
export async function saveItem(session: Session, id: string, dto: BaseItemDto): Promise<void> {
  await getItemUpdateApi(session.api).updateItem({ itemId: id, baseItemDto: dto })
}

// ---- identify -----------------------------------------------------------------------------------------

export interface IdentityCandidate {
  /** Where it came from ("TheMovieDb"...). */
  provider: string
  name: string
  year?: number
  overview?: string
  imageUrl?: string
  /** The provider's ids, as the server needs them back when this one is applied. */
  providerIds: Record<string, string>
  raw: RemoteSearchResult
}

/** The ids the providers know a title by, as the person sees them ("TheMovieDb 603"). */
export function describeProviderIds(ids: Record<string, string>): string {
  return Object.entries(ids)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')
}

export function toCandidate(result: RemoteSearchResult): IdentityCandidate | null {
  if (!result.Name) return null
  return {
    provider: result.SearchProviderName ?? '',
    name: result.Name,
    year: result.ProductionYear ?? undefined,
    overview: result.Overview ?? undefined,
    imageUrl: result.ImageUrl && /^https?:\/\//i.test(result.ImageUrl) ? result.ImageUrl : undefined,
    providerIds: result.ProviderIds ?? {},
    raw: result,
  }
}

/** Looks a title up in the metadata providers the server has switched on. The server does the searching. */
export async function searchIdentity(session: Session, dto: BaseItemDto, query: { name: string; year?: number }): Promise<IdentityCandidate[]> {
  const api = getItemLookupApi(session.api)
  const itemId = dto.Id ?? ''
  const searchInfo = { Name: query.name.trim(), Year: query.year }
  const type = dto.Type ?? ''
  let results: RemoteSearchResult[]
  if (type === 'Movie') results = (await api.getMovieRemoteSearchResults({ movieInfoRemoteSearchQuery: { SearchInfo: searchInfo, ItemId: itemId } })).data
  else if (type === 'Series') results = (await api.getSeriesRemoteSearchResults({ seriesInfoRemoteSearchQuery: { SearchInfo: searchInfo, ItemId: itemId } })).data
  else if (type === 'BoxSet') results = (await api.getBoxSetRemoteSearchResults({ boxSetInfoRemoteSearchQuery: { SearchInfo: searchInfo, ItemId: itemId } })).data
  else if (type === 'MusicAlbum') results = (await api.getMusicAlbumRemoteSearchResults({ albumInfoRemoteSearchQuery: { SearchInfo: searchInfo, ItemId: itemId } })).data
  else if (type === 'MusicArtist') results = (await api.getMusicArtistRemoteSearchResults({ artistInfoRemoteSearchQuery: { SearchInfo: searchInfo, ItemId: itemId } })).data
  else throw new Error('This kind of title cannot be looked up.')
  return results.map(toCandidate).filter((c): c is IdentityCandidate => c !== null)
}

/** Tells the server which one it is. The server then fills in its details (and, if asked, its pictures). */
export async function applyIdentity(session: Session, id: string, candidate: IdentityCandidate, replaceImages: boolean): Promise<void> {
  await getItemLookupApi(session.api).applySearchCriteria({ itemId: id, remoteSearchResult: candidate.raw, replaceAllImages: replaceImages })
}

// ---- refresh ------------------------------------------------------------------------------------------

/**
 * "scan": look for changed files only. "missing": look for details and pictures that are missing and keep what is there.
 * "all": ask the providers again and replace what the server has (except what is locked).
 */
export type RefreshMode = 'scan' | 'missing' | 'all'

export async function refreshItem(session: Session, id: string, mode: RefreshMode, replaceImages = false): Promise<void> {
  await getLibraryApi(session.api).refreshItem({
    itemId: id,
    metadataRefreshMode: mode === 'scan' ? 'Default' : 'FullRefresh',
    imageRefreshMode: mode === 'scan' ? 'Default' : 'FullRefresh',
    replaceAllMetadata: mode === 'all',
    replaceAllImages: mode === 'all' && replaceImages,
  })
}

// ---- pictures -----------------------------------------------------------------------------------------

/** The pictures this editor changes, with the names a person uses. */
export const PICTURE_KINDS = [
  { type: 'Primary', label: 'Poster' },
  { type: 'Backdrop', label: 'Backdrop' },
  { type: 'Logo', label: 'Logo' },
  { type: 'Thumb', label: 'Thumbnail' },
] as const satisfies ReadonlyArray<{ type: ImageType; label: string }>
export type PictureType = (typeof PICTURE_KINDS)[number]['type']

export interface PictureSlot {
  type: PictureType
  index: number
  tag?: string
  width?: number
  height?: number
  bytes?: number
  url: string
}

/** The pictures the title has now. */
export async function getPictures(session: Session, id: string): Promise<PictureSlot[]> {
  const { data } = await getImageApi(session.api).getItemImageInfos({ itemId: id })
  const known = new Set<string>(PICTURE_KINDS.map((k) => k.type))
  return data
    .filter((i) => i.ImageType && known.has(i.ImageType))
    .map((i) => ({
      type: i.ImageType as PictureType,
      index: i.ImageIndex ?? 0,
      tag: i.ImageTag ?? undefined,
      width: i.Width ?? undefined,
      height: i.Height ?? undefined,
      bytes: i.Size,
      url: itemImageUrl(session.serverUrl, id, i.ImageType === 'Backdrop' ? 'Backdrop' : i.ImageType === 'Logo' ? 'Logo' : 'Primary', { tag: i.ImageTag ?? undefined, width: 360 }),
    }))
}

export interface PictureChoice {
  provider: string
  url: string
  thumbnail: string
  width?: number
  height?: number
  language?: string
  rating?: number
  votes?: number
}

/** The pictures the metadata providers offer for a title. Only web addresses are kept. */
export async function getPictureChoices(session: Session, id: string, type: PictureType, allLanguages = false): Promise<PictureChoice[]> {
  const { data } = await getRemoteImageApi(session.api).getRemoteImages({ itemId: id, type, limit: 30, includeAllLanguages: allLanguages })
  return (data.Images ?? [])
    .filter((i) => i.Url && /^https?:\/\//i.test(i.Url))
    .map((i) => ({
      provider: i.ProviderName ?? '',
      url: i.Url as string,
      thumbnail: i.ThumbnailUrl && /^https?:\/\//i.test(i.ThumbnailUrl) ? i.ThumbnailUrl : (i.Url as string),
      width: i.Width ?? undefined,
      height: i.Height ?? undefined,
      language: i.Language ?? undefined,
      rating: i.CommunityRating ?? undefined,
      votes: i.VoteCount ?? undefined,
    }))
}

/** Tells the server to download one of the pictures it offered. Only an address from `getPictureChoices` should be passed. */
export async function downloadPicture(session: Session, id: string, type: PictureType, choice: PictureChoice): Promise<void> {
  await getRemoteImageApi(session.api).downloadRemoteImage({ itemId: id, type, imageUrl: choice.url })
}

export const MAX_PICTURE_BYTES = 10 * 1024 * 1024
export const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** Is this file fit to be a picture? English, plain words; null when it is. */
export function checkPictureFile(file: { type: string; size: number }): string | null {
  if (!(PICTURE_TYPES as readonly string[]).includes(file.type)) return 'Choose a JPEG, PNG or WebP picture.'
  if (file.size <= 0) return 'That file is empty.'
  if (file.size > MAX_PICTURE_BYTES) return 'That picture is larger than 10 MB.'
  return null
}

/** Is the shape right for this kind of picture? A warning, not a rule (null when it looks fine). */
export function pictureShapeWarning(type: PictureType, width: number, height: number): string | null {
  if (width < 1 || height < 1) return null
  const ratio = width / height
  if (type === 'Primary' && ratio > 1) return 'Posters are usually taller than wide.'
  if ((type === 'Backdrop' || type === 'Thumb') && ratio < 1.3) return 'Backdrops and thumbnails are usually wide.'
  if (type === 'Backdrop' && width < 1280) return 'This backdrop is small; it may look soft on a big screen.'
  return null
}

/**
 * Sends a picture the person chose. Jellyfin wants the file as base64 text, with the picture's own type as the content type.
 * The browser reads the file; this only sends it.
 */
export async function uploadPicture(session: Session, id: string, type: PictureType, picture: { base64: string; contentType: string }): Promise<void> {
  await session.api.axiosInstance.post(`${session.api.basePath}/Items/${encodeURIComponent(id)}/Images/${type}`, picture.base64, {
    headers: { Authorization: session.api.authorizationHeader, 'Content-Type': picture.contentType },
  })
}

export async function deletePicture(session: Session, id: string, type: PictureType, index = 0): Promise<void> {
  await getImageApi(session.api).deleteItemImageByIndex({ itemId: id, imageType: type, imageIndex: index })
}
