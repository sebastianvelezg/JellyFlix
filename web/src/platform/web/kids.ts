import { useSyncExternalStore } from 'react'
import {
  checkKidsSetup,
  getAllowedSeries,
  hashPin,
  isValidPin,
  setKidsGuard,
  verifyPin,
  waitAfterFailures,
  type KidsGuard,
  type Session,
} from '../../core'

/**
 * Kids mode on this device: what is kept (the limit, the PIN as a salted hash, the wrong tries) and the switch of the guard that
 * every read of the server goes through. The PIN protects the app on this device, not the server: whoever can open the
 * browser's own tools can undo it. For a real limit, the account itself must have a maximum rating set in Administration.
 */
export interface KidsState {
  enabled: boolean
  /** The highest rating allowed, as the server writes it. */
  maxName: string
  maxValue: number
  /** The server's table of ratings, so the guard does not have to ask at every start. */
  ratings: Record<string, number>
  salt: string
  hash: string
  /** Wrong PINs in a row, and until when (ms since the epoch) another try has to wait. */
  failures: number
  lockedUntil: number
}

const KEY = 'jellyflix.kids'
const OFF: KidsState = { enabled: false, maxName: '', maxValue: 0, ratings: {}, salt: '', hash: '', failures: 0, lockedUntil: 0 }

function parse(raw: string | null): KidsState {
  try {
    const p = (raw ? JSON.parse(raw) : {}) as Partial<KidsState>
    if (p.enabled !== true || typeof p.maxName !== 'string' || typeof p.hash !== 'string' || typeof p.salt !== 'string' || !p.ratings) return OFF
    return {
      enabled: true,
      maxName: p.maxName,
      maxValue: Number(p.maxValue) || 0,
      ratings: p.ratings,
      salt: p.salt,
      hash: p.hash,
      failures: Number(p.failures) || 0,
      lockedUntil: Number(p.lockedUntil) || 0,
    }
  } catch {
    return OFF
  }
}

const rawValue = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

// The same object is handed out for as long as what is saved does not change (a React store needs that).
let cache: { raw: string | null; state: KidsState } | null = null
const listeners = new Set<() => void>()

export function readKids(): KidsState {
  const raw = rawValue()
  if (!cache || cache.raw !== raw) cache = { raw, state: parse(raw) }
  return cache.state
}

function write(next: KidsState | null): void {
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage Kids mode cannot be kept: the caller sees it is not on after a reload.
  }
  listeners.forEach((listener) => listener())
}

/** Kids mode as it is now, kept up to date. */
export function useKids(): KidsState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY || e.key === null) listener()
      }
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        window.removeEventListener('storage', onStorage)
      }
    },
    readKids,
    () => OFF,
  )
}

const guardOf = (state: KidsState, allowedSeries: readonly string[]): KidsGuard => ({
  maxName: state.maxName,
  maxValue: state.maxValue,
  ratings: state.ratings,
  allowedSeries: new Set(allowedSeries),
})

const randomSalt = () => {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: 'bad-pin' | 'unknown-rating' | 'nothing-to-show' | 'no-ratings-reported' | 'failed' }

/** Turns Kids mode on: checks the server can serve it, keeps the limit and the PIN, and starts guarding at once. */
export async function enableKids(session: Session, maxName: string, pin: string): Promise<EnableResult> {
  if (!isValidPin(pin)) return { ok: false, reason: 'bad-pin' }
  let check
  try {
    check = await checkKidsSetup(session, maxName)
  } catch {
    return { ok: false, reason: 'failed' }
  }
  if (!check.ok) return { ok: false, reason: check.reason }
  const salt = randomSalt()
  const state: KidsState = { enabled: true, maxName, maxValue: check.maxValue, ratings: check.ratings, salt, hash: hashPin(pin, salt), failures: 0, lockedUntil: 0 }
  setKidsGuard(guardOf(state, check.allowedSeries))
  write(state)
  return { ok: true }
}

/**
 * At the start of the app (and after signing in again): if Kids mode is on, the guard goes up at once, and the series that pass
 * are asked for. Until they arrive an episode of a series is hidden, which errs on the side of the child.
 */
export function restoreKids(session: Session): void {
  const state = readKids()
  if (!state.enabled) {
    setKidsGuard(null)
    return
  }
  setKidsGuard(guardOf(state, []))
  void getAllowedSeries(session, state.maxName)
    .then((ids) => {
      if (readKids().enabled) setKidsGuard(guardOf(state, ids))
    })
    .catch(() => undefined)
}

export type ExitResult = { ok: true } | { ok: false; waitSeconds: number }

/** Leaves Kids mode with the PIN. Wrong tries in a row make the next one wait longer and longer. */
export function exitKids(pin: string, now = Date.now()): ExitResult {
  const state = readKids()
  if (!state.enabled) return { ok: true }
  if (now < state.lockedUntil) return { ok: false, waitSeconds: Math.ceil((state.lockedUntil - now) / 1000) }
  if (verifyPin(pin, state.salt, state.hash)) {
    setKidsGuard(null)
    write(null)
    return { ok: true }
  }
  const failures = state.failures + 1
  const wait = waitAfterFailures(failures)
  write({ ...state, failures, lockedUntil: wait > 0 ? now + wait * 1000 : 0 })
  return { ok: false, waitSeconds: wait }
}
