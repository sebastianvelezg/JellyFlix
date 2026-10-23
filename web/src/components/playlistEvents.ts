import { useSyncExternalStore } from 'react'

/** Counts the changes made to playlists in this window, so a row that shows one reads it again. */
let version = 0
const listeners = new Set<() => void>()

export function notifyPlaylistsChanged(): void {
  version += 1
  listeners.forEach((listener) => listener())
}

export function usePlaylistsVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
    () => 0,
  )
}
