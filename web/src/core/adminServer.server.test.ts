// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import {
  applyPolicyFields,
  createUser,
  deleteTitle,
  findTitles,
  getActivity,
  getAdminDevices,
  getAdminSessions,
  getAdminUsers,
  getApiKeys,
  getLibraries,
  getParentalRatingOptions,
  getServerSummary,
  getUserPolicy,
  performFor,
  policyFieldsOf,
  removeDevice,
  revokeApiKey,
  runBatch,
  savePolicy,
  scanAllLibraries,
  sendSessionMessage,
  setUserPassword,
  stopSessionPlayback,
} from './adminServer'
import { connect } from './auth'
import { getEditableItem } from './admin'
import type { Session } from './jellyfin'

let mock: MockServer
let admin: Session
let guestMock: MockServer
let guest: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 12, seriesCount: 1, animeCount: 1, musicArtists: 1, adminSessions: true })
  admin = await connect(mock.url, 'tester', 'secret')
  guestMock = await startMockJellyfin({ movieCount: 5, admin: false })
  guest = await connect(guestMock.url, 'tester', 'secret')
})
afterAll(async () => {
  await mock.close()
  await guestMock.close()
})

describe('libraries and titles', () => {
  it('lists the libraries and starts a scan', async () => {
    const libs = await getLibraries(admin)
    expect(libs.map((l) => l.name)).toEqual(['Movies', 'Shows', 'Anime', 'Music'])
    expect(libs[0]).toMatchObject({ id: 'lib-movies', type: 'movies', locations: ['/media/movies'], refreshing: false })
    await scanAllLibraries(admin)
    expect(mock.adminLog).toContain('scan all')
  })

  it('finds titles by name, and only the ones the server could not recognise', async () => {
    const all = await findTitles(admin, { text: '', type: 'Movie', unidentified: false, start: 0, limit: 50 })
    expect(all.total).toBe(12)
    expect(all.rows[0]).toMatchObject({ type: 'Movie', identified: true })
    expect(all.rows[0]?.path).toMatch(/^\/media\/movies\//)
    const few = await findTitles(admin, { text: 'movie 00', type: 'Movie', unidentified: false, start: 0, limit: 3 })
    expect(few.rows).toHaveLength(3)
    expect(few.total).toBe(9)
    const lost = await findTitles(admin, { text: '', type: 'Movie', unidentified: true, start: 0, limit: 50 })
    expect(lost.rows.map((r) => r.name)).toEqual(['Test Movie 004', 'Test Movie 008', 'Test Movie 012'])
    expect(lost.rows.every((r) => !r.identified)).toBe(true)
    expect(mock.requests.filter((r) => r.path === '/Items').at(-1)?.query.hasTmdbId).toBe('false')
  })

  it('deletes a title for everyone, once', async () => {
    await deleteTitle(admin, 'm0012')
    expect(mock.adminLog).toContain('delete-title m0012')
    const left = await findTitles(admin, { text: '', type: 'Movie', unidentified: false, start: 0, limit: 50 })
    expect(left.total).toBe(11)
    await expect(deleteTitle(admin, 'm0012')).rejects.toMatchObject({ response: { status: 404 } })
  })

  it('is refused for an account that is not an administrator', async () => {
    await expect(getLibraries(guest)).rejects.toMatchObject({ response: { status: 403 } })
    await expect(scanAllLibraries(guest)).rejects.toMatchObject({ response: { status: 403 } })
    await expect(deleteTitle(guest, 'm0001')).rejects.toMatchObject({ response: { status: 403 } })
    expect(guestMock.adminLog).toEqual([])
  })
})

describe('batch actions against the server', () => {
  const rows = [
    { id: 'm0001', name: 'Test Movie 001' },
    { id: 'm0002', name: 'Test Movie 002' },
    { id: 'm0004', name: 'Test Movie 004' },
  ]

  it('tags only the titles that need it, and a second run does nothing', async () => {
    const run = () => runBatch(rows, performFor(admin, { kind: 'tag', tag: 'Weekend', add: true }))
    expect((await run()).map((r) => r.outcome)).toEqual(['done', 'done', 'done'])
    expect((await getEditableItem(admin, 'm0001')).fields.tags).toEqual(['Weekend'])
    expect((await getEditableItem(admin, 'm0004')).fields.tags).toEqual(['Classic', 'Weekend']) // what it had stays
    expect((await run()).map((r) => r.outcome)).toEqual(['skipped', 'skipped', 'skipped'])
    expect((await runBatch(rows, performFor(admin, { kind: 'tag', tag: 'weekend', add: false }))).map((r) => r.outcome)).toEqual(['done', 'done', 'done'])
    expect((await getEditableItem(admin, 'm0004')).fields.tags).toEqual(['Classic'])
  })

  it('locks, refreshes and marks watched', async () => {
    expect((await runBatch(rows, performFor(admin, { kind: 'lock', value: true }))).every((r) => r.outcome === 'done')).toBe(true)
    expect((await getEditableItem(admin, 'm0002')).fields.lockedAll).toBe(true)
    await runBatch(rows, performFor(admin, { kind: 'refresh', mode: 'missing' }))
    expect(mock.adminLog.filter((l) => l.startsWith('refresh m000'))).toHaveLength(3)
    await runBatch(rows, performFor(admin, { kind: 'watched', value: true }))
    expect(mock.user.played.has('m0002')).toBe(true)
  })

  it('stops at the first refusal for an account that is not an administrator', async () => {
    const results = await runBatch(rows, performFor(guest, { kind: 'lock', value: true }), { concurrency: 1 })
    expect(results.map((r) => r.outcome)).toEqual(['failed', 'skipped', 'skipped'])
    expect(guestMock.adminLog).toEqual([])
  })
})

describe('accounts', () => {
  it('lists them, edits the allowances with the whole policy sent back, and makes new ones', async () => {
    const users = await getAdminUsers(admin)
    expect(users.map((u) => [u.name, u.isAdmin])).toEqual([['guest', false], ['tester', true]])
    const policy = await getUserPolicy(admin, 'user2')
    const fields = policyFieldsOf(policy)
    await savePolicy(admin, 'user2', applyPolicyFields(policy, { ...fields, isDisabled: true, maxRating: '5', videoTranscoding: false }))
    expect(mock.adminLog).toContain('policy user2')
    const sent = mock.requests.filter((r) => r.path === '/Users/user2/Policy').at(-1)?.body as Record<string, unknown>
    expect(sent.AuthenticationProviderId).toBeDefined() // the rest of the policy went back untouched
    expect(mock.accounts.get('user2')?.policy).toMatchObject({ IsDisabled: true, MaxParentalRating: 5, EnableVideoPlaybackTranscoding: false })
    expect((await getAdminUsers(admin)).find((u) => u.name === 'guest')?.isDisabled).toBe(true)

    const id = await createUser(admin, ' Ana ', 'a-long-password')
    expect(id).toMatch(/^user/)
    expect(mock.adminLog).toContain('create-user Ana')
    await expect(createUser(admin, 'ana', 'another-long-one')).rejects.toMatchObject({ response: { status: 400 } })
    await setUserPassword(admin, id, 'new-long-password')
    expect(mock.adminLog).toContain(`password ${id}`)
    // No password is ever written to the log of what was done.
    expect(mock.adminLog.join('\n')).not.toMatch(/long-password/)
  })

  it('knows the parental ratings, once each', async () => {
    const ratings = await getParentalRatingOptions(admin)
    expect(ratings.map((r) => r.value)).toEqual([1, 5, 7, 9])
  })

  it('is refused for an account that is not an administrator', async () => {
    await expect(getAdminUsers(guest)).rejects.toMatchObject({ response: { status: 403 } })
    await expect(createUser(guest, 'Eve', 'a-long-password')).rejects.toMatchObject({ response: { status: 403 } })
    await expect(savePolicy(guest, 'user2', {} as never)).rejects.toMatchObject({ response: { status: 403 } })
    expect(guestMock.adminLog).toEqual([])
  })
})

describe('sessions, devices and keys', () => {
  it('lists who plays what, sends a message and stops playback', async () => {
    const sessions = await getAdminSessions(admin)
    const kitchen = sessions.find((s) => s.id === 'kitchen-session')
    expect(kitchen).toMatchObject({ userName: 'guest', deviceName: 'Kitchen tablet', controllable: true, playing: { title: 'Test Movie 002', method: 'converted', reasons: ['ContainerBitrateExceedsLimit'] } })
    await sendSessionMessage(admin, 'kitchen-session', ' Dinner is ready ')
    expect(mock.adminLog).toContain('message kitchen-session Dinner is ready')
    await stopSessionPlayback(admin, 'kitchen-session')
    expect(mock.remoteLog).toContain('kitchen-session Stop')
    expect((await getAdminSessions(admin)).find((s) => s.id === 'kitchen-session')?.playing).toBeUndefined()
  })

  it('lists devices without their tokens, and signs one out', async () => {
    const devices = await getAdminDevices(admin)
    expect(devices.map((d) => d.name)).toContain('Old phone')
    expect(JSON.stringify(devices)).not.toMatch(/secret-token/) // the token never leaves the core
    expect(devices.filter((d) => d.isThisDevice)).toHaveLength(1)
    await removeDevice(admin, 'dev-phone')
    expect(mock.adminLog).toContain('remove-device dev-phone')
    expect((await getAdminDevices(admin)).map((d) => d.id)).not.toContain('dev-phone')
  })

  it('refuses to remove the device or the key it is using', async () => {
    await expect(removeDevice(admin, admin.deviceId)).rejects.toThrow(/Sign out in Settings/)
    expect(mock.adminLog.filter((l) => l.includes(admin.deviceId))).toEqual([])
    const keys = await getApiKeys(admin)
    await expect(revokeApiKey(admin, { ...(keys[0] as (typeof keys)[number]), isThisSession: true })).rejects.toThrow(/Sign out in Settings/)
    expect((await getApiKeys(admin)).length).toBe(keys.length)
  })

  it('lists keys by their last four characters and revokes one', async () => {
    const keys = await getApiKeys(admin)
    expect(keys.map((k) => [k.app, k.hint])).toEqual([['Home Assistant', 'ab12'], ['Old script', 'cd34']])
    await revokeApiKey(admin, keys[1] as (typeof keys)[number])
    expect(mock.adminLog).toContain('revoke-key cd34')
    expect(mock.adminLog.join('\n')).not.toMatch(/apikey-/)
    expect((await getApiKeys(admin)).map((k) => k.hint)).toEqual(['ab12'])
  })

  it('is refused for an account that is not an administrator', async () => {
    await expect(getAdminDevices(guest)).rejects.toMatchObject({ response: { status: 403 } })
    await expect(getApiKeys(guest)).rejects.toMatchObject({ response: { status: 403 } })
    await expect(removeDevice(guest, 'dev-tv')).rejects.toMatchObject({ response: { status: 403 } })
  })
})

describe('activity and health', () => {
  it('pages through the activity log and summarises the server', async () => {
    const first = await getActivity(admin, 0, 30)
    expect(first.total).toBe(45)
    expect(first.lines).toHaveLength(30)
    expect(first.lines[0]?.date.getTime()).toBeGreaterThan(first.lines[1]?.date.getTime() ?? 0) // newest first
    const second = await getActivity(admin, 30, 30)
    expect(second.lines).toHaveLength(15)
    const summary = await getServerSummary(admin)
    expect(summary).toMatchObject({ name: 'Mock Jellyfin', version: '12.2.0', hasUpdate: true, pendingRestart: false, tasksFailed: 0 })
    expect(summary.sessions).toBeGreaterThan(0)
  })

  it('is refused for an account that is not an administrator', async () => {
    await expect(getActivity(guest, 0)).rejects.toMatchObject({ response: { status: 403 } })
    await expect(getServerSummary(guest)).rejects.toMatchObject({ response: { status: 403 } })
  })
})
