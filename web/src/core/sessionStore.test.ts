// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect, logout } from './auth'
import { getMovieLibraries } from './library'
import { restoreSession, toStoredSession, type SessionStore, type StoredSession } from './sessionStore'

class MemoryStore implements SessionStore {
  value: StoredSession | null = null
  async load() {
    return this.value
  }
  async save(s: StoredSession) {
    this.value = s
  }
  async clear() {
    this.value = null
  }
}

let mock: MockServer
beforeAll(async () => {
  mock = await startMockJellyfin()
})
afterAll(() => mock.close())

describe('restoreSession', () => {
  it('returns null when nothing is stored', async () => {
    expect(await restoreSession(new MemoryStore())).toBeNull()
  })

  it('restores a working session from storage and verifies the token', async () => {
    const session = await connect(mock.url, 'tester', 'secret')
    const store = new MemoryStore()
    await store.save(toStoredSession(session))
    // The stored form never contains the password or the SDK object.
    expect(JSON.stringify(store.value)).not.toContain('secret')
    expect(Object.keys(store.value ?? {}).sort()).toEqual(
      ['accessToken', 'deviceId', 'serverName', 'serverUrl', 'serverVersion', 'userId', 'userName'],
    )

    const restored = await restoreSession(store)
    expect(restored?.userName).toBe('tester')
    expect(restored?.deviceId).toBe(session.deviceId)
    expect(await getMovieLibraries(restored!)).toHaveLength(1) // and it can actually make requests
    expect(mock.requests.filter((r) => r.path === '/Users/Me').at(-1)?.auth).toBe('header')
  })

  it('clears the store and returns null when the server rejects the token', async () => {
    const session = await connect(mock.url, 'tester', 'secret')
    const store = new MemoryStore()
    await store.save(toStoredSession(session))
    await logout(session) // revokes the token server-side
    expect(await restoreSession(store)).toBeNull()
    expect(store.value).toBeNull()
  })

  it('keeps the stored session and throws a ConnectionError when the server is unreachable', async () => {
    const store = new MemoryStore()
    await store.save({
      serverUrl: 'http://127.0.0.1:1',
      serverName: 'x',
      serverVersion: '12',
      accessToken: 't',
      deviceId: 'd',
      userId: 'u',
      userName: 'n',
    })
    await expect(restoreSession(store)).rejects.toMatchObject({ kind: 'unreachable' })
    expect(store.value).not.toBeNull()
  })
})

describe('onUnauthorized', () => {
  it('fires when the server later rejects the token, and not for other failures', async () => {
    const onUnauthorized = vi.fn()
    const session = await connect(mock.url, 'tester', 'secret', { onUnauthorized })
    await getMovieLibraries(session)
    expect(onUnauthorized).not.toHaveBeenCalled()

    mock.tokens.delete(session.accessToken) // e.g. revoked from the Jellyfin dashboard
    await expect(getMovieLibraries(session)).rejects.toThrow()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('is not triggered by a wrong password at sign-in', async () => {
    const onUnauthorized = vi.fn()
    await expect(connect(mock.url, 'tester', 'wrong', { onUnauthorized })).rejects.toBeTruthy()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
