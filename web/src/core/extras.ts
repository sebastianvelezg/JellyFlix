import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getMediaSegmentApi } from '@jellyfin/sdk/lib/utils/api/media-segment-api'
import type { Session } from './jellyfin'
import { TICKS_PER_SECOND } from './ticks'

/** A stretch of a video the viewer may want to skip. */
export interface Segment {
  kind: 'intro' | 'recap' | 'outro' | 'preview'
  startSeconds: number
  endSeconds: number
}

export interface Chapter {
  name: string
  startSeconds: number
}

/** Things that make playback nicer but are never required: a server without them just yields empty lists. */
export interface PlaybackExtras {
  segments: Segment[]
  chapters: Chapter[]
}

export const NO_EXTRAS: PlaybackExtras = { segments: [], chapters: [] }

const SEGMENT_KINDS: Record<string, Segment['kind']> = { Intro: 'intro', Recap: 'recap', Outro: 'outro', Preview: 'preview' }

/**
 * Intro/recap/credits segments (Jellyfin 10.10+, filled in by a segment provider plugin) and chapter
 * markers. Never throws: if the server has neither, or does not support them, the lists are empty.
 */
export async function getPlaybackExtras(session: Session, itemId: string): Promise<PlaybackExtras> {
  const [segments, chapters] = await Promise.all([
    getMediaSegmentApi(session.api)
      .getItemSegments({ itemId })
      .then(({ data }) =>
        (data.Items ?? [])
          .map((s): Segment | null => {
            const kind = SEGMENT_KINDS[s.Type ?? '']
            if (!kind || s.StartTicks == null || s.EndTicks == null || s.EndTicks <= s.StartTicks) return null
            return { kind, startSeconds: s.StartTicks / TICKS_PER_SECOND, endSeconds: s.EndTicks / TICKS_PER_SECOND }
          })
          .filter((s): s is Segment => s !== null)
          .sort((a, b) => a.startSeconds - b.startSeconds),
      )
      .catch((): Segment[] => []),
    getLibraryApi(session.api)
      .getItems({ userId: session.userId, ids: [itemId], fields: [ItemFields.Chapters] })
      .then(({ data }) =>
        (data.Items?.[0]?.Chapters ?? [])
          .map((c, i): Chapter => ({
            name: c.Name?.trim() || `Chapter ${i + 1}`,
            startSeconds: (c.StartPositionTicks ?? 0) / TICKS_PER_SECOND,
          }))
          .sort((a, b) => a.startSeconds - b.startSeconds),
      )
      .catch((): Chapter[] => []),
  ])
  return { segments, chapters: chapters.length > 1 ? chapters : [] }
}

/** The segment the playhead is in, if any (the last second of it does not count, so a skip does not re-trigger). */
export function activeSegment(segments: Segment[], position: number): Segment | undefined {
  return segments.find((s) => position >= s.startSeconds - 0.25 && position < s.endSeconds - 1)
}

/** The chapter playing at `position`. */
export function chapterAt(chapters: Chapter[], position: number): Chapter | undefined {
  let current: Chapter | undefined
  for (const chapter of chapters) {
    if (chapter.startSeconds <= position + 0.01) current = chapter
    else break
  }
  return current
}
