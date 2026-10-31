import { sha256 } from './sha256'

/**
 * Kids mode: what a child may see on this device. The rules are pure and live here; the platform keeps the choice and the PIN, and
 * the request layer (`createApi`) asks `guardUrl` and `guardResponse` about every read, so a blocked title never reaches a screen.
 *
 * The limit is the age rating chosen (its number comes from the server's own list, so "PG" or "TV-14" mean what the server says).
 * A title with no rating, or one the server cannot rank, is blocked: a child's view is the cautious one.
 */
export interface KidsGuard {
  /** The highest rating allowed, as the server writes it ("PG"). */
  maxName: string
  /** Its number in the server's list of ratings. */
  maxValue: number
  /** Every rating the server knows, lower case, with its number. */
  ratings: Record<string, number>
  /** The series that pass the limit, so that their episodes and seasons (which often carry no rating of their own) pass too. */
  allowedSeries: ReadonlySet<string>
}

let guard: KidsGuard | null = null

/** Turns the guard on (or off with null) for every request made from now on. */
export function setKidsGuard(next: KidsGuard | null): void {
  guard = next
}

export function getKidsGuard(): KidsGuard | null {
  return guard
}

/** The number of a rating, or undefined when the server has no such rating. */
export function ratingValue(name: string | null | undefined, ratings: Record<string, number>): number | undefined {
  if (!name) return undefined
  return ratings[name.trim().toLowerCase()]
}

/** What kinds of title carry an age rating; music, folders and people do not, and always pass. */
const RATED = new Set(['Movie', 'Series', 'MusicVideo', 'BoxSet', 'Video', 'Trailer', 'Book', 'AudioBook', 'Program'])
/** These usually have none of their own: they follow their series. */
const FOLLOWS_SERIES = new Set(['Season', 'Episode'])

interface ItemLike {
  Id?: string
  Type?: string
  OfficialRating?: string | null
  SeriesId?: string | null
}

/** True when this title may not be shown. */
export function isBlocked(item: ItemLike, g: KidsGuard): boolean {
  const type = item.Type ?? ''
  if (FOLLOWS_SERIES.has(type)) {
    if (item.SeriesId && g.allowedSeries.has(item.SeriesId)) return false
    const own = ratingValue(item.OfficialRating, g.ratings)
    return own === undefined || own > g.maxValue
  }
  if (!RATED.has(type)) return false
  if (type === 'Series' && item.Id && g.allowedSeries.has(item.Id)) return false
  const value = ratingValue(item.OfficialRating, g.ratings)
  return value === undefined || value > g.maxValue
}

/** The lists of the server that can be limited by the server itself, which also keeps the counts and the paging right. */
const LIMITED_BY_SERVER = /\/(Items|Users\/[^/]+\/Items)$/i
/**
 * Kinds of title that carry their own age rating. The server's limit is only asked for when a list is made of these alone: it leaves
 * out whatever has no rating, which would take out every episode (they follow their series) and all the music.
 */
const RATED_BY_THEMSELVES = new Set(['Movie', 'Series', 'MusicVideo', 'BoxSet', 'Video', 'Trailer', 'Book', 'AudioBook'])

/** Adds the server's own limit to a list request (it only lets through titles that have a rating at or below the chosen one). */
export function guardUrl(url: string, g: KidsGuard | null): string {
  if (!g) return url
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url)
  let parsed: URL
  try {
    parsed = new URL(url, 'http://placeholder.invalid')
  } catch {
    return url
  }
  if (!LIMITED_BY_SERVER.test(parsed.pathname)) return url
  const kinds = parsed.searchParams.getAll('includeItemTypes').flatMap((value) => value.split(',')).filter(Boolean)
  if (kinds.length === 0 || !kinds.every((kind) => RATED_BY_THEMSELVES.has(kind))) return url
  parsed.searchParams.set('maxOfficialRating', g.maxName)
  parsed.searchParams.set('hasParentalRating', 'true')
  return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}`
}

/** Thrown for a title that may not be opened (it looks, to the app, like a title that does not exist). */
export class BlockedTitle extends Error {
  constructor() {
    super('This title is not available in Kids mode.')
    this.name = 'BlockedTitle'
  }
}

/**
 * Takes the blocked titles out of whatever the server answered: a list (`{ Items: [...] }`), a plain list of titles, or one title.
 * Anything else comes back as it was. The number of titles left is reported in `TotalRecordCount` when the server counted.
 */
export function guardResponse(data: unknown, g: KidsGuard | null): unknown {
  if (!g || data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) {
    if (!data.every((entry) => entry && typeof entry === 'object' && 'Type' in entry)) return data
    return data.filter((entry) => !isBlocked(entry as ItemLike, g))
  }
  const record = data as { Items?: unknown; Type?: string; TotalRecordCount?: number }
  if (Array.isArray(record.Items)) {
    const kept = record.Items.filter((entry) => !(entry && typeof entry === 'object' && 'Type' in entry && isBlocked(entry as ItemLike, g)))
    const removed = record.Items.length - kept.length
    // (The count the server gave is only corrected, never asked for: whoever asked for a total already has it.)
    const { TotalRecordCount: total } = record
    return {
      ...record,
      Items: kept,
      ...(removed > 0 && typeof total === 'number' ? { TotalRecordCount: Math.max(0, total - removed) } : {}),
    }
  }
  if (typeof record.Type === 'string' && 'Id' in record && isBlocked(record as ItemLike, g)) throw new BlockedTitle()
  return data
}

// ---- the PIN ------------------------------------------------------------------------------------------------------

export const PIN_MIN = 4
export const PIN_MAX = 8

/** A PIN is four to eight digits (a remote or a phone keypad types it; nothing to remember beyond that). */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin)
}

/** What is stored in place of the PIN: its hash with a random salt, so the number itself is not kept. */
export function hashPin(pin: string, salt: string): string {
  return sha256(`${salt}:${pin}`)
}

export function verifyPin(pin: string, salt: string, hash: string): boolean {
  return hashPin(pin, salt) === hash
}

/** Wrong tries in a row it takes before a wait starts. */
export const FREE_TRIES = 5
/** The longest wait, in seconds (fifteen minutes). */
export const MAX_WAIT_SECONDS = 15 * 60

/** How long to wait before the next try: nothing for the first few wrong ones, then 30 s, doubling, up to fifteen minutes. */
export function waitAfterFailures(failures: number): number {
  if (failures < FREE_TRIES) return 0
  return Math.min(MAX_WAIT_SECONDS, 30 * 2 ** (failures - FREE_TRIES))
}
