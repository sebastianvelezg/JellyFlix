/**
 * The "Up next" card of the player. While a title nears its end it shows what follows (so you can jump straight to it
 * during the credits); once the title has ended it counts down and starts the next one by itself, unless you cancelled.
 */

/** The card appears this many seconds before the end... */
export const UP_NEXT_PREVIEW_SECONDS = 20
/** ...but only in a title at least this long (in a short clip it would sit on the picture the whole time). */
export const UP_NEXT_MIN_RUNTIME_SECONDS = 90

/**
 * Music videos flow into one another: the countdown runs over their last seconds (not after they end), and the next one starts the
 * moment the video ends.
 */
export const FLOW_COUNTDOWN_SECONDS = 3

/**
 * hidden: no card. preview: near the end, with "Play now" only. counting: autoplay is on and the countdown runs (after the title
 * ended, or, in a flow, over its last seconds). waiting: ended and autoplay is off, so the card just waits for you.
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
  /** The next title follows without a pause (music videos): see {@link FLOW_COUNTDOWN_SECONDS}. */
  flow?: boolean
}): UpNextPhase {
  if (!state.hasNext || state.dismissed || state.error) return 'hidden'
  if (state.ended) return state.autoplay ? 'counting' : 'waiting'
  if (state.flow && state.autoplay && state.durationSeconds > 0 && state.remainingSeconds <= FLOW_COUNTDOWN_SECONDS) return 'counting'
  const known = state.durationSeconds >= UP_NEXT_MIN_RUNTIME_SECONDS
  return known && state.remainingSeconds <= UP_NEXT_PREVIEW_SECONDS ? 'preview' : 'hidden'
}
