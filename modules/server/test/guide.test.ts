import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it, type TestContext } from 'node:test'
import { UNAVAILABLE_PROGRAM, type ChannelDef, type ChannelSummary, type ChannelWindow, type Guide } from '../../contract/index.ts'
import { createApp } from '../src/app.ts'
import type { Config } from '../src/config.ts'
import { openDb } from '../src/db/db.ts'
import { createJellyfinClient } from '../src/jellyfin/client.ts'
import { ADMIN, BEN, fakeJellyfin } from './fakeJellyfin.ts'

/** The guide is read by everybody who signs in: what a person may not see in Jellyfin must not show in it. */
const config: Config = { port: 0, host: '127.0.0.1', jellyfinUrl: 'http://jellyfin.test', apiKey: undefined, modules: ['channels'], dataDir: ':memory:', origins: ['*'], trustProxy: false, seerrUrl: undefined, seerrApiKey: undefined, version: '0.0.0-test' }

let server: Server
let base = ''
const now = 1_800_000_000
const fake = fakeJellyfin()

const call = async <T = unknown>(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: T; text: string }> => {
  const res = await fetch(base + path, { method, headers: { authorization: `MediaBrowser Token="${token}"`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T, text }
}

const channel: ChannelDef = {
  name: 'Comedy',
  number: 7,
  color: '#e5484d',
  sources: [{ kind: 'rule', name: 'Secret library of the grown-ups', genres: ['Comedy'], types: ['Movie'] }],
  mode: 'marathon',
  order: 'sequential',
  blocks: [],
  timezone: 'UTC',
  avoidRepeat: 3,
  enabled: true,
}

let id = ''
before(async () => {
  const app = createApp({ config, db: openDb(':memory:'), jellyfin: createJellyfinClient(config.jellyfinUrl, undefined, fake.fetch), clock: () => now })
  server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  id = (await call<{ id: string }>('POST', '/v1/channels', 'tok-admin', channel)).body.id
})
after(() => server.close())

const itemAsks = () => fake.calls.filter((c) => c.path === '/Items').length

describe('what a guide says to somebody who may not see a title', () => {
  it('shows everything to somebody who may see everything', async () => {
    const w = await call<ChannelWindow>('GET', `/v1/channels/${id}/window?before=0&after=3`, 'tok-ben')
    assert.equal(w.status, 200)
    assert.ok(w.body.programs.length >= 4)
    assert.ok(w.body.programs.every((p) => p.itemId && !p.unavailable && p.title.startsWith('Film')))
  })

  it('puts a generic note where a title is that the person may not see, and keeps the times', async (t) => {
    const all = await call<ChannelWindow>('GET', `/v1/channels/${id}/window?before=0&after=3`, 'tok-admin')
    const hiddenOne = all.body.programs[1]!
    fake.hidden[BEN.id]!.add(hiddenOne.itemId)
    // (A new person, so what was learned before does not stand in the way: the learned answers last a few minutes.)
    const other = await fresh(t)
    const w = await other.call<ChannelWindow>('GET', `/v1/channels/${other.id}/window?before=0&after=3`, 'tok-ben')
    const note = w.body.programs[1]!
    assert.equal(note.unavailable, true)
    assert.equal(note.itemId, '')
    assert.equal(note.title, UNAVAILABLE_PROGRAM)
    assert.equal(note.subtitle, undefined)
    assert.equal(note.seriesId, undefined)
    assert.equal(note.start, hiddenOne.start)
    assert.equal(note.end, hiddenOne.end)
    assert.equal(note.runtime, hiddenOne.runtime)
    assert.equal(w.body.currentIndex, all.body.currentIndex)
    // The name and the id of the title are nowhere in what that person is told.
    assert.equal(w.text.includes(hiddenOne.title), false)
    assert.equal(w.text.includes(hiddenOne.itemId), false)
    // Somebody who may see it still sees it.
    const admin = await other.call<ChannelWindow>('GET', `/v1/channels/${other.id}/window?before=0&after=3`, 'tok-admin')
    assert.equal(admin.body.programs[1]!.title, hiddenOne.title)
    fake.hidden[BEN.id]!.delete(hiddenOne.itemId)
  })

  it('does the same in the guide and in the list of channels, and nowhere says what the channel was made from', async (t) => {
    const other = await fresh(t)
    const window = await other.call<ChannelWindow>('GET', `/v1/channels/${other.id}/window?before=0&after=3`, 'tok-admin')
    const current = window.body.programs[window.body.currentIndex]!
    fake.hidden[BEN.id]!.add(current.itemId)
    const second = await fresh(t)
    const guide = await second.call<Guide>('GET', '/v1/guide', 'tok-ben')
    const shown = guide.body.channels[0]!.programs.find((p) => p.start === current.start)!
    assert.equal(shown.unavailable, true)
    assert.equal(guide.text.includes(current.title), false)
    const list = await second.call<ChannelSummary[]>('GET', '/v1/channels', 'tok-ben')
    assert.equal(list.body[0]!.now?.unavailable, true)
    assert.equal(list.text.includes(current.title), false)
    // The administrator who made it sees it.
    const admin = await second.call<ChannelSummary[]>('GET', '/v1/channels', 'tok-admin')
    assert.equal(admin.body[0]!.now?.title, current.title)
    fake.hidden[BEN.id]!.delete(current.itemId)
  })

  it('keeps the definition of a channel (its sources and their names) for those who set channels up', async () => {
    assert.equal((await call('GET', `/v1/channels/${id}`, 'tok-ben')).status, 403)
    const admin = await call<ChannelDef>('GET', `/v1/channels/${id}`, 'tok-admin')
    assert.equal(admin.status, 200)
    for (const path of ['/v1/guide', '/v1/channels', `/v1/channels/${id}/window`]) {
      assert.equal((await call('GET', path, 'tok-ben')).text.includes('Secret library of the grown-ups'), false, path)
    }
  })

  it('asks Jellyfin once for the whole guide, with the person\'s own token, and not again while it remembers', async (t) => {
    const other = await fresh(t)
    const before = fake.calls.filter((c) => c.path === '/Items')
    const askedBefore = before.length
    await other.call('GET', '/v1/guide', 'tok-ben')
    const asked = fake.calls.filter((c) => c.path === '/Items').slice(askedBefore)
    assert.ok(asked.length >= 1)
    assert.ok(asked.every((c) => c.token === 'tok-ben'), 'asked as the person, never with the container\'s own key')
    const again = itemAsks()
    await other.call('GET', '/v1/guide', 'tok-ben')
    await other.call('GET', '/v1/channels', 'tok-ben')
    assert.equal(itemAsks(), again)
  })

  it('hides what it could not check, and checks it again next time instead of remembering the failure', async (t) => {
    const other = await fresh(t)
    fake.failItems = true
    const down = await other.call<ChannelWindow>('GET', `/v1/channels/${other.id}/window?before=0&after=2`, 'tok-ben')
    assert.equal(down.status, 200)
    assert.ok(down.body.programs.every((p) => p.unavailable === true))
    fake.failItems = false
    const up = await other.call<ChannelWindow>('GET', `/v1/channels/${other.id}/window?before=0&after=2`, 'tok-ben')
    assert.ok(up.body.programs.every((p) => !p.unavailable))
  })
})

/** The same container code with its own memory (nothing learned about anybody), sharing the Jellyfin of the tests. */
async function fresh(t: TestContext): Promise<{ id: string; call: typeof call }> {
  const app = createApp({ config, db: openDb(':memory:'), jellyfin: createJellyfinClient(config.jellyfinUrl, undefined, fake.fetch), clock: () => now })
  const own = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((resolve) => own.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(own.address() as AddressInfo).port}`
  const request: typeof call = async (method, path, token, body) => {
    const res = await fetch(url + path, { method, headers: { authorization: `MediaBrowser Token="${token}"`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as never, text }
  }
  t.after(() => own.close())
  const made = await request<{ id: string }>('POST', '/v1/channels', 'tok-admin', channel)
  return { id: made.body.id, call: request }
}

void ADMIN
