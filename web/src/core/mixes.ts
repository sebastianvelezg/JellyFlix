import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { getInstantMixApi } from '@jellyfin/sdk/lib/utils/api/instant-mix-api'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import type { Session } from './jellyfin'
import { getFavoriteTracks, getRandomTracks, getRecentlyPlayedTracks, toTrack, type Track } from './music'

/**
 * Songs picked for you. "Radio" is the server's own instant mix (songs that go with an artist, an album or a song);
 * the mix of the day blends what you favour and play lately with the radios of the artists you come back to most.
 */

/** How many songs a radio asks for. */
export const RADIO_SIZE = 50
/** How many songs the mix of the day has. */
export const DAY_MIX_SIZE = 40

const toTracks = (items: Parameters<typeof toTrack>[0][] | null | undefined): Track[] =>
  (items ?? []).map(toTrack).filter((t): t is Track => t !== null)

/** Songs that go with an artist. */
export async function getArtistRadio(session: Session, artistId: string, limit = RADIO_SIZE): Promise<Track[]> {
  const { data } = await getInstantMixApi(session.api).getInstantMixFromArtists({
    itemId: artistId,
    userId: session.userId,
    limit,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return toTracks(data.Items)
}

/** Songs that go with an album. */
export async function getAlbumRadio(session: Session, albumId: string, limit = RADIO_SIZE): Promise<Track[]> {
  const { data } = await getInstantMixApi(session.api).getInstantMixFromAlbum({
    itemId: albumId,
    userId: session.userId,
    limit,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return toTracks(data.Items)
}

/** Songs that go with one song (it is not repeated at the start: the caller puts it first). */
export async function getSongRadio(session: Session, trackId: string, limit = RADIO_SIZE): Promise<Track[]> {
  const { data } = await getInstantMixApi(session.api).getInstantMixFromSong({
    itemId: trackId,
    userId: session.userId,
    limit,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  return toTracks(data.Items)
}

/** Songs by their ids, in the order of the ids (a song that is gone from the server is left out). */
export async function getTracksByIds(session: Session, ids: string[]): Promise<Track[]> {
  if (ids.length === 0) return []
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    ids,
    includeItemTypes: [BaseItemKind.Audio],
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const byId = new Map(toTracks(data.Items).map((t) => [t.id, t]))
  return ids.map((id) => byId.get(id)).filter((t): t is Track => t !== undefined)
}

// ---- the mix of the day ----------------------------------------------------------------------------------------

/** The day a mix belongs to, in the viewer's own calendar ("2026-10-26"). Pure. */
export function dayKey(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** A small deterministic random generator (mulberry32) seeded from text, so "of the day" can be reproduced. Pure. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let state = h >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A shuffled copy that is the same for the same seed. Pure. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = seededRandom(seed)
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j] as T, result[i] as T]
  }
  return result
}

/**
 * The artists whose songs show up most in what you favour and play lately (what you played lately counts double),
 * most first; ties are broken by the day's seed so they rotate from day to day. Pure.
 */
export function favouriteArtists(favorites: readonly Track[], recent: readonly Track[], count: number, seed: string): string[] {
  const score = new Map<string, number>()
  const add = (tracks: readonly Track[], weight: number) => {
    for (const t of tracks) if (t.artistId) score.set(t.artistId, (score.get(t.artistId) ?? 0) + weight)
  }
  add(favorites, 1)
  add(recent, 2)
  const tiebreak = new Map(seededShuffle([...score.keys()], seed).map((id, index) => [id, index]))
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || (tiebreak.get(a[0]) ?? 0) - (tiebreak.get(b[0]) ?? 0))
    .slice(0, count)
    .map(([id]) => id)
}

/**
 * Takes one song from each list in turn (so no one source or artist fills the start), skipping songs already taken and
 * songs by the same artist as the one just before when another choice exists. Pure.
 */
export function blendMix(parts: ReadonlyArray<readonly Track[]>, size: number): Track[] {
  const queues = parts.map((p) => [...p])
  const taken = new Set<string>()
  const mix: Track[] = []
  let turn = 0
  while (mix.length < size) {
    const last = mix[mix.length - 1]
    const order = queues.map((_, i) => (turn + i) % queues.length)
    // The list whose turn it is, unless it only has the artist just played: then the next list that has another one.
    let pick: { list: number; at: number } | null = null
    for (const list of order) {
      const at = (queues[list] as Track[]).findIndex((t) => !taken.has(t.id) && !(last && t.artistId && t.artistId === last.artistId))
      if (at >= 0) {
        pick = { list, at }
        break
      }
    }
    if (!pick) {
      for (const list of order) {
        const at = (queues[list] as Track[]).findIndex((t) => !taken.has(t.id))
        if (at >= 0) {
          pick = { list, at }
          break
        }
      }
    }
    if (!pick) break
    const [song] = (queues[pick.list] as Track[]).splice(pick.at, 1)
    if (song) {
      taken.add(song.id)
      mix.push(song)
    }
    turn = (pick.list + 1) % queues.length
  }
  return mix
}

/**
 * Today's mix: a few of your favourites, the radios of the artists you play most, and a handful of random songs for
 * surprise (all of them if there is nothing to go by yet). `seed` should be the day plus something of yours.
 */
export async function buildMixOfTheDay(session: Session, libraryId: string | undefined, seed: string): Promise<Track[]> {
  const [favorites, recent] = await Promise.all([
    getFavoriteTracks(session, libraryId, 60).catch(() => [] as Track[]),
    getRecentlyPlayedTracks(session, libraryId, 30).catch(() => [] as Track[]),
  ])
  const artists = favouriteArtists(favorites, recent, 3, seed)
  const radios = await Promise.all(artists.map((id) => getArtistRadio(session, id, 25).catch(() => [] as Track[])))
  const surprise = await getRandomTracks(session, libraryId, artists.length > 0 ? 15 : DAY_MIX_SIZE).catch(() => [] as Track[])
  const parts = [
    seededShuffle(favorites, `${seed}:favorites`).slice(0, 12),
    ...radios.map((r, i) => seededShuffle(r, `${seed}:radio${i}`)),
    seededShuffle(surprise, `${seed}:surprise`),
  ]
  return blendMix(parts, DAY_MIX_SIZE)
}
