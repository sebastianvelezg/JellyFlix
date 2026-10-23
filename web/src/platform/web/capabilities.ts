import type { DeviceCapabilities } from '../../core'

/** What this browser can decode, from `canPlayType` and MSE. Web-only (needs a <video> element). */
export function detectCapabilities(
  video: HTMLVideoElement = document.createElement('video'),
): DeviceCapabilities {
  const can = (type: string) => video.canPlayType(type) !== ''
  const mseH264 =
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')
  return {
    containers: {
      mp4: can('video/mp4'),
      webm: can('video/webm'),
      mkv: can('video/x-matroska') || can('video/mkv'),
    },
    video: {
      h264: can('video/mp4; codecs="avc1.640029"'),
      hevc: can('video/mp4; codecs="hvc1.1.4.L123.B0"'),
      hevcMain10: can('video/mp4; codecs="hvc1.2.4.L123.B0"'),
      vp8: can('video/webm; codecs="vp8"'),
      vp9: can('video/webm; codecs="vp9"'),
      av1: can('video/mp4; codecs="av01.0.15M.10"'),
    },
    audio: {
      aac: can('audio/mp4; codecs="mp4a.40.2"'),
      mp3: can('audio/mpeg'),
      opus: can('audio/webm; codecs="opus"'),
      flac: can('audio/flac'),
      vorbis: can('audio/webm; codecs="vorbis"'),
      ac3: can('audio/mp4; codecs="ac-3"'),
      eac3: can('audio/mp4; codecs="ec-3"'),
    },
    hls: mseH264 || can('application/vnd.apple.mpegurl'),
  }
}
