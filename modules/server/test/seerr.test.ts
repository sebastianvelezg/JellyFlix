import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Manifest, SeerrDetail, SeerrMe, SeerrRequestResult, SeerrRequests, SeerrSearch } from '../../contract/index.ts'
import { createApp } from '../src/app.ts'
import type { Config } from '../src/config.ts'
import { openDb } from '../src/db/db.ts'
import { createJellyfinClient } from '../src/jellyfin/client.ts'
import { canRequest, detailOf, posterOf, quotaOf, statusOf, titleOf } from '../src/modules/seerr/normalize.ts'
import { HttpError } from '../src/http/router.ts'
import { createSeerrClient } from '../src/modules/seerr/client.ts'
import { parseVersion } from '../src/modules/seerr/service.ts'
import { fakeJellyfin } from './fakeJellyfin.ts'
import { ADMIN, fakeSeerr, REQUEST, SEERR_KEY, type FakeSeerr } from './fakeSeerr.ts'

const base: Config = {
  port: 0,
  host: '127.0.0.1',
  jellyfinUrl: 'http://jellyfin.test',
  apiKey: undefined,
  modules: ['seerr'],
  dataDir: ':memory:',
  origins: ['*'],
  trustProxy: false,
  seerrUrl: 'http://seerr.test',
  seerrApiKey: SEERR_KEY,
  version: '0.0.0-test',
}

interface Running {
  base: string
  seerr: FakeSeerr
  /** Every body this container answered, to look for what must never be in one. */
  said: string[]
  close: () => void
  call: <T = unknown>(method: string, path: string, token: string | null, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: T }>
}

async function start(config: Config = base): Promise<Running> {
  const jellyfin = fakeJellyfin()
  const seerr = fakeSeerr()
  const app = createApp({ config, db: openDb(':memory:'), jellyfin: createJellyfinClient(config.jellyfinUrl, undefined, jellyfin.fetch), seerrFetch: seerr.fetch })
  const server: Server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const said: string[] = []
  return {
    base: url,
    seerr,
    said,
    close: () => server.close(),
    call: async (method, path, token, body, headers = {}) => {
      const res = await fetch(url + path, {
        method,
        headers: { ...(token ? { authorization: `MediaBrowser Token="${token}"` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const text = await res.text()
      said.push(text)
      return { status: res.status, body: (text ? JSON.parse(text) : undefined) as never }
    },
  }
}

describe('the Seerr module', () => {
  let app: Running
  before(async () => {
    app = await start()
  })
  after(() => app.close())
  beforeEach(() => {
    app.seerr.calls.length = 0
    app.seerr.version = '3.5.1'
    app.seerr.down = false
    app.seerr.users['u-ben'] = { id: 7, permissions: REQUEST }
  })

  it('is listed as ready while Seerr answers and is new enough, and says what is wrong otherwise', async () => {
    const ready = await app.call<Manifest>('GET', '/v1/manifest', 'tok-ben')
    assert.deepEqual(ready.body.modules, [{ id: 'seerr', version: 1, state: 'ready' }])

    const stopped = await start({ ...base, modules: ['seerr'] })
    stopped.seerr.version = '3.2.0'
    const old = await stopped.call<Manifest>('GET', '/v1/manifest', 'tok-ben')
    assert.equal(old.body.modules[0]?.state, 'error')
    assert.match(old.body.modules[0]?.detail ?? '', /3\.2\.0 is too old: 3\.3\.0/)
    stopped.seerr.version = '3.3.0'
    stopped.seerr.down = true
    // The answer about the version is remembered for a minute: the first one stands.
    assert.equal((await stopped.call<Manifest>('GET', '/v1/manifest', 'tok-ben')).body.modules[0]?.state, 'error')
    stopped.close()

    const down = await start()
    down.seerr.down = true
    const unreachable = await down.call<Manifest>('GET', '/v1/manifest', 'tok-ben')
    assert.equal(unreachable.body.modules[0]?.state, 'error')
    assert.equal(unreachable.body.modules[0]?.detail, 'Seerr did not answer.')
    down.close()
  })

  it('never makes the manifest wait long for a Seerr that does not answer, and the other modules stay listed', async () => {
    const slow = await start({ ...base, modules: ['channels', 'seerr'] })
    slow.seerr.hang = true
    const began = Date.now()
    const manifest = await slow.call<Manifest>('GET', '/v1/manifest', 'tok-ben')
    assert.ok(Date.now() - began < 2500, 'it answered within the patience of the app (2.5 s)')
    assert.deepEqual(manifest.body.modules.map((m) => [m.id, m.state]), [['channels', 'ready'], ['seerr', 'error']])
    // Asked again it answers at once from what it learned (no new wait while Seerr is still silent).
    const again = Date.now()
    await slow.call('GET', '/v1/manifest', 'tok-ben')
    assert.ok(Date.now() - again < 500)
    slow.close()
  })

  it('needs an address and a key: without them it is "needs-setup" and has no routes', async () => {
    const bare = await start({ ...base, seerrUrl: undefined, seerrApiKey: undefined })
    const manifest = await bare.call<Manifest>('GET', '/v1/manifest', 'tok-ben')
    assert.equal(manifest.body.modules[0]?.state, 'needs-setup')
    assert.equal((await bare.call('GET', '/v1/seerr/me', 'tok-ben')).status, 404)
    bare.close()
  })

  it('needs a signed-in person for everything', async () => {
    for (const path of ['/v1/seerr/me', '/v1/seerr/search?query=x', '/v1/seerr/title/movie/603', '/v1/seerr/requests']) {
      assert.equal((await app.call('GET', path, null)).status, 401, path)
    }
    assert.equal((await app.call('POST', '/v1/seerr/requests', null, { mediaType: 'movie', mediaId: 1 })).status, 401)
    assert.equal(app.seerr.calls.filter((c) => c.path !== '/status').length, 0)
  })

  it('finds the person in Seerr by their Jellyfin id and acts as them, whatever the request says', async () => {
    const me = await app.call<SeerrMe>('GET', '/v1/seerr/me', 'tok-ben', undefined, { 'x-api-user': '1', 'x-api-key': 'mine' })
    assert.equal(me.status, 200)
    assert.deepEqual(me.body.canRequest, { movie: true, tv: true })
    assert.deepEqual(me.body.quota.movie, { limit: 2, days: 7, used: 1, remaining: 1, restricted: false })
    assert.deepEqual(me.body.quota.tv, { used: 0, restricted: false })
    const lookup = app.seerr.calls.find((c) => c.path.startsWith('/user/jellyfin/'))
    assert.equal(lookup?.path, '/user/jellyfin/u-ben')
    // Everything after the lookup is made as Seerr user 7 (Ben), never the administrator's 1, and always with the container's own key.
    const asBen = app.seerr.calls.filter((c) => !c.path.startsWith('/user/jellyfin/') && c.path !== '/status')
    assert.ok(asBen.length > 0 && asBen.every((c) => c.user === '7' && c.key === SEERR_KEY))
  })

  it('tells a Jellyfin account that Seerr does not know, and never uses another account instead', async () => {
    delete app.seerr.users['u-ben']
    // (Another instance so the remembered identity of the other tests does not hide this.)
    const other = await start()
    delete other.seerr.users['u-ben']
    const r = await other.call<{ error: string }>('GET', '/v1/seerr/search?query=matrix', 'tok-ben')
    assert.equal(r.status, 403)
    assert.match(r.body.error, /not in Seerr yet/)
    assert.equal(other.seerr.calls.some((c) => c.path === '/search'), false)
    // It is remembered: typing more does not ask Seerr who this is again.
    const asked = other.seerr.calls.length
    for (let i = 0; i < 3; i += 1) assert.equal((await other.call('GET', '/v1/seerr/search?query=matrix', 'tok-ben')).status, 403)
    assert.equal(other.seerr.calls.length, asked)
    other.close()
  })

  it('stops reading an answer from Seerr that has no length and goes on and on', async () => {
    const big = new Response(new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(1024 * 1024)) }), { status: 200 })
    const client = createSeerrClient('http://seerr.test', SEERR_KEY, async () => big)
    await assert.rejects(client.get('/status'), (e: unknown) => e instanceof HttpError && /more than expected/.test(e.message))
  })

  it('searches movies and series with their state, leaves people out and ignores a picture path that is not one', async () => {
    const r = await app.call<SeerrSearch>('GET', '/v1/seerr/search?query=matrix&page=2', 'tok-ben')
    assert.equal(r.status, 200)
    assert.equal(r.body.page, 2)
    assert.equal(r.body.totalPages, 3)
    assert.deepEqual(
      r.body.results.map((t) => [t.mediaType, t.id, t.status]),
      [['movie', 603, 'available'], ['movie', 604, 'processing'], ['tv', 1396, 'partial'], ['tv', 1399, 'none']],
    )
    const matrix = r.body.results[0]
    assert.equal(matrix?.jellyfinId, 'jf-matrix-0001')
    assert.equal(matrix?.posterPath, '/matrix.jpg')
    assert.equal(matrix?.year, 1999)
    assert.equal(r.body.results[1]?.posterPath, undefined, 'a path with ".." is dropped')
    const asked = app.seerr.calls.find((c) => c.path === '/search')
    assert.deepEqual(asked?.query, { query: 'matrix', page: '2' })
  })

  it('refuses a search that is empty, too long or on a page that is not one', async () => {
    assert.equal((await app.call('GET', '/v1/seerr/search', 'tok-ben')).status, 400)
    assert.equal((await app.call('GET', '/v1/seerr/search?query=%20%20', 'tok-ben')).status, 400)
    assert.equal((await app.call('GET', `/v1/seerr/search?query=${'a'.repeat(201)}`, 'tok-ben')).status, 400)
    assert.equal((await app.call('GET', '/v1/seerr/search?query=x&page=0', 'tok-ben')).status, 400)
    assert.equal((await app.call('GET', '/v1/seerr/search?query=x&page=abc', 'tok-ben')).status, 400)
  })

  it('shows a series with its seasons and where each one stands (the specials are left out)', async () => {
    const r = await app.call<SeerrDetail>('GET', '/v1/seerr/title/tv/1396', 'tok-ben')
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.seasons, [
      { number: 1, name: 'Season 1', episodes: 7, status: 'available' },
      { number: 2, name: 'Season 2', episodes: 13, status: 'pending' },
      { number: 3, name: 'Season 3', episodes: 13, status: 'none' },
    ])
    const movie = await app.call<SeerrDetail>('GET', '/v1/seerr/title/movie/603', 'tok-ben')
    assert.equal(movie.body.tagline, 'Free your mind.')
    assert.equal(movie.body.seasons, undefined)
  })

  it('searches for several words, and for characters that need encoding, the way Seerr accepts them', async () => {
    const r = await app.call<SeerrSearch>('GET', `/v1/seerr/search?query=${encodeURIComponent('matrix reloaded & 100% wolf')}`, 'tok-ben')
    assert.equal(r.status, 200)
    const asked = app.seerr.calls.find((c) => c.path === '/search')
    assert.equal(asked?.query.query, 'matrix reloaded & 100% wolf')
  })

  it('shows the seasons that were asked for as being on their way', async () => {
    const other = await start()
    await other.call('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'tv', mediaId: 1396, seasons: [3] })
    const r = await other.call<SeerrDetail>('GET', '/v1/seerr/title/tv/1396', 'tok-ben')
    assert.deepEqual(r.body.seasons?.map((s) => [s.number, s.status]), [[1, 'available'], [2, 'pending'], [3, 'pending']])
    other.close()
  })

  it('refuses a title that is not a title number or a kind it does not have', async () => {
    assert.equal((await app.call('GET', '/v1/seerr/title/book/1', 'tok-ben')).status, 400)
    assert.equal((await app.call('GET', '/v1/seerr/title/movie/abc', 'tok-ben')).status, 400)
    assert.equal((await app.call('GET', '/v1/seerr/title/movie/0', 'tok-ben')).status, 400)
    assert.equal((await app.call('GET', '/v1/seerr/title/movie/1%2F..%2Fsettings%2Fmain', 'tok-ben')).status, 400)
    assert.equal(app.seerr.calls.some((c) => c.path.startsWith('/movie') || c.path.startsWith('/settings')), false)
  })

  it('requests a movie as that person, sending Seerr only the kind and the number', async () => {
    const r = await app.call<SeerrRequestResult>('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604, userId: 1, is4k: true, rootFolder: '/etc', seasons: [1] })
    assert.equal(r.status, 200)
    assert.equal(r.body.status, 'pending')
    const sent = app.seerr.calls.find((c) => c.method === 'POST')
    assert.deepEqual(sent?.body, { mediaType: 'movie', mediaId: 604 })
    assert.equal(sent?.user, '7')
  })

  it('requests a series for all its seasons or for some of them', async () => {
    await app.call('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'tv', mediaId: 1396 })
    await app.call('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'tv', mediaId: 1396, seasons: [3, 2, 3] })
    const bodies = app.seerr.calls.filter((c) => c.method === 'POST').map((c) => c.body)
    assert.deepEqual(bodies, [
      { mediaType: 'tv', mediaId: 1396, seasons: 'all' },
      { mediaType: 'tv', mediaId: 1396, seasons: [2, 3] },
    ])
  })

  it('checks what it is asked to request before asking Seerr anything', async () => {
    const bad = [
      {},
      { mediaType: 'book', mediaId: 1 },
      { mediaType: 'movie', mediaId: 'abc' },
      { mediaType: 'movie', mediaId: -3 },
      { mediaType: 'movie', mediaId: 1.5 },
      { mediaType: 'tv', mediaId: 5, seasons: [] },
      { mediaType: 'tv', mediaId: 5, seasons: ['1'] },
      { mediaType: 'tv', mediaId: 5, seasons: [101] },
      { mediaType: 'tv', mediaId: 5, seasons: 'some' },
      { mediaType: 'tv', mediaId: 5, seasons: Array.from({ length: 101 }, (_, i) => i) },
    ]
    for (const body of bad) assert.equal((await app.call('POST', '/v1/seerr/requests', 'tok-ben', body)).status, 400, JSON.stringify(body))
    assert.equal(app.seerr.calls.some((c) => c.method === 'POST'), false)
  })

  it('does not ask Seerr for a request an account has no permission to make', async () => {
    const other = await start()
    other.seerr.users['u-ben'] = { id: 7, permissions: 0 }
    const r = await other.call<{ error: string }>('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604 })
    assert.equal(r.status, 403)
    assert.equal(other.seerr.calls.some((c) => c.method === 'POST'), false)
    const me = await other.call<SeerrMe>('GET', '/v1/seerr/me', 'tok-ben')
    assert.deepEqual(me.body.canRequest, { movie: false, tv: false })
    other.close()
  })

  it('translates what Seerr refuses with, without passing its words on', async () => {
    app.seerr.failNextRequest = { status: 409, message: 'Request for this media already exists at http://10.0.0.5:5055' }
    const duplicate = await app.call<{ error: string }>('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604 })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.body.error, 'That has already been requested.')

    // Seerr says "ok" but makes nothing when every season asked for was already requested.
    app.seerr.failNextRequest = { status: 200, message: '' }
    const nothing = await app.call<{ error: string }>('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'tv', mediaId: 1396, seasons: [2] })
    assert.equal(nothing.status, 409)
    assert.equal(nothing.body.error, 'That has already been requested.')

    app.seerr.failNextRequest = { status: 403, message: 'Movie quota exceeded.' }
    const quota = await app.call<{ error: string }>('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604 })
    assert.equal(quota.status, 409)
    assert.equal(quota.body.error, 'The request limit has been reached for now.')

    app.seerr.failNextRequest = { status: 500, message: 'Database exploded at /var/lib/seerr' }
    const broken = await app.call<{ error: string }>('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604 })
    assert.equal(broken.status, 502)
    assert.doesNotMatch(broken.body.error, /Database|\/var|10\.0\.0\.5/)

    app.seerr.down = true
    const down = await app.call<{ error: string }>('GET', '/v1/seerr/title/movie/603', 'tok-ben')
    assert.equal(down.status, 502)
    assert.equal(down.body.error, 'Seerr did not answer.')
  })

  it('lists only the requests of the person, even for an administrator, with the titles', async () => {
    const mine = await start()
    await mine.call('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604 })
    await mine.call('POST', '/v1/seerr/requests', 'tok-admin', { mediaType: 'tv', mediaId: 1396, seasons: [1, 2] })
    const ben = await mine.call<SeerrRequests>('GET', '/v1/seerr/requests', 'tok-ben')
    assert.equal(ben.body.results.length, 1)
    assert.equal(ben.body.results[0]?.title, 'The Matrix Reloaded')
    assert.equal(ben.body.results[0]?.posterPath, '/reloaded.jpg')
    assert.equal(ben.body.results[0]?.status, 'pending')
    assert.equal(ben.body.results[0]?.mediaStatus, 'pending')
    assert.equal(ben.body.totalPages, 2)
    const admin = await mine.call<SeerrRequests>('GET', '/v1/seerr/requests', 'tok-admin')
    assert.deepEqual(admin.body.results.map((r) => [r.mediaType, r.mediaId, r.seasons]), [['tv', 1396, [1, 2]]])
    const asked = mine.seerr.calls.filter((c) => c.path === '/request' && c.method === 'GET')
    assert.deepEqual(asked.map((c) => c.query.requestedBy), ['7', '1'])
    mine.close()
  })

  it('slows down a person who asks for too many requests or searches in a minute', async () => {
    const busy = await start()
    for (let i = 0; i < 10; i += 1) assert.equal((await busy.call('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604 })).status, 200)
    assert.equal((await busy.call('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604 })).status, 429)
    // Somebody else is not slowed down by it.
    assert.equal((await busy.call('POST', '/v1/seerr/requests', 'tok-admin', { mediaType: 'movie', mediaId: 604 })).status, 200)
    for (let i = 0; i < 60; i += 1) assert.equal((await busy.call('GET', '/v1/seerr/search?query=a', 'tok-ben')).status, 200)
    assert.equal((await busy.call('GET', '/v1/seerr/search?query=a', 'tok-ben')).status, 429)
    busy.close()
  })

  it('also slows down a person who keeps asking about titles, requests and quota', async () => {
    const busy = await start()
    for (let i = 0; i < 180; i += 1) assert.equal((await busy.call('GET', '/v1/seerr/title/movie/603', 'tok-ben')).status, 200)
    assert.equal((await busy.call('GET', '/v1/seerr/title/movie/603', 'tok-ben')).status, 429)
    assert.equal((await busy.call('GET', '/v1/seerr/me', 'tok-ben')).status, 429)
    assert.equal((await busy.call('GET', '/v1/seerr/me', 'tok-admin')).status, 200)
    busy.close()
  })

  it('never lets the Seerr key (or its address) out in any answer', async () => {
    const all = await start()
    all.seerr.users['u-ben'] = { id: 7, permissions: REQUEST }
    await all.call('GET', '/v1/manifest', 'tok-ben')
    await all.call('GET', '/v1/seerr/me', 'tok-ben')
    await all.call('GET', '/v1/seerr/search?query=matrix', 'tok-ben')
    await all.call('GET', '/v1/seerr/title/tv/1396', 'tok-ben')
    await all.call('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604 })
    all.seerr.failNextRequest = { status: 401, message: `bad key ${SEERR_KEY}` }
    await all.call('POST', '/v1/seerr/requests', 'tok-ben', { mediaType: 'movie', mediaId: 604 })
    all.seerr.down = true
    await all.call('GET', '/v1/seerr/me', 'tok-admin')
    const text = all.said.join('\n')
    assert.ok(text.length > 100)
    assert.equal(text.includes(SEERR_KEY), false)
    assert.equal(text.includes('seerr.test'), false)
    all.close()
  })

  it('does not follow a redirect from Seerr (the key could be sent somewhere else)', async () => {
    const jellyfin = fakeJellyfin()
    const seerr = fakeSeerr()
    let followed: RequestInit['redirect']
    const app2 = createApp({
      config: base,
      db: openDb(':memory:'),
      jellyfin: createJellyfinClient(base.jellyfinUrl, undefined, jellyfin.fetch),
      seerrFetch: async (url, init) => {
        followed = init?.redirect
        return seerr.fetch(url, init)
      },
    })
    const server = createServer((req, res) => void app2.handler(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/seerr/me`, { headers: { authorization: 'MediaBrowser Token="tok-ben"' } })
    server.close()
    assert.equal(followed, 'manual')
  })
})

describe('what is read from Seerr', () => {
  it('turns its status numbers into words, and any other number into "none"', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 0, 'x', null].map(statusOf), ['none', 'pending', 'processing', 'partial', 'available', 'blocked', 'none', 'none', 'none', 'none'])
  })

  it('accepts only TMDb picture paths', () => {
    assert.equal(posterOf('/abc.jpg'), '/abc.jpg')
    for (const bad of ['abc.jpg', '//evil.com/x.jpg', '/../x.jpg', 'https://evil.com/x.jpg', '/a b.jpg', '/a/b.jpg', '', 5, null, `/${'a'.repeat(200)}`]) assert.equal(posterOf(bad), undefined, String(bad))
  })

  it('drops what is not a movie or a series, and cuts long texts', () => {
    assert.equal(titleOf({ id: 1, mediaType: 'person', name: 'x' }), null)
    assert.equal(titleOf({ id: -1, mediaType: 'movie', title: 'x' }), null)
    assert.equal(titleOf({ id: 1, mediaType: 'movie' }), null)
    const long = titleOf({ id: 1, mediaType: 'movie', title: 'T'.repeat(500), overview: 'O'.repeat(5000) })
    assert.equal(long?.title.length, 200)
    assert.equal(long?.overview?.length, 400)
  })

  it('does not trust the Jellyfin id Seerr sends unless it looks like one', () => {
    assert.equal(titleOf({ id: 1, mediaType: 'movie', title: 'x', mediaInfo: { jellyfinMediaId: '../../x' } })?.jellyfinId, undefined)
    assert.equal(titleOf({ id: 1, mediaType: 'movie', title: 'x', mediaInfo: { jellyfinMediaId: 'a1b2c3d4e5f6a7b8' } })?.jellyfinId, 'a1b2c3d4e5f6a7b8')
  })

  it('reads a series without seasons or with strange ones', () => {
    const none = detailOf({ id: 5, name: 'Show', seasons: 'many' }, 'tv')
    assert.deepEqual(none?.seasons, [])
    const odd = detailOf({ id: 5, name: 'Show', seasons: [{ seasonNumber: -1 }, { seasonNumber: 200 }, { seasonNumber: 2 }, null, 7] }, 'tv')
    assert.deepEqual(odd?.seasons?.map((s) => s.number), [2])
  })

  it('reads a quota with no limit as having none', () => {
    assert.deepEqual(quotaOf({ restricted: false, used: 3 }), { used: 3, restricted: false })
    assert.deepEqual(quotaOf({ limit: 0, days: 7, used: 3, remaining: 0, restricted: false }), { used: 3, restricted: false })
    assert.equal(quotaOf(null), undefined)
  })

  it('works out what a Seerr account may request from its permission number', () => {
    assert.deepEqual(canRequest(0), { movie: false, tv: false })
    assert.deepEqual(canRequest(ADMIN), { movie: true, tv: true })
    assert.deepEqual(canRequest(REQUEST), { movie: true, tv: true })
    assert.deepEqual(canRequest(262144), { movie: true, tv: false })
    assert.deepEqual(canRequest(524288), { movie: false, tv: true })
    assert.deepEqual(canRequest('32'), { movie: false, tv: false })
  })

  it('reads versions', () => {
    assert.deepEqual(parseVersion('3.5.1'), [3, 5, 1])
    assert.deepEqual(parseVersion('v3.3.0-develop.4'), [3, 3, 0])
    assert.equal(parseVersion('nonsense'), null)
    assert.equal(parseVersion(undefined), null)
  })
})
