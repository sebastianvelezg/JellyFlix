import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import type { ChannelDef, MatchRoomView } from '../../contract/index.ts'
import { createApp } from '../src/app.ts'
import type { Config } from '../src/config.ts'
import { openDb } from '../src/db/db.ts'
import { createJellyfinClient } from '../src/jellyfin/client.ts'
import { fakeJellyfin, SERVICE_KEY } from './fakeJellyfin.ts'

/**
 * Example answers of the container, kept in contract/examples/. The Android TV app has no generated copy of the contract: its tests
 * read these files with its own parsers, so an answer that changes here and is not followed there makes a test fail on the TV side.
 *
 * The files are compared by shape (names and kinds of values), not by value, because ids, codes and films are random.
 * After changing an answer on purpose: `UPDATE_EXAMPLES=1 npm test`, and commit the files.
 */
const DIR = new URL('../../contract/examples/', import.meta.url)
const config: Config = { port: 0, host: '127.0.0.1', jellyfinUrl: 'http://jellyfin.test', apiKey: SERVICE_KEY, modules: ['channels', 'match'], dataDir: ':memory:', origins: ['*'], trustProxy: false, seerrUrl: undefined, seerrApiKey: undefined, version: '0.0.0-test' }
const NOW = 1_800_000_000

let server: Server
let base = ''
const fake = fakeJellyfin()

before(async () => {
  const app = createApp({ config, db: openDb(':memory:'), jellyfin: createJellyfinClient(config.jellyfinUrl, SERVICE_KEY, fake.fetch), clock: () => NOW })
  server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function call<T = unknown>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, { method, headers: { authorization: `MediaBrowser Token="${token}"`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  assert.equal(res.status, 200, `${method} ${path}`)
  return (await res.json()) as T
}

/** Names and kinds of values: arrays by their first element. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : []
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, shape(v)]))
  return value === null ? 'null' : typeof value
}

function check(name: string, actual: unknown): void {
  const file = new URL(`${name}.json`, DIR)
  if (process.env.UPDATE_EXAMPLES === '1') {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`)
    return
  }
  assert.ok(existsSync(file), `contract/examples/${name}.json is missing: run UPDATE_EXAMPLES=1 npm test`)
  const saved = JSON.parse(readFileSync(file, 'utf8')) as unknown
  assert.deepEqual(shape(actual), shape(saved), `the answer "${name}" no longer looks like contract/examples/${name}.json (the TV app reads that file). If it changed on purpose: UPDATE_EXAMPLES=1 npm test`)
}

const channelDef: ChannelDef = {
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
}

describe('example answers for the TV app', () => {
  it('channels: the list and the window around now', async () => {
    const made = await call<{ id: string }>('POST', '/v1/channels', 'tok-admin', channelDef)
    check('channels', await call('GET', '/v1/channels', 'tok-ben'))
    check('channel-window', await call('GET', `/v1/channels/${made.id}/window`, 'tok-ben'))
  })

  it('match: a room in the middle of swiping, a finished one, and the list of rooms', async () => {
    const room = await call<MatchRoomView>('POST', '/v1/match/rooms', 'tok-admin', { deckSize: 4, genre: 'Comedy' })
    check('match-room-swiping', room)
    for (const card of room.deck) await call('POST', `/v1/match/rooms/${room.id}/swipe`, 'tok-admin', { cardId: card.id, vote: card === room.deck[0] ? 'like' : 'pass' })
    const done = await call<MatchRoomView>('GET', `/v1/match/rooms/${room.id}`, 'tok-admin')
    assert.equal(done.phase, 'done')
    check('match-room-done', done)
    check('match-rooms', await call('GET', '/v1/match/rooms', 'tok-admin'))
  })
})
