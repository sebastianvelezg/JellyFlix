/**
 * Two ways to keep a video from playing on and on when nobody is watching: "Are you still watching?" after a number of titles that
 * followed one another by themselves, and a sleep timer. The rules are here, apart from any screen, so they can be tested (and the TV
 * app follows the same ones).
 *
 * - **The count** is the titles of one run: the one a person started (1), and each one that then began by itself. It starts again
 *   whenever a person starts a title, answers "Still watching", or leaves the player (a run is only carried from one title to the next
 *   one that began by itself, see {@link startOfPlayback}). A reload, a sign out or another account also start from nothing.
 * - **At the limit** the next title does not begin: a question is shown. Answering "Keep watching" starts it (and a new count);
 *   "Stop", or no answer in a minute, stops. Where the title stopped is already saved by the usual end-of-playback report.
 * - **The sleep timer** stops after a time chosen, or when the title now playing ends. It keeps counting during the countdown to the
 *   next title, and it wins over it: when both would apply, nothing new starts. It is not remembered across a reload.
 * - With the limit off and no timer, nothing here changes how autoplay works.
 */

/** After how many titles in a row the question comes (0: never). */
export const STILL_WATCHING_CHOICES = [0, 2, 3, 4, 6, 8] as const

/** Seconds the question waits for an answer before it stops the playback. */
export const STILL_WATCHING_ANSWER_SECONDS = 60

export const SLEEP_MINUTES = [15, 30, 45, 60, 90, 120] as const

/** The timer says it is about to stop this many seconds before, with a way to keep watching. */
export const SLEEP_WARNING_SECONDS = 30

export interface Streak {
  /** Titles watched in this run, counting the one now playing. */
  count: number
  /** The title that began by itself and has not started yet: when it does, the run goes on; anything else starts a new one. */
  pendingFor: string | null
  /** The title whose start was already counted, so that counting it twice (a screen drawn again) changes nothing. */
  startedFor: string | null
}

export const NO_STREAK: Streak = { count: 0, pendingFor: null, startedFor: null }

/** A title starts playing. It is a continuation only when it is the one that was just started by itself. Safe to call twice. */
export function startOfPlayback(streak: Streak, itemId: string): Streak {
  if (streak.startedFor === itemId) return streak
  if (streak.pendingFor === itemId) return { count: Math.max(1, streak.count), pendingFor: null, startedFor: itemId }
  return { count: 1, pendingFor: null, startedFor: itemId }
}

export type SleepTimer = { kind: 'at'; endsAt: number } | { kind: 'episodeEnd' }

export function sleepAfterMinutes(minutes: number, now: number): SleepTimer {
  return { kind: 'at', endsAt: now + minutes * 60_000 }
}

export type SleepState = 'running' | 'warning' | 'due'

/** What a timer by the clock is doing at `now`. */
export function sleepState(timer: Extract<SleepTimer, { kind: 'at' }>, now: number): SleepState {
  const left = timer.endsAt - now
  if (left <= 0) return 'due'
  return left <= SLEEP_WARNING_SECONDS * 1000 ? 'warning' : 'running'
}

/** Whole seconds left on a timer by the clock (0 when it is due). */
export function sleepSecondsLeft(timer: Extract<SleepTimer, { kind: 'at' }>, now: number): number {
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
}

export type EndDecision =
  /** Do not start anything: the timer says to stop here. */
  | { action: 'stop' }
  /** Ask "Are you still watching?" before the next title. */
  | { action: 'ask' }
  /** Start the next title by itself; `streak` is the run to carry to it. */
  | { action: 'continue'; streak: Streak }

/**
 * A title has ended and the next one is about to begin by itself. `limit` is "after how many titles" (0: never), `nextId` the title
 * that would start.
 */
export function decideAtEnd(input: { streak: Streak; limit: number; timer: SleepTimer | null; nextId: string; now: number }): EndDecision {
  const { streak, limit, timer, nextId, now } = input
  // The timer first: it stops the title that is ending, with no question and no next title.
  if (timer?.kind === 'episodeEnd') return { action: 'stop' }
  if (timer?.kind === 'at' && now >= timer.endsAt) return { action: 'stop' }
  if (limit > 0 && streak.count >= limit) return { action: 'ask' }
  return { action: 'continue', streak: { count: streak.count + 1, pendingFor: nextId, startedFor: streak.startedFor } }
}
