// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PlaybackPlan } from './playback'
import { buildReportBody } from './reporting'

const plan: PlaybackPlan = {
  itemId: 'item1',
  mediaSourceId: 'ms1',
  playSessionId: 'ps1',
  playMethod: 'DirectPlay',
  protocol: 'direct',
  mediaType: 'video',
  url: 'http://h/x',
  audioTracks: [],
  subtitleTracks: [],
  audioIndex: 1,
  transcodeReasons: [],
}

describe('buildReportBody', () => {
  it('maps player state to Jellyfin fields', () => {
    const body = buildReportBody(plan, { positionSeconds: 12.5, paused: true, muted: false, volume: 0.5 }, { audioIndex: 1 })
    expect(body).toMatchObject({
      ItemId: 'item1',
      MediaSourceId: 'ms1',
      PlaySessionId: 'ps1',
      PlayMethod: 'DirectPlay',
      PositionTicks: 125_000_000,
      IsPaused: true,
      IsMuted: false,
      VolumeLevel: 50,
      CanSeek: true,
      AudioStreamIndex: 1,
      SubtitleStreamIndex: -1,
    })
  })

  it('reports the selected subtitle', () => {
    const body = buildReportBody(plan, { positionSeconds: 0, paused: false, muted: true, volume: 1 }, { subtitleIndex: 3 })
    expect(body.SubtitleStreamIndex).toBe(3)
    expect(body.IsMuted).toBe(true)
  })
})
