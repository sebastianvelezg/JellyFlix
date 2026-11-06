// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  behindLive,
  createModulesClient,
  describeSpan,
  isLive,
  locate,
  joinLink,
  mergePrograms,
  isTrustedModulesAddress,
  normalizeModulesUrl,
  probeModules,
  whatIsWaiting,
  type FetchLike,
  type Manifest,
  type MatchRoomView,
  type Program,
} from './index'

const manifest = (over: Partial<Manifest> = {}): Manifest => ({
  api: 1,
  version: '0.1.0',
  serverTime: 1000,
  user: { id: 'u', name: 'Sebas', isAdmin: true },
  modules: [{ id: 'channels', state: 'ready' }],
  serviceKey: false,
  ...over,
})

const answer = (body: unknown, status = 200): FetchLike => async () => new Response(JSON.stringify(body), { status })

const program = (start: number, end: number): Program => ({ start, end, itemId: `i${start}`, title: `T${start}`, type: 'Movie', runtime: end - start })

describe('the address of the modules container', () => {
  it('accepts a web address or a path on this site, and nothing else', () => {
    expect(normalizeModulesUrl('http://host:8097/')).toBe('http://host:8097')
    expect(normalizeModulesUrl(' https://modules.example.com/api ')).toBe('https://modules.example.com/api')
    expect(normalizeModulesUrl('/modules')).toBe('/modules')
    for (const bad of ['', '   ', null, undefined, 'host:8097', 'javascript:alert(1)', '//evil.example', 'http://', 'ftp://host', 'http://a b']) {
      expect(normalizeModulesUrl(bad)).toBeNull()
    }
  })
})

describe('addresses a link may name', () => {
  const trust = (address: string) => isTrustedModulesAddress(address, 'flix.example.com', 'https://jellyfin.example.com')
  it('accepts this site, the Jellyfin server, a path and addresses inside a home network', () => {
    for (const ok of ['/modules', 'https://flix.example.com:8097', 'http://jellyfin.example.com:8097', 'http://192.168.1.10:8097', 'http://10.0.0.5:8097', 'http://172.20.1.1:8097', 'http://nas.local:8097', 'http://localhost:8097']) {
      expect(trust(ok), ok).toBe(true)
    }
  })
  it('refuses a stranger: the app would send the session token there', () => {
    for (const bad of ['https://evil.example', 'http://172.32.0.1:8097', 'http://192.169.1.1', 'http://8.8.8.8:8097', 'https://flix.example.com.evil.example', 'http://localhost.evil.example']) {
      expect(trust(bad), bad).toBe(false)
    }
  })
})

describe('finding out whether a modules container is there', () => {
  it('does not ask anything when there is no address', async () => {
    const fetchSpy = vi.fn<FetchLike>()
    expect(await probeModules(null, 'tok', fetchSpy)).toEqual({ status: 'absent' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is ready when the container answers its manifest, and signs the request with the session token', async () => {
    const fetchSpy = vi.fn<FetchLike>(answer(manifest()))
    const gate = await probeModules('http://modules:8097', 'secret-token', fetchSpy, () => 995_000)
    expect(gate.status).toBe('ready')
    if (gate.status === 'ready') expect(gate.skew).toBe(5)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://modules:8097/v1/manifest')
    expect((init.headers as Record<string, string>).authorization).toBe('MediaBrowser Token="secret-token"')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('treats anything that goes wrong as "absent", without an error', async () => {
    expect(await probeModules('http://x', 't', async () => Promise.reject(new TypeError('network')))).toEqual({ status: 'absent' })
    expect(await probeModules('http://x', 't', answer({ error: 'no' }, 401))).toEqual({ status: 'absent' })
    expect(await probeModules('http://x', 't', answer({ error: 'boom' }, 500))).toEqual({ status: 'absent' })
    expect(await probeModules('http://x', 't', answer('<html>not it</html>'))).toEqual({ status: 'absent' })
    expect(await probeModules('http://x', 't', answer({ hello: 'world' }))).toEqual({ status: 'absent' })
  })

  it('says when the container speaks another version of the API', async () => {
    const gate = await probeModules('http://x', 't', answer(manifest({ api: 99, version: '9.0.0' })))
    expect(gate).toEqual({ status: 'incompatible', api: 99, version: '9.0.0' })
  })
})

describe('the client', () => {
  it('turns an error answer into a message from the container', async () => {
    const client = createModulesClient('http://x', 't', answer({ error: 'Channel 7 already exists.' }, 409))
    await expect(client.post('/v1/channels', {})).rejects.toMatchObject({ status: 409, message: 'Channel 7 already exists.' })
  })

  it('reports an unreachable container with status 0', async () => {
    const client = createModulesClient('http://x', 't', async () => Promise.reject(new TypeError('down')))
    await expect(client.get('/v1/channels')).rejects.toMatchObject({ status: 0 })
  })
})

describe('where a viewer is on a channel', () => {
  const list = [program(0, 100), program(100, 250), program(250, 300)]

  it('finds the program that is on and how far into it', () => {
    expect(locate(list, 0)).toEqual({ index: 0, offset: 0 })
    expect(locate(list, 99.5)).toEqual({ index: 0, offset: 99.5 })
    expect(locate(list, 100)).toEqual({ index: 1, offset: 0 })
    expect(locate(list, 260)).toEqual({ index: 2, offset: 10 })
    expect(locate(list, 300)).toBeNull()
    expect(locate(list, -1)).toBeNull()
  })

  it('knows how far behind or ahead of live the viewer is, and what counts as live', () => {
    expect(behindLive(100, 160)).toBe(60)
    expect(behindLive(200, 160)).toBe(-40)
    expect(isLive(5)).toBe(true)
    expect(isLive(-19)).toBe(true)
    expect(isLive(21)).toBe(false)
    expect(describeSpan(30)).toBe('1 min')
    expect(describeSpan(14 * 60)).toBe('14 min')
    expect(describeSpan(-65 * 60)).toBe('1 h 05 min')
    expect(describeSpan(2 * 3600)).toBe('2 h')
  })

  it('joins two lists of programs with each moment once and in order', () => {
    const merged = mergePrograms([program(100, 250), program(0, 100)], [program(100, 250), program(250, 300)])
    expect(merged.map((p) => p.start)).toEqual([0, 100, 250])
  })
})

describe('the link of an invitation', () => {
  const here = { origin: 'https://jellyflix.example', pathname: '/' }

  it('opens this app and joins the room, and carries the address of the container when the other phone may not know it', () => {
    expect(joinLink(here, '/modules', 'ABCDE')).toBe('https://jellyflix.example/#/modules/match?join=ABCDE')
    expect(joinLink(here, 'http://192.168.1.5:8097', 'ABCDE')).toBe('https://jellyflix.example/?modules=http%3A%2F%2F192.168.1.5%3A8097#/modules/match?join=ABCDE')
  })
})

describe('what a Match room is waiting for', () => {
  const room = (over: Partial<MatchRoomView>): MatchRoomView => ({
    id: 'r',
    code: 'ABCDE',
    mode: 'phones',
    hostId: 'h',
    hostName: 'Host',
    filters: {},
    version: 1,
    phase: 'swipe',
    round: 1,
    me: 'a',
    members: [
      { id: 'a', name: 'A', done: false },
      { id: 'b', name: 'B', done: false },
    ],
    deck: [],
    myVotes: {},
    remaining: [],
    lastLiked: [],
    ...over,
  })

  it('is waiting for me while I still have cards', () => {
    expect(whatIsWaiting(room({ remaining: [{ id: 'c', name: 'C', kind: 'Movie', genres: [] }] }))).toBe('you')
  })

  it('is waiting for the others to finish when I am done', () => {
    expect(
      whatIsWaiting(
        room({
          members: [
            { id: 'a', name: 'A', done: true },
            { id: 'b', name: 'B', done: false },
          ],
        }),
      ),
    ).toBe('others-to-finish')
    expect(whatIsWaiting(room({ members: [{ id: 'a', name: 'A', done: true }] }))).toBe('none')
  })

  it('waits for nothing when it is over', () => {
    expect(whatIsWaiting(room({ phase: 'done' }))).toBe('none')
    expect(whatIsWaiting(room({ phase: 'lobby' }))).toBe('none')
  })
})
