// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as capabilities } from '../../test/fixtures'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import type { Session } from './jellyfin'
import { getMovie, getMovieLibraries, getMoviePage, PAGE_SIZE, posterUrl, toMovie } from './library'
import { negotiatePlayback } from './playback'
import { PlaybackReporter } from './reporting'

describe('toMovie / posterUrl', () => {
  it('maps a DTO and ignores trivial resume positions', () => {
    expect(
      toMovie({ Id: 'a', Name: 'A', ProductionYear: 1999, ImageTags: { Primary: 't' }, RunTimeTicks: 5, UserData: { PlaybackPositionTicks: 600_000_000, Played: false } } as never),
    ).toMatchObject({ id: 'a', name: 'A', year: 1999, imageTag: "t", resumeTicks: 600_000_000 })
    expect(toMovie({ Id: 'a', Name: 'A', UserData: { PlaybackPositionTicks: 20_000_000 } } as never)?.resumeTicks).toBe(0)
    expect(toMovie({ Name: 'no id' } as never)).toBeNull()
  })

  it('builds poster URLs without credentials, or null without an image', () => {
    const url = posterUrl('http://h:8096', { id: 'abc', imageTag: 'tag' })
    expect(url).toBe('http://h:8096/Items/abc/Images/Primary?fillWidth=300&quality=80&tag=tag')
    expect(posterUrl('http://h:8096', { id: 'abc' })).toBeNull()
  })
})

describe('library + playback negotiation against a mock Jellyfin server', () => {
  let mock: MockServer
  let session: Session
  beforeAll(async () => {
    mock = await startMockJellyfin({ movieCount: 130 })
    session = await connect(mock.url, 'tester', 'secret')
  })
  afterAll(() => mock.close())

  it('lists only movie libraries', async () => {
    expect(await getMovieLibraries(session)).toEqual([{ id: 'lib-movies', name: 'Movies' }])
  })

  it('pages through the library instead of fetching everything', async () => {
    const first = await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 0 })
    expect(first.movies).toHaveLength(PAGE_SIZE)
    expect(first.total).toBe(130)
    const last = await getMoviePage(session, { libraryId: 'lib-movies', startIndex: 120 })
    expect(last.movies).toHaveLength(10)
    const request = mock.requests.filter((r) => r.path === '/Items').at(-1)
    expect(request?.query).toMatchObject({ startIndex: '120', limit: String(PAGE_SIZE), includeItemTypes: 'Movie' })
    expect(request?.auth).toBe('header')
  })

  it('fetches a single movie', async () => {
    expect((await getMovie(session, 'm0003')).name).toBe('Test Movie 003')
    await expect(getMovie(session, 'missing')).rejects.toThrow(/no longer available/)
  })

  it('negotiates direct play and forces a transcode when asked', async () => {
    const direct = await negotiatePlayback(session, 'm0001', { capabilities })
    expect(direct).toMatchObject({ playMethod: 'DirectPlay', protocol: 'direct', audioIndex: 1 })
    const info = mock.requests.filter((r) => r.path === '/Items/m0001/PlaybackInfo').at(-1)
    const dto = info?.body as { DeviceProfile?: unknown; SubtitleStreamIndex?: number; StartTimeTicks?: number }
    expect(dto.DeviceProfile).toBeTruthy()
    expect(dto.SubtitleStreamIndex).toBe(-1)
    expect(dto.StartTimeTicks).toBeUndefined()

    const hls = await negotiatePlayback(session, 'm0001', {
      capabilities,
      forceTranscode: true,
      audioStreamIndex: 2,
      mediaSourceId: direct.mediaSourceId,
    })
    expect(hls).toMatchObject({ playMethod: 'Transcode', protocol: 'hls', audioIndex: 2 })
    const hlsInfo = mock.requests.filter((r) => r.path === '/Items/m0001/PlaybackInfo').at(-1)
    expect(hlsInfo?.body).toMatchObject({ AudioStreamIndex: 2, MediaSourceId: direct.mediaSourceId })

    // Regression: a real Jellyfin server ignores the requested audio track unless the media source is named too.
    const ignored = await negotiatePlayback(session, 'm0001', { capabilities, forceTranscode: true, audioStreamIndex: 2 })
    expect(ignored.audioIndex).toBe(1)
    expect(hls.url).not.toContain('ApiKey')
    expect(new URL(hls.url).searchParams.get('AudioStreamIndex')).toBe('2')
  })

  it('reports start, progress and stop; stop becomes the resume position', async () => {
    const plan = await negotiatePlayback(session, 'm0002', { capabilities })
    const reporter = new PlaybackReporter(session, plan)
    const state = { positionSeconds: 5, paused: false, muted: false, volume: 1 }
    await reporter.start(state)
    await reporter.progress({ ...state, positionSeconds: 15 })
    await reporter.stop({ ...state, positionSeconds: 20 })
    await reporter.stop({ ...state, positionSeconds: 25 }) // second stop is ignored

    const paths = mock.requests.filter((r) => r.path.startsWith('/Sessions/Playing')).map((r) => r.path)
    expect(paths.slice(-3)).toEqual(['/Sessions/Playing', '/Sessions/Playing/Progress', '/Sessions/Playing/Stopped'])
    expect(mock.requests.filter((r) => r.path === '/Sessions/Playing/Stopped' && (r.body as { ItemId: string }).ItemId === 'm0002')).toHaveLength(1)
    expect(mock.resume.get('m0002')).toBe(200_000_000)
    expect((await getMovie(session, 'm0002')).resumeTicks).toBe(200_000_000)
  })
})

describe('reporting failures never throw', () => {
  it('swallows server errors', async () => {
    const mock = await startMockJellyfin({ failReporting: true })
    try {
      const session = await connect(mock.url, 'tester', 'secret')
      const plan = await negotiatePlayback(session, 'm0001', { capabilities })
      const reporter = new PlaybackReporter(session, plan)
      const state = { positionSeconds: 1, paused: false, muted: false, volume: 1 }
      await expect(reporter.start(state)).resolves.toBeUndefined()
      await expect(reporter.progress(state)).resolves.toBeUndefined()
      await expect(reporter.stop(state)).resolves.toBeUndefined()
    } finally {
      await mock.close()
    }
  })
})
