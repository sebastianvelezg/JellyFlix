/**
 * "Since your last visit": when you were here before this time. Opening the app again within half an hour counts as the same visit
 * (a reload, a second tab), so what was new stays new until you really come back later. Kept on this device only, for each account
 * (see owner.ts).
 */
import { ownedKey } from './owner'

const KEY = 'jellyflix.visit'

/** A pause longer than this ends a visit. */
export const VISIT_GAP_MS = 30 * 60_000

export interface Visit {
  /** When the previous visit was last seen; none the first time. */
  since?: number
  /** The last time the app was opened. */
  seen: number
}

/** Pure: the visit that starts at `now`, given what was stored. */
export function nextVisit(stored: Partial<Visit> | null | undefined, now: number): Visit {
  const seen = typeof stored?.seen === 'number' && Number.isFinite(stored.seen) ? stored.seen : undefined
  if (seen === undefined) return { seen: now }
  if (now - seen > VISIT_GAP_MS) return { since: seen, seen: now }
  const since = typeof stored?.since === 'number' && Number.isFinite(stored.since) ? stored.since : undefined
  return since === undefined ? { seen: now } : { since, seen: now }
}

/** This page load's visit, and whose it is: a visit is counted for each account that signs in. */
let current: { owner: string; visit: Visit } | null = null

function readStored(key: string): Partial<Visit> | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Visit> | null
  } catch {
    return null
  }
}

/**
 * Starts this visit of the account signed in (once per page load and account) and says when its previous one was, if there was one.
 * With nobody signed in there is no visit.
 */
export function startVisit(now = Date.now()): number | undefined {
  const key = ownedKey(KEY)
  if (!key) return undefined
  if (current?.owner === key) return current.visit.since
  current = { owner: key, visit: nextVisit(readStored(key), now) }
  try {
    localStorage.setItem(key, JSON.stringify(current.visit))
  } catch {
    // A convenience only.
  }
  return current.visit.since
}

/** When the previous visit was, for this page load (see {@link startVisit}). */
export function previousVisit(): number | undefined {
  return startVisit()
}
