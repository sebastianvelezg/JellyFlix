import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import type { ChannelDef, ChannelWindow, Manifest, MatchRoomView } from '../../contract/index.ts'
import { createApp } from '../src/app.ts'
import { openDb } from '../src/db/db.ts'
import { createJellyfinClient } from '../src/jellyfin/client.ts'
import type { Config } from '../src/config.ts'
import { fakeJellyfin, SERVICE_KEY } from './fakeJellyfin.ts'

// (With the container's own key: a Match on phones needs it, to know what everybody in the room may watch.)
const config: Config = { port: 0, host: '127.0.0.1', jellyfinUrl: 'http://jellyfin.test', apiKey: SERVICE_KEY, modules: ['channels', 'match'], dataDir: ':memory:', origins: ['*'], trustProxy: false, seerrUrl: undefined, seerrApiKey: undefined, version: '0.0.0-test' }

let server: Server
let base = ''
let now = 1_800_000_000 // a fixed moment
const fake = fakeJellyfin()

before(async () => {
  const db = openDb(':memory:')
  const app = createApp({ config, db, jellyfin: createJellyfinClient(config.jellyfinUrl, SERVICE_KEY, fake.fetch), clock: () => now })
  server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function call<T = unknown>(method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `MediaBrowser Token="${token}"` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T }
}

const channelDef = (over: Partial<ChannelDef> = {}): ChannelDef => ({
  name: 'Comedy',
  number: 7,
  color: '#e5484d',
  sources: [{ kind: 'rule', name: 'Comedy', genres: ['Comedy'], types: ['Movie'] }],
  mode: 'marathon',
  order: 'interleave',
  blocks: [],
  timezone: 'UTC',
  avoidRepeat: 3,
  enabled: true,
  ...over,
})

describe('the container', () => {
  it('answers health without a token and refuses everything else without one', async () => {
    assert.equal((await call('GET', '/v1/health', null)).status, 200)
    assert.equal((await call('GET', '/v1/manifest', null)).status, 401)
    assert.equal((await call('GET', '/v1/manifest', 'not-a-token')).status, 401)
    assert.equal((await call('GET', '/v1/nothing', 'tok-admin')).status, 404)
  })

  it('says who is asking and which modules are on', async () => {
    const { status, body } = await call<Manifest>('GET', '/v1/manifest', 'tok-ben')
    assert.equal(status, 200)
    assert.deepEqual(body.modules.map((m) => m.id), ['channels', 'match'])
    assert.equal(body.user.isAdmin, false)
    assert.equal(body.serverTime, now)
  })

  it('does not keep the token anywhere it can be read back', async () => {
    const { body } = await call('GET', '/v1/channels', 'tok-admin')
    assert.equal(JSON.stringify(body).includes('tok-admin'), false)
  })

  it('answers the preflight request browsers send', async () => {
    const res = await fetch(`${base}/v1/channels`, { method: 'OPTIONS', headers: { origin: 'http://app.test', 'access-control-request-method': 'GET' } })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  })
})

describe('channels', () => {
  let id = ''

  it('only an administrator creates a channel', async () => {
    assert.equal((await call('POST', '/v1/channels', 'tok-ben', channelDef())).status, 403)
    const made = await call<{ id: string; poolSize: number }>('POST', '/v1/channels', 'tok-admin', channelDef())
    assert.equal(made.status, 200)
    assert.ok(made.body.poolSize > 0)
    id = made.body.id
  })

  it('refuses a number that is taken and a definition that makes no sense', async () => {
    assert.equal((await call('POST', '/v1/channels', 'tok-admin', channelDef())).status, 409)
    assert.equal((await call('POST', '/v1/channels', 'tok-admin', channelDef({ number: 8, sources: [] }))).status, 400)
    assert.equal((await call('POST', '/v1/channels', 'tok-admin', { name: 'x' })).status, 400)
  })

  it('says what is on now, and how far into it, to anybody', async () => {
    const { status, body } = await call<ChannelWindow>('GET', `/v1/channels/${id}/window?before=1&after=3`, 'tok-ben')
    assert.equal(status, 200)
    assert.ok(body.currentIndex >= 0)
    const current = body.programs[body.currentIndex]!
    assert.ok(current.start <= now && now < current.end)
    assert.equal(body.programs.length, body.currentIndex + 1 + 3)
    for (let i = 1; i < body.programs.length; i += 1) assert.equal(body.programs[i]!.start, body.programs[i - 1]!.end)
  })

  it('keeps the schedule the same when asked again, and goes on when time passes', async () => {
    const a = await call<ChannelWindow>('GET', `/v1/channels/${id}/window`, 'tok-ben')
    const b = await call<ChannelWindow>('GET', `/v1/channels/${id}/window`, 'tok-admin')
    assert.deepEqual(a.body.programs, b.body.programs)
    now += 3 * 3600
    const later = await call<ChannelWindow>('GET', `/v1/channels/${id}/window`, 'tok-ben')
    const cur = later.body.programs[later.body.currentIndex]!
    assert.ok(cur.start <= now && now < cur.end)
  })

  it('does not ask Jellyfin again, for what is on, about what it already learned of the person', async () => {
    const before = fake.calls.filter((c) => c.path !== '/Users/Me').length
    await call('GET', `/v1/channels/${id}/window`, 'tok-ben')
    await call('GET', '/v1/guide', 'tok-ben')
    assert.equal(fake.calls.filter((c) => c.path !== '/Users/Me').length, before)
  })

  it('lists the channels with what is on and what is next', async () => {
    const { body } = await call<Array<{ number: number; now?: { itemId: string }; next?: unknown }>>('GET', '/v1/channels', 'tok-ben')
    assert.equal(body.length, 1)
    assert.equal(body[0]!.number, 7)
    assert.ok(body[0]!.now && body[0]!.next)
  })

  it('shows the guide for all channels', async () => {
    const { body } = await call<{ channels: Array<{ programs: unknown[] }> }>('GET', `/v1/guide?from=${now - 600}&to=${now + 7200}`, 'tok-ben')
    assert.equal(body.channels.length, 1)
    assert.ok(body.channels[0]!.programs.length >= 1)
  })

  it('keeps what is on when the channel is edited, and changes what is further away', async () => {
    const before = await call<ChannelWindow>('GET', `/v1/channels/${id}/window?before=0&after=0`, 'tok-ben')
    const edited = await call('PUT', `/v1/channels/${id}`, 'tok-admin', channelDef({ name: 'Comedy 2', sources: [{ kind: 'rule', name: 'Drama', genres: ['Drama'], types: ['Movie'] }] }))
    assert.equal(edited.status, 200)
    const after = await call<ChannelWindow>('GET', `/v1/channels/${id}/window?before=0&after=0`, 'tok-ben')
    assert.equal(after.body.programs[0]!.itemId, before.body.programs[0]!.itemId)
    const far = await call<ChannelWindow>('GET', `/v1/channels/${id}/window?at=${now + 5 * 3600}&before=0&after=0`, 'tok-ben')
    assert.ok(far.body.programs[0], 'there is a schedule further on')
  })

  it('goes through the episodes of a series in order', async () => {
    const made = await call<{ id: string }>('POST', '/v1/channels', 'tok-admin', channelDef({ name: 'Show', number: 9, order: 'sequential', sources: [{ kind: 'item', id: 's1', name: 'The Show', itemType: 'Series' }] }))
    assert.equal(made.status, 200)
    const w = await call<ChannelWindow>('GET', `/v1/channels/${made.body.id}/window?before=0&after=3`, 'tok-ben')
    assert.deepEqual(w.body.programs.map((p) => p.itemId), ['e1', 'e2', 'e3', 'e4'])
    assert.equal(w.body.programs[0]!.subtitle, 'The Show · S01E01')
  })

  it('suggests genres and collections, and makes one channel per genre', async () => {
    const s = await call<{ genres: string[] }>('GET', '/v1/channels/suggestions', 'tok-admin')
    assert.deepEqual(s.body.genres, ['Action', 'Comedy', 'Documentary', 'Drama']) // from /Genres and from the query filters, once each
    assert.equal((await call('GET', '/v1/channels/suggestions', 'tok-ben')).status, 403)
    const auto = await call<{ created: Array<{ number: number; name: string }> }>('POST', '/v1/channels/auto', 'tok-admin', { genres: ['Action', 'Drama'], collectionIds: [], types: ['Movie'] })
    assert.deepEqual(auto.body.created.map((c) => c.name), ['Action', 'Drama'])
    assert.equal(new Set(auto.body.created.map((c) => c.number)).size, 2)
  })

  it('previews a channel without saving it', async () => {
    const before = (await call<unknown[]>('GET', '/v1/channels', 'tok-admin')).body.length
    const p = await call<{ poolSize: number; programs: unknown[] }>('POST', '/v1/channels/preview', 'tok-admin', channelDef({ number: 99 }))
    assert.ok(p.body.poolSize > 0 && p.body.programs.length > 0)
    assert.equal((await call<unknown[]>('GET', '/v1/channels', 'tok-admin')).body.length, before)
  })

  it('reads many films with a few questions to Jellyfin, and says which one it could not find', async () => {
    const films = Array.from({ length: 25 }, (_, i) => ({ kind: 'item' as const, id: `m${String(i + 1).padStart(2, '0')}`, name: `Film ${i + 1}`, itemType: 'Movie' }))
    const asked = () => fake.calls.filter((c) => c.path === '/Items').length
    const before = asked()
    const p = await call<{ poolSize: number; warnings: string[] }>('POST', '/v1/channels/preview', 'tok-admin', channelDef({ number: 98, sources: [...films, { kind: 'item', id: 'zzzz', name: 'Gone' }] }))
    assert.equal(p.status, 200)
    assert.equal(p.body.poolSize, 25)
    assert.deepEqual(p.body.warnings, ['“Gone” is not in Jellyfin (or this account cannot see it).'])
    assert.equal(asked() - before, 1) // one batch, not twenty-six questions
  })

  it('keeps the settings of how a channel is programmed, with a default for an old channel, and refuses odd ones', async () => {
    const ok = await call<{ programs: Array<{ itemId: string }> }>('POST', '/v1/channels/preview', 'tok-admin', channelDef({ number: 97, order: 'oldest', episodesInARow: 2, maxMinutes: 90 }))
    assert.equal(ok.status, 200)
    assert.ok(ok.body.programs.length > 0)
    for (const bad of [{ episodesInARow: 6 }, { episodesInARow: 0 }, { maxMinutes: -1 }, { maxMinutes: 601 }, { maxMinutes: 1.5 }]) {
      assert.equal((await call('POST', '/v1/channels/preview', 'tok-admin', { ...channelDef({ number: 96 }), ...bad })).status, 400, JSON.stringify(bad))
    }
    const { episodesInARow: _a, maxMinutes: _b, ...old } = channelDef({ number: 95 })
    assert.equal((await call('POST', '/v1/channels/preview', 'tok-admin', old)).status, 200)
    const many = Array.from({ length: 501 }, (_, i) => ({ kind: 'item' as const, id: `x${i}`, name: 'x' }))
    assert.equal((await call('POST', '/v1/channels/preview', 'tok-admin', channelDef({ number: 94, sources: many }))).status, 400)
  })

  it('turns a channel off and on, and says how many titles it has', async () => {
    const list = (await call<Array<{ id: string; enabled: boolean; mode: string; poolSize: number; now?: unknown }>>('GET', '/v1/channels', 'tok-ben')).body
    const mine = list.find((c) => c.id === id)!
    assert.equal(mine.mode, 'marathon')
    assert.ok(mine.poolSize > 0)
    assert.equal((await call('POST', `/v1/channels/${id}/enabled`, 'tok-ben', { enabled: false })).status, 403)
    assert.equal((await call('POST', `/v1/channels/${id}/enabled`, 'tok-admin', { enabled: 'no' })).status, 400)
    const off = await call<{ enabled: boolean }>('POST', `/v1/channels/${id}/enabled`, 'tok-admin', { enabled: false })
    assert.equal(off.body.enabled, false)
    const after = (await call<Array<{ id: string; enabled: boolean; now?: unknown }>>('GET', '/v1/channels', 'tok-ben')).body.find((c) => c.id === id)!
    assert.equal(after.enabled, false)
    assert.equal(after.now, undefined)
    assert.equal(((await call<{ channels: Array<{ id: string }> }>('GET', '/v1/guide', 'tok-ben')).body.channels).some((c) => c.id === id), false)
    const on = await call<{ enabled: boolean }>('POST', `/v1/channels/${id}/enabled`, 'tok-admin', { enabled: true })
    assert.equal(on.body.enabled, true)
    const back = (await call<Array<{ id: string; now?: unknown }>>('GET', '/v1/channels', 'tok-ben')).body.find((c) => c.id === id)!
    assert.ok(back.now)
  })

  it('removes a channel', async () => {
    assert.equal((await call('DELETE', `/v1/channels/${id}`, 'tok-admin')).status, 200)
    assert.equal((await call('GET', `/v1/channels/${id}`, 'tok-admin')).status, 404)
  })
})

describe('match', () => {
  /** A Match for phones: the host (Ana) opens it, Ana and Ben join, and the host starts it. */
  async function phonesRoom(over: Record<string, unknown> = {}): Promise<MatchRoomView> {
    const made = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { mode: 'phones', deckSize: 6, ...over })
    assert.equal(made.status, 200)
    await call('POST', '/v1/match/join', 'tok-admin', { code: made.body.code })
    await call('POST', '/v1/match/join', 'tok-ben', { code: made.body.code })
    const started = await call<MatchRoomView>('POST', `/v1/match/rooms/${made.body.id}/start`, 'tok-admin')
    assert.equal(started.status, 200)
    return started.body
  }

  const swipeAs = (token: string, roomId: string, cardId: string | undefined, vote: 'like' | 'pass') => call('POST', `/v1/match/rooms/${roomId}/swipe`, token, { cardId, vote })
  const room = async (token: string, roomId: string) => (await call<MatchRoomView>('GET', `/v1/match/rooms/${roomId}`, token)).body

  it('a Match on one device deals the cards at once, nobody else can join it, and a round ends with just the person', async () => {
    const made = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4 })
    assert.equal(made.body.mode, 'local')
    assert.equal(made.body.phase, 'swipe')
    assert.equal(made.body.deck.length, 4)
    assert.equal((await call('POST', '/v1/match/join', 'tok-ben', { code: made.body.code })).status, 409)
    for (const c of made.body.deck) await swipeAs('tok-admin', made.body.id, c.id, c.id === made.body.deck[2]!.id ? 'like' : 'pass')
    const view = await room('tok-admin', made.body.id)
    assert.equal(view.phase, 'done')
    assert.equal(view.winner?.id, made.body.deck[2]!.id)
  })

  it('a Match for phones starts in a lobby; people join; only the host starts it; then everybody swipes the same cards', async () => {
    const lobby = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { mode: 'phones', deckSize: 6 })
    assert.equal(lobby.body.phase, 'lobby')
    assert.equal(lobby.body.code.length, 5)
    assert.deepEqual(lobby.body.deck, [])
    assert.equal(lobby.body.hostName, 'Ana')

    assert.equal((await call('POST', `/v1/match/rooms/${lobby.body.id}/start`, 'tok-admin')).status, 409, 'nobody has joined')
    const joined = await call<MatchRoomView>('POST', '/v1/match/join', 'tok-ben', { code: lobby.body.code.toLowerCase() })
    assert.equal(joined.status, 200)
    assert.equal(joined.body.phase, 'lobby')
    assert.equal((await call('POST', `/v1/match/rooms/${lobby.body.id}/start`, 'tok-ben')).status, 403, 'only the host starts it')
    // The host sees who has joined, without voting.
    const host = await room('tok-admin', lobby.body.id)
    assert.deepEqual(host.members.map((m) => m.name), ['Ben'])
    assert.equal(host.hostId, host.me)
    assert.equal((await call('POST', `/v1/match/rooms/${lobby.body.id}/swipe`, 'tok-ben', { cardId: 'x', vote: 'like' })).status, 409, 'no swiping in the lobby')

    const started = await call<MatchRoomView>('POST', `/v1/match/rooms/${lobby.body.id}/start`, 'tok-admin')
    assert.equal(started.status, 200)
    assert.equal(started.body.phase, 'swipe')
    assert.equal(started.body.deck.length, 6)
    assert.equal((await call('POST', `/v1/match/rooms/${lobby.body.id}/start`, 'tok-admin')).status, 409, 'already started')
    // The host did not join, so the round ends when Ben finishes.
    const ids = started.body.deck.map((c) => c.id)
    for (const [i, id] of ids.entries()) await swipeAs('tok-ben', lobby.body.id, id, i === 1 ? 'like' : 'pass')
    const done = await room('tok-admin', lobby.body.id)
    assert.equal(done.phase, 'done')
    assert.equal(done.winner?.id, ids[1])
  })

  it('two people swipe the same cards and end with a winner they can play', async () => {
    const started = await phonesRoom()
    const ids = started.deck.map((c) => c.id)
    // Ana likes the first three; Ben likes cards 2, 3 and 6.
    for (const [i, id] of ids.entries()) await swipeAs('tok-admin', started.id, id, i < 3 ? 'like' : 'pass')
    let view = await room('tok-admin', started.id)
    assert.equal(view.round, 1, 'waits for Ben')
    assert.equal(view.remaining.length, 0)
    for (const [i, id] of ids.entries()) await swipeAs('tok-ben', started.id, id, i === 1 || i === 2 || i === 5 ? 'like' : 'pass')
    view = await room('tok-ben', started.id)
    assert.equal(view.round, 2)
    assert.deepEqual(view.deck.map((c) => c.id), [ids[1], ids[2]])
    assert.deepEqual(view.lastLiked, [ids[1], ids[2]])
    await swipeAs('tok-admin', started.id, ids[1], 'like')
    await swipeAs('tok-admin', started.id, ids[2], 'like')
    await swipeAs('tok-ben', started.id, ids[1], 'like')
    await swipeAs('tok-ben', started.id, ids[2], 'pass')
    view = await room('tok-admin', started.id)
    assert.equal(view.phase, 'done')
    assert.equal(view.winner?.id, ids[1])
  })

  it('only people in the room can look at it, and nobody sees the other’s votes', async () => {
    const mine = (await call<Array<{ id: string }>>('GET', '/v1/match/rooms', 'tok-admin')).body
    assert.ok(mine.length >= 1)
    const made = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { mode: 'phones', deckSize: 4 })
    assert.equal((await call('GET', `/v1/match/rooms/${made.body.id}`, 'tok-ben')).status, 403)
    await call('POST', '/v1/match/join', 'tok-ben', { code: made.body.code })
    await call('POST', '/v1/match/join', 'tok-admin', { code: made.body.code })
    await call('POST', `/v1/match/rooms/${made.body.id}/start`, 'tok-admin')
    const first = (await room('tok-admin', made.body.id)).deck[0]!
    await swipeAs('tok-admin', made.body.id, first.id, 'pass')
    const ben = await room('tok-ben', made.body.id)
    assert.deepEqual(ben.myVotes, {})
    assert.equal(ben.members.find((m) => m.name === 'Ana')?.done, false)
  })

  it('the host closes a Match for phones for everybody; a person who leaves only leaves', async () => {
    const made = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { mode: 'phones', deckSize: 4 })
    await call('POST', '/v1/match/join', 'tok-ben', { code: made.body.code })
    await call('DELETE', `/v1/match/rooms/${made.body.id}`, 'tok-ben')
    assert.equal((await call('GET', `/v1/match/rooms/${made.body.id}`, 'tok-admin')).status, 200)
    await call('POST', '/v1/match/join', 'tok-ben', { code: made.body.code })
    await call('DELETE', `/v1/match/rooms/${made.body.id}`, 'tok-admin')
    assert.equal((await call('GET', `/v1/match/rooms/${made.body.id}`, 'tok-ben')).status, 404)
  })

  it('answers "unchanged" when nothing moved since the version the app has', async () => {
    const made = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4 })
    const again = await call<{ unchanged?: boolean }>('GET', `/v1/match/rooms/${made.body.id}?since=${made.body.version}`, 'tok-admin')
    assert.equal(again.body.unchanged, true)
  })

  it('does not know a wrong code and refuses a bad vote', async () => {
    assert.equal((await call('POST', '/v1/match/join', 'tok-ben', { code: 'ZZZZZ' })).status, 404)
    const made = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4 })
    assert.equal((await swipeAs('tok-admin', made.body.id, made.body.deck[0]!.id, 'maybe' as 'like')).status, 400)
  })

  it('brings a fresh set when nobody agreed, without repeating films, with the same filters', async () => {
    const started = await phonesRoom({ deckSize: 4, genre: 'Comedy' })
    for (const c of started.deck) {
      await swipeAs('tok-admin', started.id, c.id, 'like')
      await swipeAs('tok-ben', started.id, c.id, 'pass')
    }
    const view = await room('tok-admin', started.id)
    assert.equal(view.round, 2)
    assert.equal(view.phase, 'swipe')
    const first = new Set(started.deck.map((c) => c.id))
    assert.ok(view.deck.every((c) => !first.has(c.id) && c.genres.includes('Comedy')))
    assert.deepEqual(view.filters, { genre: 'Comedy' })
  })

  it('when nobody agrees and no films are left, keeps the last votes and lets everybody choose a favourite', async () => {
    // There are ten comedies: sets of 4, 4 and 2 are dealt, and everybody passes on every one.
    const started = await phonesRoom({ deckSize: 4, genre: 'Comedy' })
    let view = started
    for (let guard = 0; guard < 6 && view.phase === 'swipe'; guard += 1) {
      for (const c of view.deck) {
        await swipeAs('tok-admin', started.id, c.id, 'pass')
        await swipeAs('tok-ben', started.id, c.id, 'pass')
      }
      view = await room('tok-ben', started.id)
    }
    assert.equal(view.phase, 'pick', 'the room is not stuck in the swiping')
    assert.equal(view.deck.length, 2)
    // They choose, and the Match ends with a winner.
    await call('POST', `/v1/match/rooms/${started.id}/pick`, 'tok-admin', { cardId: view.deck[0]!.id })
    await call('POST', `/v1/match/rooms/${started.id}/pick`, 'tok-ben', { cardId: view.deck[0]!.id })
    view = await room('tok-ben', started.id)
    assert.equal(view.phase, 'done')
    assert.equal(view.winner?.id, view.deck[0]!.id)
  })

  it('couch mode: one remote plays a seat for each person on the sofa, and nobody else can', async () => {
    const made = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4, players: ['Ana', 'Ben', 'Cy'] })
    assert.equal(made.status, 200)
    assert.deepEqual(made.body.members.map((m) => m.name), ['Ana', 'Ben', 'Cy'])
    const seat = made.body.members[1]!.id
    const id = made.body.id
    // The host asks what a seat still has to vote on, and votes for it.
    const view = await call<MatchRoomView>('GET', `/v1/match/rooms/${id}?as=${encodeURIComponent(seat)}`, 'tok-admin')
    assert.equal(view.body.me, seat)
    assert.equal(view.body.remaining.length, made.body.deck.length)
    const voted = await call<MatchRoomView>('POST', `/v1/match/rooms/${id}/swipe`, 'tok-admin', { cardId: made.body.deck[0]!.id, vote: 'like', as: seat })
    assert.equal(voted.status, 200)
    assert.equal(voted.body.me, seat)
    assert.equal(voted.body.remaining.length, made.body.deck.length - 1)
    // The host's own votes are not touched, and a person who is not the host cannot play a seat.
    const own = await call<MatchRoomView>('GET', `/v1/match/rooms/${id}`, 'tok-admin')
    assert.equal(own.body.remaining.length, made.body.deck.length)
    const stranger = await call('POST', `/v1/match/rooms/${id}/swipe`, 'tok-ben', { cardId: made.body.deck[0]!.id, vote: 'like', as: seat })
    assert.equal(stranger.status, 403)
    // A seat that does not exist cannot be played either.
    const missing = await call('POST', `/v1/match/rooms/${id}/swipe`, 'tok-admin', { cardId: made.body.deck[0]!.id, vote: 'like', as: 'nobody#9' })
    assert.equal(missing.status, 403)
  })

  it('couch mode finishes like any room once every seat has voted, and the host closes it for everybody', async () => {
    const made = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4, players: ['Ana', 'Ben'] })
    const seats = made.body.members.map((m) => m.id)
    const liked = made.body.deck[0]!.id
    let last: MatchRoomView | undefined
    for (const seat of seats) {
      for (const card of made.body.deck) {
        const answer = await call<MatchRoomView>('POST', `/v1/match/rooms/${made.body.id}/swipe`, 'tok-admin', { cardId: card.id, vote: card.id === liked ? 'like' : 'pass', as: seat })
        assert.equal(answer.status, 200)
        last = answer.body
      }
    }
    assert.equal(last?.phase, 'done')
    assert.equal(last?.winner?.id, liked)
    await call('DELETE', `/v1/match/rooms/${made.body.id}`, 'tok-admin')
    assert.equal((await call('GET', `/v1/match/rooms/${made.body.id}`, 'tok-admin')).status, 404)
  })

  it("the host can end a Match without agreement and keep the films that came closest; nobody else can", async () => {
    const started = await phonesRoom({ deckSize: 4 })
    await swipeAs('tok-admin', started.id, started.deck[0]!.id, "like")
    const denied = await call("POST", `/v1/match/rooms/${started.id}/end`, 'tok-ben')
    assert.equal(denied.status, 403)
    const ended = await call<MatchRoomView>("POST", `/v1/match/rooms/${started.id}/end`, 'tok-admin')
    assert.equal(ended.body.phase, "done")
    assert.equal(ended.body.winnerBy, "none")
    assert.equal(ended.body.winner, undefined)
    assert.deepEqual(ended.body.finalists?.map((c) => c.id), [started.deck[0]!.id])
    const seen = await room('tok-ben', started.id)
    assert.equal(seen.winnerBy, "none")
  })

  it('only deals the films that fit the filters, and says what they were', async () => {
    const options = await call<{ genres: string[] }>('GET', '/v1/match/options', 'tok-ben')
    assert.deepEqual(options.body.genres, ['Action', 'Comedy', 'Drama'])
    const comedy = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 6, genre: 'Comedy' })
    assert.ok(comedy.body.deck.every((c) => c.genres.includes('Comedy')))
    assert.deepEqual(comedy.body.filters, { genre: 'Comedy' })
    const decade = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 6, decade: 2000 })
    assert.ok(decade.body.deck.every((c) => c.year !== undefined && c.year >= 2000 && c.year <= 2009))
    const short = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4, length: 'short' })
    assert.ok(short.body.deck.every((c) => (c.runtimeMinutes ?? 999) < 90))
    const medium = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4, length: 'medium' })
    assert.ok(medium.body.deck.every((c) => (c.runtimeMinutes ?? 0) >= 90 && (c.runtimeMinutes ?? 999) <= 120))
    // Nothing in this library is longer than two hours: a clear message, before anybody is called in.
    const none = await call<{ error: string }>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4, length: 'long', mode: 'phones' })
    assert.equal(none.status, 422)
    assert.match(none.body.error, /fewer filters/)
  })

  it('can include series, and a series is only a film card when asked for', async () => {
    const films = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 20, genre: 'Comedy' })
    assert.ok(films.body.deck.every((c) => c.kind === 'Movie'))
    const both = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 20, genre: 'Comedy', series: true })
    assert.ok(both.body.deck.some((c) => c.kind === 'Series'))
    assert.equal(both.body.filters.series, true)
    const long = await call<{ error: string }>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4, length: 'long', series: true })
    assert.equal(long.status, 422)
  })

  it('at the end says how much the people agreed and what each chose', async () => {
    const started = await phonesRoom()
    const ids = started.deck.map((c) => c.id)
    // Ana likes the first four, Ben the middle four: they agree on two (cards 3 and 4).
    for (const [i, id] of ids.entries()) {
      await swipeAs('tok-admin', started.id, id, i < 4 ? 'like' : 'pass')
      await swipeAs('tok-ben', started.id, id, i >= 2 && i < 6 ? 'like' : 'pass')
    }
    // Round 2 has those two; both like both, so each chooses a favourite.
    for (const id of [ids[2]!, ids[3]!]) {
      await swipeAs('tok-admin', started.id, id, 'like')
      await swipeAs('tok-ben', started.id, id, 'like')
    }
    let view = await room('tok-admin', started.id)
    assert.equal(view.phase, 'pick')
    await call('POST', `/v1/match/rooms/${started.id}/pick`, 'tok-admin', { cardId: ids[2] })
    await call('POST', `/v1/match/rooms/${started.id}/pick`, 'tok-ben', { cardId: ids[3] })
    view = await room('tok-ben', started.id)
    assert.equal(view.phase, 'done')
    assert.equal(view.winnerBy, 'coin')
    const s = view.summary!
    assert.equal(s.rounds, 3)
    assert.deepEqual(s.firstRound, { total: 6, both: 2, percent: 33, liked: [{ id: 'u-admin', name: 'Ana', count: 4 }, { id: 'u-ben', name: 'Ben', count: 4 }] })
    assert.deepEqual(s.picks.map((p) => [p.name, p.card]), [['Ana', started.deck[2]!.name], ['Ben', started.deck[3]!.name]])
  })

  it('another round deals a new set with the same filters; the host of a Match for phones can ask for it', async () => {
    const started = await phonesRoom({ deckSize: 4 })
    for (const c of started.deck) {
      await swipeAs('tok-admin', started.id, c.id, c.id === started.deck[0]!.id ? 'like' : 'pass')
      await swipeAs('tok-ben', started.id, c.id, c.id === started.deck[0]!.id ? 'like' : 'pass')
    }
    assert.equal((await room('tok-admin', started.id)).phase, 'done')
    const again = await call<MatchRoomView>('POST', `/v1/match/rooms/${started.id}/again`, 'tok-admin')
    assert.equal(again.status, 200)
    assert.equal(again.body.phase, 'swipe')
    assert.equal(again.body.round, 1)
    assert.ok(again.body.deck.every((c) => !started.deck.some((o) => o.id === c.id)))
  })
})

describe('what the container refuses', () => {
  it('does not let a stranger join a Match that has already started, but gives the room back to somebody already in', async () => {
    const lobby = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { mode: 'phones', deckSize: 6 })
    await call('POST', '/v1/match/join', 'tok-ben', { code: lobby.body.code })
    assert.equal((await call('POST', `/v1/match/rooms/${lobby.body.id}/start`, 'tok-admin')).status, 200)
    assert.equal((await call('POST', '/v1/match/join', 'tok-admin', { code: lobby.body.code })).status, 409)
    assert.equal((await call('POST', '/v1/match/join', 'tok-ben', { code: lobby.body.code })).status, 200)
  })

  it('makes a person wait after too many wrong room codes', async () => {
    now += 61 // (earlier tests also tried a wrong code)
    for (let i = 0; i < 8; i += 1) assert.equal((await call('POST', '/v1/match/join', 'tok-ben', { code: 'ZZZZZ' })).status, 404)
    assert.equal((await call('POST', '/v1/match/join', 'tok-ben', { code: 'ZZZZZ' })).status, 429)
    now += 61
    assert.equal((await call('POST', '/v1/match/join', 'tok-ben', { code: 'ZZZZZ' })).status, 404)
  })

  it('refuses a token that is not shaped like one, and an address with broken escapes', async () => {
    const res = await fetch(`${base}/v1/manifest`, { headers: { authorization: 'Bearer abc",Token="tok-admin' } })
    assert.equal(res.status, 401)
    assert.equal((await call('GET', '/v1/channels/%E0%A4%A', 'tok-admin')).status, 400)
  })
})
