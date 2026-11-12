import { beforeEach, describe, expect, it } from 'vitest'
import { profileSignedIn, EMPTY_PROFILES } from '../../core'
import { canLockWithPin, lockFor, pinMatches, readProfiles, writeProfiles } from './profiles'

beforeEach(() => localStorage.clear())

describe('the accounts kept on this browser', () => {
  it('are written down and read back, and nothing stored is an empty book', () => {
    expect(readProfiles()).toEqual(EMPTY_PROFILES)
    const book = profileSignedIn(EMPTY_PROFILES, { serverUrl: 'http://jf', serverName: 'Home', serverVersion: '10', accessToken: 't', deviceId: 'd', userId: 'u', userName: 'Ana' }, 5)
    writeProfiles(book)
    expect(readProfiles().profiles.map((p) => p.userName)).toEqual(['Ana'])
    writeProfiles(EMPTY_PROFILES)
    expect(localStorage.getItem('jellyflix.profiles')).toBeNull()
  })

  it('survive a damaged value without breaking the app', () => {
    localStorage.setItem('jellyflix.profiles', '{not json')
    expect(readProfiles()).toEqual(EMPTY_PROFILES)
  })

  it('keep a PIN as a salted hash that only the same PIN matches', async () => {
    if (!canLockWithPin()) return
    const lock = await lockFor('1234')
    expect(lock.hash).not.toContain('1234')
    expect(await pinMatches('1234', lock)).toBe(true)
    expect(await pinMatches('4321', lock)).toBe(false)
    // The same PIN does not make the same hash twice (the salt differs).
    expect((await lockFor('1234')).hash).not.toBe(lock.hash)
  })
})
