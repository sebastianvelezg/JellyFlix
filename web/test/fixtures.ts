import type { DeviceCapabilities } from '../src/core'

/** A desktop-Chrome-like device (H.264/AAC/VP9/Opus, MKV, HLS via MSE; no HEVC/AC3). */
export const chromeLikeCapabilities: DeviceCapabilities = {
  containers: { mp4: true, webm: true, mkv: true },
  video: { h264: true, hevc: false, hevcMain10: false, vp8: true, vp9: true, av1: true },
  audio: { aac: true, mp3: true, opus: true, flac: true, vorbis: true, ac3: false, eac3: false },
  hls: true,
}
