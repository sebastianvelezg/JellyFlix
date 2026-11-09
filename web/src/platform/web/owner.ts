/**
 * Whose things this device keeps. What one account does here (its searches, the audio and subtitles it picked for a series, where it
 * stopped in a book, its last visit) is kept under that account's id, so another account signing in on the same browser (a child, a
 * guest) never sees it. With nobody signed in nothing is read or written.
 *
 * The keys below were once kept for whoever was signed in, without an owner. Those copies cannot be given back to the right account,
 * so they are dropped the first time anyone signs in.
 */
const UNOWNED = ['jellyflix.recentSearches', 'jellyflix.series', 'jellyflix.subsync', 'jellyflix.books', 'jellyflix.visit'] as const

let owner: string | null = null

/** Called with the account's id as soon as a session starts, and with null when it ends. */
export function setStorageOwner(userId: string | null): void {
  const next = userId?.trim() || null
  if (next === owner) return
  owner = next
  if (!next) return
  try {
    for (const key of UNOWNED) localStorage.removeItem(key)
  } catch {
    // Storage blocked: there is nothing to clean up either.
  }
}

/** The key `base` has for the account signed in, or null with nobody signed in. */
export function ownedKey(base: string): string | null {
  return owner ? `${base}:${owner}` : null
}
