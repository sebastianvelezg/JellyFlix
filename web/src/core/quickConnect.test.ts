// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import { authorizeQuickConnect, completeQuickConnect, isQuickConnectApproved, startQuickConnect } from './quickConnect'

let mock: MockServer
let off: MockServer
beforeAll(async () => {
  mock = await startMockJellyfin()
  off = await startMockJellyfin({ quickConnect: false })
})
afterAll(async () => {
  await mock.close()
  await off.close()
})

describe('Quick Connect', () => {
  it('signs in with a code approved from another signed-in device, without any password', async () => {
    const request = await startQuickConnect(mock.url)
    expect(request.code).toMatch(/^\d{6}$/)
    expect(await isQuickConnectApproved(request)).toBe(false)

    // The other device (already signed in) types the code.
    const other = await connect(mock.url, 'tester', 'secret')
    await authorizeQuickConnect(other, request.code.slice(0, 3) + ' ' + request.code.slice(3))
    expect(await isQuickConnectApproved(request)).toBe(true)

    const session = await completeQuickConnect(request)
    expect(session.userName).toBe('tester')
    expect(session.deviceId).toBe(request.deviceId)
    expect(session.accessToken).not.toBe(other.accessToken)
    // The new token really works.
    expect(mock.tokens.has(session.accessToken)).toBe(true)
    // The password never travelled in this sign-in.
    const authRequests = mock.requests.filter((r) => r.path === '/Users/AuthenticateWithQuickConnect')
    expect(JSON.stringify(authRequests.map((r) => r.body))).not.toContain('secret"')
  })

  it('does not hand out a session for a code nobody approved', async () => {
    const request = await startQuickConnect(mock.url)
    await expect(completeQuickConnect(request)).rejects.toMatchObject({ kind: 'bad-credentials' })
  })

  it('says so when the server has Quick Connect switched off', async () => {
    await expect(startQuickConnect(off.url)).rejects.toMatchObject({ kind: 'quick-connect-off' })
  })

  it('refuses a code that is not six digits and one the server does not know', async () => {
    const other = await connect(mock.url, 'tester', 'secret')
    await expect(authorizeQuickConnect(other, '12')).rejects.toThrow(/six digits/)
    await expect(authorizeQuickConnect(other, '999999')).rejects.toThrow(/not found/)
  })
})
