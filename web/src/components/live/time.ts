/** "9:30 PM" / "21:30": a moment as a clock time, in the language and the habits of this device. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "Mon, Oct 23, 9:30 PM" for a moment that is not today (the guide goes a few hours ahead, which may be tomorrow). */
export function formatDayAndClock(ms: number, nowMs: number): string {
  const day = new Date(ms)
  const sameDay = day.toDateString() === new Date(nowMs).toDateString()
  return sameDay ? formatClock(ms) : `${day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${formatClock(ms)}`
}
