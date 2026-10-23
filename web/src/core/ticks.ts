/** Jellyfin expresses positions and durations in 100-nanosecond ticks. */
export const TICKS_PER_SECOND = 10_000_000

export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * TICKS_PER_SECOND))
}

export function ticksToSeconds(ticks: number | null | undefined): number {
  return ticks ? ticks / TICKS_PER_SECOND : 0
}

/** Formats seconds as m:ss or h:mm:ss. Non-finite input renders as 0:00. */
export function formatTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "1h 47m" / "52m" for a duration in seconds; empty string when unknown. */
export function formatRuntime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 60) return totalSeconds > 0 ? '<1m' : ''
  const minutes = Math.floor(totalSeconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`
}
