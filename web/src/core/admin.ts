import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import type { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type'
import type { MetadataField } from '@jellyfin/sdk/lib/generated-client/models/metadata-field'
import type { RemoteSearchResult } from '@jellyfin/sdk/lib/generated-client/models/remote-search-result'
import { getImageApi } from '@jellyfin/sdk/lib/utils/api/image-api'
import { getItemLookupApi } from '@jellyfin/sdk/lib/utils/api/item-lookup-api'
import { getItemUpdateApi } from '@jellyfin/sdk/lib/utils/api/item-update-api'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getRemoteImageApi } from '@jellyfin/sdk/lib/utils/api/remote-image-api'
import { itemImageUrl } from './images'
import type { Session } from './jellyfin'
import { isAdministrator } from './plugins'

/**
 * Administrator tools for one title: edit its details, identify it, refresh it, change its pictures. Everything here is the
 * server's own API and the server decides who may use it (it answers 403 to anyone who is not an administrator); the app
 * only shows the tools to administrators, asks before it writes, and keeps a local note of what it changed.
 */

// ---- who may ------------------------------------------------------------------------------------------

const adminChecks = new WeakMap<Session, Promise<boolean>>()

/**
 * Whether this account is a server administrator. Asked once per sign-in; a question that could not be answered counts as
 * "no" for now and is asked again next time (a hiccup at start-up must not hide the tools until the page is reloaded).
 */
export function canAdminister(session: Session): Promise<boolean> {
  let check = adminChecks.get(session)
  if (!check) {
    check = isAdministrator(session).catch(() => {
      adminChecks.delete(session)
      return false
    })
    adminChecks.set(session, check)
  }
  return check
}

/** The kinds of title the editor works on (the server edits all of them the same way). */
export const EDITABLE_TYPES = ['Movie', 'Series', 'Season', 'Episode', 'MusicAlbum', 'MusicArtist', 'BoxSet'] as const
export type EditableType = (typeof EDITABLE_TYPES)[number]

export function isEditableType(type: string | null | undefined): type is EditableType {
  return (EDITABLE_TYPES as readonly string[]).includes(type ?? '')
}

/** Only a movie, a series, an album, an artist or a collection can be looked up in the metadata providers. */
export const IDENTIFIABLE_TYPES: readonly EditableType[] = ['Movie', 'Series', 'MusicAlbum', 'MusicArtist', 'BoxSet']

export function canIdentify(type: string | null | undefined): boolean {
  return (IDENTIFIABLE_TYPES as readonly string[]).includes(type ?? '')
}

// ---- the details of a title ---------------------------------------------------------------------------

/** The fields the editor shows, all as text the way a person types them. */
export interface MetadataFields {
  name: string
  originalTitle: string
  sortName: string
  overview: string
  year: string
  officialRating: string
  communityRating: string
  genres: string[]
  studios: string[]
  tags: string[]
  /** Nothing about this title may be changed by a refresh. */
  lockedAll: boolean
  /** Only these fields are kept as they are when the server refreshes the title. */
  lockedFields: LockableField[]
}

/** The fields the server can keep from being overwritten, in the order they are listed. */
export const LOCKABLE_FIELDS = ['Name', 'Overview', 'Genres', 'Studios', 'Tags', 'OfficialRating', 'Cast', 'Runtime'] as const satisfies readonly MetadataField[]
export type LockableField = (typeof LOCKABLE_FIELDS)[number]

export const FIELD_LIMITS = { name: 250, originalTitle: 250, sortName: 250, overview: 8000, officialRating: 30, listItems: 60, listItem: 80 } as const

/** What the server holds today, as the editor shows it. */
export function fieldsOf(dto: BaseItemDto): MetadataFields {
  const locked = (dto.LockedFields ?? []).filter((f): f is LockableField => (LOCKABLE_FIELDS as readonly string[]).includes(f))
  return {
    name: dto.Name ?? '',
    originalTitle: dto.OriginalTitle ?? '',
    sortName: dto.ForcedSortName ?? '',
    overview: dto.Overview ?? '',
    year: dto.ProductionYear ? String(dto.ProductionYear) : '',
    officialRating: dto.OfficialRating ?? '',
    communityRating: dto.CommunityRating != null ? String(dto.CommunityRating) : '',
    genres: [...(dto.Genres ?? [])],
    studios: (dto.Studios ?? []).map((s) => s.Name ?? '').filter(Boolean),
    tags: [...(dto.Tags ?? [])],
    lockedAll: dto.LockData === true,
    lockedFields: locked,
  }
}

/** "Action, Drama" or one per line → a clean list: trimmed, no empty entries, no repeats (capitals do not matter). */
export function parseList(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.split(/[,\n;]/)) {
    const value = part.trim().replace(/\s+/g, ' ')
    if (!value || seen.has(value.toLowerCase())) continue
    seen.add(value.toLowerCase())
    out.push(value)
  }
  return out
}

/** Every English sentence this file can hand to the screen (it translates them): the labels and the messages. */
export const ADMIN_TEXTS: readonly string[] = [
  'A title is needed.',
  'That title is too long.',
  'That description is too long.',
  'Use a year with four digits, such as 1999.',
  'The rating is a number from 0 to 10.',
  'That rating is too long.',
  'That list is too long.',
  'Choose a JPEG, PNG or WebP picture.',
  'That file is empty.',
  'That picture is larger than 10 MB.',
  'Posters are usually taller than wide.',
  'Backdrops and thumbnails are usually wide.',
  'This backdrop is small; it may look soft on a big screen.',
  'This kind of title cannot be looked up.',
  'Poster',
  'Backdrop',
  'Logo',
  'Thumbnail',
]

export const formatList = (list: readonly string[]): string => list.join(', ')

export type FieldErrors = Partial<Record<keyof MetadataFields, string>>

/** What is wrong with the fields, in plain words (English: the screen translates them). Empty when they can be saved. */
export function validateFields(fields: MetadataFields, now = new Date()): FieldErrors {
  const errors: FieldErrors = {}
  if (!fields.name.trim()) errors.name = 'A title is needed.'
  else if (fields.name.length > FIELD_LIMITS.name) errors.name = 'That title is too long.'
  if (fields.originalTitle.length > FIELD_LIMITS.originalTitle) errors.originalTitle = 'That title is too long.'
  if (fields.sortName.length > FIELD_LIMITS.sortName) errors.sortName = 'That title is too long.'
  if (fields.overview.length > FIELD_LIMITS.overview) errors.overview = 'That description is too long.'
  if (fields.year.trim()) {
    const year = Number(fields.year)
    if (!/^\d{4}$/.test(fields.year.trim()) || year < 1800 || year > now.getFullYear() + 10) errors.year = 'Use a year with four digits, such as 1999.'
  }
  if (fields.communityRating.trim()) {
    const rating = Number(fields.communityRating.replace(',', '.'))
    if (!Number.isFinite(rating) || rating < 0 || rating > 10) errors.communityRating = 'The rating is a number from 0 to 10.'
  }
  if (fields.officialRating.length > FIELD_LIMITS.officialRating) errors.officialRating = 'That rating is too long.'
  for (const key of ['genres', 'studios', 'tags'] as const) {
    const list = fields[key]
    if (list.length > FIELD_LIMITS.listItems || list.some((x) => x.length > FIELD_LIMITS.listItem)) errors[key] = 'That list is too long.'
  }
  return errors
}

/** One line of "what will change". */
export interface FieldChange {
  key: keyof MetadataFields
  label: string
  before: string
  after: string
}

export const FIELD_LABELS: Record<keyof MetadataFields, string> = {
  name: 'Title',
  originalTitle: 'Original title',
  sortName: 'Sort title',
  overview: 'Description',
  year: 'Year',
  officialRating: 'Parental rating',
  communityRating: 'Community rating',
  genres: 'Genres',
  studios: 'Studios',
  tags: 'Tags',
  lockedAll: 'Lock the whole title',
  lockedFields: 'Fields kept as they are',
}

function show(key: keyof MetadataFields, fields: MetadataFields): string {
  const value = fields[key]
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return formatList(value)
  return value.trim()
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** What differs between two versions of the fields, in the order of the form. Pure. */
export function diffFields(before: MetadataFields, after: MetadataFields): FieldChange[] {
  const changes: FieldChange[] = []
  for (const key of Object.keys(FIELD_LABELS) as Array<keyof MetadataFields>) {
    const a = before[key]
    const b = after[key]
    const same = Array.isArray(a) && Array.isArray(b) ? sameList(a as string[], b as string[]) : typeof a === 'string' && typeof b === 'string' ? a.trim() === b.trim() : a === b
    if (!same) changes.push({ key, label: FIELD_LABELS[key], before: show(key, before), after: show(key, after) })
  }
  return changes
}

/** The item as the server should now hold it: the one it gave us, with only the editor's fields replaced. Pure. */
export function applyFields(dto: BaseItemDto, fields: MetadataFields): BaseItemDto {
  const trimmed = (text: string) => text.trim()
  const rating = fields.communityRating.trim() ? Number(fields.communityRating.replace(',', '.')) : undefined
  const keptStudios = new Map((dto.Studios ?? []).map((s) => [s.Name ?? '', s]))
  return {
    ...dto,
    Name: trimmed(fields.name),
    OriginalTitle: trimmed(fields.originalTitle) || undefined,
    ForcedSortName: trimmed(fields.sortName) || undefined,
    Overview: trimmed(fields.overview) || undefined,
    ProductionYear: fields.year.trim() ? Number(fields.year) : undefined,
    OfficialRating: trimmed(fields.officialRating) || undefined,
    CommunityRating: rating,
    Genres: fields.genres,
    Studios: fields.studios.map((name) => keptStudios.get(name) ?? { Name: name }),
    Tags: fields.tags,
    LockData: fields.lockedAll,
    // Fields locked in a way this editor does not list are left alone.
    LockedFields: [...(dto.LockedFields ?? []).filter((f) => !(LOCKABLE_FIELDS as readonly string[]).includes(f)), ...fields.lockedFields],
  }
}

/** The title with `fields` from an earlier moment put back, for the changed ones only (undoing an edit). Pure. */
export function restoreFields(current: MetadataFields, earlier: MetadataFields, keys: ReadonlyArray<keyof MetadataFields>): MetadataFields {
  const next = { ...current } as Record<keyof MetadataFields, unknown>
  for (const key of keys) next[key] = Array.isArray(earlier[key]) ? [...(earlier[key] as string[])] : earlier[key]
  return next as unknown as MetadataFields
}

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
