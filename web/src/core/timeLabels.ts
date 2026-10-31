import { formatTime } from './ticks'

/** What a time label beside the seek bar can show. */
export type TimeLabelKind = 'elapsed' | 'remaining' | 'total' | 'endsAt' | 'none'

export interface TimeLabelState {
  currentTime: number
  duration: number
  /** Playback speed (the time it will end at depends on it). */
  speed: number
  /** The wall clock, in milliseconds, at the moment `currentTime` was read. */
  now: number
  /** The language for the clock time ("en", "es"). */
  locale?: string
}

/**
 * The text of one label: "12:30" (elapsed), "-1:03:20" (remaining), "1:45:50" (total), "9:42 PM" (the time it ends at the
 * speed it plays now). `null` when there is nothing to show (nothing chosen, or no length yet).
 */
export function timeLabelText(kind: TimeLabelKind, state: TimeLabelState): string | null {
  const { currentTime, duration, speed, now, locale } = state
  switch (kind) {
    case 'elapsed':
      return formatTime(currentTime)
    case 'total':
      return duration > 0 ? formatTime(duration) : null
    case 'remaining':
      return duration > 0 ? `-${formatTime(Math.max(0, duration - currentTime))}` : null
    case 'endsAt': {
      if (!(duration > 0) || !(speed > 0)) return null
      const end = new Date(now + (Math.max(0, duration - currentTime) / speed) * 1000)
      return end.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    }
    default:
      return null
  }
}
