import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getLocalizationApi } from '@jellyfin/sdk/lib/utils/api/localization-api'
import type { Session } from './jellyfin'
import { ratingValue } from './parental'

/** Every age rating the server knows, with its number, written the way titles name them (lower case). */
export async function getRatingTable(session: Session): Promise<Record<string, number>> {
  const { data } = await getLocalizationApi(session.api).getParentalRatings()
  const table: Record<string, number> = {}
  for (const rating of data) if (rating.Name && rating.Value != null) table[rating.Name.trim().toLowerCase()] = rating.Value
  return table
}

/** The series the server lets through at this rating (their episodes pass with them). Asked of the server, which does the ranking. */
export async function getAllowedSeries(session: Session, maxName: string): Promise<string[]> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    includeItemTypes: [BaseItemKind.Series],
    recursive: true,
    maxOfficialRating: maxName,
    hasParentalRating: true,
    limit: 5000,
    enableTotalRecordCount: false,
    enableImages: false,
    enableUserData: false,
  })
  return (data.Items ?? []).map((s) => s.Id).filter((id): id is string => !!id)
}

export type KidsCheck =
  | { ok: true; ratings: Record<string, number>; maxValue: number; allowedSeries: string[] }
  | { ok: false; reason: 'unknown-rating' | 'nothing-to-show' | 'no-ratings-reported' }

/**
 * Before Kids mode is turned on: does it have what it needs? The rating must be one the server knows, something in the libraries must
 * pass it, and the server must say the rating of the titles it lists (or every one of them would look unrated and be hidden).
 */
export async function checkKidsSetup(session: Session, maxName: string): Promise<KidsCheck> {
  const ratings = await getRatingTable(session)
  const maxValue = ratingValue(maxName, ratings)
  if (maxValue === undefined) return { ok: false, reason: 'unknown-rating' }
  const [allowedSeries, { data }] = await Promise.all([
    getAllowedSeries(session, maxName),
    getLibraryApi(session.api).getItems({
      userId: session.userId,
      includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.MusicVideo],
      recursive: true,
      maxOfficialRating: maxName,
      hasParentalRating: true,
      limit: 20,
      enableTotalRecordCount: false,
      enableImages: false,
      enableUserData: false,
    }),
  ])
  const found = data.Items ?? []
  if (found.length === 0 && allowedSeries.length === 0) return { ok: false, reason: 'nothing-to-show' }
  if (found.length > 0 && !found.some((item) => item.OfficialRating)) return { ok: false, reason: 'no-ratings-reported' }
  return { ok: true, ratings, maxValue, allowedSeries }
}
