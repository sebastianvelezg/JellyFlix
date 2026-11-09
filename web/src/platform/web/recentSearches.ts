import { ownedKey } from './owner'

/** The last things you searched for, kept on this device only (never sent anywhere), for the account signed in (see owner.ts). */
const KEY = 'jellyflix.recentSearches'
export const RECENT_LIMIT = 8

export function readRecentSearches(): string[] {
  try {
    const key = ownedKey(KEY)
    const parsed: unknown = JSON.parse((key && localStorage.getItem(key)) || '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

function write(list: string[]): void {
  try {
    const key = ownedKey(KEY)
    if (key) localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // A convenience only.
  }
}

/** Puts a search at the top of the list (a repeat moves up instead of appearing twice); returns the new list. */
export function addRecentSearch(term: string): string[] {
  const clean = term.trim().replace(/\s+/g, ' ')
  if (!clean) return readRecentSearches()
  const next = [clean, ...readRecentSearches().filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, RECENT_LIMIT)
  write(next)
  return next
}

export function clearRecentSearches(): string[] {
  try {
    const key = ownedKey(KEY)
    if (key) localStorage.removeItem(key)
  } catch {
    // A convenience only.
  }
  return []
}
