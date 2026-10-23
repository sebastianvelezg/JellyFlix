/**
 * Live smoke test against a REAL Jellyfin server. Skipped unless JELLYFIN_SMOKE_URL is set.
 *
 *   PowerShell:
 *     $env:JELLYFIN_SMOKE_URL="http://jellyfin.local:8096"
 *     $env:JELLYFIN_SMOKE_USER="alice"; $env:JELLYFIN_SMOKE_PASSWORD="..."
 *     npm run smoke
 *
 * It signs in, lists libraries and movies, asks the server how to play the first movie (direct
 * and forced transcode), and downloads the first bytes / first HLS segment using the same
 * authentication rules as the app. It does NOT report playback progress, so your watch history is
 * untouched. It runs in Node, so it cannot judge browser CORS or decode video; use the app for that.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as chromeLike } from '../../test/fixtures'
import {
  connect,
  getContinueWatching,
  getMovie,
  getMovieDetails,
  getMovieGenres,
  getMovieLibraries,
  getMoviePage,
  getRecentlyAdded,
  getSimilarMovies,
  searchMovies,
  logout,
  negotiatePlayback,
  withApiKey,
  type PlaybackPlan,
  type Session,
} from '.'

const url = process.env.JELLYFIN_SMOKE_URL
const user = process.env.JELLYFIN_SMOKE_USER ?? ''
const password = process.env.JELLYFIN_SMOKE_PASSWORD ?? ''

async function probeStream(session: Session, plan: PlaybackPlan): Promise<string> {
  if (plan.protocol === 'hls') {
    const auth = { Authorization: session.api.authorizationHeader }
    const playlist = await fetch(plan.url, { headers: auth })
    expect(playlist.status, 'HLS master playlist').toBe(200)
    const text = await playlist.text()
    expect(text.startsWith('#EXTM3U')).toBe(true)
    // The master may point at a variant playlist; follow one level to reach a segment.
    const first = text.split('\n').find((l) => l && !l.startsWith('#'))
    if (!first) return 'HLS playlist OK (no entries listed)'
    const next = new URL(first, plan.url)
    const second = await fetch(next, { headers: auth })
    expect(second.status, 'HLS playlist/segment').toBe(200)
    return `HLS OK (${next.pathname.split('/').pop()?.split('?')[0]})`
  }
  const response = await fetch(withApiKey(plan.url, session.accessToken), { headers: { Range: 'bytes=0-1023' } })
  expect([200, 206], 'direct stream status').toContain(response.status)
  const bytes = (await response.arrayBuffer()).byteLength
  expect(bytes).toBeGreaterThan(0)
  response.body?.cancel().catch(() => undefined)
  return `direct stream OK (${response.status}, ${response.headers.get('content-type')})`
}

describe.skipIf(!url)('live smoke test (real Jellyfin server)', () => {
  let session: Session

  it('signs in and verifies the token', async () => {
    session = await connect(url as string, user, password)
    console.log(`  server: ${session.serverName} ${session.serverVersion}`)
    expect(session.accessToken).toBeTruthy()
  })

  it('lists movie libraries and a page of movies', async () => {
    const libraries = await getMovieLibraries(session)
    console.log(`  movie libraries: ${libraries.map((l) => l.name).join(', ') || '(none)'}`)
    expect(libraries.length).toBeGreaterThan(0)
    const page = await getMoviePage(session, { libraryId: libraries[0]?.id as string, startIndex: 0 })
    console.log(`  first page: ${page.movies.length} of ${page.total} movies`)
    expect(page.movies.length).toBeGreaterThan(0)
  })

  it('negotiates playback and can fetch media for the first movie', async () => {
    const [library] = await getMovieLibraries(session)
    const page = await getMoviePage(session, { libraryId: library?.id as string, startIndex: 0, limit: 1 })
    const id = process.env.JELLYFIN_SMOKE_MOVIE_ID ?? page.movies[0]?.id
    const movie = await getMovie(session, id as string)

    const natural = await negotiatePlayback(session, movie.id, { capabilities: chromeLike })
    console.log(
      `  "${movie.name}": ${natural.playMethod}/${natural.protocol}, ${natural.audioTracks.length} audio, ` +
        `${natural.subtitleTracks.length} text subtitles → ${await probeStream(session, natural)}`,
    )

    const forced = await negotiatePlayback(session, movie.id, { capabilities: chromeLike, forceTranscode: true })
    console.log(`  forced transcode: ${forced.playMethod}/${forced.protocol} → ${await probeStream(session, forced)}`)
    expect(forced.playMethod).toBe('Transcode')
  }, 60_000)

  it('reads the browse features: genres, sort, search, details, rows (read-only)', async () => {
    const [library] = await getMovieLibraries(session)
    const id = library?.id as string
    const genres = await getMovieGenres(session, id)
    const byYear = await getMoviePage(session, { libraryId: id, startIndex: 0, limit: 5, sort: 'released' })
    const newest = await getRecentlyAdded(session, id, 5)
    const resuming = await getContinueWatching(session, 5)
    console.log(`  genres: ${genres.length}, newest-by-year: ${byYear.movies.map((m) => m.year).join(',')}, recently added: ${newest.length}, continue watching: ${resuming.length}`)
    expect(byYear.movies.length).toBeGreaterThan(0)

    const first = byYear.movies[0]
    const word = first?.name.split(/s+/).find((w) => w.length > 3) ?? first?.name ?? ''
    const found = await searchMovies(session, word)
    console.log(`  search "${word}": ${found.total} result(s)`)
    expect(found.movies.some((m) => m.id === first?.id)).toBe(true)

    const details = await getMovieDetails(session, first?.id as string)
    const similar = await getSimilarMovies(session, details.id, 6)
    console.log(
      `  details "${details.name}": ${details.genres.join('/') || 'no genres'}, ${details.cast.length} cast, ` +
        `${details.media?.resolution ?? '?'} ${details.media?.videoCodec ?? ''}, ${details.media?.audio.length ?? 0} audio, ` +
        `${details.media?.subtitles.length ?? 0} subtitle(s), ${similar.length} similar`,
    )
    expect(details.name).toBe(first?.name)
  })

  it('signs out and the token stops working', async () => {
    await logout(session)
    const check = await fetch(`${session.serverUrl}/Users/Me`, {
      headers: { Authorization: session.api.authorizationHeader },
    })
    expect(check.status).toBe(401)
  })
})
