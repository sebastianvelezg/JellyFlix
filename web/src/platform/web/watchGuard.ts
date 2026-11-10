import { useSyncExternalStore } from 'react'
import { NO_STREAK, type SleepTimer, type Streak } from '../../core'

/**
 * The sleep timer and the count of titles that followed one another by themselves (see core/watchLimit.ts). Both live in memory only:
 * they have to outlive one title (each episode is a page of its own) but not a reload, a sign out or another account.
 */
let sleepTimer: SleepTimer | null = null
let streak: Streak = NO_STREAK
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function getSleepTimer(): SleepTimer | null {
  return sleepTimer
}

export function setSleepTimer(next: SleepTimer | null): void {
  sleepTimer = next
  emit()
}

export function getStreak(): Streak {
  return streak
}

export function setStreak(next: Streak): void {
  streak = next
}

/** Forgets both (signing out or switching account). */
export function resetWatchGuard(): void {
  streak = NO_STREAK
  setSleepTimer(null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The sleep timer in use, redrawn when it is set or cleared. */
export function useSleepTimer(): SleepTimer | null {
  return useSyncExternalStore(subscribe, getSleepTimer, () => null)
}
