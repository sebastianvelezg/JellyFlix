import { describe, expect, it } from 'vitest'
import {
  profilesByRecent,
  canAddProfile,
  EMPTY_PROFILES,
  isValidProfilePin,
  MAX_PROFILES,
  profileRightPin,
  profileRemoved,
  sanitizeProfiles,
  profileSignedIn,
  pinWaitAfter,
  pinWaitLeft,
  profileWithPin,
  profileWrongPin,
} from './profiles'
import type { StoredSession } from './sessionStore'

const stored = (n: number, over: Partial<StoredSession> = {}): StoredSession => ({
  serverUrl: 'http://jf:8096',
  serverName: 'Home',
  serverVersion: '10.10.0',
  accessToken: `tok${n}`,
  deviceId: `dev${n}`,
  userId: `user${n}`,
  userName: `User ${n}`,
  ...over,
})

describe('accounts on one browser', () => {
  it('adds an account that signs in, and gives a saved one its new token instead of a second entry', () => {
    let book = profileSignedIn(EMPTY_PROFILES, stored(1), 10)
    book = profileSignedIn(book, stored(2), 20)
    expect(book.profiles.map((p) => p.userId)).toEqual(['user1', 'user2'])
    book = profileSignedIn(book, stored(1, { accessToken: 'fresh', serverUrl: 'http://jf:8096/' }), 30)
    expect(book.profiles).toHaveLength(2)
    expect(book.profiles[0]).toMatchObject({ accessToken: 'fresh', lastUsed: 30 })
  })

  it('keeps at most six, and a full book does not drop anybody to make room', () => {
    let book = EMPTY_PROFILES
    for (let n = 1; n <= MAX_PROFILES; n += 1) book = profileSignedIn(book, stored(n), n)
    expect(canAddProfile(book)).toBe(false)
    expect(profileSignedIn(book, stored(99), 100)).toBe(book)
    expect(canAddProfile(profileRemoved(book, stored(3)))).toBe(true)
  })

  it('shows the one used last first', () => {
    let book = profileSignedIn(profileSignedIn(EMPTY_PROFILES, stored(1), 10), stored(2), 20)
    expect(profilesByRecent(book).map((p) => p.userId)).toEqual(['user2', 'user1'])
    book = profileRightPin(book, stored(1), 99)
    expect(profilesByRecent(book)[0]?.userId).toBe('user1')
  })

  it('takes a PIN of four to six digits only', () => {
    expect(['1234', '123456', '0000'].every(isValidProfilePin)).toBe(true)
    expect(['123', '1234567', '12a4', '', '12 34'].some(isValidProfilePin)).toBe(false)
  })

  it('makes the wait longer after each wrong PIN, up to five minutes, and a right one starts over', () => {
    expect([0, 1, 2, 3, 4, 5, 9, 20].map(pinWaitAfter)).toEqual([0, 0, 0, 5, 10, 20, 300, 300])
    let book = profileWithPin(profileSignedIn(EMPTY_PROFILES, stored(1), 0), stored(1), { salt: 's', hash: 'h' })
    for (let i = 0; i < 3; i += 1) book = profileWrongPin(book, stored(1), 1000)
    expect(book.profiles[0]).toMatchObject({ failures: 3, lockedUntil: 6000 })
    expect(pinWaitLeft(book.profiles[0]!, 2000)).toBe(4)
    expect(pinWaitLeft(book.profiles[0]!, 7000)).toBe(0)
    book = profileRightPin(book, stored(1), 8000)
    expect(book.profiles[0]).toMatchObject({ failures: 0, lockedUntil: 0 })
  })

  it('removing the PIN clears the wait too', () => {
    let book = profileWithPin(profileSignedIn(EMPTY_PROFILES, stored(1), 0), stored(1), { salt: 's', hash: 'h' })
    book = profileWrongPin(profileWrongPin(profileWrongPin(book, stored(1), 0), stored(1), 0), stored(1), 0)
    book = profileWithPin(book, stored(1), null)
    expect(book.profiles[0]?.pin).toBeUndefined()
    expect(book.profiles[0]).toMatchObject({ failures: 0, lockedUntil: 0 })
  })

  it('reads storage defensively: it drops what is malformed, repeated or over the limit', () => {
    const good = { ...stored(1), failures: 1, lockedUntil: 5, lastUsed: 7, pin: { salt: 'a', hash: 'b' } }
    const book = sanitizeProfiles({
      ask: false,
      profiles: [good, good, { serverUrl: 'x' }, { ...stored(2), accessToken: '' }, null, 'text', { ...stored(3), pin: { salt: 1 } }],
    })
    expect(book.ask).toBe(false)
    expect(book.profiles.map((p) => p.userId)).toEqual(['user1', 'user3'])
    expect(book.profiles[0]?.pin).toEqual({ salt: 'a', hash: 'b' })
    expect(book.profiles[1]?.pin).toBeUndefined()
    expect(sanitizeProfiles(undefined)).toEqual({ profiles: [], ask: true })
    expect(sanitizeProfiles({ profiles: Array.from({ length: 9 }, (_, n) => stored(n + 1)) }).profiles).toHaveLength(MAX_PROFILES)
  })
})
