import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Generates the synthetic test media once (needs ffmpeg on PATH). */
export default function globalSetup() {
  const root = resolve(import.meta.dirname, '..')
  if (existsSync(resolve(root, 'test-media', 'hls-a2', 'master.m3u8')) && existsSync(resolve(root, 'test-media', 'hls-music', 'master.m3u8'))) return
  execFileSync(process.execPath, [resolve(root, 'scripts', 'make-test-media.mjs')], { stdio: 'inherit' })
}
