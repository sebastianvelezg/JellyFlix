import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getPlaylistApi } from '@jellyfin/sdk/lib/utils/api/playlist-api'
import { shareWhileRunning } from './inFlight'
import type { Session } from './jellyfin'
import { toMovie, type Movie } from './library'
import { toEpisode } from './shows'

/**
 * Playlists of movies and episodes (the ones of songs are in `music.ts`). They live on the server, so they follow you to every
 * device. Everything here that changes one is a plain call that either works or throws; the interface says what it did.
 */

export interface VideoPlaylist {
  id: string
  name: string
  imageTag?: string
  /** How many titles it holds, when the server says. */
  itemCount?: number
}

/** One place in a playlist. The same title can be there twice, so each place has its own id. */
export interface PlaylistEntry {
  entryId: string
  item: Movie
}

/** The playlist that "Watch later" means. It is recognised by name, in either language of the app. */
export const WATCH_LATER_NAMES = ['Watch later', 'Ver más tarde'] as const

export function isWatchLater(playlist: Pick<VideoPlaylist, 'name'>): boolean {
  return WATCH_LATER_NAMES.some((name) => name.toLowerCase() === playlist.name.trim().toLowerCase())
}

export function findWatchLater(playlists: VideoPlaylist[]): VideoPlaylist | undefined {
  return playlists.find(isWatchLater)
}

function toPlaylist(dto: BaseItemDto): VideoPlaylist | null {
  if (!dto.Id || !dto.Name) return null
  return { id: dto.Id, name: dto.Name, imageTag: dto.ImageTags?.Primary ?? undefined, itemCount: dto.ChildCount ?? undefined }
}

/** The video playlists. The rows of the main page that each need them share one request. */
export function getVideoPlaylists(session: Session): Promise<VideoPlaylist[]> {
  return shareWhileRunning(session, 'video-playlists', async () => {
    const { data } = await getLibraryApi(session.api).getItems({
      userId: session.userId,
      includeItemTypes: [BaseItemKind.Playlist],
      mediaTypes: [MediaType.Video],
      recursive: true,
      sortBy: [ItemSortBy.SortName],
      sortOrder: [SortOrder.Ascending],
      enableImages: true,
      imageTypeLimit: 1,
    })
    return (data.Items ?? []).map(toPlaylist).filter((p): p is VideoPlaylist => p !== null)
  })
}

export async function getVideoPlaylist(session: Session, id: string): Promise<VideoPlaylist> {
  const { data } = await getLibraryApi(session.api).getItem({ itemId: id, userId: session.userId })
  const playlist = toPlaylist(data)
  if (!playlist) throw new Error('That playlist is no longer available.')
  return playlist
}

export async function getPlaylistEntries(session: Session, playlistId: string): Promise<PlaylistEntry[]> {
  const { data } = await getPlaylistApi(session.api).getPlaylistItems({
    playlistId,
    userId: session.userId,
    limit: 500,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const entries: PlaylistEntry[] = []
  for (const dto of data.Items ?? []) {
    const item = toEpisode(dto) ?? toMovie(dto)
    if (item && dto.PlaylistItemId) entries.push({ entryId: dto.PlaylistItemId, item })
  }
  return entries
}

/** Makes a playlist (with these titles in it, if any) and returns its id. */
export async function createVideoPlaylist(session: Session, name: string, itemIds: string[] = []): Promise<string> {
  const clean = name.trim()
  if (!clean) throw new Error('Give the playlist a name.')
  const { data } = await getPlaylistApi(session.api).createPlaylist({
    createPlaylistDto: { Name: clean, Ids: itemIds, UserId: session.userId, MediaType: MediaType.Video, IsPublic: false },
  })
  if (!data.Id) throw new Error('The server did not create the playlist.')
  return data.Id
}

/** Adds titles to the end of a playlist, or at `position` (0 is the first place). */
export async function addToPlaylist(session: Session, playlistId: string, itemIds: string[], position?: number): Promise<void> {
  await getPlaylistApi(session.api).addItemToPlaylist({ playlistId, ids: itemIds, userId: session.userId, position })
}

/**
 * Puts a title in the "Watch later" playlist, making the playlist first if there is none (named `name`, in the language of the app).
 * A title that is already there is not added twice.
 */
export async function addToWatchLater(
  session: Session,
  itemId: string,
  name: string,
): Promise<{ playlistId: string; created: boolean; already: boolean }> {
  const existing = findWatchLater(await getVideoPlaylists(session))
  if (!existing) return { playlistId: await createVideoPlaylist(session, name, [itemId]), created: true, already: false }
  const entries = await getPlaylistEntries(session, existing.id)
  if (entries.some((e) => e.item.id === itemId)) return { playlistId: existing.id, created: false, already: true }
  await addToPlaylist(session, existing.id, [itemId])
  return { playlistId: existing.id, created: false, already: false }
}

/** Takes the given places out of a playlist (`entryId` of each entry, not the title's id). */
export async function removeFromPlaylist(session: Session, playlistId: string, entryIds: string[]): Promise<void> {
  await getPlaylistApi(session.api).removeItemFromPlaylist({ playlistId, entryIds })
}

/** Moves one place of a playlist to another position (0 is the first). */
export async function moveInPlaylist(session: Session, playlistId: string, entryId: string, newIndex: number): Promise<void> {
  await getPlaylistApi(session.api).moveItem({ playlistId, itemId: entryId, newIndex })
}

export async function renamePlaylist(session: Session, playlistId: string, name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) throw new Error('Give the playlist a name.')
  await getPlaylistApi(session.api).updatePlaylist({ playlistId, updatePlaylistDto: { Name: clean } })
}

export async function deletePlaylist(session: Session, playlistId: string): Promise<void> {
  await getLibraryApi(session.api).deleteItem({ itemId: playlistId })
}

/** Where an entry ends up when it is moved one place up (-1) or down (+1); null at the ends. Pure. */
export function targetIndex(index: number, direction: -1 | 1, length: number): number | null {
  const to = index + direction
  return to < 0 || to >= length ? null : to
}

/** The list as it looks after a move, so it can be shown at once while the server catches up. Pure. */
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved as T)
  return next
}
