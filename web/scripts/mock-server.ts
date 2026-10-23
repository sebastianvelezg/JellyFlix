// Starts the fake Jellyfin server for manual demos:  npm run mock
// Log in with username "tester" and password "secret". Needs test media (npm run media).
import { startMockJellyfin } from '../test/mock/mockJellyfin.ts'
import { resolve } from 'node:path'

const playMode = process.argv.includes('--hls') ? 'hls' : 'direct'
// A server with everything in it, so every page of the app has something to show.
const mock = await startMockJellyfin({
  mediaDir: resolve(import.meta.dirname, '..', 'test-media'),
  playMode,
  movieCount: 60,
  seriesCount: 6,
  animeCount: 4,
  musicArtists: 5,
  collections: 6,
  segments: true,
})
console.log(`Mock Jellyfin (${playMode}) listening on ${mock.url}  user=tester password=secret`)
