import { getUserDataApi } from '@jellyfin/sdk/lib/utils/api/user-data-api'
import type { Session } from '../jellyfin'

/** A program played this far counts as watched (Jellyfin marks a title played near its end on its own). */
export const WATCHED_FRACTION = 0.9

/**
 * How far the position Jellyfin holds may be from where the channel's own playback left off and still count as "what the channel did".
 * The player reports its place every few seconds, so a little slack is normal; more means somebody else moved it.
 */
export const OWN_PLACE_SLACK_SECONDS = 90

const TICKS = 10_000_000

/**
 * Watching a retro TV channel plays a title like any other, so Jellyfin would keep the place where the viewer left it and offer it in
 * "Continue watching". A channel is not a place to resume: when the viewer leaves a program before the end, the position it had before
 * the channel touched it is put back. (A program watched to the end is left alone: it counts as watched.)
 *
 * It is put back only if the position Jellyfin holds now is the one the channel left (where `playedSeconds` was, give or take the
 * player's reporting). If it is somewhere else, the same title was being watched meanwhile on another device (or here, by hand) and
 * that is progress the viewer made: it is not overwritten. Returns whether it put the position back.
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
    const { data } = await getUserDataApi(session.api).getItemUserData({ itemId, userId: session.userId })
    const now = data.PlaybackPositionTicks ?? 0
    // Nothing to put back when the title is already where it was before; and when it is somewhere that is not where the channel left it,
    // somebody else put it there.
    if (now === previousTicks) return false
    if (Math.abs(now / TICKS - playedSeconds) > OWN_PLACE_SLACK_SECONDS) return false
    await getUserDataApi(session.api).updateItemUserData({ itemId, userId: session.userId, updateUserItemDataDto: { PlaybackPositionTicks: previousTicks } })
    return true
  } catch {
    // Not being able to tidy up is not worth telling anybody about.
    return false
  }
}
