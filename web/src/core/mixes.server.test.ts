// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import type { Session } from './jellyfin'
import {
  blendMix,
  buildMixOfTheDay,
  dayKey,
  DAY_MIX_SIZE,
  favouriteArtists,
  getAlbumRadio,
  getArtistRadio,
  getSongRadio,
  getTracksByIds,
  seededShuffle,
} from './mixes'
import type { Track } from './music'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 2, musicArtists: 4 })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

const track = (id: string, artistId?: string): Track => ({ id, name: id, artist: artistId ?? '', artistId, album: '', favorite: false, playCount: 0 })

describe('radio', () => {
  it('asks the server for an instant mix of an artist, an album and a song', async () => {
    const artist = await getArtistRadio(session, 'ar0002', 10)
    expect(artist).toHaveLength(10)
    expect(artist[0]?.artistId).toBe('ar0002') // the artist's own songs come first
    expect((await getAlbumRadio(session, 'al0001-1', 5)).length).toBe(5)
    const song = await getSongRadio(session, 'tr0001-1-1', 5)
    expect(song.map((t) => t.id)).not.toContain('tr0001-1-1')
    expect(mock.adminLog).toEqual(expect.arrayContaining(['mix Artists ar0002', 'mix Albums al0001-1', 'mix Songs tr0001-1-1']))
  })

  it('reads songs by id, in the order asked, leaving out ones that are gone', async () => {
    const found = await getTracksByIds(session, ['tr0002-1-3', 'tr0001-1-1', 'tr9999-9-9'])
    expect(found.map((t) => t.id)).toEqual(['tr0002-1-3', 'tr0001-1-1'])
    expect(await getTracksByIds(session, [])).toEqual([])
  })
})

describe('the mix of the day', () => {
  it('is made of favourites and radios, without repeats, and is the same size every day', async () => {
    const mix = await buildMixOfTheDay(session, undefined, '2026-10-26:me')
    expect(mix.length).toBeGreaterThan(10)
    expect(mix.length).toBeLessThanOrEqual(DAY_MIX_SIZE)
    expect(new Set(mix.map((t) => t.id)).size).toBe(mix.length)
  })

  it('leans on the artists you favour and play', async () => {
    // Favouriting songs of artist 3 makes its radio part of the mix.
    mock.user.favorites.add('tr0003-1-1')
    mock.user.favorites.add('tr0003-2-2')
    const before = mock.adminLog.length
    await buildMixOfTheDay(session, undefined, '2026-10-27:me')
    expect(mock.adminLog.slice(before)).toContain('mix Artists ar0003')
  })
})

describe('mix helpers', () => {
  it('names the day in the viewer calendar', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(dayKey(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })

  it('shuffles the same way for the same seed, and differently for another', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    expect(seededShuffle(items, 'a')).toEqual(seededShuffle(items, 'a'))
    expect(seededShuffle(items, 'a')).not.toEqual(seededShuffle(items, 'b'))
    expect([...seededShuffle(items, 'a')].sort((x, y) => x - y)).toEqual(items)
    expect(items[0]).toBe(0) // the original is untouched
  })

  it('ranks artists by favourites and, double, recent plays', () => {
    const favs = [track('1', 'a'), track('2', 'a'), track('3', 'b')]
    const recent = [track('4', 'b'), track('5', 'c')]
    // a: 2, b: 1 + 2 = 3, c: 2 (a and c tie, broken by the seed)
    const top = favouriteArtists(favs, recent, 3, 'seed')
    expect(top[0]).toBe('b')
    expect(new Set(top)).toEqual(new Set(['a', 'b', 'c']))
    expect(favouriteArtists(favs, recent, 1, 'seed')).toEqual(['b'])
    expect(favouriteArtists([track('x')], [], 3, 'seed')).toEqual([]) // songs without an artist give no seed
  })

  it('blends lists in turn, drops repeats and avoids the same artist twice in a row', () => {
    const a = [track('1', 'x'), track('2', 'x'), track('3', 'y')]
    const b = [track('4', 'x'), track('1', 'x'), track('5', 'z')]
    const mix = blendMix([a, b], 10)
    expect(mix.map((t) => t.id).sort()).toEqual(['1', '2', '3', '4', '5'])
    for (let i = 1; i < mix.length; i += 1) {
      const sameArtist = mix[i]?.artistId === mix[i - 1]?.artistId
      // Only allowed when nothing else was left.
      if (sameArtist) expect(mix.slice(i).every((t) => t.artistId === mix[i]?.artistId)).toBe(true)
    }
    expect(blendMix([a, b], 2)).toHaveLength(2)
    expect(blendMix([], 5)).toEqual([])
  })
})
