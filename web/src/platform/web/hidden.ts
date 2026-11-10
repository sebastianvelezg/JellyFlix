import { useSyncExternalStore } from 'react'
import { NO_HIDDEN, parseHidden, type HiddenItems } from '../../core'
import { ownedKey } from './owner'

/**
 * What the signed-in account has hidden from "Continue watching" and "Next up" (see core/hidden.ts), kept on this device under that
 * account (see owner.ts). With nobody signed in nothing is read or written.
 */
const BASE = 'jellyflix.hidden'

let cache: { key: string; raw: string | null; value: HiddenItems } | null = null
const listeners = new Set<() => void>()

function read(): HiddenItems {
  const key = ownedKey(BASE)
  if (!key) return NO_HIDDEN
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    // Storage blocked: nothing is hidden.
  }
  if (cache && cache.key === key && cache.raw === raw) return cache.value
  let value = NO_HIDDEN
  try {
    value = parseHidden(raw ? (JSON.parse(raw) as unknown) : null)
  } catch {
    // A damaged value is the same as none.
  }
  cache = { key, raw, value }
  return value
}

export const readHidden = read

function emit() {
  for (const listener of listeners) listener()
}

/** Replaces what is hidden. Returns what it was before. */
export function writeHidden(next: HiddenItems): HiddenItems {
  const previous = read()
  const key = ownedKey(BASE)
  if (!key) return previous
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // Storage full or blocked: the choice lasts until the page is closed.
    cache = { key, raw: null, value: next }
    emit()
    return previous
  }
  emit()
  return previous
}

export function updateHidden(change: (hidden: HiddenItems) => HiddenItems): HiddenItems {
  return writeHidden(change(read()))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(BASE)) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** What is hidden, redrawn when it changes (here or in another tab). */
export function useHidden(): HiddenItems {
  return useSyncExternalStore(subscribe, read, () => NO_HIDDEN)
}
