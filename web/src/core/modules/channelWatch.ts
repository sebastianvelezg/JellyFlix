import { getUserDataApi } from '@jellyfin/sdk/lib/utils/api/user-data-api'
import type { Session } from '../jellyfin'

/** A program played this far counts as watched (Jellyfin marks a title played near its end on its own). */
export const WATCHED_FRACTION = 0.9

/**
 * Watching a retro TV channel plays a title like any other, so Jellyfin would keep the place where the viewer left it and offer it in
 * "Continue watching". A channel is not a place to resume: when the viewer leaves a program before the end, the position it had before
 * the channel touched it is put back. (A program watched to the end is left alone: it counts as watched.)
 * Returns whether it put the position back.
 */
export async function restoreResumePosition(
  session: Session,
  itemId: string,
  previousTicks: number,
  playedSeconds: number,
  runtimeSeconds: number,
): Promise<boolean> {
  if (runtimeSeconds > 0 && playedSeconds / runtimeSeconds >= WATCHED_FRACTION) return false
  try {
    await getUserDataApi(session.api).updateItemUserData({ itemId, userId: session.userId, updateUserItemDataDto: { PlaybackPositionTicks: previousTicks } })
    return true
  } catch {
    // Not being able to tidy up is not worth telling anybody about.
    return false
  }
}
