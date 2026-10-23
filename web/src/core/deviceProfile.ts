import type { CodecProfile } from '@jellyfin/sdk/lib/generated-client/models/codec-profile'
import { CodecType } from '@jellyfin/sdk/lib/generated-client/models/codec-type'
import type { DeviceProfile } from '@jellyfin/sdk/lib/generated-client/models/device-profile'
import type { DirectPlayProfile } from '@jellyfin/sdk/lib/generated-client/models/direct-play-profile'
import { DlnaProfileType } from '@jellyfin/sdk/lib/generated-client/models/dlna-profile-type'
import { EncodingContext } from '@jellyfin/sdk/lib/generated-client/models/encoding-context'
import { MediaStreamProtocol } from '@jellyfin/sdk/lib/generated-client/models/media-stream-protocol'
import { ProfileConditionType } from '@jellyfin/sdk/lib/generated-client/models/profile-condition-type'
import { ProfileConditionValue } from '@jellyfin/sdk/lib/generated-client/models/profile-condition-value'
import { SubtitleDeliveryMethod } from '@jellyfin/sdk/lib/generated-client/models/subtitle-delivery-method'
import type { TranscodingProfile } from '@jellyfin/sdk/lib/generated-client/models/transcoding-profile'

/**
 * What the playback device can decode. The web layer fills this from `canPlayType`/MSE; a TV
 * app would fill it from its native player (e.g. ExoPlayer codec list).
 */
export interface DeviceCapabilities {
  containers: { mp4: boolean; webm: boolean; mkv: boolean }
  /** `hevcMain10`: 10-bit HEVC specifically (many devices decode 8-bit HEVC only). */
  video: { h264: boolean; hevc: boolean; hevcMain10: boolean; vp8: boolean; vp9: boolean; av1: boolean }
  audio: {
    aac: boolean
    mp3: boolean
    opus: boolean
    flac: boolean
    vorbis: boolean
    ac3: boolean
    eac3: boolean
  }
  /** True when HLS can be played (natively or through a library such as hls.js). */
  hls: boolean
}

const pick = (entries: Array<[boolean, string]>) =>
  entries.filter(([ok]) => ok).map(([, name]) => name)

/**
 * Builds the Jellyfin DeviceProfile sent with PlaybackInfo. The server compares the file's
 * container/codecs with it to decide between direct play and transcoding, so it must
 * only claim what this browser can really decode.
 */
export function buildDeviceProfile(caps: DeviceCapabilities): DeviceProfile {
  const { video: v, audio: a, containers: c } = caps

  const mp4Video = pick([
    [v.h264, 'h264'],
    [v.hevc, 'hevc'],
    [v.vp9, 'vp9'],
    [v.av1, 'av1'],
  ])
  const mp4Audio = pick([
    [a.aac, 'aac'],
    [a.mp3, 'mp3'],
    [a.ac3, 'ac3'],
    [a.eac3, 'eac3'],
    [a.opus, 'opus'],
    [a.flac, 'flac'],
  ])
  const webmVideo = pick([
    [v.vp8, 'vp8'],
    [v.vp9, 'vp9'],
    [v.av1, 'av1'],
  ])
  const webmAudio = pick([
    [a.vorbis, 'vorbis'],
    [a.opus, 'opus'],
  ])

  const directPlay: DirectPlayProfile[] = []
  if (c.mp4 && mp4Video.length && mp4Audio.length) {
    directPlay.push({
      Type: DlnaProfileType.Video,
      Container: 'mp4,m4v,mov',
      VideoCodec: mp4Video.join(','),
      AudioCodec: mp4Audio.join(','),
    })
  }
  if (c.webm && webmVideo.length && webmAudio.length) {
    directPlay.push({
      Type: DlnaProfileType.Video,
      Container: 'webm',
      VideoCodec: webmVideo.join(','),
      AudioCodec: webmAudio.join(','),
    })
  }
  if (c.mkv) {
    const video = [...new Set([...mp4Video, ...webmVideo])]
    const audio = [...new Set([...mp4Audio, ...webmAudio])]
    if (video.length && audio.length) {
      directPlay.push({
        Type: DlnaProfileType.Video,
        Container: 'mkv',
        VideoCodec: video.join(','),
        AudioCodec: audio.join(','),
      })
    }
  }

  // Music: plain audio files, by container. WAV is decoded by every browser.
  const audioDirectPlay: DirectPlayProfile[] = []
  const audioFile = (container: string, codecs: string[]) =>
    audioDirectPlay.push({ Type: DlnaProfileType.Audio, Container: container, AudioCodec: codecs.join(',') })
  if (a.mp3) audioFile('mp3', ['mp3'])
  if (a.aac) audioFile('aac,m4a,m4b', ['aac'])
  if (a.flac) audioFile('flac', ['flac'])
  const oggCodecs = pick([
    [a.vorbis, 'vorbis'],
    [a.opus, 'opus'],
  ])
  if (oggCodecs.length) audioFile('ogg,oga,opus,webm,webma', oggCodecs)
  audioFile('wav', ['pcm_s16le', 'pcm_s24le', 'pcm_u8'])
  directPlay.push(...audioDirectPlay)

  const transcoding: TranscodingProfile[] = []
  // Music the browser cannot play is converted to AAC (in HLS where available, which also allows seeking) or MP3.
  transcoding.push(
    caps.hls
      ? {
          Type: DlnaProfileType.Audio,
          Context: EncodingContext.Streaming,
          Protocol: MediaStreamProtocol.Hls,
          Container: 'ts',
          AudioCodec: 'aac',
          MaxAudioChannels: '2',
          MinSegments: 1,
          BreakOnNonKeyFrames: true,
        }
      : {
          Type: DlnaProfileType.Audio,
          Context: EncodingContext.Streaming,
          Protocol: MediaStreamProtocol.Http,
          Container: 'mp3',
          AudioCodec: 'mp3',
          MaxAudioChannels: '2',
        },
  )
  if (caps.hls) {
    transcoding.push({
      Type: DlnaProfileType.Video,
      Context: EncodingContext.Streaming,
      Protocol: MediaStreamProtocol.Hls,
      Container: 'ts',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      MaxAudioChannels: '2',
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    })
  } else {
    transcoding.push({
      Type: DlnaProfileType.Video,
      Context: EncodingContext.Streaming,
      Protocol: MediaStreamProtocol.Http,
      Container: 'mp4',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      MaxAudioChannels: '2',
    })
  }

  // Browsers decode only 8-bit H.264 up to High profile in practice; anything else
  // (e.g. High 10, interlaced/anamorphic) must be transcoded rather than failing to play.
  const codecProfiles: CodecProfile[] = [
    {
      Type: CodecType.Video,
      Codec: 'h264',
      Conditions: [
        {
          Condition: ProfileConditionType.EqualsAny,
          Property: ProfileConditionValue.VideoProfile,
          Value: 'high|main|baseline|constrained baseline',
          IsRequired: false,
        },
        {
          Condition: ProfileConditionType.LessThanEqual,
          Property: ProfileConditionValue.VideoLevel,
          Value: '52',
          IsRequired: false,
        },
        {
          Condition: ProfileConditionType.NotEquals,
          Property: ProfileConditionValue.IsAnamorphic,
          Value: 'true',
          IsRequired: false,
        },
      ],
    },
  ]

  // HEVC is common in libraries and often 10-bit; without Main10 support those files must be transcoded.
  if (v.hevc && !v.hevcMain10) {
    codecProfiles.push({
      Type: CodecType.Video,
      Codec: 'hevc',
      Conditions: [
        {
          Condition: ProfileConditionType.LessThanEqual,
          Property: ProfileConditionValue.VideoBitDepth,
          Value: '8',
          IsRequired: false,
        },
      ],
    })
  }

  return {
    Name: 'Jellyflix Web',
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 120_000_000,
    DirectPlayProfiles: directPlay,
    TranscodingProfiles: transcoding,
    CodecProfiles: codecProfiles,
    SubtitleProfiles: ['vtt', 'srt', 'subrip', 'ass', 'ssa'].map((Format) => ({
      Format,
      Method: SubtitleDeliveryMethod.External,
    })),
  }
}
