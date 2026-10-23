// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as capabilities } from '../../test/fixtures'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import type { Session } from './jellyfin'
import { negotiatePlayback, type PlaybackPlan } from './playback'
import { PlaybackSession } from './playbackSession'
import { audioChangeRequest, retryRequest, transcodeFallbackRequest } from './streamRequest'

const device = { paused: false, muted: false, volume: 1 }

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin()
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

const playingReports = (itemId: string) =>
  mock.requests
    .filter((r) => r.path.startsWith('/Sessions/Playing') && (r.body as { ItemId?: string })?.ItemId === itemId)
    .map((r) => ({ path: r.path, ticks: (r.body as { PositionTicks: number }).PositionTicks }))

describe('PlaybackSession', () => {
  it('sends start once, progress on changes and ticks, and stop at the last trusted position', async () => {
    const plan = await negotiatePlayback(session, 'm0001', { capabilities })
    const s = new PlaybackSession(session, plan, 100)

    s.moved(0) // loading noise before playback begins must be ignored
    expect(s.position).toBe(100)

    s.playing(100, device)
    s.playing(101, device) // a second "playing" (after buffering) must not send another start
    await expect.poll(() => playingReports('m0001').length).toBe(1)
    s.tick(device)
    s.tick({ ...device, paused: true }) // paused: no report
    // Overlapping progress reports are skipped, so wait for the tick's report to land first.
    await expect.poll(() => playingReports('m0001').length).toBe(2)
    s.stateChanged(150, { ...device, paused: true })
    await expect.poll(() => playingReports('m0001').length).toBe(3)
    s.moved(160)
    await s.stop({ ...device, paused: true })
    await s.stop(device) // second stop ignored

    await expect.poll(() => playingReports('m0001').length).toBe(4)
    const reports = playingReports('m0001')
    expect(reports.filter((r) => r.path === '/Sessions/Playing')).toHaveLength(1)
    expect(reports.map((r) => r.path)).toEqual([
      '/Sessions/Playing',
      '/Sessions/Playing/Progress',
      '/Sessions/Playing/Progress',
      '/Sessions/Playing/Stopped',
    ])
    expect(reports.at(-1)?.ticks).toBe(160 * 10_000_000)
    expect(mock.resume.get('m0001')).toBe(160 * 10_000_000)
  })

  it('never reports stopped (and so never overwrites the resume point) if playback did not start', async () => {
    mock.resume.set('m0002', 123 * 10_000_000)
    const plan = await negotiatePlayback(session, 'm0002', { capabilities })
    const s = new PlaybackSession(session, plan, 123)
    s.moved(0)
    await s.stop(device)
    expect(s.stopRequestOnUnload(device)).toBeNull()
    expect(playingReports('m0002')).toEqual([])
    expect(mock.resume.get('m0002')).toBe(123 * 10_000_000)
  })

  it('reports the full duration when the movie ends', async () => {
    const plan = await negotiatePlayback(session, 'm0003', { capabilities })
    const s = new PlaybackSession(session, plan, 0)
    s.playing(0, device)
    await s.ended(30, { ...device, paused: true })
    expect(playingReports('m0003').at(-1)).toEqual({ path: '/Sessions/Playing/Stopped', ticks: 300_000_000 })
  })

  it('hands back a keepalive-ready stop request for page unload, once', async () => {
    const plan = await negotiatePlayback(session, 'm0004', { capabilities })
    const s = new PlaybackSession(session, plan, 0)
    s.playing(5, device)
    const request = s.stopRequestOnUnload(device)
    expect(request?.url).toBe(`${session.serverUrl}/Sessions/Playing/Stopped`)
    expect(request?.headers.Authorization).toContain('Token=')
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({ ItemId: 'm0004', PositionTicks: 50_000_000 })
    expect(s.stopRequestOnUnload(device)).toBeNull()
    await s.stop(device) // already stopped
    expect(playingReports('m0004').filter((r) => r.path.endsWith('/Stopped'))).toHaveLength(0)
  })
})

describe('stream requests', () => {
  const plan: PlaybackPlan = {
    itemId: 'i',
    mediaSourceId: 'm',
    playSessionId: 'p',
    playMethod: 'DirectPlay',
    protocol: 'direct',
    mediaType: 'video',
    url: 'http://h/x',
    audioTracks: [],
    transcodeReasons: [],
    subtitleTracks: [],
    audioIndex: 1,
    defaultAudioIndex: 1,
  }

  it('forces a transcode only for non-default audio (or after a fallback)', () => {
    expect(audioChangeRequest(plan, 2, { fallback: false, startSeconds: 7 })).toEqual({
      audioIndex: 2,
      mediaSourceId: 'm',
      forceTranscode: true,
      fallback: false,
      startSeconds: 7,
    })
    expect(audioChangeRequest(plan, 1, { fallback: false, startSeconds: 7 }).forceTranscode).toBe(false)
    expect(audioChangeRequest(plan, 1, { fallback: true, startSeconds: 7 }).forceTranscode).toBe(true)
  })

  it('offers a transcode fallback once, and only from direct play', () => {
    expect(transcodeFallbackRequest(plan, { fallback: false, startSeconds: 9 })).toEqual({
      audioIndex: 1,
      mediaSourceId: 'm',
      forceTranscode: true,
      fallback: true,
      startSeconds: 9,
    })
    expect(transcodeFallbackRequest(plan, { fallback: true, startSeconds: 9 })).toBeNull()
    expect(transcodeFallbackRequest({ ...plan, playMethod: 'Transcode' }, { fallback: false, startSeconds: 9 })).toBeNull()
  })

  it('retries with the same audio track', () => {
    expect(retryRequest({ ...plan, audioIndex: 2 }, { fallback: false, startSeconds: 3 })).toEqual({
      audioIndex: 2,
      mediaSourceId: 'm',
      forceTranscode: true,
      fallback: false,
      startSeconds: 3,
    })
    expect(retryRequest(plan, { fallback: false, startSeconds: 3 }).forceTranscode).toBe(false)
  })
})
