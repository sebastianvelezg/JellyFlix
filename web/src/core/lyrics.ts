import { getLyricApi } from '@jellyfin/sdk/lib/utils/api/lyric-api'
import type { Session } from './jellyfin'
import { ticksToSeconds } from './ticks'

/** One line of a song's lyrics; `start` (seconds) is null when the lyrics are not timed. */
export interface LyricLine {
  start: number | null
  text: string
}

export interface Lyrics {
  lines: LyricLine[]
  /** True when the lines have times, so the line being sung can be followed. */
  synced: boolean
}

/** The lyric lines of a server answer; a line without a time (a stray header or a gap) takes the time of the one before it. */
export function parseLyrics(data: { Lyrics?: Array<{ Start?: number | null; Text?: string | null }>; Metadata?: { Offset?: number | null } | null }): Lyrics | null {
  // LRC files may carry a global offset (in ticks) that moves every line.
  const offset = data.Metadata?.Offset ?? 0
  const raw = (data.Lyrics ?? []).map((l) => ({ start: l.Start == null ? null : ticksToSeconds(l.Start + offset), text: l.Text ?? '' }))
  if (!raw.some((l) => l.text.trim() !== '')) return null
  // Timed means most lines have a time; one or two stray lines do not make a song "plain".
  const timed = raw.filter((l) => l.start !== null).length
  if (timed === 0 || timed < raw.length / 2) return { lines: raw.map((l) => ({ ...l, start: null })), synced: false }
  let previous = 0
  const lines = raw.map((l) => {
    const start = Math.max(l.start ?? previous, previous)
    previous = start
    return { start, text: l.text }
  })
  return { lines, synced: true }
}

/** The lyrics the server has for a song (its own tags, or a lyrics plugin such as LrcLib); null when it has none. */
export async function getLyrics(session: Session, trackId: string): Promise<Lyrics | null> {
  let data
  try {
    ;({ data } = await getLyricApi(session.api).getLyrics({ itemId: trackId }))
  } catch (e) {
    // Jellyfin answers 404 for a song without lyrics.
    if ((e as { response?: { status?: number } }).response?.status === 404) return null
    throw e
  }
  return parseLyrics(data)
}

/**
 * Looks for timed lyrics for a song with the server's lyrics plugin (LrcLib and the like) and saves the best one next to the song,
 * where the server will serve it from now on. Returns the new lyrics, or null when no source has timed ones.
 * The server only lets an administrator do this; anyone else gets a 403, which is thrown.
 */
export async function findTimedLyrics(session: Session, trackId: string): Promise<Lyrics | null> {
  const api = getLyricApi(session.api)
  const { data: found } = await api.searchRemoteLyrics({ itemId: trackId })
  const best = found.find((r) => parseLyrics(r.Lyrics)?.synced)
  if (!best) return null
  const { data } = await api.downloadRemoteLyrics({ itemId: trackId, lyricId: best.Id })
  return parseLyrics(data) ?? parseLyrics(best.Lyrics)
}

/** The index of the line being sung at `position` seconds, or -1 before the first one (or when the lyrics are not timed). */
export function currentLyricIndex(lyrics: Lyrics, position: number): number {
  if (!lyrics.synced) return -1
  let found = -1
  for (let i = 0; i < lyrics.lines.length; i++) {
    if ((lyrics.lines[i]?.start ?? Infinity) <= position) found = i
    else break
  }
  return found
}
