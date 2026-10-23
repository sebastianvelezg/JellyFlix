import { getSubtitleApi } from '@jellyfin/sdk/lib/utils/api/subtitle-api'
import type { Session } from './jellyfin'
import type { PlaybackPlan } from './playback'

/**
 * The first request for an embedded subtitle makes the server extract it from the video file, which on a
 * NAS and a large file can take far longer than an ordinary API call (later requests are instant).
 */
const SUBTITLE_TIMEOUT_MS = 120_000

/**
 * Downloads one text subtitle track converted to WebVTT by the server. The request carries the
 * Authorization header, which a player's own subtitle fetch (e.g. ) could not send.
 * Turning the text into something a player can show (blob URL, native cue list) is the platform's job.
 */
export async function fetchSubtitleVtt(
  session: Session,
  plan: PlaybackPlan,
  streamIndex: number,
): Promise<string> {
  const { data } = await getSubtitleApi(session.api).getSubtitle(
    {
      routeItemId: plan.itemId,
      routeMediaSourceId: plan.mediaSourceId,
      routeIndex: streamIndex,
      routeFormat: 'vtt',
    },
    { responseType: 'text', timeout: SUBTITLE_TIMEOUT_MS },
  )
  return typeof data === 'string' ? data : await (data as Blob).text()
}
