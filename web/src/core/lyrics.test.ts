// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import { currentLyricIndex, findTimedLyrics, getLyrics, parseLyrics } from './lyrics'
import type { Session } from './jellyfin'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin()
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

describe('lyrics', () => {
  it('reads timed lyrics and finds the line being sung', async () => {
    const lyrics = await getLyrics(session, 'track-1')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.lines.map((l) => l.start)).toEqual([0, 10, 20])
    if (!lyrics) throw new Error('no lyrics')
    expect(currentLyricIndex(lyrics, 0)).toBe(0)
    expect(currentLyricIndex(lyrics, 9.9)).toBe(0)
    expect(currentLyricIndex(lyrics, 10)).toBe(1)
    expect(currentLyricIndex(lyrics, 500)).toBe(2)
  })

  it('reads lyrics without times as plain text (nothing to follow)', async () => {
    const lyrics = await getLyrics(session, 'track-2')
    expect(lyrics?.synced).toBe(false)
    expect(lyrics?.lines.map((l) => l.text)).toEqual(['Plain one', 'Plain two'])
    if (!lyrics) throw new Error('no lyrics')
    expect(currentLyricIndex(lyrics, 15)).toBe(-1)
  })

  it('answers null for a song with no lyrics (the server says 404)', async () => {
    expect(await getLyrics(session, 'track-3')).toBeNull()
  })

  it('finds timed lyrics through the server plugin, and the server then serves them', async () => {
    const found = await findTimedLyrics(session, 'track-2')
    expect(found?.synced).toBe(true)
    expect((await getLyrics(session, 'track-2'))?.synced).toBe(true)
  })

  it('answers null when no source has timed lyrics', async () => {
    expect(await findTimedLyrics(session, 'track-4')).toBeNull()
    expect((await getLyrics(session, 'track-4'))?.synced).toBe(false)
  })
})

describe('parseLyrics', () => {
  const T = 10_000_000
  it('lets a line without a time take the one before it, so a stray header does not make timed lyrics plain', () => {
    const l = parseLyrics({ Lyrics: [{ Text: 'Header' }, { Start: 5 * T, Text: 'a' }, { Text: 'gap' }, { Start: 9 * T, Text: 'b' }] })
    expect(l?.synced).toBe(true)
    expect(l?.lines.map((x) => x.start)).toEqual([0, 5, 5, 9])
  })
  it('moves every line by the offset of the lyrics file', () => {
    const l = parseLyrics({ Metadata: { Offset: -2 * T }, Lyrics: [{ Start: 5 * T, Text: 'a' }, { Start: 9 * T, Text: 'b' }] })
    expect(l?.lines.map((x) => x.start)).toEqual([3, 7])
  })
  it('keeps lyrics where most lines have no time as plain', () => {
    const l = parseLyrics({ Lyrics: [{ Start: T, Text: 'a' }, { Text: 'b' }, { Text: 'c' }] })
    expect(l?.synced).toBe(false)
    expect(l?.lines.every((x) => x.start === null)).toBe(true)
  })
})
