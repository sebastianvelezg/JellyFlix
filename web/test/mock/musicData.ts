/**
 * Music for the mock Jellyfin server: artists ("ar0001"), their albums ("al0001-1") and the tracks of
 * each album ("tr0001-1-3"), plus one playlist. Every artist has 2 albums of 4 tracks, 30 seconds each.
 */
export const ALBUMS_PER_ARTIST = 2
export const TRACKS_PER_ALBUM = 4
export const TRACK_SECONDS = 30
export const PLAYLIST_ID = 'pl0001'
export const MUSIC_LIBRARY = 'lib-music'

const TICKS = 10_000_000
const GENRES = ['Rock', 'Jazz', 'Pop']
const pad = (n: number) => String(n).padStart(4, '0')

export const artistId = (n: number) => `ar${pad(n)}`
export const albumId = (n: number, album: number) => `al${pad(n)}-${album}`
export const trackId = (n: number, album: number, track: number) => `tr${pad(n)}-${album}-${track}`
export const ARTIST_ID = /^ar(\d{4})$/
export const ALBUM_ID = /^al(\d{4})-(\d+)$/
export const TRACK_ID = /^tr(\d{4})-(\d+)-(\d+)$/

const artistName = (n: number) => `Test Artist ${String(n).padStart(3, '0')}`
const albumName = (n: number, album: number) => `Album ${String(n).padStart(3, '0')}-${album}`
const trackName = (album: number, track: number) => `Song ${album}.${track}`

/** The slice of the mock's user state that music needs. */
export interface MusicUser {
  played: Set<string>
  favorites: Set<string>
  plays: Map<string, number>
  lastPlayed: string[]
}

export interface MusicRow {
  id: string
  type: 'MusicArtist' | 'MusicAlbum' | 'Audio' | 'Playlist'
  /** Lower-case name, for search. */
  name: string
  lib: string
  /** The album a track belongs to (used when a request asks for the children of an album). */
  parent?: string
  genre?: string
  year: number
  created: number
  artistIds: string[]
  artist: string
  album: string
  /** Track number within the album, for ordering. */
  number: number
}

export function musicIds(artists: number) {
  const albums: Array<{ artist: number; album: number }> = []
  const tracks: Array<{ artist: number; album: number; track: number }> = []
  for (let n = 1; n <= artists; n += 1) {
    for (let a = 1; a <= ALBUMS_PER_ARTIST; a += 1) {
      albums.push({ artist: n, album: a })
      for (let t = 1; t <= TRACKS_PER_ALBUM; t += 1) tracks.push({ artist: n, album: a, track: t })
    }
  }
  return { albums, tracks }
}

/** Every track in the playlist: the first track of each of the first five albums. */
export function playlistTrackIds(artists: number): string[] {
  const { albums } = musicIds(artists)
  return albums.slice(0, 5).map(({ artist, album }) => trackId(artist, album, 1))
}

export function musicRows(artists: number): MusicRow[] {
  const rows: MusicRow[] = []
  for (let n = 1; n <= artists; n += 1) {
    rows.push({
      id: artistId(n),
      type: 'MusicArtist',
      name: artistName(n).toLowerCase(),
      lib: MUSIC_LIBRARY,
      genre: GENRES[n % 3],
      year: 0,
      created: n,
      artistIds: [artistId(n)],
      artist: artistName(n),
      album: '',
      number: 0,
    })
  }
  const { albums, tracks } = musicIds(artists)
  for (const { artist, album } of albums) {
    rows.push({
      id: albumId(artist, album),
      type: 'MusicAlbum',
      name: albumName(artist, album).toLowerCase(),
      lib: MUSIC_LIBRARY,
      genre: GENRES[(artist + album) % 3],
      year: 1990 + ((artist * 3 + album) % 30),
      created: artist * 10 + album,
      artistIds: [artistId(artist)],
      artist: artistName(artist),
      album: albumName(artist, album),
      number: 0,
    })
  }
  for (const { artist, album, track } of tracks) {
    rows.push({
      id: trackId(artist, album, track),
      type: 'Audio',
      name: trackName(album, track).toLowerCase(),
      lib: MUSIC_LIBRARY,
      parent: albumId(artist, album),
      genre: GENRES[(artist + album) % 3],
      year: 1990 + ((artist * 3 + album) % 30),
      created: artist * 100 + album * 10 + track,
      artistIds: [artistId(artist)],
      artist: artistName(artist),
      album: albumName(artist, album),
      number: track,
    })
  }
  if (artists > 0) {
    rows.push({
      id: PLAYLIST_ID,
      type: 'Playlist',
      name: 'road trip',
      lib: 'playlists',
      year: 0,
      created: 1,
      artistIds: [],
      artist: '',
      album: '',
      number: 0,
    })
  }
  return rows
}

function userData(id: string, user: MusicUser) {
  return {
    PlaybackPositionTicks: 0,
    Played: user.played.has(id),
    PlayCount: user.plays.get(id) ?? 0,
    IsFavorite: user.favorites.has(id),
  }
}

/** The DTO for an artist, album, track or the playlist, or undefined if the id is not music. */
export function musicDto(id: string, user: MusicUser, artists: number) {
  const artist = ARTIST_ID.exec(id)
  if (artist) {
    const n = Number(artist[1])
    if (n < 1 || n > artists) return undefined
    return {
      Id: id,
      Name: artistName(n),
      SortName: artistName(n).toLowerCase(),
      Type: 'MusicArtist',
      ImageTags: { Primary: 'tag1' },
      BackdropImageTags: n % 2 === 1 ? ['bd1'] : [],
      Genres: [GENRES[n % 3]],
      Overview: `Biography of ${artistName(n)}. A synthetic artist used only by the mock server.`,
      DateCreated: new Date(Date.UTC(2024, 0, 1) + n * 86_400_000).toISOString(),
      UserData: userData(id, user),
    }
  }
  const album = ALBUM_ID.exec(id)
  if (album) {
    const n = Number(album[1])
    const a = Number(album[2])
    if (n < 1 || n > artists || a < 1 || a > ALBUMS_PER_ARTIST) return undefined
    return {
      Id: id,
      Name: albumName(n, a),
      SortName: albumName(n, a).toLowerCase(),
      Type: 'MusicAlbum',
      AlbumArtist: artistName(n),
      AlbumArtists: [{ Id: artistId(n), Name: artistName(n) }],
      Artists: [artistName(n)],
      ProductionYear: 1990 + ((n * 3 + a) % 30),
      ChildCount: TRACKS_PER_ALBUM,
      RunTimeTicks: TRACKS_PER_ALBUM * TRACK_SECONDS * TICKS,
      ImageTags: { Primary: 'tag1' },
      Genres: [GENRES[(n + a) % 3]],
      DateCreated: new Date(Date.UTC(2024, 0, 1) + (n * 10 + a) * 86_400_000).toISOString(),
      UserData: userData(id, user),
    }
  }
  const track = TRACK_ID.exec(id)
  if (track) {
    const n = Number(track[1])
    const a = Number(track[2])
    const t = Number(track[3])
    if (n < 1 || n > artists || a < 1 || a > ALBUMS_PER_ARTIST || t < 1 || t > TRACKS_PER_ALBUM) return undefined
    return {
      Id: id,
      Name: trackName(a, t),
      SortName: trackName(a, t).toLowerCase(),
      Type: 'Audio',
      MediaType: 'Audio',
      Artists: [artistName(n)],
      ArtistItems: [{ Id: artistId(n), Name: artistName(n) }],
      Album: albumName(n, a),
      AlbumId: albumId(n, a),
      AlbumArtist: artistName(n),
      AlbumPrimaryImageTag: 'tag1',
      IndexNumber: t,
      ParentIndexNumber: 1,
      RunTimeTicks: TRACK_SECONDS * TICKS,
      ImageTags: {},
      DateCreated: new Date(Date.UTC(2024, 0, 1) + (n * 100 + a * 10 + t) * 86_400_000).toISOString(),
      UserData: userData(id, user),
    }
  }
  if (id === PLAYLIST_ID && artists > 0) {
    return {
      Id: id,
      Name: 'Road trip',
      SortName: 'road trip',
      Type: 'Playlist',
      MediaType: 'Audio',
      ChildCount: playlistTrackIds(artists).length,
      RunTimeTicks: playlistTrackIds(artists).length * TRACK_SECONDS * TICKS,
      ImageTags: {},
      UserData: userData(id, user),
    }
  }
  return undefined
}
