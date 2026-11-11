import { restoreResumePosition } from '../../core/modules'
import type { Session } from '../../core'

/**
 * A restore that did not get to happen. Watching a channel changes the place a title has in Jellyfin, and the page puts it back when the
 * viewer leaves; if the page dies first (closed tab, crash, lost network) what was held here is used on the next visit.
 */

const PENDING_KEY = 'jellyflix.channel.pending'
/** An entry not touched for this long belongs to a viewer who is gone (the one watching keeps it fresh), so it is safe to tidy. */
export const PENDING_STALE_SECONDS = 120
/** How often the place being watched is written down. */
export const PENDING_SAVE_EVERY_SECONDS = 10

interface Pending {
  userId: string
  itemId: string
  ticks: number
  runtime: number
  played: number
  /** Seconds since the epoch of the last time this entry was written. */
  at: number
}

function readPending(): Record<string, Pending> {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, Pending>) : {}
  } catch {
    return {}
  }
}

function writePending(all: Record<string, Pending>): void {
  try {
    if (Object.keys(all).length === 0) localStorage.removeItem(PENDING_KEY)
    else localStorage.setItem(PENDING_KEY, JSON.stringify(all))
  } catch {
    // Without storage the tidy-up still happens when the viewer leaves the program; only a crash is not covered.
  }
}

/** A title starts to be watched on a channel: if the page dies before the place is put back, the next visit does it. */
export function markWatching(userId: string, itemId: string, ticks: number, runtime: number, nowSeconds = Date.now() / 1000): void {
  const all = readPending()
  all[`${userId}|${itemId}`] = { userId, itemId, ticks, runtime, played: 0, at: nowSeconds }
  writePending(all)
}

/** How far the channel has played the title (kept fresh while it is watched). */
export function noteWatched(userId: string, itemId: string, played: number, nowSeconds = Date.now() / 1000): void {
  const all = readPending()
  const entry = all[`${userId}|${itemId}`]
  if (!entry) return
  entry.played = played
  entry.at = nowSeconds
  writePending(all)
}

/** The place was put back (or there was nothing to put back). */
export function doneWatching(userId: string, itemId: string): void {
  const all = readPending()
  if (delete all[`${userId}|${itemId}`]) writePending(all)
}

/** Puts back the places of titles whose viewer left without the page getting to do it. */
export async function restoreLeftOver(session: Session, nowSeconds = Date.now() / 1000): Promise<number> {
  let restored = 0
  for (const entry of Object.values(readPending())) {
    if (entry.userId !== session.userId || nowSeconds - entry.at < PENDING_STALE_SECONDS) continue
    if (await restoreResumePosition(session, entry.itemId, entry.ticks, entry.played, entry.runtime)) restored += 1
    doneWatching(entry.userId, entry.itemId)
  }
  return restored
}
