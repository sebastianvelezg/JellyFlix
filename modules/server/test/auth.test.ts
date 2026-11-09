import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clientOf, createAuthenticator, MAX_REFUSALS } from '../src/auth/auth.ts'
import { HttpError } from '../src/http/router.ts'
import type { JellyfinClient } from '../src/jellyfin/client.ts'

/** A Jellyfin that knows one token, and counts how often it is asked. */
function jellyfin() {
  const asked: string[] = []
  const client: JellyfinClient = {
    hasServiceKey: false,
    getAsService: () => Promise.reject(new Error('not used')),
    get: <T>(_path: string, token: string) => {
      asked.push(token)
      if (token === 'good-token') return Promise.resolve({ Id: 'u1', Name: 'Ana', Policy: { IsAdministrator: false } } as T)
      return Promise.reject(new HttpError(401, 'no'))
    },
  }
  return { client, asked }
}

const status = async (promise: Promise<unknown>): Promise<number> => {
  try {
    await promise
    return 200
  } catch (e) {
    return e instanceof HttpError ? e.status : 500
  }
}

describe('who a token belongs to', () => {
  it('asks Jellyfin once a minute for the same token', async () => {
    let time = 0
    const { client, asked } = jellyfin()
    const authenticate = createAuthenticator(client, () => time)
    assert.equal((await authenticate('good-token', 'a')).id, 'u1')
    await authenticate('good-token', 'a')
    assert.equal(asked.length, 1)
    time = 61_000
    await authenticate('good-token', 'a')
    assert.equal(asked.length, 2)
  })

  it('makes a caller that keeps sending refused tokens wait, without asking Jellyfin, while everybody else carries on', async () => {
    let time = 0
    const { client, asked } = jellyfin()
    const authenticate = createAuthenticator(client, () => time)
    await authenticate('good-token', 'friend')
    for (let i = 0; i < MAX_REFUSALS; i += 1) assert.equal(await status(authenticate(`made-up-${i}`, 'attacker')), 401)
    const before = asked.length
    assert.equal(await status(authenticate('made-up-next', 'attacker')), 429)
    assert.equal(asked.length, before, 'Jellyfin is not asked any more')
    // Somebody already signed in, and another caller, are not affected.
    assert.equal(await status(authenticate('good-token', 'friend')), 200)
    assert.equal(await status(authenticate('made-up-other', 'someone-else')), 401)
    // A minute later the caller may try again.
    time = 61_000
    assert.equal(await status(authenticate('made-up-later', 'attacker')), 401)
  })

  it('keeps the sessions in use when many unknown tokens arrive (the least recently used make room, not all of them)', async () => {
    const { client, asked } = jellyfin()
    const authenticate = createAuthenticator(client, () => 0)
    await authenticate('good-token', 'friend')
    for (let i = 0; i < 600; i += 1) {
      await status(authenticate(`made-up-${i}`, `caller-${i}`))
      if (i % 100 === 0) await authenticate('good-token', 'friend')
    }
    const before = asked.length
    await authenticate('good-token', 'friend')
    assert.equal(asked.length, before, 'the session in use was still remembered')
  })
})

describe('who is calling', () => {
  const req = (forwarded?: string) => ({ headers: forwarded ? { 'x-forwarded-for': forwarded } : {}, socket: { remoteAddress: '10.0.0.5' } }) as never

  it('is the address of the connection, whatever the header says, unless the proxy is trusted', () => {
    assert.equal(clientOf(req('1.2.3.4'), false), '10.0.0.5')
    assert.equal(clientOf(req('1.2.3.4'), true), '1.2.3.4')
    assert.equal(clientOf(req('spoofed, 1.2.3.4'), true), '1.2.3.4')
    assert.equal(clientOf(req(), true), '10.0.0.5')
  })
})
