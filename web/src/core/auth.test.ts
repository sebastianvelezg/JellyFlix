// @vitest-environment node
import { AxiosError } from 'axios'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect, ConnectionError, describeConnectionFailure, logout } from './auth'

function axiosError(status?: number, code?: string): AxiosError {
  const e = new AxiosError('boom', code)
  if (status !== undefined) {
    e.response = { status, data: null, statusText: '', headers: {}, config: {} as never }
  }
  return e
}

describe('describeConnectionFailure', () => {
  it('explains an unreachable server and mentions CORS', () => {
    const e = describeConnectionFailure(axiosError(undefined, 'ERR_NETWORK'), 'reach', 'http://h:8096', 'http:')
    expect(e.kind).toBe('unreachable')
    expect(e.message).toMatch(/CORS/)
  })

  it('explains mixed content when the page is https and the server is http', () => {
    const e = describeConnectionFailure(axiosError(undefined, 'ERR_NETWORK'), 'reach', 'http://h:8096', 'https:')
    expect(e.message).toMatch(/HTTPS/)
  })

  it('reports timeouts', () => {
    expect(describeConnectionFailure(axiosError(undefined, 'ECONNABORTED'), 'reach').message).toMatch(/did not answer/)
  })

  it('maps 401 during login to bad credentials', () => {
    const e = describeConnectionFailure(axiosError(401), 'login')
    expect(e.kind).toBe('bad-credentials')
    expect(e.message).toBe('Incorrect username or password.')
  })

  it('maps other statuses', () => {
    expect(describeConnectionFailure(axiosError(403), 'login').kind).toBe('forbidden')
    expect(describeConnectionFailure(axiosError(404), 'reach').kind).toBe('not-jellyfin')
    expect(describeConnectionFailure(axiosError(503), 'reach').kind).toBe('server-error')
    expect(describeConnectionFailure(new Error('x'), 'reach').kind).toBe('unknown')
  })
})

describe('connect / logout against a mock Jellyfin server', () => {
  let mock: MockServer
  beforeAll(async () => {
    mock = await startMockJellyfin()
  })
  afterAll(() => mock.close())

  it('signs in, verifies the token with an authenticated request, and returns a session', async () => {
    const session = await connect(`${mock.url}/`, ' tester ', 'secret')
    expect(session.serverUrl).toBe(mock.url)
    expect(session.userName).toBe('tester')
    expect(session.serverName).toBe('Mock Jellyfin')
    expect(session.accessToken).toMatch(/^token-/)

    const login = mock.requests.find((r) => r.path === '/Users/AuthenticateByName')
    expect(login?.body).toEqual({ Username: 'tester', Pw: 'secret' })
    // The token is proven by an authenticated request using the Authorization header, not a query string.
    const me = mock.requests.find((r) => r.path === '/Users/Me')
    expect(me).toMatchObject({ auth: 'header', status: 200 })
    expect(JSON.stringify(mock.requests.map((r) => r.query))).not.toContain(session.accessToken)
  })

  it('rejects a wrong password with a clear message', async () => {
    await expect(connect(mock.url, 'tester', 'nope')).rejects.toMatchObject({
      kind: 'bad-credentials',
      message: 'Incorrect username or password.',
    })
  })

  it('rejects malformed URLs before any request', async () => {
    const before = mock.requests.length
    await expect(connect('ftp://nope', 'tester', 'secret')).rejects.toMatchObject({ kind: 'invalid-url' })
    await expect(connect('', 'tester', 'secret')).rejects.toBeInstanceOf(ConnectionError)
    expect(mock.requests.length).toBe(before)
  })

  it('requires a username', async () => {
    await expect(connect(mock.url, '  ', 'x')).rejects.toMatchObject({ kind: 'bad-credentials' })
  })

  it('reports an unreachable server', async () => {
    await expect(connect('http://127.0.0.1:1', 'tester', 'secret')).rejects.toMatchObject({ kind: 'unreachable' })
  })

  it('logout revokes the token on the server', async () => {
    const session = await connect(mock.url, 'tester', 'secret')
    expect(mock.tokens.has(session.accessToken)).toBe(true)
    await logout(session)
    expect(mock.tokens.has(session.accessToken)).toBe(false)
  })

  it('logout does not throw when the server is gone', async () => {
    const other = await startMockJellyfin()
    const session = await connect(other.url, 'tester', 'secret')
    await other.close()
    await expect(logout(session)).resolves.toBeUndefined()
  })
})
