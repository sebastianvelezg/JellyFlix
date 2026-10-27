/**
 * The "Up next" card of the player. While a title nears its end it shows what follows (so you can jump straight to it
 * during the credits); once the title has ended it counts down and starts the next one by itself, unless you cancelled.
 */

/** The card appears this many seconds before the end... */
export const UP_NEXT_PREVIEW_SECONDS = 20
/** ...but only in a title at least this long (in a short clip it would sit on the picture the whole time). */
export const UP_NEXT_MIN_RUNTIME_SECONDS = 90

/**
 * hidden: no card. preview: near the end, with "Play now" only. counting: ended and autoplay is on, the countdown runs.
 * waiting: ended and autoplay is off, so the card just waits for you.
 */
export type UpNextPhase = 'hidden' | 'preview' | 'counting' | 'waiting'

export function upNextPhase(state: {
  hasNext: boolean
  ended: boolean
  /** Seconds left to play at the current position (the length when it is not known yet is 0, which counts as unknown). */
  remainingSeconds: number
  durationSeconds: number
  /** The viewer closed the card for this title. */
  dismissed: boolean
  autoplay: boolean
  error: boolean
}): UpNextPhase {
  if (!state.hasNext || state.dismissed || state.error) return 'hidden'
  if (state.ended) return state.autoplay ? 'counting' : 'waiting'
  const known = state.durationSeconds >= UP_NEXT_MIN_RUNTIME_SECONDS
  return known && state.remainingSeconds <= UP_NEXT_PREVIEW_SECONDS ? 'preview' : 'hidden'
}
