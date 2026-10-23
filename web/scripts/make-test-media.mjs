// Generates small synthetic test media for the mock Jellyfin server (test-media/, git-ignored).
// Requires ffmpeg on PATH. Nothing here touches a real Jellyfin server or real media.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const out = resolve(import.meta.dirname, '..', 'test-media')
mkdirSync(out, { recursive: true })
const sample = join(out, 'sample.mp4')

const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })

// 30 s, 320x180 H.264 + two AAC audio tracks (440 Hz default, 880 Hz alternate).
ff(
  '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=30',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
  '-f', 'lavfi', '-i', 'sine=frequency=880:duration=30',
  '-map', '0:v', '-map', '1:a', '-map', '2:a',
  '-c:v', 'libx264', '-preset', 'veryfast', '-g', '15', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart',
  sample,
)

// HLS renditions the mock serves as "transcodes": one per audio track.
for (const [dir, track] of [['hls', '0'], ['hls-a2', '1']]) {
  const d = join(out, dir)
  rmSync(d, { recursive: true, force: true })
  mkdirSync(d, { recursive: true })
  ff(
    '-i', sample, '-map', '0:v', '-map', `0:a:${track}`, '-c', 'copy',
    '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
    '-hls_segment_filename', join(d, 'seg%03d.ts'), join(d, 'master.m3u8'),
  )
}
// Music: a 30 s MP3 (direct play) and the same as HLS/AAC (what the mock offers as a "transcode").
const song = join(out, 'sample.mp3')
ff('-f', 'lavfi', '-i', 'sine=frequency=523:duration=30', '-c:a', 'libmp3lame', '-b:a', '64k', song)
const musicHls = join(out, 'hls-music')
rmSync(musicHls, { recursive: true, force: true })
mkdirSync(musicHls, { recursive: true })
ff(
  '-i', song, '-c:a', 'aac', '-b:a', '64k',
  '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
  '-hls_segment_filename', join(musicHls, 'seg%03d.ts'), join(musicHls, 'master.m3u8'),
)
console.log('Test media written to', out)
