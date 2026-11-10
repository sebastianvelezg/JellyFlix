import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { MatchRoomView } from '../../contract/index.ts'
import { createApp } from '../src/app.ts'
import type { Config } from '../src/config.ts'
import { openDb } from '../src/db/db.ts'
import { createJellyfinClient } from '../src/jellyfin/client.ts'
import { ADMIN, BEN, fakeJellyfin, SERVICE_KEY } from './fakeJellyfin.ts'

/** With the container's own Jellyfin key it can look at what everybody in a room may see: nothing hidden from somebody is dealt. */
const config: Config = { port: 0, host: '127.0.0.1', jellyfinUrl: 'http://jellyfin.test', apiKey: SERVICE_KEY, modules: ['match'], dataDir: ':memory:', origins: ['*'], trustProxy: false, seerrUrl: undefined, seerrApiKey: undefined, version: '0.0.0-test' }

let server: Server
let base = ''
const fake = fakeJellyfin()

const call = async <T = unknown>(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: T }> => {
  const res = await fetch(base + path, { method, headers: { authorization: `MediaBrowser Token="${token}"`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T }
}

before(async () => {
  const app = createApp({ config, db: openDb(':memory:'), jellyfin: createJellyfinClient(config.jellyfinUrl, SERVICE_KEY, fake.fetch) })
  server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())
beforeEach(() => {
  fake.hidden[BEN.id]!.clear()
  fake.hidden[ADMIN.id]!.clear()
  fake.failService = false
})

/** Films 1 to 20 of the fake library are hidden from the person (a library they cannot open). */
const hideFrom = (userId: string, ids: string[]) => ids.forEach((id) => fake.hidden[userId]!.add(id))
const film = (n: number) => `m${String(n).padStart(2, '0')}`
const films = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => film(from + i))

async function lobbyWithBen(): Promise<MatchRoomView> {
  const lobby = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { mode: 'phones', deckSize: 6 })
  assert.equal((await call('POST', '/v1/match/join', 'tok-ben', { code: lobby.body.code })).status, 200)
  return lobby.body
}

describe('Match with the container\'s own key', () => {
  it('never deals a title hidden from somebody who joined', async () => {
    // Ben may only see films 21 to 30; the host may see everything.
    hideFrom(BEN.id, films(1, 20))
    const lobby = await lobbyWithBen()
    const started = await call<MatchRoomView>('POST', `/v1/match/rooms/${lobby.id}/start`, 'tok-admin')
    assert.equal(started.status, 200)
    assert.equal(started.body.deck.length, 6)
    for (const card of started.body.deck) assert.ok(Number(card.id.slice(1)) >= 21, `${card.id} is hidden from Ben`)
    // The asking was done as the container (its own key), about Ben, and the host's own library with the host's own token.
    const askedAboutBen = fake.calls.filter((c) => c.token === SERVICE_KEY)
    assert.ok(askedAboutBen.length > 0)
  })

  it('also thinks of the host, whose screen shows the cards, when somebody else is the one who brings the next set', async () => {
    const lobby = await lobbyWithBen()
    const started = await call<MatchRoomView>('POST', `/v1/match/rooms/${lobby.id}/start`, 'tok-admin')
    // The host (who does not vote) may not see films 1 to 20. Ben passes on every card, so Ben's request brings the next set.
    hideFrom(ADMIN.id, films(1, 20))
    let last: MatchRoomView = started.body
    for (const card of started.body.deck) last = (await call<MatchRoomView>('POST', `/v1/match/rooms/${lobby.id}/swipe`, 'tok-ben', { cardId: card.id, vote: 'pass' })).body
    assert.equal(last.round, 2)
    assert.ok(last.deck.length > 0)
    for (const card of last.deck) assert.ok(Number(card.id.slice(1)) >= 21, `${card.id} is hidden from the host`)
  })

  it('says to try again, and deals nothing, when Jellyfin cannot say what somebody may see', async () => {
    const lobby = await lobbyWithBen()
    fake.failService = true
    const started = await call<{ error: string }>('POST', `/v1/match/rooms/${lobby.id}/start`, 'tok-admin')
    assert.equal(started.status, 502)
    assert.match(started.body.error, /Try again/)
    fake.failService = false
    // Nothing was spoiled: it starts when Jellyfin answers.
    assert.equal((await call('POST', `/v1/match/rooms/${lobby.id}/start`, 'tok-admin')).status, 200)
  })

  it('still leaves out what somebody already watched (the other half of what the key is for)', async () => {
    fake.watched[BEN.id] = new Set(films(1, 20))
    const lobby = await lobbyWithBen()
    const started = await call<MatchRoomView>('POST', `/v1/match/rooms/${lobby.id}/start`, 'tok-admin')
    for (const card of started.body.deck) assert.ok(Number(card.id.slice(1)) >= 21)
    fake.watched[BEN.id] = new Set()
  })
})
