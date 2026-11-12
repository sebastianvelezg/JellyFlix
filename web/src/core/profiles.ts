import type { StoredSession } from './sessionStore'

/**
 * Several accounts on one browser ("Who is watching?"), as the TV app has. Each saved account is a signed-in session plus an optional PIN
 * that guards opening it from this browser. The PIN only decides who may open an account here (it is not encryption, and what an
 * account may watch is still decided by Jellyfin). Plain data and rules; the storage and the hashing are in `platform/web/profiles.ts`.
 */

/** The most accounts one browser keeps. */
export const MAX_PROFILES = 6
export const PROFILE_PIN_MIN = 4
export const PROFILE_PIN_MAX = 6

/** A PIN is kept as a salted hash (never the number). */
export interface PinLock {
  salt: string
  hash: string
}

export interface Profile extends StoredSession {
  pin?: PinLock
  /** Wrong PINs in a row, and until when (ms since the epoch) the next try has to wait. */
  failures: number
  lockedUntil: number
  lastUsed: number
}

export interface ProfileBook {
  profiles: Profile[]
  /** Ask who is watching when the app opens (it always does when there is more than one account and this is on). */
  ask: boolean
}

export const EMPTY_PROFILES: ProfileBook = { profiles: [], ask: true }

/** What identifies an account on this browser: the server and the user on it. */
export const profileKey = (p: Pick<StoredSession, 'serverUrl' | 'userId'>): string => `${p.serverUrl.replace(/\/+$/, '')}|${p.userId}`

export const canAddProfile = (book: ProfileBook): boolean => book.profiles.length < MAX_PROFILES

export const isValidProfilePin = (pin: string): boolean => new RegExp(`^\\d{${PROFILE_PIN_MIN},${PROFILE_PIN_MAX}}$`).test(pin)

/** Adds an account that just signed in, or gives the one already saved its new token. A full book refuses a new one (the oldest is not dropped). */
export function profileSignedIn(book: ProfileBook, session: StoredSession, now: number): ProfileBook {
  const key = profileKey(session)
  const at = book.profiles.findIndex((p) => profileKey(p) === key)
  if (at >= 0) {
    const profiles = book.profiles.map((p, i) => (i === at ? { ...p, ...session, lastUsed: now } : p))
    return { ...book, profiles }
  }
  if (!canAddProfile(book)) return book
  return { ...book, profiles: [...book.profiles, { ...session, failures: 0, lockedUntil: 0, lastUsed: now }] }
}

export const profileRemoved = (book: ProfileBook, session: Pick<StoredSession, 'serverUrl' | 'userId'>): ProfileBook => ({
  ...book,
  profiles: book.profiles.filter((p) => profileKey(p) !== profileKey(session)),
})

const change = (book: ProfileBook, who: Pick<StoredSession, 'serverUrl' | 'userId'>, patch: (p: Profile) => Profile): ProfileBook => ({
  ...book,
  profiles: book.profiles.map((p) => (profileKey(p) === profileKey(who) ? patch(p) : p)),
})

export const profileWithPin = (book: ProfileBook, who: Pick<StoredSession, 'serverUrl' | 'userId'>, pin: PinLock | null): ProfileBook =>
  change(book, who, (p) => {
    const next: Profile = { ...p, failures: 0, lockedUntil: 0 }
    if (pin) next.pin = pin
    else delete next.pin
    return next
  })

/** The saved sign-in of an account, without the PIN and the counters, as the session store keeps it. */
export const storedOf = (p: Profile): StoredSession => ({
  serverUrl: p.serverUrl,
  serverName: p.serverName,
  serverVersion: p.serverVersion,
  accessToken: p.accessToken,
  deviceId: p.deviceId,
  userId: p.userId,
  userName: p.userName,
})

/** The wait, in seconds, after this many wrong PINs in a row: none for the first two, then it grows to five minutes. */
export function pinWaitAfter(failures: number): number {
  if (failures < 3) return 0
  return Math.min(300, 5 * 2 ** (failures - 3))
}

/** Seconds left of the wait after wrong PINs (0: none). */
export const pinWaitLeft = (p: Pick<Profile, 'lockedUntil'>, now: number): number => Math.max(0, Math.ceil((p.lockedUntil - now) / 1000))

export const profileWrongPin = (book: ProfileBook, who: Pick<StoredSession, 'serverUrl' | 'userId'>, now: number): ProfileBook =>
  change(book, who, (p) => {
    const failures = p.failures + 1
    return { ...p, failures, lockedUntil: now + pinWaitAfter(failures) * 1000 }
  })

export const profileRightPin = (book: ProfileBook, who: Pick<StoredSession, 'serverUrl' | 'userId'>, now: number): ProfileBook =>
  change(book, who, (p) => ({ ...p, failures: 0, lockedUntil: 0, lastUsed: now }))

/** Most recently used first, which is the order the picker shows. */
export const profilesByRecent = (book: ProfileBook): Profile[] => [...book.profiles].sort((a, b) => b.lastUsed - a.lastUsed)

/** Reads what storage held, keeping only what is well formed (a hand-edited or old value never breaks the app). */
export function sanitizeProfiles(value: unknown): ProfileBook {
  const raw = (value && typeof value === 'object' ? value : {}) as { profiles?: unknown; ask?: unknown }
  const seen = new Set<string>()
  const profiles: Profile[] = []
  for (const item of Array.isArray(raw.profiles) ? raw.profiles : []) {
    const p = item as Partial<Profile>
    if (typeof p?.serverUrl !== 'string' || typeof p.userId !== 'string' || typeof p.accessToken !== 'string' || !p.accessToken || typeof p.deviceId !== 'string') continue
    const key = profileKey({ serverUrl: p.serverUrl, userId: p.userId })
    if (seen.has(key) || profiles.length >= MAX_PROFILES) continue
    seen.add(key)
    const pin = p.pin && typeof p.pin.salt === 'string' && typeof p.pin.hash === 'string' ? { salt: p.pin.salt, hash: p.pin.hash } : undefined
    profiles.push({
      serverUrl: p.serverUrl,
      serverName: typeof p.serverName === 'string' ? p.serverName : '',
      serverVersion: typeof p.serverVersion === 'string' ? p.serverVersion : '',
      accessToken: p.accessToken,
      deviceId: p.deviceId,
      userId: p.userId,
      userName: typeof p.userName === 'string' ? p.userName : '',
      ...(pin ? { pin } : {}),
      failures: Number.isInteger(p.failures) && (p.failures as number) >= 0 ? (p.failures as number) : 0,
      lockedUntil: Number.isFinite(p.lockedUntil) ? (p.lockedUntil as number) : 0,
      lastUsed: Number.isFinite(p.lastUsed) ? (p.lastUsed as number) : 0,
    })
  }
  return { profiles, ask: raw.ask !== false }
}
