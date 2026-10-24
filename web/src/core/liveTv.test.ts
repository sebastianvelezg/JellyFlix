// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromeLikeCapabilities } from '../../test/fixtures'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import type { Session } from './jellyfin'
import { getChannel, getChannels, getGuide, guideBlocks, guideStart, isOnNow, matchesChannel, neighbourChannel, programProgress, splitChannelName, toChannel, toProgram } from './liveTv'
import { getLibrarySections } from './library'
import { negotiatePlayback } from './playback'

const HOUR = 3_600_000

describe('programmes and the guide, as numbers', () => {
  const program = (startH: number, endH: number) => ({ id: `p${startH}`, channelId: 'c', name: 'N', startMs: startH * HOUR, endMs: endH * HOUR, genres: [] })

  it('reads a programme and refuses one that has no times or ends before it starts', () => {
    expect(toProgram({ Id: 'p', Name: 'News', ChannelId: 'c', StartDate: '2026-10-23T20:00:00Z', EndDate: '2026-10-23T20:30:00Z', EpisodeTitle: 'Today' } as never)).toMatchObject({
      name: 'News',
      episodeTitle: 'Today',
      endMs: Date.parse('2026-10-23T20:30:00Z'),
    })
    expect(toProgram({ Id: 'p', Name: 'News', StartDate: '2026-10-23T20:30:00Z', EndDate: '2026-10-23T20:00:00Z' } as never)).toBeNull()
    expect(toProgram({ Id: 'p', Name: 'News' } as never)).toBeNull()
  })

  it('reads a channel with its number, favorite and current programme', () => {
    const channel = toChannel({
      Id: 'ch',
      Name: 'One',
      ChannelNumber: '4.1',
      ImageTags: { Primary: 't' },
      UserData: { IsFavorite: true },
      CurrentProgram: { Id: 'p', Name: 'News', StartDate: '2026-10-23T20:00:00Z', EndDate: '2026-10-23T20:30:00Z' },
    } as never)
    expect(channel).toMatchObject({ id: 'ch', number: '4.1', imageTag: 't', favorite: true, now: { name: 'News', channelId: 'ch' } })
    expect(toChannel({ Name: 'no id' } as never)).toBeNull()
  })

  it('says how far a programme is and whether it is on', () => {
    const p = program(10, 12)
    expect(programProgress(p, 9 * HOUR)).toBe(0)
    expect(programProgress(p, 11 * HOUR)).toBe(0.5)
    expect(programProgress(p, 13 * HOUR)).toBe(1)
    expect(isOnNow(p, 10 * HOUR)).toBe(true)
    expect(isOnNow(p, 12 * HOUR)).toBe(false)
  })

  it('lays the programmes out over a window, cutting those that stick out and dropping those outside', () => {
    const blocks = guideBlocks([program(7, 9), program(9, 11), program(11, 13), program(13, 14)], 10 * HOUR, 12 * HOUR)
    expect(blocks.map((b) => [b.program.id, b.left, b.width, b.cutBefore, b.cutAfter])).toEqual([
      ['p9', 0, 0.5, true, false],
      ['p11', 0.5, 0.5, false, true],
    ])
  })

  it('starts the guide at the previous half hour', () => {
    expect(guideStart(Date.parse('2026-10-23T20:47:10Z'))).toBe(Date.parse('2026-10-23T20:30:00Z'))
    expect(guideStart(Date.parse('2026-10-23T20:30:00Z'))).toBe(Date.parse('2026-10-23T20:30:00Z'))
  })

  it('goes to the next and the previous channel, round the ends, and nowhere with one channel', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(neighbourChannel(list, 'a', 1)).toBe('b')
    expect(neighbourChannel(list, 'c', 1)).toBe('a')
    expect(neighbourChannel(list, 'a', -1)).toBe('c')
    expect(neighbourChannel([{ id: 'a' }], 'a', 1)).toBeNull()
    expect(neighbourChannel(list, 'zzz', 1)).toBeNull()
  })
})

describe('the names of channels from a playlist', () => {
  it('takes the quality and the notes out of the name and keeps them as tags', () => {
    expect(splitChannelName('A&E Latin America (1080p)')).toEqual({ title: 'A&E Latin America', tags: ['1080p'] })
    expect(splitChannelName('Alerta Bogota (720p) [Geo-blocked]')).toEqual({ title: 'Alerta Bogota', tags: ['720p', 'Geo-blocked'] })
    expect(splitChannelName('BUM Television (720p) [Not 24/7]')).toEqual({ title: 'BUM Television', tags: ['720p', 'Not 24/7'] })
    expect(splitChannelName('Canal 1 (Colombia) (1080p)')).toEqual({ title: 'Canal 1 (Colombia)', tags: ['1080p'] })
  })

  it('leaves a name that has nothing to take out, and a name that would be left empty', () => {
    expect(splitChannelName('Canal 9 Cosmos')).toEqual({ title: 'Canal 9 Cosmos', tags: [] })
    expect(splitChannelName('Canal (Colombia)')).toEqual({ title: 'Canal (Colombia)', tags: [] })
    expect(splitChannelName('(1080p)')).toEqual({ title: '(1080p)', tags: [] })
    expect(splitChannelName('  Tele 5 [HD]  ')).toEqual({ title: 'Tele 5', tags: ['HD'] })
  })

  it('finds a channel by a part of its name or of its number, in any case', () => {
    expect(matchesChannel({ name: 'Canal CNC Medellin (1080p)', number: '12' }, 'cnc')).toBe(true)
    expect(matchesChannel({ name: 'Canal CNC', number: '12' }, '12')).toBe(true)
    expect(matchesChannel({ name: 'Canal CNC' }, 'bum')).toBe(false)
    expect(matchesChannel({ name: 'Canal CNC' }, '  ')).toBe(true)
  })
})

describe('live TV against a mock Jellyfin server', () => {
  let mock: MockServer
  let session: Session
  beforeAll(async () => {
    mock = await startMockJellyfin({ movieCount: 2, liveTv: 5 })
    session = await connect(mock.url, 'tester', 'secret')
  })
  afterAll(() => mock.close())

  it('puts the live TV view in its own section', async () => {
    expect((await getLibrarySections(session)).livetv).toEqual([{ id: 'lib-livetv', name: 'Live TV' }])
  })

  it('lists the channels a page at a time, each with what is on now, and only the favorites when asked', async () => {
    const page = await getChannels(session, { limit: 2 })
    expect(page.total).toBe(5)
    expect(page.channels.map((c) => c.id)).toEqual(['ch0001', 'ch0002'])
    expect(page.channels[0]?.now && isOnNow(page.channels[0].now, Date.now())).toBe(true)
    mock.user.favorites.add('ch0004')
    expect((await getChannels(session, { favorites: true })).channels.map((c) => [c.id, c.favorite])).toEqual([['ch0004', true]])
    expect((await getChannel(session, 'ch0003')).name).toBe('Test Channel 03')
  })

  it('reads the guide of some channels for a window, in time order, and nothing for no channels', async () => {
    const from = guideStart(Date.now())
    const guide = await getGuide(session, ['ch0001', 'ch0002'], from, from + 2 * HOUR)
    for (const programs of guide.values()) {
      expect(programs.length).toBeGreaterThanOrEqual(4)
      expect(programs.every((p, i) => i === 0 || (programs[i - 1] as typeof p).startMs <= p.startMs)).toBe(true)
      expect(programs.some((p) => isOnNow(p, Date.now()))).toBe(true)
    }
    expect((await getGuide(session, [], from, from + HOUR)).size).toBe(0)
  })

  it('asks the server to open the stream, and gets an HLS plan that knows its live stream and cannot be played as a file', async () => {
    const plan = await negotiatePlayback(session, 'ch0001', { live: true, capabilities: chromeLikeCapabilities })
    expect(plan).toMatchObject({ itemId: 'ch0001', protocol: 'hls', liveStreamId: 'live-ch0001' })
    const ask = [...mock.requests].reverse().find((r) => r.path === '/Items/ch0001/PlaybackInfo')
    expect(ask?.body).toMatchObject({ AutoOpenLiveStream: true, EnableDirectPlay: false, EnableDirectStream: false })
    // A film is not a live stream.
    const film = await negotiatePlayback(session, 'm0001', { capabilities: chromeLikeCapabilities })
    expect(film.liveStreamId).toBeUndefined()
  })
})
