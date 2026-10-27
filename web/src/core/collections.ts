import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { itemImageUrl } from './images'
import type { Session } from './jellyfin'
import { nextInQueue } from './musicVideos'
import { toMovie, type Movie } from './library'
import type { Page } from './music'

/** A collection ("box set"): a hand-made or automatic group of movies, such as a saga. */
export interface Collection {
  id: string
  name: string
  imageTag?: string
  backdropTag?: string
  /** How many titles it holds, when the server says. */
  itemCount?: number
  favorite: boolean
}

/** `random` is for rows that show a different handful each time (servers often give every collection the same added date). */
export type CollectionSort = 'name' | 'added' | 'random'

export const COLLECTION_SORT_LABELS: Record<Exclude<CollectionSort, 'random'>, string> = {
  name: 'Name (A–Z)',
  added: 'Recently added',
}

export function toCollection(dto: BaseItemDto): Collection | null {
  if (!dto.Id || !dto.Name) return null
  return {
    id: dto.Id,
    name: dto.Name,
    imageTag: dto.ImageTags?.Primary ?? undefined,
    backdropTag: dto.BackdropImageTags?.[0] ?? undefined,
    itemCount: dto.ChildCount ?? dto.RecursiveItemCount ?? undefined,
    favorite: dto.UserData?.IsFavorite ?? false,
  }
}

export interface CollectionQuery {
  startIndex: number
  limit?: number
  sort?: CollectionSort
  /** Only collections whose name contains this. */
  search?: string
  /** Have the server count every match for `total` (the default); a list that shows no total leaves it out. */
  withTotal?: boolean
}

const COLLECTION_PAGE = 60

/** One page of the collections the user can see. They live in a hidden library of their own, so no library is given. */
export async function getCollectionPage(session: Session, query: CollectionQuery): Promise<Page<Collection>> {
  const added = query.sort === 'added'
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    includeItemTypes: [BaseItemKind.BoxSet],
    recursive: true,
    searchTerm: query.search?.trim() || undefined,
    sortBy: query.sort === 'random' ? [ItemSortBy.Random] : added ? [ItemSortBy.DateCreated, ItemSortBy.SortName] : [ItemSortBy.SortName],
    sortOrder: query.sort === 'random' ? undefined : [added ? SortOrder.Descending : SortOrder.Ascending],
    startIndex: query.startIndex,
    limit: query.limit ?? COLLECTION_PAGE,
    fields: [ItemFields.ChildCount],
    enableUserData: true,
    enableTotalRecordCount: query.withTotal ?? true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const items = (data.Items ?? []).map(toCollection).filter((c): c is Collection => c !== null)
  return { items, total: data.TotalRecordCount ?? items.length }
}

/** A collection and its description. */
export interface CollectionDetails extends Collection {
  overview?: string
}

export async function getCollection(session: Session, id: string): Promise<CollectionDetails> {
  const { data } = await getLibraryApi(session.api).getItem({ itemId: id, userId: session.userId })
  const base = toCollection(data)
  if (!base) throw new Error('That collection is no longer available.')
  return { ...base, overview: data.Overview ?? undefined }
}

/** What is in a collection, oldest first so a saga reads in order. Titles without a year come last. */
export async function getCollectionItems(session: Session, id: string): Promise<Movie[]> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId: id,
    sortBy: [ItemSortBy.ProductionYear, ItemSortBy.SortName],
    sortOrder: [SortOrder.Ascending],
    fields: [ItemFields.PrimaryImageAspectRatio],
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return sortByYear((data.Items ?? []).map(toMovie).filter((m): m is Movie => m !== null))
}

/** Oldest release first, without a year last; ties keep their order. Pure. */
export function sortByYear<T extends Pick<Movie, 'year'>>(titles: T[]): T[] {
  return titles
    .map((title, index) => ({ title, index }))
    .sort((a, b) => (a.title.year ?? Infinity) - (b.title.year ?? Infinity) || a.index - b.index)
    .map((entry) => entry.title)
}

/** Which title a collection's Play button starts: one you left half-way, else the first you have not watched, else the first. */
export function collectionPlayTarget<T extends Pick<Movie, 'played' | 'resumeTicks' | 'isSeries'>>(items: T[]): T | undefined {
  const playable = items.filter((m) => !m.isSeries)
  return playable.find((m) => m.resumeTicks > 0) ?? playable.find((m) => !m.played) ?? playable[0]
}

/** The title that follows `currentId` in a collection (a series is not played through, so it is skipped); null after the last one. Pure. */
export function nextInCollection<T extends Pick<Movie, 'id' | 'isSeries'>>(items: readonly T[], currentId: string): T | null {
  return nextInQueue(items, currentId, false)
}

/** Collections whose name matches the text (for search). */
export async function searchCollections(session: Session, term: string, limit = 12): Promise<Collection[]> {
  if (!term.trim()) return []
  return (await getCollectionPage(session, { startIndex: 0, limit, search: term, withTotal: false })).items
}

export function collectionPosterUrl(serverUrl: string, collection: Pick<Collection, 'id' | 'imageTag'>, width = 300): string | null {
  return collection.imageTag ? itemImageUrl(serverUrl, collection.id, 'Primary', { tag: collection.imageTag, width }) : null
}

export function collectionBackdropUrl(serverUrl: string, collection: Pick<Collection, 'id' | 'backdropTag'>, width = 1600): string | null {
  return collection.backdropTag ? itemImageUrl(serverUrl, collection.id, 'Backdrop', { tag: collection.backdropTag, width }) : null
}
