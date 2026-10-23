import { useCallback, useEffect, useRef, useState } from 'react'
import { clearStored, readStored, writeStored } from '../platform/web/swrStore'
import { errorText, type AsyncState } from './useAsync'

/**
 * "Stale while revalidate": what a list looked like the last time it was read is shown at once, and a fresh copy is
 * fetched behind it. Lists live in memory and, per tab, in sessionStorage, so even after a reload the screen is
 * drawn straight away. Two components asking for the same list at the same moment share one request.
 *
 * Only for lists that are fine to show a little out of date (rows, genres, collections). Never for what the person
 * just changed, nor for random picks.
 */

interface Entry {
  data: unknown
  at: number
}

const memory = new Map<string, Entry>()
const inFlight = new Map<string, Promise<unknown>>()

function peek(key: string): Entry | null {
  const hit = memory.get(key)
  if (hit) return hit
  const stored = readStored(key)
  if (stored) memory.set(key, stored)
  return stored
}

function remember(key: string, data: unknown): void {
  const entry = { data, at: Date.now() }
  memory.set(key, entry)
  writeStored(key, entry)
}

/** Reads a list, sharing the request with anyone else reading the same key right now. */
function fetchShared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key)
  if (running) return running as Promise<T>
  const promise = load()
    .then((data) => {
      remember(key, data)
      return data
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

/** Forgets every remembered list (on sign-out, so the next person never sees them). */
export function clearSwr(): void {
  memory.clear()
  inFlight.clear()
  clearStored()
}

/** Forgets the copies held in memory only, as a reload would. For tests. */
export function dropSwrMemory(): void {
  memory.clear()
  inFlight.clear()
}

/** Whose lists these are: one person on one server (two servers can hand out the same user id). */
export const swrScope = (session: { serverUrl: string; userId: string }): string => `${session.serverUrl}#${session.userId}`

/** Remembered lists are made for one person: build keys with this, starting from `swrScope`. */
export const swrKey = (userId: string, ...parts: Array<string | number | undefined>): string =>
  [userId, ...parts.map((p) => p ?? '')].join('|')

function initial<T>(key: string): AsyncState<T> {
  const hit = peek(key)
  return hit ? { status: 'ready', data: hit.data as T } : { status: 'loading' }
}

/**
 * Like `useAsync`, but with a remembered copy (see above). `key` names the list and everything it depends on;
 * `load` should be wrapped in `useCallback` with the same dependencies. A copy younger than `fresh` ms is trusted
 * and not fetched again. If the refresh fails while an older copy is shown, the older copy stays.
 */
export function useSwr<T>(key: string, load: () => Promise<T>, { fresh = 30_000 }: { fresh?: number } = {}) {
  const [held, setHeld] = useState(() => ({ key, state: initial<T>(key) }))
  // Another list (a different key) starts from its own remembered copy, if any.
  const state = held.key === key ? held.state : initial<T>(key)
  const [attempt, setAttempt] = useState(0)
  /** The attempt that was asked for by hand, which must go to the server even if a copy is recent. */
  const forcedAttempt = useRef(-1)

  useEffect(() => {
    let cancelled = false
    const hit = peek(key)
    // A recent copy is enough, unless the person asked to try again.
    if (hit && forcedAttempt.current !== attempt && Date.now() - hit.at < fresh) {
      setHeld({ key, state: { status: 'ready', data: hit.data as T } })
      return
    }
    fetchShared(key, load)
      .then((data) => {
        if (!cancelled) setHeld({ key, state: { status: 'ready', data } })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setHeld((current) =>
          current.key === key && current.state.status === 'ready'
            ? current
            : { key, state: { status: 'error', message: errorText(e) } },
        )
      })
    return () => {
      cancelled = true
    }
  }, [key, load, attempt, fresh])

  const retry = useCallback(() => {
    setHeld((current) => ({ key: current.key, state: current.state.status === 'ready' ? current.state : { status: 'loading' } }))
    forcedAttempt.current = attempt + 1
    setAttempt(attempt + 1)
  }, [attempt])

  /** Changes the list as shown and as remembered (for edits the person just made). */
  const update = useCallback(
    (fn: (data: T) => T) => {
      setHeld((current) => {
        if (current.key !== key || current.state.status !== 'ready') return current
        const data = fn(current.state.data)
        remember(key, data)
        return { key, state: { status: 'ready', data } }
      })
    },
    [key],
  )

  return { state, retry, update }
}

/** The key of a title's details (shared by banners, title pages and the prefetch on hover). */
export const detailsKey = (session: { serverUrl: string; userId: string }, id: string): string =>
  swrKey(swrScope(session), 'details', id)

/** Reads a list ahead of time, for example when a card is hovered, so that opening it is instant. */
export function prefetchSwr<T>(key: string, load: () => Promise<T>, fresh = 30_000): void {
  const hit = peek(key)
  if (hit && Date.now() - hit.at < fresh) return
  fetchShared(key, load).catch(() => undefined)
}
