import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import type { Session } from './jellyfin'
import { toMovie, toMovies, type Movie } from './library'
import { seededShuffle } from './mixes'

/**
 * Music videos by folder, like the Folders view of Jellyfin: a library of music videos is often a tree of folders (an artist, an
 * album, a year), and a folder can be played through. Everything here reads what the server already has.
 */

export interface VideoFolder {
  id: string
  name: string
  /** How many items the server says it holds (folders and videos directly inside). */
  childCount?: number
}

export interface FolderContents {
  folders: VideoFolder[]
  videos: Movie[]
}

/** One step of the way from a library to a folder. */
export interface Crumb {
  id: string
  name: string
}

/** Folders first, then videos: what is directly inside a library or a folder (one level, as the Folders view shows it). */
export async function getFolderContents(session: Session, parentId: string): Promise<FolderContents> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId,
    includeItemTypes: [BaseItemKind.Folder, BaseItemKind.MusicVideo],
    recursive: false,
    sortBy: [ItemSortBy.SortName],
    sortOrder: [SortOrder.Ascending],
    fields: [ItemFields.ChildCount],
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
    enableTotalRecordCount: false,
  })
  const items = data.Items ?? []
  const folders: VideoFolder[] = []
  for (const dto of items) {
    if (dto.Type === BaseItemKind.Folder && dto.Id && dto.Name) folders.push({ id: dto.Id, name: dto.Name, childCount: dto.ChildCount ?? undefined })
  }
  return { folders, videos: toMovies(items.filter((dto) => dto.Type === BaseItemKind.MusicVideo)) }
}

/** A folder's name and the folders above it (the library first), for the breadcrumb. */
export async function getFolderTrail(session: Session, id: string): Promise<{ name: string; trail: Crumb[] }> {
  const api = getLibraryApi(session.api)
  const [{ data: ancestors }, { data: folder }] = await Promise.all([
    api.getAncestors({ itemId: id, userId: session.userId }),
    api.getItems({ userId: session.userId, ids: [id], enableTotalRecordCount: false }),
  ])
  // The server lists them from the nearest one up to the root; the root itself (a virtual folder with no name of its own) is left out.
  const trail = [...ancestors]
    .reverse()
    .filter((a) => a.Id && a.Name && a.Type !== BaseItemKind.AggregateFolder && a.Type !== BaseItemKind.UserRootFolder)
    .map((a) => ({ id: a.Id as string, name: a.Name as string }))
  return { name: folder.Items?.[0]?.Name ?? '', trail }
}

/** A name as pieces that compare as numbers where they are numbers ("2" before "10"), ignoring case. */
function naturalParts(name: string): Array<string | number> {
  return name
    .toLowerCase()
    .split(/(\d+)/)
    .filter((part) => part !== '')
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

function compareParts(a: ReadonlyArray<string | number>, b: ReadonlyArray<string | number>): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = a[i] as string | number
    const y = b[i] as string | number
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x) < String(y) ? -1 : 1
  }
  return a.length - b.length
}

/**
 * Orders by path the way a folder view lists things: at each level the folders come first, then the files, each by name
 * ("2" before "10"), so a folder's videos stay together. Pure; does not change its input.
 */
export function sortByPath<T>(items: readonly T[], pathOf: (item: T) => string): T[] {
  const key = (path: string) => {
    const parts = path.split(/[\\/]+/).filter((part) => part !== '')
    return parts.map((part, i) => [i < parts.length - 1 ? 0 : 1, ...naturalParts(part)] as Array<string | number>)
  }
  return items
    .map((item) => ({ item, key: key(pathOf(item)) }))
    .sort((a, b) => {
      for (let i = 0; i < Math.min(a.key.length, b.key.length); i += 1) {
        const order = compareParts(a.key[i] as Array<string | number>, b.key[i] as Array<string | number>)
        if (order !== 0) return order
      }
      return a.key.length - b.key.length
    })
    .map((entry) => entry.item)
}

/** The most videos read for one queue (a very large library is played from its first part). */
export const QUEUE_LIMIT = 2000

const queueCache = new Map<string, { at: number; videos: Movie[] }>()
/** A queue read a moment ago is reused (each video of a played-through folder asks for the same list). */
const QUEUE_CACHE_MS = 2 * 60_000

/**
 * Every music video inside a library or a folder, however deep, in the order of their paths (so a folder's videos are together).
 * This is what "play this folder" plays.
 */
export async function getVideosUnder(session: Session, parentId: string): Promise<Movie[]> {
  const cached = queueCache.get(`${session.userId}:${parentId}`)
  if (cached && Date.now() - cached.at < QUEUE_CACHE_MS) return cached.videos
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    parentId,
    includeItemTypes: [BaseItemKind.MusicVideo],
    recursive: true,
    fields: [ItemFields.Path],
    limit: QUEUE_LIMIT,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
    enableTotalRecordCount: false,
  })
  const withPath = (data.Items ?? []).map((dto) => ({ movie: toMovie(dto), path: dto.Path ?? dto.Name ?? '' }))
  const videos = sortByPath(
    withPath.filter((entry): entry is { movie: Movie; path: string } => entry.movie !== null),
    (entry) => entry.path,
  ).map((entry) => entry.movie)
  queueCache.set(`${session.userId}:${parentId}`, { at: Date.now(), videos })
  return videos
}

/** Forgets the queues read earlier (after something changed on the server). */
export function clearQueueCache(): void {
  queueCache.clear()
}

/**
 * The order a queue plays in: as it is, or shuffled the same way every time for the same `seed` (each video of the queue is
 * a new page, and they must all agree on the order). Pure.
 */
export function orderQueue<T>(items: readonly T[], seed?: string): T[] {
  return seed ? seededShuffle(items, seed) : [...items]
}

/**
 * The title that follows `currentId` in a queue (a series is skipped: it is not played through). After the last one it is the
 * first again when `loop` is on, else null. Null too when `currentId` is not in the queue. Pure.
 */
export function nextInQueue<T extends Pick<Movie, 'id' | 'isSeries'>>(items: readonly T[], currentId: string, loop = false): T | null {
  const at = items.findIndex((m) => m.id === currentId)
  if (at < 0) return null
  const after = items.slice(at + 1).find((m) => !m.isSeries)
  if (after) return after
  return loop ? (items.find((m) => !m.isSeries) ?? null) : null
}

/** A random word for `shuffle` (the same seed gives the same order on every page of a queue). */
export function newShuffleSeed(random: () => number = Math.random): string {
  return Math.floor(random() * 36 ** 8).toString(36).padStart(8, '0')
}

/** The title a queue starts with: its first (a series is skipped), in the order for `seed`. Undefined for an empty queue. Pure. */
export function firstOfQueue<T extends Pick<Movie, 'isSeries'>>(items: readonly T[], seed?: string): T | undefined {
  return orderQueue(items, seed).find((m) => !m.isSeries)
}
