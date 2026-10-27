/**
 * The mix of the day is made once a day and remembered, so it is the same all day and opening Music is quick.
 * Only song ids and the day are kept (no names, no session). Harmless to lose: the next visit makes a new one.
 */
const KEY = 'jellyflix.daymix'

export interface StoredDayMix {
  /** The day it was made for ("2026-10-26"), in the viewer's calendar. */
  day: string
  /** Whose mix it is (a user id), so two accounts on one browser do not share one. */
  owner: string
  ids: string[]
}

export function readDayMix(day: string, owner: string): string[] | null {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StoredDayMix> | null
    if (!stored || stored.day !== day || stored.owner !== owner || !Array.isArray(stored.ids)) return null
    const ids = stored.ids.filter((id): id is string => typeof id === 'string')
    return ids.length > 0 ? ids : null
  } catch {
    return null
  }
}

export function writeDayMix(mix: StoredDayMix): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mix))
  } catch {
    // The mix is a convenience only.
  }
}

export function clearDayMix(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}
