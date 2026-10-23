// @vitest-environment node
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info'
import type { PlaybackInfoResponse } from '@jellyfin/sdk/lib/generated-client/models/playback-info-response'
import { describe, expect, it } from 'vitest'
import { buildPlan, describePlayback, transcodeReasonText, PlaybackError, resolveServerPath, stripCredentials, withApiKey } from './playback'

const SERVER = 'http://jellyfin.local:8096'

const streams: MediaSourceInfo['MediaStreams'] = [
  { Index: 0, Type: 'Video', Codec: 'h264' },
  { Index: 1, Type: 'Audio', Codec: 'aac', Language: 'eng', DisplayTitle: 'English', IsDefault: true },
  { Index: 2, Type: 'Audio', Codec: 'ac3', Language: 'spa', DisplayTitle: 'Spanish' },
  { Index: 3, Type: 'Subtitle', Codec: 'subrip', Language: 'eng', IsTextSubtitleStream: true, DisplayTitle: 'English' },
  { Index: 4, Type: 'Subtitle', Codec: 'hdmv_pgs_subtitle', Language: 'eng', IsTextSubtitleStream: false },
]

function response(source: Partial<MediaSourceInfo>, extra: Partial<PlaybackInfoResponse> = {}): PlaybackInfoResponse {
  return {
    PlaySessionId: 'ps1',
    MediaSources: [
      { Id: 'ms1', ETag: 'etag', RunTimeTicks: 600_000_000, MediaStreams: streams, DefaultAudioStreamIndex: 1, ...source },
    ],
    ...extra,
  }
}

const base = { serverUrl: SERVER, itemId: 'item1', deviceId: 'dev1' }

describe('buildPlan', () => {
  it('chooses direct play when the server says so, without credentials in the URL', () => {
    const plan = buildPlan({ ...base, response: response({ SupportsDirectPlay: true }) })
    expect(plan.playMethod).toBe('DirectPlay')
    expect(plan.protocol).toBe('direct')
    const url = new URL(plan.url)
    expect(url.pathname).toBe('/Videos/item1/stream')
    expect(url.searchParams.get('Static')).toBe('true')
    expect(url.searchParams.get('MediaSourceId')).toBe('ms1')
    expect(url.searchParams.get('PlaySessionId')).toBe('ps1')
    expect(url.searchParams.get('Tag')).toBe('etag')
    expect(url.searchParams.has('ApiKey')).toBe(false)
    expect(plan.audioIndex).toBe(1)
  })

  it('uses the HLS transcoding URL otherwise and strips any token the server embedded', () => {
    const plan = buildPlan({
      ...base,
      response: response({
        SupportsDirectPlay: false,
        TranscodingUrl: '/videos/item1/master.m3u8?MediaSourceId=ms1&AudioStreamIndex=2&ApiKey=secret&api_key=secret2',
        TranscodingSubProtocol: 'hls',
      }),
    })
    expect(plan.playMethod).toBe('Transcode')
    expect(plan.protocol).toBe('hls')
    expect(plan.url).toBe(`${SERVER}/videos/item1/master.m3u8?MediaSourceId=ms1&AudioStreamIndex=2`)
    expect(plan.url).not.toContain('secret')
    expect(plan.audioIndex).toBe(2)
  })

  it('treats a non-HLS transcode as progressive', () => {
    const plan = buildPlan({
      ...base,
      response: response({
        SupportsDirectPlay: false,
        TranscodingUrl: '/videos/item1/stream.mp4?x=1',
        TranscodingSubProtocol: 'http',
      }),
    })
    expect(plan.protocol).toBe('progressive')
  })

  it('lists audio tracks and only text subtitles', () => {
    const plan = buildPlan({ ...base, response: response({ SupportsDirectPlay: true }) })
    expect(plan.audioTracks.map((t) => t.index)).toEqual([1, 2])
    expect(plan.subtitleTracks.map((t) => t.index)).toEqual([3])
    expect(plan.defaultAudioIndex).toBe(1)
  })

  it('prefers direct play over an offered transcode', () => {
    const plan = buildPlan({
      ...base,
      response: response({ SupportsDirectPlay: true, TranscodingUrl: '/videos/item1/master.m3u8' }),
    })
    expect(plan.playMethod).toBe('DirectPlay')
  })

  it.each([
    ['NoCompatibleStream', /no compatible stream/i],
    ['NotAllowed', /not allowed/i],
    ['RateLimitExceeded', /limiting/i],
  ] as const)('reports server error %s', (code, message) => {
    expect(() => buildPlan({ ...base, response: { ErrorCode: code } })).toThrow(PlaybackError)
    expect(() => buildPlan({ ...base, response: { ErrorCode: code } })).toThrow(message)
  })

  it('fails clearly when nothing is playable', () => {
    expect(() => buildPlan({ ...base, response: response({ SupportsDirectPlay: false }) })).toThrow(/compatible stream/i)
    expect(() => buildPlan({ ...base, response: { PlaySessionId: 'x', MediaSources: [] } })).toThrow(/no playable media/i)
    expect(() => buildPlan({ ...base, response: { MediaSources: [{ Id: 'a', SupportsDirectPlay: true }] } })).toThrow(
      /session id/i,
    )
  })
})

describe('URL helpers', () => {
  it('withApiKey replaces existing credentials and uses the ApiKey spelling', () => {
    expect(withApiKey('http://h/v?api_key=old&a=1', 'tok')).toBe('http://h/v?a=1&ApiKey=tok')
    expect(withApiKey('http://h/v?apikey=old', 'tok')).toBe('http://h/v?ApiKey=tok')
  })

  it('stripCredentials removes tokens case-insensitively', () => {
    expect(stripCredentials('http://h/v?APIKEY=1&api_key=2&keep=3')).toBe('http://h/v?keep=3')
  })

  it('resolveServerPath handles root-relative, base-path and absolute URLs', () => {
    expect(resolveServerPath('http://h:8096', '/videos/1/master.m3u8?a=1')).toBe('http://h:8096/videos/1/master.m3u8?a=1')
    expect(resolveServerPath('http://h:8096/jf', '/videos/1/m.m3u8')).toBe('http://h:8096/jf/videos/1/m.m3u8')
    expect(resolveServerPath('http://h:8096/jf', '/jf/videos/1/m.m3u8')).toBe('http://h:8096/jf/videos/1/m.m3u8')
    expect(resolveServerPath('http://h:8096', 'videos/1/m.m3u8')).toBe('http://h:8096/videos/1/m.m3u8')
    expect(resolveServerPath('http://h:8096', 'https://cdn/x.m3u8')).toBe('https://cdn/x.m3u8')
  })
})

describe('describePlayback', () => {
  it('says a file that plays as it is is not converted', () => {
    const plan = buildPlan({ ...base, response: response({ SupportsDirectPlay: true }) })
    expect(plan.transcodeReasons).toEqual([])
    expect(describePlayback(plan)).toEqual({ method: 'direct', reasons: [] })
  })

  it('reads why the server is converting a file from the stream address, once each, in words', () => {
    const plan = buildPlan({
      ...base,
      response: response({
        SupportsDirectPlay: false,
        TranscodingUrl: '/videos/m1/master.m3u8?MediaSourceId=ms&TranscodeReasons=VideoCodecNotSupported,AudioCodecNotSupported,VideoCodecNotSupported,SomethingNew',
      }),
    })
    expect(describePlayback(plan)).toEqual({
      method: 'transcode',
      reasons: ['This browser cannot decode the video', 'This browser cannot decode the audio', 'Something New'],
    })
    expect(transcodeReasonText('ContainerBitrateExceedsLimit')).toBe('The file is above your quality limit')
  })
})
