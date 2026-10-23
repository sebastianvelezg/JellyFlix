/**
 * The filters of a library beyond "watched / favorites" and genre: the decade, a minimum rating, the age rating, a tag and the picture
 * quality. Pure: turns what the person chose into the parameters of the server's item query, and cleans up what was saved.
 */

export type Quality = 'uhd' | 'hd'
export const QUALITIES: readonly Quality[] = ['uhd', 'hd']

export interface AdvancedFilters {
  /** The first year of a decade: 1990 means 1990 to 1999. */
  decade?: number
  /** Only titles rated at least this well by the community (0 to 10). */
  minRating?: number
  /** Age rating, as the server writes it ("PG-13", "TV-MA"). */
  officialRating?: string
  tag?: string
  quality?: Quality
}

export const NO_FILTERS: AdvancedFilters = {}

export const MIN_RATINGS = [5, 6, 7, 8, 9] as const

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const clean = value.trim().slice(0, 60)
  return clean || undefined
}

/** Drops anything that is not a valid choice (saved settings are never trusted). */
export function sanitizeFilters(value: unknown): AdvancedFilters {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const out: AdvancedFilters = {}
  if (typeof v.decade === 'number' && Number.isInteger(v.decade) && v.decade % 10 === 0 && v.decade >= 1880 && v.decade <= 2090) out.decade = v.decade
  if (typeof v.minRating === 'number' && (MIN_RATINGS as readonly number[]).includes(v.minRating)) out.minRating = v.minRating
  const officialRating = text(v.officialRating)
  if (officialRating) out.officialRating = officialRating
  const tag = text(v.tag)
  if (tag) out.tag = tag
  if (QUALITIES.includes(v.quality as Quality)) out.quality = v.quality as Quality
  return out
}

export function countActiveFilters(filters: AdvancedFilters): number {
  return Object.keys(sanitizeFilters(filters)).length
}

/** The years of a decade, as the server wants them. */
export function decadeYears(decade: number): number[] {
  return Array.from({ length: 10 }, (_, i) => decade + i)
}

/** "1990s". */
export function decadeLabel(decade: number): string {
  return `${decade}s`
}

/** The item-query parameters for these filters. */
export function filterQuery(filters: AdvancedFilters): {
  years?: number[]
  minCommunityRating?: number
  officialRatings?: string[]
  tags?: string[]
  is4K?: boolean
  isHd?: boolean
} {
  const f = sanitizeFilters(filters)
  return {
    years: f.decade !== undefined ? decadeYears(f.decade) : undefined,
    minCommunityRating: f.minRating,
    officialRatings: f.officialRating ? [f.officialRating] : undefined,
    tags: f.tag ? [f.tag] : undefined,
    is4K: f.quality === 'uhd' ? true : undefined,
    isHd: f.quality === 'hd' ? true : undefined,
  }
}

/** What a library offers to filter by. */
export interface FilterFacets {
  decades: number[]
  officialRatings: string[]
  tags: string[]
}

/** Builds the lists the filter menus offer from what the server says exists in a library. */
export function toFacets(years: Array<number | null | undefined> | null | undefined, officialRatings: unknown, tags: unknown): FilterFacets {
  const strings = (list: unknown) => [...new Set(((Array.isArray(list) ? list : []) as unknown[]).map(text).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b))
  const decades = [...new Set((years ?? []).filter((y): y is number => typeof y === 'number' && y > 1800).map((y) => Math.floor(y / 10) * 10))].sort((a, b) => b - a)
  return { decades, officialRatings: strings(officialRatings), tags: strings(tags) }
}
