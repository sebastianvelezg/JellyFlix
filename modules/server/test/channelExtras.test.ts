import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import type { ChannelDef, ChannelSummary, Guide } from '../../contract/index.ts'
import { createApp } from '../src/app.ts'
import { openDb } from '../src/db/db.ts'
import { createJellyfinClient } from '../src/jellyfin/client.ts'
import type { Config } from '../src/config.ts'
import { inspectImage, MAX_IMAGE_BYTES, parseImage } from '../src/modules/channels/image.ts'
import { fakeJellyfin } from './fakeJellyfin.ts'

const config: Config = { port: 0, host: '127.0.0.1', jellyfinUrl: 'http://jellyfin.test', apiKey: undefined, modules: ['channels'], dataDir: ':memory:', origins: ['*'], trustProxy: false, seerrUrl: undefined, seerrApiKey: undefined, version: '0.0.0-test' }

let server: Server
let base = ''
const now = 1_800_000_000
const fake = fakeJellyfin()

before(async () => {
  const app = createApp({ config, db: openDb(':memory:'), jellyfin: createJellyfinClient(config.jellyfinUrl, undefined, fake.fetch), clock: () => now })
  server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function call<T = unknown>(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `MediaBrowser Token="${token}"`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T }
}

const def = (name: string, number: number): ChannelDef => ({
  name,
  number,
  color: '#4d8dff',
  sources: [{ kind: 'rule', name: 'Comedy', genres: ['Comedy'], types: ['Movie'] }],
  mode: 'marathon',
  order: 'interleave',
  blocks: [],
  timezone: 'UTC',
  avoidRepeat: 3,
  enabled: true,
})

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const b64 = (b: Buffer) => b.toString('base64')

const pngWithSize = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}
const jpegWithSize = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(30)
  b[0] = 0xff
  b[1] = 0xd8
  b[2] = 0xff
  b[3] = 0xc0
  b.writeUInt16BE(17, 4)
  b[6] = 8
  b.writeUInt16BE(h, 7)
  b.writeUInt16BE(w, 9)
  return b
}
const webpLosslessWithSize = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(40)
  b.write('RIFF', 0, 'latin1')
  b.writeUInt32LE(32, 4)
  b.write('WEBP', 8, 'latin1')
  b.write('VP8L', 12, 'latin1')
  b.writeUInt32LE(20, 16)
  b[20] = 0x2f
  b.writeUInt32LE((w - 1) | ((h - 1) << 14), 21)
  return b
}

describe('what is inside a picture', () => {
  it('reads the size and the kind of a PNG, a JPEG and a WebP, whatever they were called', () => {
    assert.deepEqual(inspectImage(PNG_1X1), { mime: 'image/png', width: 1, height: 1 })
    assert.deepEqual(inspectImage(jpegWithSize(320, 200)), { mime: 'image/jpeg', width: 320, height: 200 })
    assert.deepEqual(inspectImage(webpLosslessWithSize(64, 48)), { mime: 'image/webp', width: 64, height: 48 })
  })

  it('does not take an SVG, a GIF, a page or nothing for a picture', () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'GIF89a\u0001\u0000\u0001\u0000', '<!doctype html><script>alert(1)</script>', '']) {
      assert.equal(inspectImage(Buffer.from(text, 'latin1')), null, text.slice(0, 20))
    }
  })

  it('refuses what is too big, not base64, or too wide', () => {
    assert.throws(() => parseImage({ data: b64(Buffer.alloc(MAX_IMAGE_BYTES + 10, 1)) }), /too big/)
    assert.throws(() => parseImage({ data: 'not base64!!' }), /too big|valid/)
    assert.throws(() => parseImage({}), /missing/)
    assert.throws(() => parseImage({ data: b64(pngWithSize(5000, 10)) }), /pixels/)
    assert.equal(parseImage({ data: b64(PNG_1X1) }).mime, 'image/png')
  })
})

describe('favourites and pictures of channels', () => {
  const ids: string[] = []

  it('makes channels to work with', async () => {
    for (const [name, number] of [['Alpha', 61], ['Beta', 62], ['Gamma', 63]] as const) {
      const made = await call<{ id: string }>('POST', '/v1/channels', 'tok-admin', def(name, number))
      assert.equal(made.status, 200)
      ids.push(made.body.id)
    }
  })

  it('keeps a person’s favourites first, in order of number, and only for that person', async () => {
    const [alpha, beta, gamma] = ids as [string, string, string]
    const names = async (token: string) => (await call<ChannelSummary[]>('GET', '/v1/channels', token)).body.map((c) => c.name)
    assert.deepEqual(await names('tok-ben'), ['Alpha', 'Beta', 'Gamma'])

    assert.deepEqual((await call('POST', `/v1/channels/${gamma}/favorite`, 'tok-ben', { favorite: true })).body, { favorite: true })
    assert.deepEqual((await call('POST', `/v1/channels/${beta}/favorite`, 'tok-ben', { favorite: true })).body, { favorite: true })
    assert.deepEqual(await names('tok-ben'), ['Beta', 'Gamma', 'Alpha'])
    assert.deepEqual(await names('tok-admin'), ['Alpha', 'Beta', 'Gamma']) // somebody else's favourites are not seen

    const list = (await call<ChannelSummary[]>('GET', '/v1/channels', 'tok-ben')).body
    assert.deepEqual(list.map((c) => c.favorite), [true, true, false])
    // The guide follows the same order, and says which are favourites.
    const guide = (await call<Guide>('GET', `/v1/guide?from=${now - 600}&to=${now + 3600}`, 'tok-ben')).body
    assert.deepEqual(guide.channels.map((c) => [c.name, c.favorite]), [['Beta', true], ['Gamma', true], ['Alpha', false]])

    assert.deepEqual((await call('POST', `/v1/channels/${beta}/favorite`, 'tok-ben', { favorite: false })).body, { favorite: false })
    assert.deepEqual(await names('tok-ben'), ['Gamma', 'Alpha', 'Beta'])
    assert.deepEqual((await call('POST', `/v1/channels/${gamma}/favorite`, 'tok-ben', { favorite: true })).body, { favorite: true }) // twice is the same
    assert.equal((await call('POST', `/v1/channels/${alpha}/favorite`, 'tok-ben', { favorite: 'yes' })).status, 400)
    assert.equal((await call('POST', '/v1/channels/nope/favorite', 'tok-ben', { favorite: true })).status, 404)
    await call('POST', `/v1/channels/${gamma}/favorite`, 'tok-ben', { favorite: false })
  })

  it('lets an administrator set a picture, everybody see it, and only an administrator change it', async () => {
    const [alpha] = ids as [string]
    assert.equal((await call('GET', `/v1/channels/${alpha}/image`, 'tok-ben')).status, 404)
    assert.equal((await call('PUT', `/v1/channels/${alpha}/image`, 'tok-ben', { data: b64(PNG_1X1) })).status, 403)
    const put = await call<{ imageVersion: number }>('PUT', `/v1/channels/${alpha}/image`, 'tok-admin', { data: b64(PNG_1X1) })
    assert.equal(put.status, 200)
    assert.equal(put.body.imageVersion, now)

    const res = await fetch(`${base}/v1/channels/${alpha}/image?v=${put.body.imageVersion}`, { headers: { authorization: 'MediaBrowser Token="tok-ben"' } })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/)
    assert.match(res.headers.get('cache-control') ?? '', /immutable/)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG_1X1)
    const without = await fetch(`${base}/v1/channels/${alpha}/image`, { headers: { authorization: 'MediaBrowser Token="tok-ben"' } })
    assert.equal(without.headers.get('cache-control'), 'private, no-cache')
    assert.equal((await fetch(`${base}/v1/channels/${alpha}/image`)).status, 401) // not without signing in

    const list = (await call<ChannelSummary[]>('GET', '/v1/channels', 'tok-ben')).body
    assert.equal(list.find((c) => c.name === 'Alpha')?.imageVersion, now)
    assert.equal(list.find((c) => c.name === 'Beta')?.imageVersion, undefined)
    const guide = (await call<Guide>('GET', `/v1/guide?from=${now - 600}&to=${now + 3600}`, 'tok-ben')).body
    assert.equal(guide.channels.find((c) => c.name === 'Alpha')?.imageVersion, now)

    // A new picture gets a new version even in the same second.
    const again = await call<{ imageVersion: number }>('PUT', `/v1/channels/${alpha}/image`, 'tok-admin', { data: b64(PNG_1X1) })
    assert.equal(again.body.imageVersion, now + 1)
  })

  it('refuses what is not a PNG, a JPEG or a WebP, what is too big and what is too wide', async () => {
    const [, beta] = ids as [string, string]
    const put = (data: string) => call('PUT', `/v1/channels/${beta}/image`, 'tok-admin', { data })
    assert.equal((await put(b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')))).status, 415)
    assert.equal((await put(b64(Buffer.from('GIF89a......................')))).status, 415)
    assert.equal((await put(b64(Buffer.alloc(MAX_IMAGE_BYTES + 100, 7)))).status, 413)
    assert.equal((await put(b64(pngWithSize(4000, 4000)))).status, 400)
    assert.equal((await put('')).status, 400)
    assert.equal((await put('%%%')).status, 413)
    assert.equal((await call('PUT', `/v1/channels/${beta}/image`, 'tok-admin', {})).status, 400)
    assert.equal((await call('PUT', '/v1/channels/nope/image', 'tok-admin', { data: b64(PNG_1X1) })).status, 404)
    assert.equal((await call('GET', `/v1/channels/${beta}/image`, 'tok-ben')).status, 404) // nothing was kept
  })

  it('takes a picture away, and a deleted channel takes its picture and its favourites with it', async () => {
    const [alpha, beta] = ids as [string, string]
    assert.equal((await call('DELETE', `/v1/channels/${alpha}/image`, 'tok-ben')).status, 403)
    assert.equal((await call('DELETE', `/v1/channels/${alpha}/image`, 'tok-admin')).status, 200)
    assert.equal((await call('GET', `/v1/channels/${alpha}/image`, 'tok-ben')).status, 404)
    await call('PUT', `/v1/channels/${beta}/image`, 'tok-admin', { data: b64(PNG_1X1) })
    await call('POST', `/v1/channels/${beta}/favorite`, 'tok-ben', { favorite: true })
    for (const id of ids) assert.equal((await call('DELETE', `/v1/channels/${id}`, 'tok-admin')).status, 200)
    assert.equal((await call('GET', `/v1/channels/${beta}/image`, 'tok-ben')).status, 404)
    assert.deepEqual((await call<ChannelSummary[]>('GET', '/v1/channels', 'tok-ben')).body, [])
  })
})
