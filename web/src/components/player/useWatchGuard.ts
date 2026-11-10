import { useCallback, useEffect, useRef, useState } from 'react'
import {
  decideAtEnd,
  NO_STREAK,
  sleepSecondsLeft,
  sleepState,
  startOfPlayback,
  STILL_WATCHING_ANSWER_SECONDS,
  type Movie,
} from '../../core'
import { t } from '../../i18n'
import { getSleepTimer, getStreak, setSleepTimer, setStreak, useSleepTimer } from '../../platform/web/watchGuard'
import { showToast } from '../toast'

/**
 * "Are you still watching?" and the sleep timer for one title of the player (the rules are in core/watchLimit.ts). The hook gives:
 * - `autoNext`: what to call when the next title is about to start by itself; it starts it, asks first, or stops, as the rules say;
 * - the question (`ask`) and the timer's last half minute (`sleepWarning`) for the overlays, with what their buttons do.
 */
export function useWatchGuard({
  itemId,
  next,
  limit,
  goNext,
  stop,
  flow,
}: {
  itemId: string
  next: Movie | null
  /** After how many titles in a row the question comes (0: never). */
  limit: number
  /** Report where this title stopped and start the next one. */
  goNext: () => Promise<void>
  /** Report where this title stopped and leave the player. */
  stop: () => Promise<void>
  /** Music videos flow into each other: neither the question nor the timer's "end of title" rules apply to them. */
  flow: boolean
}) {
  const timer = useSleepTimer()
  const [asking, setAsking] = useState(false)
  const [answerLeft, setAnswerLeft] = useState(STILL_WATCHING_ANSWER_SECONDS)
  // The clock the timer's warning is drawn from (it moves once a second while a timer by the clock is set).
  const [now, setNow] = useState(() => Date.now())
  const askingRef = useRef(false)

  // A title that a person started begins a new count; one that began by itself carries the count on.
  useEffect(() => {
    setStreak(startOfPlayback(getStreak(), itemId))
  }, [itemId])

  const stopWith = useCallback(
    async (message: string) => {
      setSleepTimer(null)
      showToast({ message })
      await stop()
    },
    [stop],
  )

  // The timers below call the latest `stopWith` without restarting when the player re-renders (its callbacks change identity often):
  // a restart would start the minute of the question, or the clock of the sleep timer, over.
  const stopRef = useRef(stopWith)
  useEffect(() => {
    stopRef.current = stopWith
  }, [stopWith])

  /** The next title is about to begin by itself. */
  const autoNext = useCallback(async () => {
    if (!next || askingRef.current) return
    const decision = decideAtEnd({ streak: getStreak(), limit: flow ? 0 : limit, timer: flow ? null : getSleepTimer(), nextId: next.id, now: Date.now() })
    if (decision.action === 'stop') {
      await stopWith(t('Stopped, as the sleep timer said.'))
      return
    }
    if (decision.action === 'ask') {
      askingRef.current = true
      setAnswerLeft(STILL_WATCHING_ANSWER_SECONDS)
      setAsking(true)
      return
    }
    setStreak(decision.streak)
    await goNext()
  }, [next, limit, flow, goNext, stopWith])

  // The question waits a minute for an answer, then stops.
  useEffect(() => {
    if (!asking) return
    const started = Date.now()
    const clock = setInterval(() => {
      const left = STILL_WATCHING_ANSWER_SECONDS - Math.floor((Date.now() - started) / 1000)
      if (left > 0) {
        setAnswerLeft(left)
        return
      }
      clearInterval(clock)
      askingRef.current = false
      setAsking(false)
      void stopRef.current(t('Stopped: nobody answered “Are you still watching?”.'))
    }, 1000)
    return () => clearInterval(clock)
  }, [asking])

  /** "Keep watching": a new count, and the next title starts. */
  const keepWatching = useCallback(() => {
    askingRef.current = false
    setAsking(false)
    setStreak(NO_STREAK)
    void goNext()
  }, [goNext])

  /** "Stop": leave, with where it stopped saved. */
  const stopWatching = useCallback(() => {
    askingRef.current = false
    setAsking(false)
    void stopWith(t('Stopped.'))
  }, [stopWith])

  // A timer by the clock: a warning for its last half minute (with a way to keep watching), and the stop itself. It counts also while
  // the countdown to the next title runs, and while the video is paused.
  useEffect(() => {
    if (flow || timer?.kind !== 'at') return
    const clock = setInterval(() => {
      const at = Date.now()
      if (sleepState(timer, at) === 'due') {
        clearInterval(clock)
        void stopRef.current(t('Sleep timer finished. Playback stopped.'))
      } else {
        setNow(at)
      }
    }, 1000)
    return () => clearInterval(clock)
  }, [timer, flow])
  const warning = !flow && timer?.kind === 'at' && sleepState(timer, now) === 'warning' ? sleepSecondsLeft(timer, now) : null

  /** This title has ended: with "At the end of this episode" set, nothing follows. */
  const onTitleEnded = useCallback(() => {
    if (!flow && getSleepTimer()?.kind === 'episodeEnd') void stopWith(t('Stopped at the end of the episode.'))
  }, [flow, stopWith])

  return {
    /** Call when the next title is about to start by itself. */
    autoNext,
    /** Call when this title has ended. */
    onTitleEnded,
    /** The question is showing, and the seconds left to answer. */
    asking,
    answerLeft,
    keepWatching,
    stopWatching,
    /** Seconds left of a timer in its last half minute, or null. */
    sleepWarning: warning,
    /** "Keep watching" on the timer's warning: the timer is cancelled. */
    cancelSleep: () => setSleepTimer(null),
  }
}
