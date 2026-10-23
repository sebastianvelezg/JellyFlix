// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as capabilities } from '../../test/fixtures'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import { setFavorite } from './details'
import type { Session } from './jellyfin'
import { getLibrarySections } from './library'
import {
  albumsOfTracks,
  cleanAlbumName,
  cleanTrackName,
  toAlbum,
  toTrack,
  coverUrl,
  getAlbum,
  getAlbumPage,
  getAlbumTracks,
  getArtist,
  getArtistPage,
  getFavoriteTracks,
  getMusicGenres,
  getPlaylist,
  getPlaylists,
  getPlaylistTracks,
  getPopularTracks,
  getRandomAlbums,
  getRandomTracks,
  getRecentAlbums,
  getRecentlyPlayedTracks,
  getTrackPage,
  searchMusic,
  totalTicks,
} from './music'
import { negotiatePlayback } from './playback'
import { PlaybackSession } from './playbackSession'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 3, musicArtists: 4 })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

const lastItems = () => mock.requests.filter((r) => r.path === '/Items').at(-1)
const device = { paused: false, muted: false, volume: 1 }

/** Listens to a track until `seconds` (the mock counts it as played from 27 s of its 30). */
async function listen(id: string, seconds: number) {
  const plan = await negotiatePlayback(session, id, { capabilities, mediaType: 'audio' })
  const playback = new PlaybackSession(session, plan, seconds)
  playback.playing(seconds, device)
  await playback.stop(device)
}

describe('music libraries', () => {
  it('lists music libraries as their own section', async () => {
    const sections = await getLibrarySections(session)
    expect(sections.music.map((l) => l.name)).toEqual(['Music'])
    expect(sections.movies.map((l) => l.name)).toEqual(['Movies'])
  })
})

describe('albums', () => {
  it('lists albums with their artist, year, cover and track count', async () => {
    const page = await getAlbumPage(session, { startIndex: 0 })
    expect(page.total).toBe(8)
    expect(page.items[0]).toMatchObject({
      id: 'al0001-1',
      name: 'Album 001-1',
      artist: 'Test Artist 001',
      artistId: 'ar0001',
      trackCount: 4,
      imageTag: 'tag1',
      favorite: false,
    })
    expect(page.items[0]?.year).toBeGreaterThan(1989)
    expect(lastItems()?.queryAll.includeItemTypes).toEqual(['MusicAlbum'])
  })

  it('sorts, filters by genre and by favourites, and by artist', async () => {
    expect((await getAlbumPage(session, { startIndex: 0, sort: 'added', limit: 2 })).items.map((a) => a.id)).toEqual(['al0004-2', 'al0004-1'])
    expect((await getAlbumPage(session, { startIndex: 0, sort: 'artist', limit: 2 })).items.map((a) => a.artist)).toEqual([
      'Test Artist 001',
      'Test Artist 001',
    ])
    const rock = await getAlbumPage(session, { startIndex: 0, genre: 'Rock' })
    expect(lastItems()?.queryAll.genres).toEqual(['Rock'])
    expect(rock.items.every((a) => a.genres.includes('Rock'))).toBe(true)
    await setFavorite(session, 'al0002-1', true)
    expect((await getAlbumPage(session, { startIndex: 0, filter: 'favorites' })).items.map((a) => a.id)).toEqual(['al0002-1'])
    await setFavorite(session, 'al0002-1', false)
  })

  it("lists an artist's own albums", async () => {
    const page = await getAlbumPage(session, { startIndex: 0, artistId: 'ar0003' })
    expect(lastItems()?.queryAll.albumArtistIds).toEqual(['ar0003'])
    expect(page.items.map((a) => a.id)).toEqual(['al0003-1', 'al0003-2'])
  })

  it('reads one album and its tracks in order', async () => {
    expect(await getAlbum(session, 'al0002-2')).toMatchObject({ name: 'Album 002-2', artist: 'Test Artist 002' })
    await expect(getAlbum(session, 'al9999-1')).rejects.toThrow()
    const tracks = await getAlbumTracks(session, 'al0002-2')
    expect(tracks.map((t) => t.trackNumber)).toEqual([1, 2, 3, 4])
    expect(tracks[0]).toMatchObject({
      id: 'tr0002-2-1',
      name: 'Song 2.1',
      artist: 'Test Artist 002',
      album: 'Album 002-2',
      albumId: 'al0002-2',
      discNumber: 1,
    })
    expect(totalTicks(tracks)).toBe(4 * 30 * 10_000_000)
    expect(lastItems()?.query.parentId).toBe('al0002-2')
  })

  it('finds new, random and genre lists', async () => {
    expect((await getRecentAlbums(session, undefined, 3)).map((a) => a.id)).toEqual(['al0004-2', 'al0004-1', 'al0003-2'])
    expect((await getRandomAlbums(session, undefined, 5)).length).toBe(5)
    expect(lastItems()?.queryAll.sortBy).toEqual(['Random'])
    expect(await getMusicGenres(session)).toEqual(['Comedy', 'Drama', 'Action'].sort())
  })
})

describe('artists', () => {
  it('lists album artists, searches them, and reads one', async () => {
    const page = await getArtistPage(session, { startIndex: 0 })
    expect(page.total).toBe(4)
    expect(page.items[0]).toMatchObject({ id: 'ar0001', name: 'Test Artist 001', imageTag: 'tag1', favorite: false })
    expect((await getArtistPage(session, { startIndex: 0, search: 'artist 003' })).items.map((a) => a.id)).toEqual(['ar0003'])
    const artist = await getArtist(session, 'ar0001')
    expect(artist.overview).toMatch(/Biography of Test Artist 001/)
    expect(artist.backdropTag).toBe('bd1')
    await expect(getArtist(session, 'ar9999')).rejects.toThrow()
  })
})

describe('songs', () => {
  it('pages, sorts and searches songs', async () => {
    const page = await getTrackPage(session, { startIndex: 0, limit: 5 })
    expect(page.total).toBe(32)
    expect(page.items).toHaveLength(5)
    expect((await getTrackPage(session, { startIndex: 0, search: 'Song 2.3' })).total).toBe(4)
    expect((await getTrackPage(session, { startIndex: 0, sort: 'artist', limit: 1 })).items[0]?.artist).toBe('Test Artist 001')
    expect((await getTrackPage(session, { startIndex: 0, artistId: 'ar0002' })).total).toBe(8)
    expect(lastItems()?.queryAll.artistIds).toEqual(['ar0002'])
  })

  it('knows what you played, most played and favourite', async () => {
    expect(await getRecentlyPlayedTracks(session, undefined)).toEqual([])
    await listen('tr0001-1-2', 29)
    await listen('tr0001-1-2', 29)
    await listen('tr0002-1-1', 29)
    await listen('tr0003-1-1', 5) // not far enough to count
    const recent = await getRecentlyPlayedTracks(session, undefined)
    expect(recent.map((t) => t.id)).toEqual(['tr0002-1-1', 'tr0001-1-2'])
    expect(albumsOfTracks(recent).map((a) => a.id)).toEqual(['al0002-1', 'al0001-1'])
    expect(albumsOfTracks(recent)[0]).toMatchObject({ name: 'Album 002-1', artist: 'Test Artist 002', imageTag: 'tag1' })
    const popular = await getPopularTracks(session, { limit: 2 })
    expect(popular.map((t) => [t.id, t.playCount])).toEqual([
      ['tr0001-1-2', 2],
      ['tr0002-1-1', 1],
    ])

    await setFavorite(session, 'tr0004-2-3', true)
    expect((await getFavoriteTracks(session, undefined)).map((t) => t.id)).toEqual(['tr0004-2-3'])
    await setFavorite(session, 'tr0004-2-3', false)
    expect((await getRandomTracks(session, undefined, 7)).length).toBe(7)
  })

  it('gives a track its album cover, or its own picture when it has one', () => {
    const server = 'http://h'
    expect(coverUrl(server, { id: 't', albumId: 'al', albumImageTag: 'x' })).toBe('http://h/Items/al/Images/Primary?fillWidth=300&quality=80&tag=x')
    expect(coverUrl(server, { id: 't', imageTag: 'own', albumId: 'al', albumImageTag: 'x' }, 100)).toBe(
      'http://h/Items/t/Images/Primary?fillWidth=100&quality=80&tag=own',
    )
    expect(coverUrl(server, { id: 't' })).toBeNull()
  })
})

describe('playlists', () => {
  it('lists song playlists and their tracks', async () => {
    const playlists = await getPlaylists(session)
    expect(playlists).toMatchObject([{ id: 'pl0001', name: 'Road trip', trackCount: 5 }])
    expect(lastItems()?.queryAll.includeItemTypes).toEqual(['Playlist'])
    expect(await getPlaylist(session, 'pl0001')).toMatchObject({ name: 'Road trip' })
    const tracks = await getPlaylistTracks(session, 'pl0001')
    expect(tracks.map((t) => t.id)).toEqual(['tr0001-1-1', 'tr0001-2-1', 'tr0002-1-1', 'tr0002-2-1', 'tr0003-1-1'])
  })
})

describe('search', () => {
  it('finds albums, artists and songs together', async () => {
    const found = await searchMusic(session, 'Artist 002')
    expect(found.artists.map((a) => a.id)).toEqual(['ar0002'])
    expect(found.albums).toEqual([]) // album names do not contain the artist
    const albums = await searchMusic(session, 'Album 003')
    expect(albums.albums.map((a) => a.id)).toEqual(['al0003-1', 'al0003-2'])
    expect((await searchMusic(session, 'Song 1.1')).tracks).toHaveLength(4)
    expect(await searchMusic(session, '  ')).toEqual({ albums: [], artists: [], tracks: [] })
  })
})

describe('playing music', () => {
  it('asks for an audio stream and gets the audio URL', async () => {
    const plan = await negotiatePlayback(session, 'tr0001-1-1', { capabilities, mediaType: 'audio' })
    expect(plan).toMatchObject({ mediaType: 'audio', playMethod: 'DirectPlay', protocol: 'direct' })
    expect(new URL(plan.url).pathname).toBe('/Audio/tr0001-1-1/stream')
    const info = mock.requests.filter((r) => r.path === '/Items/tr0001-1-1/PlaybackInfo').at(-1)
    const profile = (info?.body as { DeviceProfile: { DirectPlayProfiles: Array<{ Type: string; Container: string }> } }).DeviceProfile
    expect(profile.DirectPlayProfiles.filter((p) => p.Type === 'Audio').map((p) => p.Container)).toContain('mp3')
  })

  it('takes the server up on a transcode (HLS) when it offers one', async () => {
    const hls = await startMockJellyfin({ movieCount: 1, musicArtists: 1, playMode: 'hls' })
    try {
      const s = await connect(hls.url, 'tester', 'secret')
      const plan = await negotiatePlayback(s, 'tr0001-1-1', { capabilities, mediaType: 'audio' })
      expect(plan).toMatchObject({ mediaType: 'audio', playMethod: 'Transcode', protocol: 'hls' })
      expect(plan.url).not.toContain('ApiKey')
      expect(new URL(plan.url).pathname).toBe('/audio/tr0001-1-1/master.m3u8')
    } finally {
      await hls.close()
    }
  })
})

describe('untagged music', () => {
  it('reads artist, year and title from a folder-style album name', () => {
    expect(cleanAlbumName('(1974) - Kiss - Hotter Than Hell [24Bit-96kHz]')).toEqual({
      year: 1974,
      artist: 'Kiss',
      name: 'Hotter Than Hell [24Bit-96kHz]',
    })
    expect(cleanAlbumName('Nelly - Sweatsuit (B000)')).toEqual({ artist: 'Nelly', name: 'Sweatsuit (B000)' })
    expect(cleanAlbumName('Abbey Road')).toEqual({ name: 'Abbey Road' })
    expect(cleanAlbumName('(1999)')).toEqual({ name: '(1999)' })
    const album = toAlbum({ Id: 'a', Name: '(1975) - Kiss - Dressed To Kill [24Bit-96kHz]' })
    expect(album).toMatchObject({ name: 'Dressed To Kill [24Bit-96kHz]', artist: 'Kiss', year: 1975 })
    // A properly tagged album is left exactly as it is, even if its title looks like a folder name.
    const tagged = toAlbum({ Id: 'b', Name: '(1999) - Remastered - Live', AlbumArtist: 'Someone', ProductionYear: 2001 })
    expect(tagged).toMatchObject({ name: '(1999) - Remastered - Live', artist: 'Someone', year: 2001 })
  })

  it('takes a track number off the start of a song title only when the file has none', () => {
    expect(cleanTrackName('01. Got To Choose')).toEqual({ number: 1, name: 'Got To Choose' })
    expect(cleanTrackName('12 - Strange Ways')).toEqual({ number: 12, name: 'Strange Ways' })
    for (const title of ['7 Rings', '99 Problems', '1-800-273-8255', '1999', 'Song 1.1']) expect(cleanTrackName(title)).toEqual({ name: title })
    expect(toTrack({ Id: 't', Name: '03. Goin\' Blind' })).toMatchObject({ name: "Goin' Blind", trackNumber: 3 })
    expect(toTrack({ Id: 't', Name: '03. Real Title', IndexNumber: 7 })).toMatchObject({ name: '03. Real Title', trackNumber: 7 })
  })
})
