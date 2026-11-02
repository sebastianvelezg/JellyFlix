import { useCallback, useEffect, useRef, useState } from 'react'
import { FLOW_COUNTDOWN_SECONDS, upNextPhase, type Movie } from '../../core'

/**
 * The "Up next" card and what follows the end of a title. Near the end the card shows what comes next; once the title ends it counts
 * down (when autoplay is on) and moves on. One music video after another is meant to flow: the countdown runs over the last seconds of
 * the video itself, and the next one starts the moment it ends.
 */
export function useUpNext({
  flow,
  next,
  error,
  autoplay,
  duration,
  currentTime,
  countdownSeconds,
  goNext,
  onNext,
}: {
  flow: boolean
  next: Movie | null
  error: boolean
  autoplay: boolean
  duration: number
  currentTime: number
  /** After a title ends the next one starts by itself once this many seconds have counted down (chosen in Settings). */
  countdownSeconds: number
  goNext: () => Promise<void>
  onNext?: () => void
}) {
  // Set when a title finishes; counts down, then starts the next one.
  const [ended, setEnded] = useState(false)
  // Set once a flow has moved on to the next video, so that it happens once.
  const advanced = useRef(false)
  const [dismissed, setDismissed] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(countdownSeconds)

  /** The video is playing (again): whatever the end had started is over. */
  const markPlaying = useCallback(() => {
    setEnded(false)
    advanced.current = false
    setSecondsLeft(countdownSeconds)
  }, [countdownSeconds])
  const markEnded = useCallback(() => setEnded(true), [])

  const phase = upNextPhase({
    hasNext: !!next,
    ended,
    remainingSeconds: duration - currentTime,
    durationSeconds: duration,
    dismissed,
    autoplay,
    error,
    flow,
  })
  const visible = phase !== 'hidden'
  const counting = phase === 'counting'
  // A flow counts with the video itself (its last seconds); anything else counts on a clock once the title has ended.
  const timed = counting && !flow
  useEffect(() => {
    if (!timed) return
    const timer = setInterval(() => setSecondsLeft((n) => n - 1), 1000)
    return () => clearInterval(timer)
  }, [timed])
  useEffect(() => {
    if (timed && secondsLeft <= 0) void goNext()
  }, [timed, secondsLeft, goNext])
  // The video ended and the next one follows: straight away (the end was already reported to the server when the video ended).
  useEffect(() => {
    if (!flow || !counting || !ended || advanced.current || !onNext) return
    advanced.current = true
    onNext()
  }, [flow, counting, ended, onNext])
  const flowSeconds = Math.min(FLOW_COUNTDOWN_SECONDS, Math.max(0, duration - currentTime))
  const shownSeconds = flow ? Math.max(1, Math.ceil(flowSeconds)) : Math.max(0, secondsLeft)

  return {
    ended,
    phase,
    visible,
    counting,
    flowSeconds,
    shownSeconds,
    secondsLeft,
    dismiss: () => setDismissed(true),
    markPlaying,
    markEnded,
  }
}
