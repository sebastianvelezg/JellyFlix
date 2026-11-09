import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import type { MetadataField } from '@jellyfin/sdk/lib/generated-client/models/metadata-field'
import type { Session } from './jellyfin'
import { isAdministrator } from './me'

/**
 * The part of the administrator tools that asks nothing of the server: who may use them, which titles they work on, and the fields of
 * the editor (checking, comparing and applying them). Apart from admin.ts so the screens every account opens can use it without loading
 * the server calls of the tools (pictures, identify, refresh...).
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
