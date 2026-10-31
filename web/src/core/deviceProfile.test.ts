// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildDeviceProfile, withoutAudioCodecs, type DeviceCapabilities } from './deviceProfile'

const chromeLike: DeviceCapabilities = {
  containers: { mp4: true, webm: true, mkv: true },
  video: { h264: true, hevc: false, hevcMain10: false, vp8: true, vp9: true, av1: true },
  audio: { aac: true, mp3: true, opus: true, flac: true, vorbis: true, ac3: false, eac3: false },
  hls: true,
}

describe('buildDeviceProfile', () => {
  it('only claims codecs the browser reports', () => {
    const p = buildDeviceProfile(chromeLike)
    const mp4 = p.DirectPlayProfiles?.find((d) => d.Container?.includes('mp4'))
    expect(mp4?.VideoCodec).toContain('h264')
    expect(mp4?.VideoCodec).not.toContain('hevc')
    expect(mp4?.AudioCodec).not.toContain('ac3')
    expect(p.DirectPlayProfiles?.map((d) => d.Container)).toContain('mkv')
  })

  it('offers an HLS transcode when HLS is playable', () => {
    const p = buildDeviceProfile(chromeLike)
    const video = p.TranscodingProfiles?.filter((t) => t.Type === 'Video')
    expect(video).toHaveLength(1)
    expect(video?.[0]).toMatchObject({ Protocol: 'hls', Container: 'ts', VideoCodec: 'h264' })
  })

  it('falls back to progressive MP4 without HLS support', () => {
    const p = buildDeviceProfile({ ...chromeLike, hls: false })
    expect(p.TranscodingProfiles?.find((t) => t.Type === 'Video')).toMatchObject({ Protocol: 'http', Container: 'mp4' })
  })

  it('omits containers the browser cannot play', () => {
    const p = buildDeviceProfile({ ...chromeLike, containers: { mp4: true, webm: false, mkv: false } })
    expect(p.DirectPlayProfiles?.filter((d) => d.Type === 'Video').map((d) => d.Container)).toEqual(['mp4,m4v,mov'])
  })

  it('limits H.264 direct play to profiles browsers can decode', () => {
    const h264 = buildDeviceProfile(chromeLike).CodecProfiles?.find((c) => c.Codec === 'h264')
    const profile = h264?.Conditions?.find((c) => c.Property === 'VideoProfile')
    expect(profile?.Value).not.toMatch(/high 10/)
  })

  it('sends 10-bit HEVC to the transcoder unless the device decodes Main10', () => {
    const hevcEight = buildDeviceProfile({ ...chromeLike, video: { ...chromeLike.video, hevc: true, hevcMain10: false } })
    const cond = hevcEight.CodecProfiles?.find((c) => c.Codec === 'hevc')?.Conditions?.[0]
    expect(cond).toMatchObject({ Property: 'VideoBitDepth', Condition: 'LessThanEqual', Value: '8' })

    const hevcTen = buildDeviceProfile({ ...chromeLike, video: { ...chromeLike.video, hevc: true, hevcMain10: true } })
    expect(hevcTen.CodecProfiles?.some((c) => c.Codec === 'hevc')).toBe(false)
    expect(hevcTen.DirectPlayProfiles?.[0]?.VideoCodec).toContain('hevc')
  })

  it('plays the audio files the browser decodes, and converts the rest to AAC (HLS) or MP3', () => {
    const p = buildDeviceProfile(chromeLike)
    const music = p.DirectPlayProfiles?.filter((d) => d.Type === 'Audio') ?? []
    expect(music.map((d) => d.Container)).toEqual(['mp3', 'aac,m4a,m4b', 'flac', 'ogg,oga,opus,webm,webma', 'wav'])
    expect(music[0]).toMatchObject({ AudioCodec: 'mp3' })
    expect(p.TranscodingProfiles?.find((t) => t.Type === 'Audio')).toMatchObject({ Protocol: 'hls', Container: 'ts', AudioCodec: 'aac' })

    const limited = buildDeviceProfile({
      ...chromeLike,
      hls: false,
      audio: { ...chromeLike.audio, flac: false, opus: false, vorbis: false, aac: false },
    })
    const containers = limited.DirectPlayProfiles?.filter((d) => d.Type === 'Audio').map((d) => d.Container)
    expect(containers).toEqual(['mp3', 'wav'])
    expect(limited.TranscodingProfiles?.find((t) => t.Type === 'Audio')).toMatchObject({ Protocol: 'http', Container: 'mp3' })
  })

  it('renders subtitles externally (never burned in)', () => {
    const p = buildDeviceProfile(chromeLike)
    expect(p.SubtitleProfiles?.every((s) => s.Method === 'External')).toBe(true)
  })
})

describe('withoutAudioCodecs', () => {
  it('stops claiming the codecs the server should convert', () => {
    const caps = { ...chromeLike, audio: { ...chromeLike.audio, ac3: true, eac3: true } }
    expect(buildDeviceProfile(caps).DirectPlayProfiles?.find((d) => d.Container?.includes('mp4'))?.AudioCodec).toContain('ac3')
    const converted = buildDeviceProfile(withoutAudioCodecs(caps, ['ac3', 'eac3']))
    expect(converted.DirectPlayProfiles?.find((d) => d.Container?.includes('mp4'))?.AudioCodec).not.toMatch(/ac3|eac3/)
  })

  it('leaves everything alone when nothing is chosen', () => {
    expect(withoutAudioCodecs(chromeLike, [])).toBe(chromeLike)
  })
})
