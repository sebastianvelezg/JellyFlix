import type { Movie } from '../core'

/**
 * The videos of a row or a grid, kept in memory under a short word when one of them is played, so the route only has to carry the word
 * (`?queue=`) and the player knows what follows. They are not saved: after a reload the word means nothing, and the video goes on with
 * the others of its folder instead.
 */
const MAX_KEPT = 12
const kept = new Map<string, Movie[]>()

/** Keeps `items` (in play order) and returns the word that finds them again. */
export function rememberPlayList(items: readonly Movie[]): string {
  const word = Math.random().toString(36).slice(2, 8)
  kept.set(word, [...items])
  if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value as string)
  return word
}

export function recallPlayList(word: string): Movie[] | undefined {
  return kept.get(word)
}
