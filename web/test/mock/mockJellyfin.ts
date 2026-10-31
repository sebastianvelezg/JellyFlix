/**
 * A tiny fake Jellyfin server for automated tests and local demos. It is NOT Jellyfin:
 * it implements just the endpoints this client uses, with the same shapes, and records every
 * request so tests can assert how the client authenticated and what it reported.
 *
 * Authentication rules mirror what matters to the client:
 *  - JSON API + HLS: `Authorization: MediaBrowser ... Token="..."` header (or ApiKey query).
 *  - Direct-play `/Videos/{id}/stream`: ApiKey query only (a <video> cannot send headers).
 *  - Images: anonymous.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cbzBytes, epubBytes, pdfBytes } from './bookFiles.ts'
import {
  ALBUM_ID,
  MUSIC_LIBRARY,
  musicDto,
  musicRows,
  playlistTrackIds,
  TRACK_ID,
  TRACK_SECONDS,
} from './musicData.ts'

export interface MockOptions {
  username?: string
  password?: string
  /** Directory produced by scripts/make-test-media.mjs. Optional for API-only tests. */
  mediaDir?: string
  movieCount?: number
  /** 'direct' answers PlaybackInfo with direct play; 'hls' always offers an HLS transcode. */
  playMode?: 'direct' | 'hls'
  /** Simulate a library that has no movie view. */
  noMovieLibrary?: boolean
  /** Leave out the (normally always present, possibly empty) "Shows" TV library: an account with only movies. */
  noTvLibrary?: boolean
  /** Series in the "Shows" library (2 seasons of 3 episodes each). 0 = the library exists but is still empty. */
  seriesCount?: number
  /** Artists in a "Music" library (each has 2 albums of 4 tracks; there is also one playlist). 0 = no music library. */
  musicArtists?: number
  /** Collections (box sets) of three movies each: "Test Collection 001" holds movies 1-3. 0 = none. */
  collections?: number
  /** Series in an "Anime" library (same shape). 0 = no Anime library at all. */
  animeCount?: number
  /** Videos in a "Music videos" library (each by one of three artists). 0 = no such library. */
  musicVideos?: number
  /** Folders inside the "Music videos" library: the videos are split between this many folders (the last video of the second one sits in a folder inside it). 0 = a flat library. */
  musicVideoFolders?: number
  /** Books in a "Books" library: bk0001 is an EPUB, then a PDF, a comic (CBZ) and a Mobi file, and so on. 0 = none. */
  books?: number
  /** Audiobooks in the same library (the 30 seconds of audio of the test media). */
  audiobooks?: number
  /** Answer the download of a book's file with "not allowed" (an account that may not download). */
  noDownload?: boolean
  /** Watch together: how far the server's clock is ahead of this machine's (ms), to prove the client uses the server's time. */
  syncSkewMs?: number
  /** Watch together: the account is not allowed to use it (every call answers 403). */
  syncPlayDenied?: boolean
  /** Live TV channels: ch0001... each with a programme every half hour from two hours ago to ten hours ahead. 0 = no Live TV. */
  liveTv?: number
  /** Make /Sessions/Playing* fail, to prove reporting errors do not break playback. */
  failReporting?: boolean
  /**
   * Fail the first `times` requests to `path` (a hiccup): with `status`, or `'drop'` to cut the connection.
   * Counted in `MockServer.flakyHits`.
   */
  flaky?: { path: string; status: number | 'drop'; times: number }
  /** Serve intro/credits segments for episodes (an intro at 3-8 s and credits at 24-30 s). */
  segments?: boolean
  /** Is the signed-in user a server administrator (default)? Plugins and scheduled tasks answer 403 to anyone else. */
  admin?: boolean
  /** The server has no subtitle plugin: searching for subtitles answers 404. */
  noSubtitlePlugin?: boolean
  /**
   * The Playback Reporting plugin: absent (default, its routes answer 404), installed with nothing recorded yet ('empty'), or with a
   * few plays on record ('data'). Its queries are for administrators only.
   */
  reporting?: 'empty' | 'data'
  /** Quick Connect is switched on (default) or off on the server. */
  quickConnect?: boolean
  /** Controllable devices to list in /Sessions, such as a TV (default: one TV named "Living room TV"). */
  remoteDevices?: Array<{ id: string; name: string; client?: string }>
  /** Titles come with trickplay pictures for the seek bar (default: none). */
  trickplay?: boolean
  /** Every movie lists a trailer (YouTube); "Test Movie 002" lists two. */
  trailers?: boolean
  /** Movies and series carry an age rating (G, PG, PG-13 or R by their number) and the server can limit lists by it. */
  ratings?: boolean
  /** Every video also has a second text subtitle (Spanish, stream 9, saying "Segunda linea de prueba"). */
  secondSubtitle?: boolean
  /** "Test Movie 002" also exists as a 4K version (a second media source, `ms-m0002-4k`). */
  versions?: boolean
  /** A second device of another account, "Kitchen tablet", playing a title that the server converts (for the administrator's session list). */
  adminSessions?: boolean
  /** Episodes that have not aired yet, for "Coming up" (default: none). */
  upcoming?: boolean
  /** Serve 404 for direct-play streams ('direct') or for every media request ('all'). */
  breakMedia?: 'direct' | 'all'
}

export interface RecordedRequest {
  method: string
  path: string
  query: Record<string, string>
  /** Every value of every key (arrays are sent as repeated keys by the SDK). */
  queryAll: Record<string, string[]>
  auth: 'header' | 'query' | 'none'
  body?: unknown
  range?: string
  status: number
}

export interface MockServer {
  url: string
  requests: RecordedRequest[]
  /** Resume positions by movie id, in ticks (updated by /Sessions/Playing/Stopped). */
  resume: Map<string, number>
  /** Watched / favorite state, for assertions. */
  user: UserState
  options: MockOptions
  close: () => Promise<void>
  tokens: Set<string>
  /** How many requests the `flaky` option has failed so far. */
  flakyHits: () => number
  /** Quick Connect codes handed out, and whether someone approved them. */
  quickConnectCodes: Map<string, { secret: string; approved: boolean }>
  /** What was asked of the controllable devices, in order: "<session id> play <item ids>" or "<session id> <command>". */
  remoteLog: string[]
  /** What was asked of the scheduled tasks and of Intro Skipper, in order ("start <task id>", "stop <task id>", "scan <season id>"). */
  taskLog: string[]
  /** The queries sent to Playback Reporting, in order. */
  reportingQueries: string[]
  /** Makes every API answer (not images or media) take this long from now on, like a slow server; 0 to stop. */
  setDelay: (ms: number) => void
  /** The most reads (GET requests for data, not images or media) that were waiting for an answer at the same moment, since the last reset. */
  peakApiRequests: () => number
  resetPeakApiRequests: () => void
  /** What an administrator asked of titles, in order ("update m0001", "refresh m0001 FullRefresh replaceAll", "identify m0001 Tmdb=603", "upload m0001 Primary image/png 12"...). */
  adminLog: string[]
  /** The accounts on the server, by id (their allowances are what an administrator edits). */
  accounts: Map<string, { id: string; name: string; policy: Record<string, unknown> }>
  /** Device ids of the browsers listening on the server's socket (they are listed as controllable in /Sessions). */
  connectedDevices: () => string[]
  /** What those browsers sent over their sockets, in order ("<device id> <text>"). */
  socketLog: string[]
  /** Pushes a message to a connected browser, as the server does when another device asks it to play or pause. False when it is not connected. */
  push: (deviceId: string, message: unknown) => boolean
}

/** A signed-in client as the server sees it: the session other devices can list and, once its socket is open, control. */
interface MockSession {
  id: string
  deviceId: string
  deviceName: string
  client: string
  itemId?: string
  positionTicks: number
  paused: boolean
  peer?: Peer
}

interface Peer {
  send: (text: string) => void
  close: () => void
}

/** A watch-together group as the server keeps it. */
interface MockGroup {
  id: string
  name: string
  state: 'Idle' | 'Waiting' | 'Paused' | 'Playing'
  /** Access tokens of the members. */
  members: Set<string>
  /** Members the group does not wait for (a player that is not on screen). */
  ignoring: Set<string>
  /** Members that have not said they are ready since the group last had to wait. */
  notReady: Set<string>
  itemIds: string[]
  playlistItemIds: string[]
  index: number
  positionTicks: number
  /** When (server ms) the title was at `positionTicks` while playing. */
  positionAt: number
  /** What the group goes back to once everyone is ready. */
  wantPlaying: boolean
}

/** Reads the unmasked text of the frames a browser sends (text, ping and close are all a test needs). */
function frameReader(onText: (text: string) => void, onPing: () => void, onClose: () => void) {
  let buffer = Buffer.alloc(0)
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      if (buffer.length < 2) return
      const opcode = (buffer[0] as number) & 0x0f
      const masked = ((buffer[1] as number) & 0x80) !== 0
      let length = (buffer[1] as number) & 0x7f
      let offset = 2
      if (length === 126) {
        if (buffer.length < 4) return
        length = buffer.readUInt16BE(2)
        offset = 4
      }
      const mask = masked ? buffer.subarray(offset, offset + 4) : null
      if (masked) offset += 4
      if (buffer.length < offset + length) return
      const payload = Buffer.from(buffer.subarray(offset, offset + length))
      buffer = buffer.subarray(offset + length)
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] = (payload[i] as number) ^ (mask[i % 4] as number)
      if (opcode === 0x1) onText(payload.toString('utf8'))
      else if (opcode === 0x9) onPing()
      else if (opcode === 0x8) return onClose()
    }
  }
}

function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const head = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
  return Buffer.concat([head, payload])
}

const TICKS = 10_000_000
const timedLyrics = [
  { Start: 0, Text: 'First line' },
  { Start: 10 * TICKS, Text: 'Second line' },
  { Start: 20 * TICKS, Text: 'Third line' },
]
const DURATION_SECONDS = 30

export function movieId(n: number): string {
  return `m${String(n).padStart(4, '0')}`
}

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

/** The text of each request body as it arrived (a picture upload is base64 text, not JSON). */
const rawBodies = new WeakMap<IncomingMessage, string>()

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      rawBodies.set(req, text)
      try {
        resolve(text ? JSON.parse(text) : undefined)
      } catch {
        resolve(undefined)
      }
    })
  })
}

function serveFile(req: IncomingMessage, res: ServerResponse, file: string, type: string) {
  if (!existsSync(file)) {
    res.writeHead(404).end()
    return
  }
  const size = statSync(file).size
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    res.writeHead(206, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    })
    createReadStream(file, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size })
    createReadStream(file).pipe(res)
  }
}

const GENRES = ['Action', 'Drama', 'Comedy']

/** The details an administrator can change (the same names as in Jellyfin's item). */
const EDITABLE_KEYS = ['Name', 'OriginalTitle', 'ForcedSortName', 'Overview', 'ProductionYear', 'OfficialRating', 'CommunityRating', 'Genres', 'Studios', 'Tags', 'LockData', 'LockedFields']

const CHAPTERS = [
  { Name: 'Opening', StartPositionTicks: 0 },
  { Name: 'The middle', StartPositionTicks: 12 * 10_000_000 },
  { Name: 'Finale', StartPositionTicks: 22 * 10_000_000 },
]

interface UserState {
  resume: Map<string, number>
  played: Set<string>
  favorites: Set<string>
  /** Titles rated with a thumb: true for a like, false for a dislike. */
  likes: Map<string, boolean>
  /** How many times each track was played to (near) its end. */
  plays: Map<string, number>
  /** Order of last playback, newest last (for Continue Watching). */
  lastPlayed: string[]
}

// ---- series: "s0001" are in the Shows library, "a0001" in the Anime library ----------------------

const SEASONS = 2
const EPISODES = 3

const showId = (prefix: 's' | 'a', n: number) => `${prefix}${String(n).padStart(4, '0')}`
const seasonId = (show: string, season: number) => `${show}-season-${season}`
const episodeId = (show: string, season: number, episode: number) => `${show}-ep-${season}-${episode}`
const EPISODE_ID = /^([sa]\d{4})-ep-(\d+)-(\d+)$/
const SEASON_ID = /^([sa]\d{4})-season-(\d+)$/
const SHOW_ID = /^([sa])(\d{4})$/

const showName = (prefix: 's' | 'a', n: number) => `Test ${prefix === 's' ? 'Show' : 'Anime'} ${String(n).padStart(3, '0')}`

/** Every episode of a show in watching order. */
function episodesOf(show: string): Array<{ id: string; season: number; episode: number }> {
  return Array.from({ length: SEASONS * EPISODES }, (_, i) => {
    const season = Math.floor(i / EPISODES) + 1
    const episode = (i % EPISODES) + 1
    return { id: episodeId(show, season, episode), season, episode }
  })
}

function showLibrary(show: string): string {
  return show.startsWith('a') ? 'lib-anime' : 'lib-shows'
}

/** A date for when `id` was last played, later for more recent playback; none if it never was. */
function lastPlayedDate(id: string, user: UserState): string | undefined {
  const order = user.lastPlayed.indexOf(id)
  return order >= 0 ? new Date(Date.UTC(2025, 0, 1) + order * 60_000).toISOString() : undefined
}

function userData(id: string, user: UserState, extra: Record<string, unknown> = {}) {
  return {
    LastPlayedDate: lastPlayedDate(id, user),
    PlaybackPositionTicks: user.resume.get(id) ?? 0,
    Played: user.played.has(id),
    PlayCount: user.plays.get(id) ?? (user.played.has(id) ? 1 : 0),
    IsFavorite: user.favorites.has(id),
    ...(user.likes.has(id) ? { Likes: user.likes.get(id) } : {}),
    ...extra,
  }
}

function showDto(show: string, user: UserState) {
  const m = SHOW_ID.exec(show) as RegExpExecArray
  const prefix = m[1] as 's' | 'a'
  const n = Number(m[2])
  const unwatched = episodesOf(show).filter((e) => !user.played.has(e.id)).length
  return {
    Id: show,
    Name: showName(prefix, n),
    SortName: showName(prefix, n).toLowerCase(),
    ProductionYear: 2010 + (n % 10),
    Type: 'Series',
    ...(withRatings ? { OfficialRating: ratingOfShow(n) } : {}),
    CommunityRating: ((n * 3) % 10) + 0.5,
    DateCreated: new Date(Date.UTC(2024, 6, 1) + n * 86_400_000).toISOString(),
    Genres: [GENRES[n % 3]],
    ImageTags: { Primary: 'tag1' },
    BackdropImageTags: n % 2 === 1 ? ['bd1'] : [],
    ChildCount: SEASONS,
    Status: 'Continuing',
    UserData: userData(show, user, { Played: unwatched === 0, UnplayedItemCount: unwatched }),
  }
}

function fullShowDto(show: string, user: UserState) {
  const dto = showDto(show, user)
  return {
    ...dto,
    Overview: `Overview of ${dto.Name}. A synthetic series used only by the mock server.`,
    OfficialRating: withRatings ? ratingOfShow(Number(show.slice(1))) : 'TV-14',
    Studios: [{ Name: 'Mock Network' }],
    People: [{ Id: 'p1', Name: 'Ada Actor', Role: 'Lead', Type: 'Actor', PrimaryImageTag: 'ptag' }],
  }
}

function seasonDto(show: string, season: number, user: UserState) {
  const unwatched = episodesOf(show).filter((e) => e.season === season && !user.played.has(e.id)).length
  return {
    Id: seasonId(show, season),
    Name: `Season ${season}`,
    Type: 'Season',
    IndexNumber: season,
    SeriesId: show,
    ChildCount: EPISODES,
    ImageTags: { Primary: 'tag1' },
    UserData: userData(seasonId(show, season), user, { UnplayedItemCount: unwatched }),
  }
}

function episodeDto(show: string, season: number, episode: number, user: UserState) {
  const id = episodeId(show, season, episode)
  const m = SHOW_ID.exec(show) as RegExpExecArray
  return {
    Id: id,
    Name: `Episode Title ${season}-${episode}`,
    SortName: `episode title ${season}-${episode}`,
    Type: 'Episode',
    IndexNumber: episode,
    ParentIndexNumber: season,
    SeriesId: show,
    SeriesName: showName(m[1] as 's' | 'a', Number(m[2])),
    SeasonId: seasonId(show, season),
    SeasonName: `Season ${season}`,
    ProductionYear: 2010,
    RunTimeTicks: DURATION_SECONDS * TICKS,
    Overview: `Overview of episode ${season}x${episode}.`,
    ImageTags: { Primary: 'tag1' },
    Chapters: CHAPTERS,
    UserData: userData(id, user),
  }
}

/** The DTO for any id the mock knows (movie, series, season or episode), or undefined. */
function dtoFor(id: string, user: UserState, counts: { movieCount: number; musicArtists: number; collections: number; musicVideos?: number; musicVideoFolders?: number; books?: number; audiobooks?: number; liveTv?: number; trickplay?: boolean; versions?: boolean }, full = false) {
  const { movieCount } = counts
  if (CHANNEL_ID.test(id)) return Number(id.slice(2)) <= (counts.liveTv ?? 0) ? channelDto(Number(id.slice(2)), user) : undefined
  if (BOOK_ID.test(id)) return Number(id.slice(2)) <= (counts.books ?? 0) ? bookDto(Number(id.slice(2)), user, full) : undefined
  if (AUDIOBOOK_ID.test(id)) return Number(id.slice(2)) <= (counts.audiobooks ?? 0) ? audiobookDto(Number(id.slice(2)), user, full) : undefined
  if (MUSIC_VIDEO_ID.test(id)) {
    const at = Number(id.slice(2))
    return at >= 1 && at <= (counts.musicVideos ?? 0)
      ? musicVideoDto(at, user, full, musicVideoParent(at, counts.musicVideos ?? 0, counts.musicVideoFolders ?? 0))
      : undefined
  }
  if (MV_FOLDER_ID.test(id)) {
    const k = Number(id.slice(3))
    const exists = id === MV_NESTED ? (counts.musicVideoFolders ?? 0) >= 2 : k >= 1 && k <= (counts.musicVideoFolders ?? 0)
    if (!exists) return undefined
    const inside = Array.from({ length: counts.musicVideos ?? 0 }, (_, i) => i + 1).filter((n) => musicVideoParent(n, counts.musicVideos ?? 0, counts.musicVideoFolders ?? 0) === id).length
    return {
      Id: id,
      Name: mvFolderName(id),
      SortName: mvFolderName(id).toLowerCase(),
      Type: 'Folder',
      IsFolder: true,
      ParentId: mvFolderParent(id),
      ChildCount: inside + (id === mvFolderId(2) && (counts.musicVideoFolders ?? 0) >= 2 ? 1 : 0),
      UserData: { IsFavorite: false, Played: false, PlaybackPositionTicks: 0 },
    }
  }
  const box = COLLECTION_ID.exec(id)
  if (box && Number(box[1]) >= 1 && Number(box[1]) <= counts.collections) return collectionDto(Number(box[1]), user, full)
  const music = musicDto(id, user, counts.musicArtists)
  if (music) return music
  const episode = EPISODE_ID.exec(id)
  if (episode) return episodeDto(episode[1] as string, Number(episode[2]), Number(episode[3]), user)
  const season = SEASON_ID.exec(id)
  if (season) return seasonDto(season[1] as string, Number(season[2]), user)
  if (SHOW_ID.test(id)) return full ? fullShowDto(id, user) : showDto(id, user)
  const n = Number(id.slice(1))
  if (/^m\d{4}$/.test(id) && n >= 1 && n <= movieCount) return full ? fullDto(n, user, counts.trickplay, counts.versions) : movieDto(n, user)
  return undefined
}

/** Played state of a series or season is derived from its episodes; marking it marks them all. */
function leavesOf(id: string): string[] {
  const season = SEASON_ID.exec(id)
  if (season) return episodesOf(season[1] as string).filter((e) => e.season === Number(season[2])).map((e) => e.id)
  if (SHOW_ID.test(id)) return episodesOf(id).map((e) => e.id)
  return [id]
}

// ---- collections: "bx0001" holds movies 1-3, "bx0002" movies 4-6... ------------------------------------

const COLLECTION_SIZE = 3
const COLLECTION_ID = /^bx(\d{4})$/
const collectionId = (n: number) => `bx${String(n).padStart(4, '0')}`
const collectionName = (n: number) => `Test Collection ${String(n).padStart(3, '0')}`

function collectionMembers(id: string, movieCount: number): string[] {
  const n = Number(COLLECTION_ID.exec(id)?.[1])
  return Array.from({ length: COLLECTION_SIZE }, (_, i) => (n - 1) * COLLECTION_SIZE + i + 1)
    .filter((m) => m <= movieCount)
    .map(movieId)
}

function collectionDto(n: number, user: UserState, full = false) {
  const id = collectionId(n)
  return {
    Id: id,
    Name: collectionName(n),
    SortName: collectionName(n).toLowerCase(),
    Type: 'BoxSet',
    ChildCount: COLLECTION_SIZE,
    DateCreated: new Date(Date.UTC(2024, 3, 1) + n * 86_400_000).toISOString(),
    ImageTags: { Primary: 'tag1' },
    BackdropImageTags: n % 2 === 1 ? ['bd1'] : [],
    ...(full ? { Overview: `The films of ${collectionName(n)}, in order.` } : {}),
    UserData: { IsFavorite: user.favorites.has(id), Played: false, PlaybackPositionTicks: 0 },
  }
}

// ---- music videos: "mv0001"... in the "Music videos" library --------------------------------------------

const MUSIC_VIDEO_ID = /^mv\d{4}$/
const musicVideoId = (n: number) => `mv${String(n).padStart(4, '0')}`
const musicVideoName = (n: number) => `Test Music Video ${String(n).padStart(3, '0')}`

// The folders of the music video library: "mvf0001"... (the videos are split in blocks), and "mvf0099" inside the second one.
const MV_FOLDER_ID = /^mvf\d{4}$/
const mvFolderId = (k: number) => `mvf${String(k).padStart(4, '0')}`
const MV_NESTED = mvFolderId(99)
const mvFolderName = (id: string) => (id === MV_NESTED ? 'Nested' : `Folder ${id.slice(3)}`)

/** Where a music video lives: a folder id, or the library when the library has no folders (or the video is past the last block). */
function musicVideoParent(n: number, total: number, folders: number): string {
  if (folders <= 0) return 'lib-musicvideos'
  const size = Math.ceil(total / folders)
  const index = Math.ceil(n / size)
  if (index > folders) return 'lib-musicvideos'
  // The last video of the second folder is one level deeper.
  if (folders >= 2 && index === 2 && n === Math.min(2 * size, total)) return MV_NESTED
  return mvFolderId(index)
}
const mvFolderParent = (id: string) => (id === MV_NESTED ? mvFolderId(2) : 'lib-musicvideos')

function musicVideoDto(n: number, user: UserState, full = false, parentId = 'lib-musicvideos') {
  const id = musicVideoId(n)
  return {
    Id: id,
    ParentId: parentId,
    Path: `/media/musicvideos/${parentId === 'lib-musicvideos' ? '' : parentId === MV_NESTED ? `${mvFolderName(mvFolderId(2))}/${mvFolderName(MV_NESTED)}/` : `${mvFolderName(parentId)}/`}${musicVideoName(n)}.mkv`,
    Name: musicVideoName(n),
    SortName: musicVideoName(n).toLowerCase(),
    ProductionYear: 1990 + (n % 30),
    Type: 'MusicVideo',
    RunTimeTicks: DURATION_SECONDS * TICKS,
    DateCreated: new Date(Date.UTC(2024, 2, 1) + n * 86_400_000).toISOString(),
    Genres: [GENRES[n % 3]],
    Artists: [`Test Artist ${(n % 3) + 1}`],
    Album: `Test Album ${(n % 2) + 1}`,
    ImageTags: { Primary: 'tag1' },
    Chapters: [],
    UserData: userData(id, user),
    ...(full
      ? {
          Overview: `The video of song ${n}.`,
          MediaSources: [
            { Id: `ms-${id}`, Container: 'mp4', Size: 1_258_774, Bitrate: 335_000, MediaStreams: STREAMS.map((st) => (st.Type === 'Video' ? { ...st, Width: 1920, Height: 1080 } : st)) },
          ],
        }
      : {}),
  }
}

// ---- books: "bk0001"... and audiobooks: "ab0001"... in the "Books" library ------------------------------

const BOOK_ID = /^bk\d{4}$/
const AUDIOBOOK_ID = /^ab\d{4}$/
const bookId = (n: number) => `bk${String(n).padStart(4, '0')}`
const audiobookId = (n: number) => `ab${String(n).padStart(4, '0')}`
const BOOK_FORMATS = ['epub', 'pdf', 'cbz', 'mobi'] as const
const bookFormat = (n: number) => BOOK_FORMATS[(n - 1) % BOOK_FORMATS.length] as (typeof BOOK_FORMATS)[number]
const bookName = (n: number) => `Test Book ${String(n).padStart(3, '0')}`
const audiobookName = (n: number) => `Test Audiobook ${String(n).padStart(3, '0')}`

function bookFile(n: number): { bytes: Uint8Array; type: string } {
  const format = bookFormat(n)
  if (format === 'epub') return { bytes: epubBytes(bookName(n)), type: 'application/epub+zip' }
  if (format === 'pdf') return { bytes: pdfBytes(), type: 'application/pdf' }
  if (format === 'cbz') return { bytes: cbzBytes(), type: 'application/vnd.comicbook+zip' }
  return { bytes: new TextEncoder().encode('not a book we can read'), type: 'application/x-mobipocket-ebook' }
}

function bookDto(n: number, user: UserState, full = false) {
  const id = bookId(n)
  return {
    Id: id,
    Name: bookName(n),
    SortName: bookName(n).toLowerCase(),
    ProductionYear: 1980 + (n % 40),
    Type: 'Book',
    Container: bookFormat(n),
    DateCreated: new Date(Date.UTC(2024, 4, 1) + n * 86_400_000).toISOString(),
    Genres: [GENRES[n % 3]],
    ImageTags: { Primary: 'tag1' },
    UserData: userData(id, user),
    ...(full
      ? {
          Overview: `The story of book ${n}.`,
          People: [{ Id: 'au1', Name: `Test Author ${(n % 2) + 1}`, Type: 'Author' }],
          MediaSources: [{ Id: `ms-${id}`, Container: bookFormat(n), Size: 2_400_000 }],
        }
      : {}),
  }
}

function audiobookDto(n: number, user: UserState, full = false) {
  const id = audiobookId(n)
  return {
    Id: id,
    Name: audiobookName(n),
    SortName: audiobookName(n).toLowerCase(),
    ProductionYear: 2000 + (n % 20),
    Type: 'AudioBook',
    Container: 'mp3',
    Artists: [`Test Author ${(n % 2) + 1}`],
    RunTimeTicks: 30 * TICKS,
    DateCreated: new Date(Date.UTC(2024, 5, 1) + n * 86_400_000).toISOString(),
    Genres: [GENRES[n % 3]],
    ImageTags: { Primary: 'tag1' },
    UserData: userData(id, user),
    ...(full ? { Overview: `The audiobook ${n}, read aloud.`, People: [{ Id: 'au1', Name: `Test Author ${(n % 2) + 1}`, Type: 'Author' }] } : {}),
  }
}

// ---- live TV: channels "ch0001"... and their programmes ---------------------------------------------------

const CHANNEL_ID = /^ch\d{4}$/
const channelId = (n: number) => `ch${String(n).padStart(4, '0')}`
const channelName = (n: number) => `Test Channel ${String(n).padStart(2, '0')}`
const SLOT_MS = 30 * 60_000
const CHANNEL_KINDS = ['movies', 'series', 'sports', 'news', 'kids'] as const
/** Channel 1 shows movies, 2 series, 3 sports, 4 news, 5 kids, 6 movies again, and so on. */
const channelKind = (n: number) => CHANNEL_KINDS[(n - 1) % CHANNEL_KINDS.length]
const CHANNEL_KIND_PARAM: Record<string, (typeof CHANNEL_KINDS)[number]> = { isMovie: 'movies', isSeries: 'series', isSports: 'sports', isNews: 'news', isKids: 'kids' }

/** The programme of a channel that starts at a half hour (ms since the epoch). */
function programDto(n: number, startMs: number) {
  const slot = Math.floor(startMs / SLOT_MS)
  return {
    Id: `pg-${channelId(n)}-${slot}`,
    ChannelId: channelId(n),
    Name: `Show ${n}-${slot % 100}`,
    EpisodeTitle: `Episode ${slot % 7}`,
    Overview: `A programme on channel ${n}.`,
    Type: 'Program',
    StartDate: new Date(startMs).toISOString(),
    EndDate: new Date(startMs + SLOT_MS).toISOString(),
    Genres: [GENRES[slot % 3]],
  }
}

/** The programmes of a channel from two hours ago to ten hours ahead, as the guide has them. */
function programsOf(n: number, nowMs: number) {
  const first = Math.floor(nowMs / SLOT_MS) * SLOT_MS - 4 * SLOT_MS
  return Array.from({ length: 24 }, (_, i) => programDto(n, first + i * SLOT_MS))
}

function channelDto(n: number, user: UserState, nowMs = Date.now()) {
  const id = channelId(n)
  return {
    Id: id,
    Name: channelName(n),
    SortName: channelName(n).toLowerCase(),
    ChannelNumber: String(n),
    Type: 'TvChannel',
    ImageTags: n % 2 === 1 ? { Primary: 'tag1' } : {},
    CurrentProgram: programDto(n, Math.floor(nowMs / SLOT_MS) * SLOT_MS),
    UserData: { IsFavorite: user.favorites.has(id), Played: false, PlaybackPositionTicks: 0 },
  }
}

/** Set by `ratings`: the ratings are for the one mock server that is running (a test runs one at a time). */
let withRatings = false
let withTrailers = false
const RATINGS = ['G', 'PG', 'PG-13', 'R']
const ratingOfMovie = (n: number) => RATINGS[n % 4] as string
const ratingOfShow = (n: number) => (n % 2 === 1 ? 'PG' : 'R')
const RATING_VALUE: Record<string, number> = { g: 1, pg: 5, 'pg-13': 7, r: 9, 'tv-ma': 9 }

function movieDto(n: number, user: UserState) {
  const id = movieId(n)
  return {
    Id: id,
    ...(withRatings ? { OfficialRating: ratingOfMovie(n) } : {}),
    Name: `Test Movie ${String(n).padStart(3, '0')}`,
    SortName: `test movie ${String(n).padStart(3, '0')}`,
    ProductionYear: 2000 + (n % 25),
    Type: 'Movie',
    RunTimeTicks: DURATION_SECONDS * TICKS,
    CommunityRating: ((n * 7) % 10) + 0.5,
    DateCreated: new Date(Date.UTC(2024, 0, 1) + n * 86_400_000).toISOString(),
    Genres: [GENRES[n % 3]],
    // Every fourth movie is one the server could not recognise (no provider id).
    ProviderIds: n % 4 === 0 ? {} : { Tmdb: String(1000 + n) },
    Path: `/media/movies/Test Movie ${String(n).padStart(3, '0')} (${2000 + (n % 25)})/Test Movie ${String(n).padStart(3, '0')}.mkv`,
    Tags: n % 4 === 0 ? ['Classic'] : [],
    ImageTags: { Primary: 'tag1' },
    BackdropImageTags: n % 2 === 1 ? ['bd1'] : [],
    Chapters: CHAPTERS,
    UserData: {
      PlaybackPositionTicks: user.resume.get(id) ?? 0,
      Played: user.played.has(id),
      PlayCount: user.plays.get(id) ?? (user.played.has(id) ? 1 : 0),
      IsFavorite: user.favorites.has(id),
      ...(user.likes.has(id) ? { Likes: user.likes.get(id) } : {}),
      LastPlayedDate: lastPlayedDate(id, user),
    },
  }
}

function fullDto(n: number, user: UserState, trickplay = false, versions = false) {
  return {
    ...movieDto(n, user),
    // Ten pictures, one every three seconds, on one sheet of 5 x 2.
    ...(trickplay ? { Trickplay: { [`ms-${movieId(n)}`]: { '160': { Width: 160, Height: 90, TileWidth: 5, TileHeight: 2, ThumbnailCount: 10, Interval: 3000, Bandwidth: 100000 } } } } : {}),
    Overview: `Overview of test movie ${n}. A short synthetic story used only by the mock server.`,
    Taglines: [`Tagline ${n}`],
    OfficialRating: withRatings ? ratingOfMovie(n) : 'PG-13',
    ...(withTrailers
      ? {
          RemoteTrailers: [
            { Url: `https://www.youtube.com/watch?v=trailer${n}a`, Name: `Test Movie ${String(n).padStart(3, '0')} (Official Trailer)` },
            ...(n === 2 ? [{ Url: `https://www.youtube.com/watch?v=trailer${n}b`, Name: 'Teaser' }] : []),
          ],
        }
      : {}),
    CriticRating: 80,
    PremiereDate: '2005-06-01T00:00:00.0000000Z',
    Studios: [{ Name: 'Mock Studios' }],
    People: [
      { Id: 'p1', Name: 'Ada Actor', Role: 'Hero', Type: 'Actor', PrimaryImageTag: 'ptag' },
      { Id: 'p2', Name: 'Bo Actor', Role: 'Sidekick', Type: 'Actor' },
      { Id: 'p3', Name: 'Dee Director', Type: 'Director' },
    ],
    MediaSources: [
      {
        Id: `ms-${movieId(n)}`,
        Container: 'mp4',
        Size: 1_258_774,
        Bitrate: 335_000,
        MediaStreams: STREAMS.map((st) => (st.Type === 'Video' ? { ...st, Width: 1920, Height: 800 } : st)),
      },
      // The same film again, in 4K (only "Test Movie 002", and only when asked for).
      ...(versions && n === 2
        ? [
            {
              Id: `ms-${movieId(n)}-4k`,
              Name: 'Test Movie 002 (4K)',
              Container: 'mkv',
              Size: 9_000_000_000,
              Bitrate: 40_000_000,
              MediaStreams: STREAMS.map((st) => (st.Type === 'Video' ? { ...st, Width: 3840, Height: 1600 } : st)),
            },
          ]
        : []),
    ],
  }
}

const STREAMS = [
  { Index: 0, Type: 'Video', Codec: 'h264', IsDefault: true, DisplayTitle: '180p H264' },
  { Index: 1, Type: 'Audio', Codec: 'aac', Language: 'eng', IsDefault: true, DisplayTitle: 'English - AAC - Stereo' },
  { Index: 2, Type: 'Audio', Codec: 'aac', Language: 'spa', IsDefault: false, DisplayTitle: 'Spanish - AAC - Stereo' },
  {
    Index: 3,
    Type: 'Subtitle',
    Codec: 'subrip',
    Language: 'eng',
    IsDefault: false,
    IsTextSubtitleStream: true,
    DisplayTitle: 'English - SUBRIP',
  },
]

export async function startMockJellyfin(options: MockOptions = {}): Promise<MockServer> {
  const opts = { username: 'tester', password: 'secret', movieCount: 130, playMode: 'direct', seriesCount: 0, animeCount: 0, musicVideos: 0, musicVideoFolders: 0, books: 0, audiobooks: 0, liveTv: 0, musicArtists: 0, collections: 0, ...options } as Required<
    Pick<MockOptions, 'username' | 'password' | 'movieCount' | 'playMode' | 'seriesCount' | 'animeCount' | 'musicVideos' | 'musicVideoFolders' | 'books' | 'audiobooks' | 'liveTv' | 'musicArtists' | 'collections'>
  > &
    MockOptions
  withRatings = opts.ratings === true
  withTrailers = opts.trailers === true
  const requests: RecordedRequest[] = []
  const tokens = new Set<string>()
  const displayPrefs = new Map<string, Record<string, string>>()
  // Playlists of movies and episodes made through the API (the ones of songs are fixed data).
  const videoLists = new Map<string, { id: string; name: string; entries: Array<{ entryId: string; itemId: string }> }>()
  let listCounter = 0
  let entryCounter = 0
  const listDto = (l: { id: string; name: string; entries: unknown[] }) => ({
    Id: l.id,
    Name: l.name,
    Type: 'Playlist',
    MediaType: 'Video',
    ChildCount: l.entries.length,
    ImageTags: l.entries.length > 0 ? { Primary: 'tag1' } : {},
    UserData: { PlaybackPositionTicks: 0, Played: false, IsFavorite: false },
  })
  // What administrators changed: the details of titles (by id), and their pictures (type -> tag, null when removed).
  const edits = new Map<string, Record<string, unknown>>()
  const pictures = new Map<string, Map<string, string | null>>()
  const adminLog: string[] = []
  let pictureCounter = 0
  const deleted = new Set<string>()
  const identified = new Set<string>()
  const basePolicy = (admin: boolean) => ({
    IsAdministrator: admin,
    IsDisabled: false,
    EnableAllFolders: true,
    EnabledFolders: [] as string[],
    EnableMediaPlayback: true,
    EnableAudioPlaybackTranscoding: true,
    EnableVideoPlaybackTranscoding: true,
    EnablePlaybackRemuxing: true,
    MaxParentalRating: null as number | null,
    EnableRemoteAccess: true,
    EnableContentDeletion: false,
    EnableContentDownloading: true,
    MaxActiveSessions: 0,
    AuthenticationProviderId: 'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
    PasswordResetProviderId: 'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
  })
  // A real server's ids are 32 hexadecimal digits; Playback Reporting's queries need one.
  const mainUserId = opts.reporting ? '0123456789abcdef0123456789abcdef' : 'user1'
  const accounts = new Map<string, { id: string; name: string; policy: Record<string, unknown> }>([
    [mainUserId, { id: mainUserId, name: opts.username, policy: basePolicy(opts.admin !== false) }],
    ['user2', { id: 'user2', name: 'guest', policy: basePolicy(false) }],
  ])
  let accountCounter = 2
  const userDto = (a: { id: string; name: string; policy: Record<string, unknown> }) => ({
    Id: a.id,
    Name: a.name,
    ServerId: 'mock',
    HasPassword: true,
    LastActivityDate: '2026-10-21T20:15:00Z',
    Policy: a.policy,
  })
  const devices = new Map<string, { Id: string; Name: string; AppName: string; AppVersion: string; LastUserName: string; DateLastActivity: string; AccessToken: string }>([
    ['dev-tv', { Id: 'dev-tv', Name: 'Living room TV', AppName: 'Jellyflix TV', AppVersion: '0.11.0', LastUserName: 'guest', DateLastActivity: '2026-10-21T21:00:00Z', AccessToken: 'secret-token-tv-zzz1' }],
    ['dev-phone', { Id: 'dev-phone', Name: 'Old phone', AppName: 'Jellyfin Android', AppVersion: '2.6.0', LastUserName: 'guest', DateLastActivity: '2026-08-01T10:00:00Z', AccessToken: 'secret-token-phone-zzz2' }],
  ])
  const apiKeys = new Map<string, { AccessToken: string; AppName: string; DateCreated: string; DateLastActivity: string }>([
    ['k1', { AccessToken: 'apikey-0123456789-ab12', AppName: 'Home Assistant', DateCreated: '2026-03-01T10:00:00Z', DateLastActivity: '2026-10-21T18:00:00Z' }],
    ['k2', { AccessToken: 'apikey-9876543210-cd34', AppName: 'Old script', DateCreated: '2025-01-01T10:00:00Z', DateLastActivity: '2025-02-01T10:00:00Z' }],
  ])
  const activity = Array.from({ length: 45 }, (_, i) => ({
    Id: 45 - i,
    Name: i % 3 === 0 ? `guest signed in from Living room TV` : i % 3 === 1 ? `Test Movie ${String(i).padStart(3, '0')} played by tester` : `Scheduled task "Scan Media Library" completed`,
    ShortOverview: i % 3 === 0 ? 'Jellyflix TV 0.11.0' : i % 3 === 1 ? 'Chrome' : '12 seconds',
    Type: i % 3 === 0 ? 'SessionStarted' : i % 3 === 1 ? 'VideoPlayback' : 'ScheduledTaskCompleted',
    Date: new Date(Date.UTC(2026, 9, 22, 12, 0, 0) - i * 3_600_000).toISOString(),
    Severity: i % 10 === 0 ? 'Warning' : 'Information',
  }))
  const withEdits = <T extends { Id?: string }>(dto: T): T => {
    const id = dto?.Id
    if (!id) return dto
    const out = { ...dto } as Record<string, unknown>
    const edit = edits.get(id)
    if (edit) {
      for (const key of EDITABLE_KEYS) {
        if (!(key in edit)) continue
        if (edit[key] === null || edit[key] === undefined) delete out[key]
        else out[key] = edit[key]
      }
    }
    if (identified.has(id)) out.ProviderIds = { Tmdb: '603' }
    const changed = pictures.get(id)
    if (changed) {
      const tags = { ...((out.ImageTags as Record<string, string> | undefined) ?? {}) }
      for (const [type, tag] of changed) {
        if (type === 'Backdrop') out.BackdropImageTags = tag ? [tag] : []
        else if (tag) tags[type] = tag
        else delete tags[type]
      }
      out.ImageTags = tags
    }
    return out as T
  }
  /** The pictures a title has, as /Items/{id}/Images lists them. */
  const imageInfos = (id: string) => {
    const dto = withEdits(dtoFor(id, user, opts) as { Id?: string; ImageTags?: Record<string, string>; BackdropImageTags?: string[] })
    const infos: Array<Record<string, unknown>> = []
    for (const [type, tag] of Object.entries(dto.ImageTags ?? {})) infos.push({ ImageType: type, ImageIndex: 0, ImageTag: tag, Width: 600, Height: 900, Size: 48_000 })
    for (const [index, tag] of (dto.BackdropImageTags ?? []).entries()) infos.push({ ImageType: 'Backdrop', ImageIndex: index, ImageTag: tag, Width: 1920, Height: 1080, Size: 160_000 })
    return infos
  }
  const resume = new Map<string, number>()
  const user: UserState = { resume, played: new Set(), favorites: new Set(), likes: new Map(), plays: new Map(), lastPlayed: [] }
  let tokenCounter = 0
  let flakyHits = 0
  let playSessionCounter = 0
  const savedLyrics = new Set<string>()
  // Subtitles saved from the internet: how many each video has now (each is one more text track).
  const savedSubtitles = new Map<string, number>()
  let delayMs = 0
  let apiInFlight = 0
  let peakApi = 0
  const quickConnectCodes = new Map<string, { secret: string; approved: boolean }>()
  const remoteLog: string[] = []
  const taskLog: string[] = []
  const reportingQueries: string[] = []
  const runningTasks = new Set<string>()
  const remoteState = new Map<string, Record<string, unknown>>()
  if (options.adminSessions)
    remoteState.set('kitchen-session', {
      NowPlayingItem: { Id: 'm0002', Name: 'Test Movie 002', RunTimeTicks: 30 * TICKS },
      PlayState: { PositionTicks: 5 * TICKS, IsPaused: false },
      TranscodingInfo: { IsVideoDirect: false, IsAudioDirect: true, Bitrate: 4_000_000, TranscodeReasons: ['ContainerBitrateExceedsLimit'] },
    })
  // Signed-in clients by token, so other devices can see what each is playing and, with an open socket, control it.
  const sessions = new Map<string, MockSession>()
  const peers = new Set<Duplex>()
  const socketLog: string[] = []
  const openSession = (accessToken: string, authorization: string) => {
    // Like Jellyfin, read the values the way they were written into the header (percent-encoded).
    const field = (name: string) => decodeURIComponent(new RegExp(`${name}="([^"]*)"`).exec(authorization)?.[1] ?? '')
    const deviceId = field('DeviceId') || `device-${accessToken}`
    sessions.set(accessToken, {
      id: `web-${deviceId}`,
      deviceId,
      deviceName: field('Device') || 'Web browser',
      client: field('Client') || 'Jellyflix Web',
      positionTicks: 0,
      paused: false,
    })
  }
  const sessionById = (id: string) => [...sessions.values()].find((s) => s.id === id)
  const sessionByDeviceId = (id: string) => [...sessions.values()].find((s) => s.deviceId === id)
  const nowPlayingItem = (id: string) => {
    const dto = dtoFor(id, user, opts) as { Name?: string; SeriesName?: string; RunTimeTicks?: number } | undefined
    return {
      Id: id,
      Name: dto?.Name ?? id,
      SeriesName: dto?.SeriesName,
      RunTimeTicks: dto?.RunTimeTicks ?? DURATION_SECONDS * TICKS,
      MediaType: TRACK_ID.test(id) || AUDIOBOOK_ID.test(id) ? 'Audio' : 'Video',
    }
  }

  // ---- watch together: the groups the server keeps ---------------------------------------------------------------
  const serverNow = () => Date.now() + (opts.syncSkewMs ?? 0)
  const groups = new Map<string, MockGroup>()
  let groupCount = 0
  let playlistCount = 0
  const groupOf = (token: string) => [...groups.values()].find((g) => g.members.has(token))
  const groupInfo = (g: MockGroup) => ({ GroupId: g.id, GroupName: g.name, State: g.state, Participants: [...g.members].map(() => opts.username), LastUpdatedAt: new Date(serverNow()).toISOString() })
  const tell = (tokens: Iterable<string>, type: string, data: unknown) => {
    for (const member of tokens) sessions.get(member)?.peer?.send(JSON.stringify({ MessageType: type, Data: data }))
  }
  const sendUpdate = (g: MockGroup, tokens: Iterable<string>, type: string, data: unknown) => tell(tokens, 'SyncPlayGroupUpdate', { GroupId: g.id, Type: type, Data: data })
  const sendState = (g: MockGroup, state: string, reason: string) => sendUpdate(g, g.members, 'StateUpdate', { State: state, Reason: reason, PositionTicks: g.positionTicks })
  const sendQueue = (g: MockGroup, tokens: Iterable<string>, reason: string, startTicks: number) =>
    sendUpdate(g, tokens, 'PlayQueue', {
      Reason: reason,
      LastUpdate: new Date(serverNow()).toISOString(),
      Playlist: g.itemIds.map((ItemId, i) => ({ ItemId, PlaylistItemId: g.playlistItemIds[i] })),
      PlayingItemIndex: g.index,
      StartPositionTicks: startTicks,
      IsPlaying: false,
      ShuffleMode: 'Sorted',
      RepeatMode: 'RepeatNone',
    })
  const broadcast = (g: MockGroup, command: string, whenMs: number, positionTicks: number) =>
    tell(g.members, 'SyncPlayCommand', {
      GroupId: g.id,
      PlaylistItemId: g.playlistItemIds[g.index] ?? '',
      When: new Date(whenMs).toISOString(),
      PositionTicks: positionTicks,
      Command: command,
      EmittedAt: new Date(serverNow()).toISOString(),
    })
  /** Where the title is by now, in ticks: it moves on from where it started while the group plays. */
  const positionNow = (g: MockGroup) => (g.state === 'Playing' ? g.positionTicks + Math.max(0, serverNow() - g.positionAt) * 10_000 : g.positionTicks)
  /** Everyone starts at one moment a little ahead (so that every device has the command before it). */
  const startPlaying = (g: MockGroup) => {
    const when = serverNow() + 400
    g.state = 'Playing'
    g.wantPlaying = true
    g.positionAt = when
    sendState(g, 'Playing', 'Unpause')
    broadcast(g, 'Unpause', when, g.positionTicks)
  }
  const resumeIfReady = (g: MockGroup) => {
    if (g.state !== 'Waiting') return
    if ([...g.notReady].some((member) => g.members.has(member) && !g.ignoring.has(member))) return
    if (g.wantPlaying) return startPlaying(g)
    g.state = 'Paused'
    sendState(g, 'Paused', 'Ready')
    broadcast(g, 'Pause', serverNow(), g.positionTicks)
  }
  const leaveSync = (member: string) => {
    const g = groupOf(member)
    if (!g) return
    g.members.delete(member)
    g.notReady.delete(member)
    g.ignoring.delete(member)
    sendUpdate(g, [member], 'GroupLeft', g.id)
    if (g.members.size === 0) groups.delete(g.id)
    else {
      sendUpdate(g, g.members, 'UserLeft', opts.username)
      resumeIfReady(g)
    }
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock')
    const path = url.pathname
    const query = Object.fromEntries(url.searchParams)
    const list = (name: string): string[] | undefined => {
      const values = url.searchParams.getAll(name).flatMap((v) => v.split(','))
      return values.length ? values : undefined
    }
    const queryAll: Record<string, string[]> = {}
    for (const key of new Set(url.searchParams.keys())) queryAll[key] = url.searchParams.getAll(key)

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': String(req.headers['access-control-request-headers'] ?? '*'),
      })
      res.end()
      return
    }

    const header = String(req.headers.authorization ?? '')
    const headerToken = /Token="([^"]+)"/.exec(header)?.[1]
    const queryToken = query.ApiKey ?? query.api_key
    const auth: RecordedRequest['auth'] = headerToken ? 'header' : queryToken ? 'query' : 'none'
    const token = headerToken ?? queryToken
    const authed = token !== undefined && tokens.has(token)

    const rec: RecordedRequest = { method: req.method ?? 'GET', path, query, queryAll, auth, range: req.headers.range, status: 0 }
    requests.push(rec)
    res.on('finish', () => {
      rec.status = res.statusCode
    })

    const needAuth = (allowHeader = true): boolean => {
      const ok = authed && (allowHeader || auth === 'query')
      if (!ok) res.writeHead(401).end()
      return ok
    }

    // Administrators only: answers 403 to anyone else, like the real server.
    const adminGate = (): boolean => {
      if (!needAuth()) return false
      if (opts.admin === false) {
        res.writeHead(403).end()
        return false
      }
      return true
    }
    const body = req.method === 'POST' ? await readBody(req) : undefined
    rec.body = body

    if (req.method === 'GET' && !/\/Images\/|\/stream|\.m3u8|\.ts$/i.test(path)) {
      apiInFlight += 1
      peakApi = Math.max(peakApi, apiInFlight)
      res.once('close', () => {
        apiInFlight -= 1
      })
    }
    if (delayMs > 0 && !/\/Images\/|\/stream|\.m3u8|\.ts$/i.test(path)) await new Promise((resolve) => setTimeout(resolve, delayMs))

    if (opts.flaky && path === opts.flaky.path && flakyHits < opts.flaky.times) {
      flakyHits += 1
      if (opts.flaky.status === 'drop') req.socket.destroy()
      else res.writeHead(opts.flaky.status).end()
      return
    }

    // --- public -------------------------------------------------------------------------
    if (path === '/System/Info/Public') {
      return json(res, 200, { ServerName: 'Mock Jellyfin', Version: '12.2.0', ProductName: 'Jellyfin Server', Id: 'mock' })
    }
    if (path === '/Users/AuthenticateByName' && req.method === 'POST') {
      const b = body as { Username?: string; Pw?: string } | undefined
      if (!header.startsWith('MediaBrowser ') || b?.Username !== opts.username || b?.Pw !== opts.password) {
        res.writeHead(401).end()
        return
      }
      const accessToken = `token-${(tokenCounter += 1)}`
      tokens.add(accessToken)
      openSession(accessToken, header)
      return json(res, 200, {
        User: { Id: mainUserId, Name: opts.username },
        AccessToken: accessToken,
        SessionInfo: { Id: `session-${tokenCounter}` },
      })
    }
    // Pictures a provider offers (the server would hand out its own addresses; here they are on the mock).
    const remotePicture = /^\/remote\/(\w+)\/(\d+)$/.exec(path)
    if (remotePicture) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#a43"/><text x="20" y="150" fill="#fff">${remotePicture[1]} ${remotePicture[2]}</text></svg>`
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(svg)
      return
    }
    const image = /^\/Items\/([^/]+)\/Images\/(?:Primary|Backdrop|Logo|Thumb)$/.exec(path)
    if (image && req.method === 'GET') {
      // An album cover has colours of its own (a main one and a band of another along the bottom), the others are a flat dark blue.
      const album = ALBUM_ID.exec(image[1] as string)
      if (album) {
        const hue = (Number(album[1]) * 97 + Number(album[2]) * 53) % 360
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${hue} 70% 45%)"/><rect y="130" width="200" height="70" fill="hsl(${(hue + 150) % 360} 70% 45%)"/></svg>`
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(svg)
        return
      }
      const svg =`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#334"/><text x="20" y="150" fill="#fff">${image[1]}</text><text x="20" y="180" fill="#9cf">${(query.tag ?? '').replace(/[^\w-]/g, '')}</text></svg>`
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(svg)
      return
    }

    const trickplaySheet = /^\/Videos\/([^/]+)\/Trickplay\/(\d+)\/(\d+)\.jpg$/.exec(path)
    if (trickplaySheet) {
      if (!needAuth()) return
      // A sheet that needs the Authorization header, like the real thing: ten pictures numbered 0 to 9.
      if (auth !== 'header') return void res.writeHead(401).end()
      const cells = Array.from({ length: 10 }, (_, i) => `<rect x="${(i % 5) * 160}" y="${Math.floor(i / 5) * 90}" width="160" height="90" fill="hsl(${i * 36} 60% 40%)"/><text x="${(i % 5) * 160 + 70}" y="${Math.floor(i / 5) * 90 + 55}" fill="#fff" font-size="32">${i}</text>`).join('')
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="180">${cells}</svg>`)
      return
    }

    // --- Quick Connect ------------------------------------------------------------------
    if (path === '/QuickConnect/Enabled') return json(res, 200, opts.quickConnect !== false)
    if (path === '/QuickConnect/Initiate' && req.method === 'POST') {
      if (opts.quickConnect === false) {
        res.writeHead(401).end()
        return
      }
      const n = quickConnectCodes.size + 1
      const code = String(100_000 + n * 111).slice(0, 6)
      const secret = `qc-secret-${n}`
      quickConnectCodes.set(code, { secret, approved: false })
      return json(res, 200, { Code: code, Secret: secret, Authenticated: false })
    }
    if (path === '/QuickConnect/Connect') {
      const found = [...quickConnectCodes.values()].find((c) => c.secret === query.secret)
      if (!found) {
        res.writeHead(404).end()
        return
      }
      return json(res, 200, { Authenticated: found.approved, Secret: found.secret })
    }
    if (path === '/QuickConnect/Authorize' && req.method === 'POST') {
      if (!needAuth()) return
      const found = quickConnectCodes.get(query.code ?? '')
      if (!found) {
        res.writeHead(404).end()
        return
      }
      found.approved = true
      return json(res, 200, true)
    }
    if (path === '/Users/AuthenticateWithQuickConnect' && req.method === 'POST') {
      const secret = (body as { Secret?: string } | undefined)?.Secret
      const found = [...quickConnectCodes.values()].find((c) => c.secret === secret)
      if (!found || !found.approved) {
        res.writeHead(401).end()
        return
      }
      const accessToken = `token-${(tokenCounter += 1)}`
      tokens.add(accessToken)
      openSession(accessToken, header)
      return json(res, 200, { User: { Id: mainUserId, Name: opts.username }, AccessToken: accessToken, SessionInfo: { Id: `session-${tokenCounter}` } })
    }

    // --- Controllable devices ("Play on the TV") ----------------------------------------------------
    if (path === '/Sessions' && req.method === 'GET') {
      if (!needAuth()) return
      const devices = opts.remoteDevices ?? [{ id: 'tv-session', name: 'Living room TV', client: 'Jellyflix TV' }]
      return json(
        res,
        200,
        [
          ...devices.map((d) => ({
            Id: d.id,
            DeviceId: `device-${d.id}`,
            DeviceName: d.name,
            Client: d.client ?? 'Jellyflix TV',
            UserName: d.id === 'kitchen-session' ? 'guest' : opts.username,
            LastActivityDate: '2026-10-22T18:00:00Z',
            SupportsRemoteControl: true,
            PlayableMediaTypes: ['Video', 'Audio'],
            ...(remoteState.get(d.id) ?? {}),
          })),
          // Browsers signed in as this account: controllable once their socket is open, and showing what they play.
          ...[...sessions.values()].map((s) => ({
            Id: s.id,
            DeviceId: s.deviceId,
            DeviceName: s.deviceName,
            Client: s.client,
            SupportsRemoteControl: s.peer !== undefined,
            PlayableMediaTypes: ['Video', 'Audio'],
            ...(s.itemId
              ? {
                  NowPlayingItem: nowPlayingItem(s.itemId),
                  PlayState: { PositionTicks: s.positionTicks, IsPaused: s.paused },
                }
              : {}),
          })),
          ...(opts.adminSessions ? [{ Id: 'kitchen-session', DeviceId: 'device-kitchen', DeviceName: 'Kitchen tablet', Client: 'Jellyfin Android', UserName: 'guest', LastActivityDate: '2026-10-22T18:00:00Z', SupportsRemoteControl: true, PlayableMediaTypes: ['Video'], ...(remoteState.get('kitchen-session') ?? {}) }] : []),
          // A session that cannot be controlled (this very browser, an old sign-in) must never be offered.
          { Id: 'browser-session', DeviceId: 'device-browser', DeviceName: 'Chrome', Client: 'Jellyflix Web', SupportsRemoteControl: false },
        ],
      )
    }
    const sendMessage = /^\/Sessions\/([^/]+)\/Message$/.exec(path)
    if (sendMessage && req.method === 'POST') {
      if (!adminGate()) return
      const b = (body ?? {}) as { Text?: string }
      if (!b.Text) return void res.writeHead(400).end()
      adminLog.push(`message ${sendMessage[1]} ${b.Text}`)
      return void res.writeHead(204).end()
    }
    const remote = /^\/Sessions\/([^/]+)\/Playing(?:\/([A-Za-z]+))?$/.exec(path)
    if (remote && req.method === 'POST') {
      if (!needAuth()) return
      const sessionId = remote[1] as string
      const command = remote[2]
      const browser = sessionById(sessionId)
      if (browser) {
        if (!browser.peer) {
          res.writeHead(404).end()
          return
        }
        if (!command) {
          const ids = String(query.itemIds ?? '')
          remoteLog.push(`${sessionId} play ${ids} from ${query.startPositionTicks ?? 0}`)
          browser.peer.send(
            JSON.stringify({
              MessageType: 'Play',
              Data: {
                ItemIds: ids.split(','),
                PlayCommand: query.playCommand ?? 'PlayNow',
                StartIndex: Number(query.startIndex ?? 0),
                StartPositionTicks: Number(query.startPositionTicks ?? 0),
              },
            }),
          )
        } else {
          remoteLog.push(`${sessionId} ${command}${query.seekPositionTicks ? ` ${query.seekPositionTicks}` : ''}`)
          browser.peer.send(JSON.stringify({ MessageType: 'Playstate', Data: { Command: command, SeekPositionTicks: Number(query.seekPositionTicks ?? 0) } }))
        }
        res.writeHead(204).end()
        return
      }
      if (!command) {
        const ids = String(query.itemIds ?? '')
        remoteLog.push(`${sessionId} play ${ids} from ${query.startPositionTicks ?? 0}`)
        remoteState.set(sessionId, {
          NowPlayingItem: { Id: ids.split(',')[0], Name: `Now playing ${ids}`, RunTimeTicks: 600 * TICKS },
          PlayState: { PositionTicks: Number(query.startPositionTicks ?? 0), IsPaused: false },
        })
      } else {
        remoteLog.push(`${sessionId} ${command}${query.seekPositionTicks ? ` ${query.seekPositionTicks}` : ''}`)
        const state = remoteState.get(sessionId) as { PlayState?: { IsPaused: boolean; PositionTicks: number } } | undefined
        if (state?.PlayState) {
          if (command === 'Pause') state.PlayState.IsPaused = true
          if (command === 'Unpause') state.PlayState.IsPaused = false
          if (command === 'Seek') state.PlayState.PositionTicks = Number(query.seekPositionTicks ?? 0)
        }
        if (command === 'Stop') remoteState.delete(sessionId)
      }
      res.writeHead(204).end()
      return
    }

    if (path === '/Sessions/Capabilities/Full' && req.method === 'POST') {
      if (!needAuth()) return
      res.writeHead(204).end()
      return
    }

    // --- authenticated JSON API ---------------------------------------------------------
    if (path === '/Users/Me') {
      if (!needAuth()) return
      return json(res, 200, { Id: mainUserId, Name: opts.username, Policy: { IsAdministrator: (accounts.get(mainUserId)?.policy.IsAdministrator as boolean) !== false && opts.admin !== false } })
    }
    // --- Administration: accounts, libraries, devices, keys, activity (403 unless an administrator) ----
    if (path === '/Users' && req.method === 'GET') {
      if (!adminGate()) return
      return json(res, 200, [...accounts.values()].map(userDto))
    }
    if (path === '/Users/New' && req.method === 'POST') {
      if (!adminGate()) return
      const b = (body ?? {}) as { Name?: string; Password?: string }
      const name = (b.Name ?? '').trim()
      if (!name || !b.Password || [...accounts.values()].some((a) => a.name.toLowerCase() === name.toLowerCase())) return void res.writeHead(400).end()
      accountCounter += 1
      const account = { id: `user${accountCounter}`, name, policy: basePolicy(false) }
      accounts.set(account.id, account)
      adminLog.push(`create-user ${name}`) // never the password
      return json(res, 200, userDto(account))
    }
    // (The server takes the account in the query: POST /Users/Password?userId=...)
    if (path === '/Users/Password' && req.method === 'POST') {
      if (!adminGate()) return
      const target = accounts.get(query.userId ?? '')
      if (!target) return void res.writeHead(404).end()
      if (!(body as { NewPw?: string } | undefined)?.NewPw) return void res.writeHead(400).end()
      adminLog.push(`password ${target.id}`) // never the password
      return void res.writeHead(204).end()
    }
    const account = /^\/Users\/([^/]+)(?:\/(Policy))?$/.exec(path)
    if (account && account[1] !== 'Me' && account[1] !== 'New' && account[1] !== 'Password') {
      if (!adminGate()) return
      const target = accounts.get(account[1] as string)
      if (!target) return void res.writeHead(404).end()
      if (!account[2] && req.method === 'GET') return json(res, 200, userDto(target))
      if (account[2] === 'Policy' && req.method === 'POST') {
        if (!body || typeof body !== 'object') return void res.writeHead(400).end()
        target.policy = { ...target.policy, ...(body as Record<string, unknown>) }
        adminLog.push(`policy ${target.id}`)
        return void res.writeHead(204).end()
      }
    }
    if (path === '/Localization/ParentalRatings') {
      if (!needAuth()) return
      return json(res, 200, [{ Name: 'G', Value: 1 }, { Name: 'PG', Value: 5 }, { Name: 'PG-13', Value: 7 }, { Name: 'R', Value: 9 }, { Name: 'TV-MA', Value: 9 }])
    }
    if (path === '/Library/VirtualFolders') {
      if (!adminGate()) return
      const folder = (ItemId: string, Name: string, CollectionType: string, location: string) => ({ ItemId, Name, CollectionType, Locations: [location], RefreshStatus: 'Idle' })
      const folders = [
        ...(opts.noMovieLibrary ? [] : [folder('lib-movies', 'Movies', 'movies', '/media/movies')]),
        ...(opts.noTvLibrary ? [] : [folder('lib-shows', 'Shows', 'tvshows', '/media/shows')]),
        ...(opts.animeCount > 0 ? [folder('lib-anime', 'Anime', 'tvshows', '/media/anime')] : []),
        ...(opts.musicVideos > 0 ? [folder('lib-musicvideos', 'Music videos', 'musicvideos', '/media/musicvideos')] : []),
        ...(opts.books + opts.audiobooks > 0 ? [folder('lib-books', 'Books', 'books', '/media/books')] : []),
        ...(opts.liveTv > 0 ? [folder('lib-livetv', 'Live TV', 'livetv', '/media/livetv')] : []),
        ...(opts.musicArtists > 0 ? [folder(MUSIC_LIBRARY, 'Music', 'music', '/media/music')] : []),
      ]
      return json(res, 200, folders)
    }
    if (path === '/Library/Refresh' && req.method === 'POST') {
      if (!adminGate()) return
      adminLog.push('scan all')
      return void res.writeHead(204).end()
    }
    if (path === '/Devices') {
      if (!adminGate()) return
      if (req.method === 'DELETE') {
        const id = query.id ?? ''
        if (!devices.delete(id) && !sessionByDeviceId(id)) return void res.writeHead(404).end()
        adminLog.push(`remove-device ${id}`)
        return void res.writeHead(204).end()
      }
      const own = [...sessions.values()].map((s) => ({ Id: s.deviceId, Name: s.deviceName, AppName: s.client, AppVersion: '0.11.0', LastUserName: opts.username, DateLastActivity: '2026-10-22T18:00:00Z', AccessToken: 'secret-token-own-zzz3' }))
      const items = [...devices.values(), ...own]
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    if (path === '/Auth/Keys') {
      if (!adminGate()) return
      const items = [...apiKeys.values()]
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    const keyRoute = /^\/Auth\/Keys\/([^/]+)$/.exec(path)
    if (keyRoute && req.method === 'DELETE') {
      if (!adminGate()) return
      const found = [...apiKeys.entries()].find(([, k]) => k.AccessToken === decodeURIComponent(keyRoute[1] as string))
      if (!found) return void res.writeHead(404).end()
      apiKeys.delete(found[0])
      adminLog.push(`revoke-key ${found[1].AccessToken.slice(-4)}`) // never the whole key
      return void res.writeHead(204).end()
    }
    if (path === '/System/ActivityLog/Entries') {
      if (!adminGate()) return
      const start = Number(query.startIndex ?? 0)
      const limit = Number(query.limit ?? 30)
      return json(res, 200, { Items: activity.slice(start, start + limit), TotalRecordCount: activity.length, StartIndex: start })
    }
    if (path === '/System/Info') {
      if (!adminGate()) return
      return json(res, 200, { ServerName: 'Mock Jellyfin', Version: '12.2.0', OperatingSystemDisplayName: 'Linux', HasUpdateAvailable: true, HasPendingRestart: false, IsShuttingDown: false })
    }
    // --- Playback Reporting: a read-only query on its table (administrators only) -------------------
    if (path === '/user_usage_stats/submit_custom_query' && req.method === 'POST') {
      if (!opts.reporting) return void res.writeHead(404).end()
      if (!needAuth()) return
      if (opts.admin === false) return void res.writeHead(403).end()
      const sql = String((body as { CustomQueryString?: string } | undefined)?.CustomQueryString ?? '')
      reportingQueries.push(sql)
      const table = (colums: string[], results: string[][]) => json(res, 200, results.length ? { colums, results, message: '' } : { colums: [], results: [], message: 'Query executed, no data returned.' })
      const none = opts.reporting === 'empty'
      if (sql.includes('MIN(DateCreated)')) return table(['MIN(DateCreated)'], none ? [['']] : [['2026-08-14 20:05:11.0000000']])
      if (sql.includes('COUNT(*), SUM(PlayDuration)') && !sql.includes('GROUP BY')) return table(['c', 's'], none ? [['0', '']] : [['5', '14400']])
      if (none) return table([], [])
      if (sql.includes('substr(DateCreated, 1, 7)')) return table(['m', 'c', 's'], [['2026-09', '2', '5400'], ['2026-10', '3', '9000']])
      if (sql.includes('substr(DateCreated, 12, 2)')) return table(['h', 's'], [['20', '9000'], ['21', '5400']])
      if (sql.includes('strftime')) return table(['d', 's'], [['5', '9000'], ['6', '5400']])
      if (sql.includes('DeviceName')) return table(['d', 'c', 'n', 's'], [['Living room TV', 'Jellyflix TV', '3', '9000'], ['Phone', 'Jellyflix', '2', '5400']])
      if (sql.includes('PlaybackMethod')) return table(['p', 's'], [['DirectPlay', '10800'], ['Transcode (v:h264 a:aac)', '3600']])
      return table([], [])
    }
    // --- Plugins and their scheduled tasks (what an administrator sees) -----------------------------
    if (path === '/Plugins' || path.startsWith('/ScheduledTasks') || path.startsWith('/Intros/')) {
      if (!needAuth()) return
      if (opts.admin === false) return void res.writeHead(403).end()
      if (path === '/Plugins') {
        return json(res, 200, [
          { Id: 'p-intro', Name: 'Intro Skipper', Version: '12.0.5.0', Status: 'Active' },
          { Id: 'p-lyrics', Name: 'Lyrics', Version: '1.7.2.0', Status: 'Active' },
          { Id: 'p-tmdb', Name: 'TMDb', Version: '12.2.0.0', Status: 'Active' },
          { Id: 'p-boxsets', Name: 'TMDb Box Sets', Version: '15.0.0.0', Status: 'Active' },
          { Id: 'p-fanart', Name: 'Fanart', Version: '15.0.0.0', Status: 'Active' },
          { Id: 'p-anilist', Name: 'AniList', Version: '15.0.0.0', Status: 'Active' },
          { Id: 'p-reporting', Name: 'Playback Reporting', Version: '19.0.0.0', Status: 'Active' },
        ])
      }
      if (path === '/ScheduledTasks' && req.method === 'GET') {
        const task = (Id: string, Name: string, Category: string) => ({
          Id,
          Name,
          Category,
          Description: `${Name} (mock)`,
          State: runningTasks.has(Id) ? 'Running' : 'Idle',
          CurrentProgressPercentage: runningTasks.has(Id) ? 12.4 : undefined,
          LastExecutionResult: runningTasks.has(Id) ? undefined : { Status: 'Completed', EndTimeUtc: '2026-10-19T14:33:45Z' },
        })
        return json(res, 200, [
          task('t-analyze', 'Detect and Analyze Media Segments', 'Intro Skipper'),
          task('t-lyrics', 'Download and upgrade lyrics', 'Library'),
          task('t-scan', 'Scan Media Library', 'Library'),
          // As on a real server: the plugin's category is its own name, and Fanart and AniList have no tasks.
          task('t-boxsets', 'Scan library for new box sets', 'TMDb'),
          task('t-backup', 'Playback Reporting Run Backup', 'Playback Reporting'),
          task('t-trim', 'Playback Reporting Trim Db', 'Playback Reporting'),
          task('t-refresh-people', 'Refresh upcoming and missing episodes (TheMovieDb)', 'Library'),
        ])
      }
      const running = /^\/ScheduledTasks\/Running\/([^/]+)$/.exec(path)
      if (running && req.method === 'POST') {
        taskLog.push(`start ${running[1]}`)
        runningTasks.add(running[1] as string)
        return void res.writeHead(204).end()
      }
      if (running && req.method === 'DELETE') {
        taskLog.push(`stop ${running[1]}`)
        runningTasks.delete(running[1] as string)
        return void res.writeHead(204).end()
      }
      const scan = /^\/Intros\/ScanSeason\/([^/]+)\/([^/]+)$/.exec(path)
      if (scan && req.method === 'POST') {
        taskLog.push(`scan ${scan[2]}`)
        return void res.writeHead(202).end()
      }
      const scanStatus = /^\/Intros\/ScanStatus\/([^/]+)$/.exec(path)
      if (scanStatus) {
        return json(res, 200, { isRunning: taskLog.includes(`scan ${scanStatus[1]}`), isQueued: false, failed: false })
      }
      return void res.writeHead(404).end()
    }
    if (path === '/Sessions/Logout' && req.method === 'POST') {
      if (!needAuth()) return
      if (token) tokens.delete(token)
      res.writeHead(204).end()
      return
    }
    if (path === '/UserViews') {
      if (!needAuth()) return
      const items: Array<{ Id: string; Name: string; CollectionType: string }> = opts.noTvLibrary ? [] : [{ Id: 'lib-shows', Name: 'Shows', CollectionType: 'tvshows' }]
      if (opts.animeCount > 0) items.push({ Id: 'lib-anime', Name: 'Anime', CollectionType: 'tvshows' })
      if (opts.musicVideos > 0) items.push({ Id: 'lib-musicvideos', Name: 'Music videos', CollectionType: 'musicvideos' })
      if (opts.books + opts.audiobooks > 0) items.push({ Id: 'lib-books', Name: 'Books', CollectionType: 'books' })
      if (opts.liveTv > 0) items.push({ Id: 'lib-livetv', Name: 'Live TV', CollectionType: 'livetv' })
      if (opts.musicArtists > 0) items.push({ Id: MUSIC_LIBRARY, Name: 'Music', CollectionType: 'music' })
      if (!opts.noMovieLibrary) items.unshift({ Id: 'lib-movies', Name: 'Movies', CollectionType: 'movies' })
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    if (path === '/Items') {
      if (!needAuth()) return
      const ids = list('ids')
      if (ids?.some((id) => TRACK_ID.test(id)) && !list('includeItemTypes')) {
        const found = ids.map((id) => dtoFor(id, user, opts)).filter((dto) => dto !== undefined)
        return json(res, 200, { Items: found, TotalRecordCount: found.length, StartIndex: 0 })
      }
      // Like Jellyfin: looking items up by id works for every type; browsing needs a type (the client always sends one).
      const types = list('includeItemTypes') ?? (ids ? ['Movie', 'Series', 'Season', 'Episode', 'MusicVideo', 'Folder', 'Book', 'AudioBook'] : ['Movie'])
      interface Row {
        id: string
        name: string
        lib: string
        genre?: string
        year: number
        created: number
        rating: number
        backdrop: boolean
        /** Music: what kind of item, which album/artists it belongs to, and its order in the album. */
        type?: string
        parent?: string
        /** Music videos and their folders: the folder (or library) that holds it. */
        mvParent?: string
        artistIds?: string[]
        artist?: string
        album?: string
        number?: number
        /** A ready-made answer (the playlists made through the API). */
        dto?: unknown
        /** Who is credited, for the person filter. */
        people: string[]
        /** For the advanced filters. */
        official?: string
        tags?: string[]
        uhd?: boolean
      }
      const rows: Row[] = []
      if (types.includes('Movie')) {
        for (let n = 1; n <= opts.movieCount; n += 1) {
          rows.push({
            id: movieId(n),
            name: `test movie ${String(n).padStart(3, '0')}`,
            lib: 'lib-movies',
            genre: GENRES[n % 3],
            year: 2000 + (n % 25),
            created: n,
            rating: ((n * 7) % 10) + 0.5,
            backdrop: n % 2 === 1,
            people: ['p1'],
            official: n % 2 === 0 ? 'PG-13' : 'R',
            tags: n % 4 === 0 ? ['Classic'] : [],
            uhd: n % 5 === 0,
          })
        }
      }
      if (types.includes('Folder') && opts.musicVideoFolders > 0) {
        const folderIds = [...Array.from({ length: opts.musicVideoFolders }, (_, i) => mvFolderId(i + 1)), ...(opts.musicVideoFolders >= 2 ? [MV_NESTED] : [])]
        for (const id of folderIds) {
          rows.push({ id, name: mvFolderName(id).toLowerCase(), lib: 'lib-musicvideos', mvParent: mvFolderParent(id), type: 'Folder', year: 0, created: 0, rating: 0, backdrop: false, people: [] })
        }
      }
      if (types.includes('MusicVideo')) {
        for (let n = 1; n <= opts.musicVideos; n += 1) {
          rows.push({
            id: musicVideoId(n),
            mvParent: musicVideoParent(n, opts.musicVideos, opts.musicVideoFolders),
            type: 'MusicVideo',
            name: musicVideoName(n).toLowerCase(),
            lib: 'lib-musicvideos',
            genre: GENRES[n % 3],
            year: 1990 + (n % 30),
            created: n,
            rating: 0,
            backdrop: false,
            people: [],
          })
        }
      }
      for (const [type, count, idOf, nameOf] of [
        ['Book', opts.books, bookId, bookName],
        ['AudioBook', opts.audiobooks, audiobookId, audiobookName],
      ] as const) {
        if (!types.includes(type)) continue
        for (let n = 1; n <= count; n += 1) {
          rows.push({ id: idOf(n), name: nameOf(n).toLowerCase(), lib: 'lib-books', genre: GENRES[n % 3], year: (type === 'Book' ? 1980 : 2000) + (n % (type === 'Book' ? 40 : 20)), created: n, rating: 0, backdrop: false, people: [] })
        }
      }
      if (types.includes('BoxSet')) {
        for (let n = 1; n <= opts.collections; n += 1) {
          rows.push({ id: collectionId(n), name: collectionName(n).toLowerCase(), lib: 'lib-collections', year: 2000, created: n, rating: 0, backdrop: n % 2 === 1, people: [] })
        }
      }
      const shows: string[] = [
        ...Array.from({ length: opts.seriesCount }, (_, i) => showId('s', i + 1)),
        ...Array.from({ length: opts.animeCount }, (_, i) => showId('a', i + 1)),
      ]
      if (types.includes('Series')) {
        for (const show of shows) {
          const n = Number(show.slice(1))
          rows.push({
            id: show,
            name: showName(show[0] as 's' | 'a', n).toLowerCase(),
            lib: showLibrary(show),
            genre: GENRES[n % 3],
            year: 2010 + (n % 10),
            created: n,
            rating: ((n * 3) % 10) + 0.5,
            backdrop: n % 2 === 1,
            people: ['p1'],
          })
        }
      }
      if (types.includes('Episode')) {
        for (const show of shows) {
          for (const e of episodesOf(show)) {
            rows.push({ id: e.id, name: `episode title ${e.season}-${e.episode}`, lib: showLibrary(show), year: 2010, created: 0, rating: 0, backdrop: false, people: [] })
          }
        }
      }
      if (types.includes('Playlist')) {
        for (const l of videoLists.values()) {
          rows.push({ id: l.id, name: l.name.toLowerCase(), lib: 'lib-playlists', year: 2000, created: Number(l.id.slice(2)), rating: 0, backdrop: false, people: [], type: 'VideoPlaylist', dto: listDto(l) })
        }
      }
      if (opts.musicArtists > 0) {
        const wanted = types.includes('Playlist') || types.includes('MusicAlbum') || types.includes('Audio') || types.includes('MusicArtist')
        if (wanted) {
          for (const r of musicRows(opts.musicArtists)) {
            if (types.includes(r.type)) rows.push({ ...r, rating: 0, backdrop: r.id.startsWith('ar') && Number(r.id.slice(2)) % 2 === 1, people: [] })
          }
        }
      }
      let selected = rows
      if (query.parentId && COLLECTION_ID.test(query.parentId)) {
        // What is inside a collection: its movies, sorted below like any other listing.
        const members = collectionMembers(query.parentId, opts.movieCount)
        selected = selected.filter((r) => members.includes(r.id))
      } else if (query.parentId && selected.some((r) => r.mvParent !== undefined) && (MV_FOLDER_ID.test(query.parentId) || query.recursive !== 'true')) {
        // The folders of the music video library: what is directly inside, or everything below when asked recursively.
        const under = (id: string | undefined, ancestor: string): boolean => id === ancestor || (id !== undefined && id !== 'lib-musicvideos' && under(mvFolderParent(id), ancestor))
        selected = selected.filter((r) =>
          r.mvParent === undefined
            ? r.lib === query.parentId
            : query.recursive === 'true'
              ? under(r.mvParent, query.parentId as string)
              : r.mvParent === query.parentId,
        )
      } else if (query.parentId) selected = selected.filter((r) => r.lib === query.parentId || r.parent === query.parentId)
      // Playlists of songs and of videos live apart: ask for one kind of them.
      const mediaTypes = list('mediaTypes')
      if (mediaTypes) selected = selected.filter((r) => (r.type === 'VideoPlaylist' ? mediaTypes.includes('Video') : r.type === 'Playlist' ? mediaTypes.includes('Audio') : true))
      const albumArtists = list('albumArtistIds') ?? list('artistIds')
      if (albumArtists) selected = selected.filter((r) => r.artistIds?.some((a) => albumArtists.includes(a)))
      if (ids) selected = selected.filter((r) => ids.includes(r.id))
      const persons = list('personIds')
      if (persons) selected = selected.filter((r) => persons.every((p) => r.people.includes(p))) // only "Ada Actor" (p1) is credited in the mock
      // Like Jellyfin: only titles that have such an image, and only those rated at least this well.
      if (list('imageTypes')?.includes('Backdrop')) selected = selected.filter((r) => r.backdrop)
      if (query.minCommunityRating) selected = selected.filter((r) => r.rating >= Number(query.minCommunityRating))
      const term = query.searchTerm?.toLowerCase()
      if (term) selected = selected.filter((r) => r.name.includes(term))
      selected = selected.filter((r) => !deleted.has(r.id))
      // Titles the server could not recognise: movies 4, 8, 12... (until one is identified).
      if (query.hasTmdbId === 'false') selected = selected.filter((r) => /^m\d{4}$/.test(r.id) && Number(r.id.slice(1)) % 4 === 0 && !identified.has(r.id))
      // The advanced filters: decades, age ratings, tags and picture quality (every title is HD; every fifth movie is 4K as well).
      const years = list('years')
      if (years) selected = selected.filter((r) => years.includes(String(r.year)))
      const officialRatings = list('officialRatings')
      if (officialRatings) selected = selected.filter((r) => r.official !== undefined && officialRatings.includes(r.official))
      const tagList = list('tags')
      if (tagList) selected = selected.filter((r) => r.tags?.some((tag) => tagList.includes(tag)))
      if (query.is4K === 'true') selected = selected.filter((r) => r.uhd === true)
      const genres = list('genres')
      if (genres) selected = selected.filter((r) => r.genre !== undefined && genres.includes(r.genre))
      const filters = list('filters') ?? []
      const isPlayed = (r: Row) => dtoFor(r.id, user, opts)?.UserData?.Played === true
      if (filters.includes('IsUnplayed')) selected = selected.filter((r) => !isPlayed(r))
      if (filters.includes('IsPlayed')) selected = selected.filter((r) => isPlayed(r))
      if (filters.includes('IsFavorite')) selected = selected.filter((r) => user.favorites.has(r.id))
      if (query.maxOfficialRating) {
        const limit = RATING_VALUE[query.maxOfficialRating.toLowerCase()] ?? 0
        const ratingOfRow = (r: Row) => (/^m\d{4}$/.test(r.id) ? ratingOfMovie(Number(r.id.slice(1))) : SHOW_ID.test(r.id) ? ratingOfShow(Number(r.id.slice(1))) : undefined)
        selected = selected.filter((r) => {
          const rating = ratingOfRow(r)
          return rating !== undefined && (RATING_VALUE[rating.toLowerCase()] ?? 99) <= limit
        })
      }
      if (filters.includes('Likes')) selected = selected.filter((r) => user.likes.get(r.id) === true)
      if (filters.includes('Dislikes')) selected = selected.filter((r) => user.likes.get(r.id) === false)
      const sortKey = list('sortBy')?.[0]
      const sortValue = (r: Row) =>
        sortKey === 'DateCreated'
          ? r.created
          : sortKey === 'ProductionYear'
            ? r.year
            : sortKey === 'CommunityRating'
              ? r.rating
              : sortKey === 'PlayCount'
                ? (user.plays.get(r.id) ?? 0)
                : sortKey === 'DatePlayed'
                  ? user.lastPlayed.indexOf(r.id)
                  : 0
      const sortText = (r: Row) => (sortKey === 'Album' ? r.album : r.artist) ?? ''
      const textSorted = sortKey === 'AlbumArtist' || sortKey === 'Artist' || sortKey === 'Album'
      // Like Jellyfin, a random sort really is random.
      if (sortKey === 'Random') selected = [...selected].sort(() => Math.random() - 0.5)
      if (sortKey && sortKey !== 'SortName' && sortKey !== 'Random' && sortKey !== 'ParentIndexNumber' && sortKey !== 'IndexNumber') {
        const dir = query.sortOrder === 'Descending' ? -1 : 1
        selected = [...selected].sort(
          (x, y) =>
            (textSorted ? sortText(x).localeCompare(sortText(y)) : sortValue(x) - sortValue(y)) * dir || x.id.localeCompare(y.id),
        )
      }
      // Tracks of an album come in track order.
      if (sortKey === 'ParentIndexNumber') selected = [...selected].sort((x, y) => (x.number ?? 0) - (y.number ?? 0))
      const start = Number(query.startIndex ?? 0)
      const limit = Number(query.limit ?? selected.length)
      const page = selected.slice(start, start + limit).map((r) => withEdits((r.dto ?? dtoFor(r.id, user, opts)) as { Id?: string }))
      return json(res, 200, { Items: page, TotalRecordCount: selected.length, StartIndex: start })
    }
    if (path === '/Items/Latest') {
      if (!needAuth()) return
      const limit = Number(query.limit ?? 16)
      if (query.parentId === 'lib-shows' || query.parentId === 'lib-anime') {
        const prefix = query.parentId === 'lib-anime' ? 'a' : 's'
        const count = prefix === 'a' ? opts.animeCount : opts.seriesCount
        // Like a real Jellyfin server: "latest" is about new episodes, so it has no series to offer.
        void [prefix, count, limit]
        return json(res, 200, [])
      }
      const newest = Array.from({ length: opts.movieCount }, (_, i) => opts.movieCount - i).slice(0, limit)
      return json(res, 200, newest.map((n) => movieDto(n, user)))
    }
    if (path === '/UserItems/Resume') {
      if (!needAuth()) return
      const types = list('includeItemTypes') ?? ['Movie']
      const wantsEpisodes = types.includes('Episode')
      const ids = [...user.lastPlayed].reverse().filter((id) => {
        if ((user.resume.get(id) ?? 0) <= 0) return false
        const episode = EPISODE_ID.exec(id)
        if (episode) return wantsEpisodes && (!query.parentId || showLibrary(episode[1] as string) === query.parentId)
        if (MUSIC_VIDEO_ID.test(id)) return types.includes('MusicVideo') && (!query.parentId || query.parentId === 'lib-musicvideos')
        if (AUDIOBOOK_ID.test(id)) return types.includes('AudioBook') && (!query.parentId || query.parentId === 'lib-books')
        return types.includes('Movie') && (!query.parentId || query.parentId === 'lib-movies')
      })
      const items = ids.slice(0, Number(query.limit ?? 12)).map((id) => dtoFor(id, user, opts))
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    if (path === '/Artists/AlbumArtists') {
      if (!needAuth()) return
      let artists = musicRows(opts.musicArtists).filter((r) => r.type === 'MusicArtist')
      const term = query.searchTerm?.toLowerCase()
      if (term) artists = artists.filter((r) => r.name.includes(term))
      if (query.isFavorite === 'true') artists = artists.filter((r) => user.favorites.has(r.id))
      if (list('sortBy')?.[0] === 'DateCreated') artists = [...artists].sort((a, b) => b.created - a.created)
      const start = Number(query.startIndex ?? 0)
      const limit = Number(query.limit ?? artists.length)
      const items = artists.slice(start, start + limit).map((r) => dtoFor(r.id, user, opts))
      return json(res, 200, { Items: items, TotalRecordCount: artists.length, StartIndex: start })
    }
    if (path === '/Playlists' && req.method === 'POST') {
      if (!needAuth()) return
      const b = (body ?? {}) as { Name?: string; Ids?: string[]; MediaType?: string }
      if (!b.Name) return void res.writeHead(400).end()
      listCounter += 1
      const id = `vp${String(listCounter).padStart(4, "0")}`
      videoLists.set(id, { id, name: b.Name, entries: (b.Ids ?? []).map((itemId) => ({ entryId: `e${(entryCounter += 1)}`, itemId })) })
      return json(res, 200, { Id: id })
    }
    const listMove = /^\/Playlists\/([^/]+)\/Items\/([^/]+)\/Move\/(\d+)$/.exec(path)
    if (listMove && req.method === 'POST') {
      if (!needAuth()) return
      const list = videoLists.get(listMove[1] as string)
      const at = list?.entries.findIndex((e) => e.entryId === listMove[2])
      if (!list || at === undefined || at < 0) return void res.writeHead(404).end()
      const [entry] = list.entries.splice(at, 1)
      list.entries.splice(Number(listMove[3]), 0, entry as (typeof list.entries)[number])
      return void res.writeHead(204).end()
    }
    const listUpdate = /^\/Playlists\/([^/]+)$/.exec(path)
    if (listUpdate && req.method === 'POST') {
      if (!needAuth()) return
      const list = videoLists.get(listUpdate[1] as string)
      if (!list) return void res.writeHead(404).end()
      const b = (body ?? {}) as { Name?: string }
      if (b.Name) list.name = b.Name
      return void res.writeHead(204).end()
    }
    const playlistItems = /^\/Playlists\/([^/]+)\/Items$/.exec(path)
    const videoList = playlistItems ? videoLists.get(playlistItems[1] as string) : undefined
    if (playlistItems && videoList) {
      if (!needAuth()) return
      if (req.method === 'POST') {
        const at = query.position === undefined ? videoList.entries.length : Number(query.position)
        const added = (list('ids') ?? []).map((itemId) => ({ entryId: `e${(entryCounter += 1)}`, itemId }))
        videoList.entries.splice(at, 0, ...added)
        return void res.writeHead(204).end()
      }
      if (req.method === 'DELETE') {
        const gone = list('entryIds') ?? []
        videoList.entries = videoList.entries.filter((e) => !gone.includes(e.entryId))
        return void res.writeHead(204).end()
      }
      const items = videoList.entries.map((e) => ({ ...dtoFor(e.itemId, user, opts), PlaylistItemId: e.entryId }))
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    if (playlistItems) {
      if (!needAuth()) return
      const items = playlistTrackIds(opts.musicArtists).map((id) => dtoFor(id, user, opts))
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    const segments = /^\/MediaSegments\/([^/]+)$/.exec(path)
    if (segments) {
      if (!needAuth()) return
      const isEpisode = EPISODE_ID.test(segments[1] as string)
      const mk = (Type: string, from: number, to: number) => ({ Id: `${Type}-${from}`, ItemId: segments[1], Type, StartTicks: from * TICKS, EndTicks: to * TICKS })
      const items = opts.segments && isEpisode ? [mk('Intro', 3, 8), mk('Outro', 24, 30)] : []
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    const displayPref = /^\/DisplayPreferences\/([^/]+)$/.exec(path)
    if (displayPref) {
      if (!needAuth()) return
      const key = `${displayPref[1]}|${query.client}`
      if (req.method === 'POST') {
        displayPrefs.set(key, ((body as { CustomPrefs?: Record<string, string> } | undefined)?.CustomPrefs ?? {}))
        return void res.writeHead(204).end()
      }
      return json(res, 200, { Id: displayPref[1], Client: query.client, CustomPrefs: displayPrefs.get(key) ?? {} })
    }
    if (path === '/Shows/Upcoming') {
      if (!needAuth()) return
      const firstShow = opts.seriesCount > 0 ? showId('s', 1) : undefined
      const items =
        opts.upcoming && firstShow
          ? [1, 2].map((n) => ({ ...episodeDto(firstShow, 2, n, user), PremiereDate: new Date(Date.now() + n * 86_400_000).toISOString() }))
          : []
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    if (path === '/Shows/NextUp') {
      if (!needAuth()) return
      const shows = [
        ...Array.from({ length: opts.seriesCount }, (_, i) => showId('s', i + 1)),
        ...Array.from({ length: opts.animeCount }, (_, i) => showId('a', i + 1)),
      ].filter((s) => (!query.parentId || showLibrary(s) === query.parentId) && (!query.seriesId || s === query.seriesId))
      const includeResumable = query.enableResumable !== 'false'
      const found: Array<{ id: string; at: number }> = []
      for (const show of shows) {
        const eps = episodesOf(show)
        const started = eps.map((e, i) => ({ e, i })).filter(({ e }) => user.played.has(e.id) || (user.resume.get(e.id) ?? 0) > 0)
        const last = started.at(-1)
        if (!last) continue
        const next = user.played.has(last.e.id) ? eps[last.i + 1] : includeResumable ? last.e : undefined
        if (next) found.push({ id: next.id, at: user.lastPlayed.indexOf(last.e.id) })
      }
      const items = found
        .sort((a, b) => b.at - a.at)
        .slice(0, Number(query.limit ?? 16))
        .map((f) => dtoFor(f.id, user, opts))
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    const seasons = /^\/Shows\/([^/]+)\/Seasons$/.exec(path)
    if (seasons) {
      if (!needAuth()) return
      const show = seasons[1] as string
      const items = Array.from({ length: SEASONS }, (_, i) => seasonDto(show, i + 1, user))
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    const episodes = /^\/Shows\/([^/]+)\/Episodes$/.exec(path)
    if (episodes) {
      if (!needAuth()) return
      const show = episodes[1] as string
      let ordered = episodesOf(show)
      if (query.seasonId) ordered = ordered.filter((e) => seasonId(show, e.season) === query.seasonId)
      if (query.startItemId) {
        const at = ordered.findIndex((e) => e.id === query.startItemId)
        ordered = at >= 0 ? ordered.slice(at) : []
      }
      ordered = ordered.slice(0, Number(query.limit ?? ordered.length))
      const items = ordered.map((e) => episodeDto(show, e.season, e.episode, user))
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    const similarShows = /^\/Shows\/([^/]+)\/Similar$/.exec(path)
    if (similarShows) {
      if (!needAuth()) return
      const n = Number((similarShows[1] as string).slice(1))
      const prefix = (similarShows[1] as string)[0] as 's' | 'a'
      const count = prefix === 'a' ? opts.animeCount : opts.seriesCount
      const items = [n + 1, n + 2].filter((x) => x <= count).map((x) => showDto(showId(prefix, x), user))
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    const ancestors = /^\/Items\/([^/]+)\/Ancestors$/.exec(path)
    if (ancestors && req.method === 'GET') {
      if (!needAuth()) return
      const chain: unknown[] = []
      let at: string | undefined = ancestors[1] as string
      while (at && at !== 'lib-musicvideos') {
        at = (dtoFor(at, user, opts) as { ParentId?: string } | undefined)?.ParentId
        if (at && at !== 'lib-musicvideos') chain.push(dtoFor(at, user, opts))
      }
      chain.push({ Id: 'lib-musicvideos', Name: 'Music videos', Type: 'CollectionFolder' })
      chain.push({ Id: 'root', Name: 'Media Folders', Type: 'AggregateFolder' })
      return json(res, 200, chain)
    }
    // Like Jellyfin 12.2 on a real server: /Genres is empty, the genres are only in the query filters.
    if (path === '/Genres') {
      if (!needAuth()) return
      return json(res, 200, { Items: [], TotalRecordCount: 0, StartIndex: 0 })
    }
    if (path === '/Items/Filters') {
      if (!needAuth()) return
      return json(res, 200, { Genres: [...GENRES].reverse(), Tags: ['Classic'], OfficialRatings: ['PG-13', 'R'], Years: [1995, 2003, 2005, 2014] })
    }
    const similar = /^\/Movies\/([^/]+)\/Similar$/.exec(path)
    if (similar) {
      if (!needAuth()) return
      const n = Number((similar[1] as string).slice(1))
      const items = [n + 1, n + 2, n + 3].filter((x) => x <= opts.movieCount).map((x) => movieDto(x, user))
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    const single = /^\/Items\/([^/]+)$/.exec(path)
    if (single && req.method === 'DELETE') {
      if (!needAuth()) return
      if (videoLists.delete(single[1] as string)) return void res.writeHead(204).end()
      // A title of the library: only an administrator may, and it is gone for everyone.
      if (opts.admin === false) return void res.writeHead(403).end()
      const id = single[1] as string
      if (!dtoFor(id, user, opts) || deleted.has(id)) return void res.writeHead(404).end()
      deleted.add(id)
      adminLog.push(`delete-title ${id}`)
      return void res.writeHead(204).end()
    }
    if (single && req.method === 'GET') {
      if (!needAuth()) return
      const ownList = videoLists.get(single[1] as string)
      if (ownList) return json(res, 200, listDto(ownList))
      const dto = dtoFor(single[1] as string, user, opts, true)
      if (!dto || deleted.has(single[1] as string)) return void res.writeHead(404).end()
      return json(res, 200, withEdits(dto))
    }
    // --- Administrator tools: edit, identify, refresh and pictures ---------------------------------
    // Every one of them answers 403 to an account that is not an administrator, as the real server does.
    const adminOnly = (): boolean => {
      if (!needAuth()) return false
      if (opts.admin === false) {
        res.writeHead(403).end()
        return false
      }
      return true
    }
    const adminItem = /^\/Items\/([^/]+)\/(MetadataEditor|Refresh|Images|RemoteImages|RemoteImages\/Download)$/.exec(path)
    const adminPicture = /^\/Items\/([^/]+)\/Images\/(Primary|Backdrop|Logo|Thumb)(?:\/(\d+))?$/.exec(path)
    const lookup = /^\/Items\/RemoteSearch\/(Movie|Series|BoxSet|MusicAlbum|MusicArtist)$/.exec(path)
    const lookupApply = /^\/Items\/RemoteSearch\/Apply\/([^/]+)$/.exec(path)
    if (single && req.method === 'POST') {
      if (!adminOnly()) return
      const id = single[1] as string
      if (!dtoFor(id, user, opts) || deleted.has(id)) return void res.writeHead(404).end()
      const b = (body ?? {}) as Record<string, unknown>
      // A full item comes back, so a field that is missing is a field that was cleared.
      edits.set(id, Object.fromEntries(EDITABLE_KEYS.map((k) => [k, b[k] ?? null])))
      adminLog.push(`update ${id}`)
      return void res.writeHead(204).end()
    }
    if (lookup && req.method === 'POST') {
      if (!adminOnly()) return
      const info = ((body ?? {}) as { SearchInfo?: { Name?: string; Year?: number } }).SearchInfo ?? {}
      const name = (info.Name ?? '').trim()
      adminLog.push(`search ${lookup[1]} ${name}${info.Year ? ` ${info.Year}` : ''}`)
      if (!name || /zzz/i.test(name)) return json(res, 200, [])
      const origin = `http://${req.headers.host}`
      return json(res, 200, [
        { Name: name, ProductionYear: info.Year ?? 1999, Overview: `The first match for ${name}.`, SearchProviderName: 'TheMovieDb', ProviderIds: { Tmdb: '603' }, ImageUrl: `${origin}/remote/Primary/1` },
        { Name: `${name} Reloaded`, ProductionYear: (info.Year ?? 1999) + 4, Overview: `The sequel to ${name}.`, SearchProviderName: 'TheMovieDb', ProviderIds: { Tmdb: '604' }, ImageUrl: `${origin}/remote/Primary/2` },
      ])
    }
    if (lookupApply && req.method === 'POST') {
      if (!adminOnly()) return
      const id = lookupApply[1] as string
      const b = (body ?? {}) as { Name?: string; ProductionYear?: number; Overview?: string; ProviderIds?: Record<string, string> }
      const current = withEdits(dtoFor(id, user, opts, true) as { Id?: string })
      edits.set(id, Object.fromEntries(EDITABLE_KEYS.map((k) => [k, (current as Record<string, unknown>)[k] ?? null])))
      Object.assign(edits.get(id) as object, { Name: b.Name ?? null, ProductionYear: b.ProductionYear ?? null, Overview: b.Overview ?? null })
      identified.add(id)
      adminLog.push(`identify ${id} ${Object.entries(b.ProviderIds ?? {}).map(([k, v]) => `${k}=${v}`).join(',')} images=${query.replaceAllImages === 'true'}`)
      return void res.writeHead(204).end()
    }
    if (adminItem) {
      const id = adminItem[1] as string
      const what = adminItem[2]
      if (!(dtoFor(id, user, opts) || /^lib-/.test(id))) return void res.writeHead(404).end()
      if (what === 'MetadataEditor' && req.method === 'GET') {
        if (!adminOnly()) return
        return json(res, 200, { ParentalRatingOptions: [{ Name: 'G', Value: 1 }, { Name: 'PG', Value: 5 }, { Name: 'PG-13', Value: 7 }, { Name: 'R', Value: 9 }], Countries: [], Cultures: [], ExternalIdInfos: [] })
      }
      if (what === 'Refresh' && req.method === 'POST') {
        if (!adminOnly()) return
        adminLog.push(`refresh ${id} ${query.metadataRefreshMode ?? ''} metadata=${query.replaceAllMetadata === 'true'} images=${query.replaceAllImages === 'true'}`)
        return void res.writeHead(204).end()
      }
      if (what === 'Images' && req.method === 'GET') {
        if (!adminOnly()) return
        return json(res, 200, imageInfos(id))
      }
      if (what === 'RemoteImages' && req.method === 'GET') {
        if (!adminOnly()) return
        const type = query.type ?? 'Primary'
        const origin = `http://${req.headers.host}`
        const images = [1, 2, 3].map((n) => ({
          ProviderName: n === 3 ? 'FanArt' : 'TheMovieDb',
          Url: `${origin}/remote/${type}/${n}`,
          ThumbnailUrl: `${origin}/remote/${type}/${n}`,
          Width: type === 'Backdrop' ? 1920 : 1000,
          Height: type === 'Backdrop' ? 1080 : 1500,
          Language: n === 2 ? null : 'en',
          CommunityRating: 6 - n,
          VoteCount: 10 * n,
          Type: type,
        }))
        adminLog.push(`pictures ${id} ${type}`)
        return json(res, 200, { Images: images, TotalRecordCount: images.length, Providers: ['TheMovieDb', 'FanArt'] })
      }
      if (what === 'RemoteImages/Download' && req.method === 'POST') {
        if (!adminOnly()) return
        const type = query.type ?? 'Primary'
        // Only an address the server itself offered is fetched.
        if (!(query.imageUrl ?? '').startsWith(`http://${req.headers.host}/remote/`)) return void res.writeHead(400).end()
        pictureCounter += 1
        pictures.set(id, (pictures.get(id) ?? new Map()).set(type, `dl${pictureCounter}`))
        adminLog.push(`download ${id} ${type} ${new URL(query.imageUrl as string).pathname}`)
        return void res.writeHead(204).end()
      }
    }
    if (adminPicture && req.method === 'POST') {
      if (!adminOnly()) return
      const id = adminPicture[1] as string
      const type = adminPicture[2] as string
      const text = rawBodies.get(req) ?? ''
      const contentType = String(req.headers['content-type'] ?? '')
      if (!/^image\/(jpeg|png|webp)$/.test(contentType) || !/^[A-Za-z0-9+/]+=*$/.test(text)) return void res.writeHead(400).end()
      pictureCounter += 1
      pictures.set(id, (pictures.get(id) ?? new Map()).set(type, `up${pictureCounter}`))
      adminLog.push(`upload ${id} ${type} ${contentType} ${Buffer.from(text, 'base64').length}`)
      return void res.writeHead(204).end()
    }
    if (adminPicture && req.method === 'DELETE') {
      if (!adminOnly()) return
      const id = adminPicture[1] as string
      pictures.set(id, (pictures.get(id) ?? new Map()).set(adminPicture[2] as string, null))
      adminLog.push(`delete ${id} ${adminPicture[2]}`)
      return void res.writeHead(204).end()
    }
    const played = /^\/UserPlayedItems\/([^/]+)$/.exec(path)
    const favorite = /^\/UserFavoriteItems\/([^/]+)$/.exec(path)
    if ((played || favorite) && (req.method === 'POST' || req.method === 'DELETE')) {
      if (!needAuth()) return
      const id = ((played ?? favorite) as RegExpExecArray)[1] as string
      const on = req.method === 'POST'
      if (played) {
        // Marking a series or season marks every episode in it.
        for (const leaf of leavesOf(id)) {
          if (on) user.played.add(leaf)
          else {
            user.played.delete(leaf)
            user.resume.delete(leaf)
          }
        }
      } else if (on) user.favorites.add(id)
      else user.favorites.delete(id)
      return json(res, 200, dtoFor(id, user, opts)?.UserData)
    }
    const rating = /^\/UserItems\/([^/]+)\/Rating$/.exec(path)
    if (rating && (req.method === 'POST' || req.method === 'DELETE')) {
      if (!needAuth()) return
      const id = rating[1] as string
      if (req.method === 'POST') user.likes.set(id, query.likes === 'true')
      else user.likes.delete(id)
      return json(res, 200, { ...dtoFor(id, user, opts)?.UserData, Likes: user.likes.get(id) })
    }
    const playbackInfo = /^\/Items\/([^/]+)\/PlaybackInfo$/.exec(path)
    if (playbackInfo && req.method === 'POST') {
      if (!needAuth()) return
      const id = playbackInfo[1] as string
      const dto = (body ?? {}) as { EnableDirectPlay?: boolean; AudioStreamIndex?: number; MediaSourceId?: string; MaxStreamingBitrate?: number }
      // Every video in the mock is a 12 Mbps file: a lower limit means the server has to convert it.
      const overLimit = !TRACK_ID.test(id) && !AUDIOBOOK_ID.test(id) && (dto.MaxStreamingBitrate ?? Infinity) < 12_000_000
      const direct = opts.playMode === 'direct' && dto.EnableDirectPlay !== false && !overLimit
      // Like a real server (verified against Jellyfin 12.2): the audio track is only honoured when the media source is named.
      const audio = dto.MediaSourceId ? (dto.AudioStreamIndex ?? 1) : 1
      const isTrack = TRACK_ID.test(id) || AUDIOBOOK_ID.test(id)
      const isChannel = CHANNEL_ID.test(id)
      const source: Record<string, unknown> = {
        Id: dto.MediaSourceId?.endsWith('-4k') ? `ms-${id}-4k` : `ms-${id}`,
        ETag: 'etag1',
        Container: 'mp4',
        RunTimeTicks: DURATION_SECONDS * TICKS,
        SupportsDirectPlay: direct,
        SupportsDirectStream: direct,
        SupportsTranscoding: true,
        DefaultAudioStreamIndex: 1,
        MediaStreams: isTrack
          ? [{ Index: 0, Type: 'Audio', Codec: 'mp3', IsDefault: true, DisplayTitle: 'MP3 - Stereo' }]
          : [
              ...STREAMS,
              ...(opts.secondSubtitle
                ? [{ Index: 9, Type: 'Subtitle', Codec: 'subrip', Language: 'spa', IsDefault: false, IsTextSubtitleStream: true, DisplayTitle: 'Spanish - SUBRIP' }]
                : []),
              ...Array.from({ length: savedSubtitles.get(id) ?? 0 }, (_, i) => ({
                Index: 4 + i,
                Type: 'Subtitle',
                Codec: 'srt',
                Language: 'spa',
                IsDefault: false,
                IsExternal: true,
                IsTextSubtitleStream: true,
                DisplayTitle: i === 0 ? 'Spanish - SRT - External' : `Spanish ${i + 1} - SRT - External`,
              })),
            ],
        // A live channel has no length; the server opens a stream for it and says which.
        ...(isChannel ? { RunTimeTicks: undefined, LiveStreamId: `live-${id}`, IsInfiniteStream: true } : {}),
      }
      if (isTrack) {
        source.Container = 'mp3'
        source.RunTimeTicks = TRACK_SECONDS * TICKS
        if (!direct) {
          source.TranscodingUrl = `/audio/${id}/master.m3u8?MediaSourceId=ms-${id}&ApiKey=leaked-by-server`
          source.TranscodingSubProtocol = 'hls'
          source.TranscodingContainer = 'ts'
        }
      } else if (!direct) {
        source.TranscodingUrl = `/videos/${id}/master.m3u8?MediaSourceId=ms-${id}&AudioStreamIndex=${audio}&TranscodeReasons=${overLimit ? 'ContainerBitrateExceedsLimit' : 'VideoCodecNotSupported,AudioCodecNotSupported'}&ApiKey=leaked-by-server`
        source.TranscodingSubProtocol = 'hls'
        source.TranscodingContainer = 'ts'
      }
      return json(res, 200, { MediaSources: [source], PlaySessionId: `play-${(playSessionCounter += 1)}` })
    }
    if (/^\/Sessions\/Playing(\/Progress|\/Stopped)?$/.test(path) && req.method === 'POST') {
      if (!needAuth()) return
      if (opts.failReporting) {
        res.writeHead(500).end()
        return
      }
      const playing = token ? sessions.get(token) : undefined
      if (playing) {
        const report = body as { ItemId?: string; PositionTicks?: number; IsPaused?: boolean } | undefined
        if (path.endsWith('/Stopped')) playing.itemId = undefined
        else if (report?.ItemId) {
          playing.itemId = report.ItemId
          playing.positionTicks = report.PositionTicks ?? 0
          playing.paused = report.IsPaused === true
        }
      }
      if (path.endsWith('/Stopped')) {
        const b = body as { ItemId?: string; PositionTicks?: number } | undefined
        if (b?.ItemId) {
          if (!TRACK_ID.test(b.ItemId)) resume.set(b.ItemId, b.PositionTicks ?? 0)
          user.lastPlayed = [...user.lastPlayed.filter((x) => x !== b.ItemId), b.ItemId]
          // Jellyfin marks an episode watched when you stop near its end (movies keep their position in these tests).
          // The same for a song: it counts as played once you get near the end.
          if (TRACK_ID.test(b.ItemId) && (b.PositionTicks ?? 0) >= TRACK_SECONDS * TICKS * 0.9) {
            user.played.add(b.ItemId)
            user.plays.set(b.ItemId, (user.plays.get(b.ItemId) ?? 0) + 1)
          }
          if (EPISODE_ID.test(b.ItemId) && (b.PositionTicks ?? 0) >= DURATION_SECONDS * TICKS * 0.9) {
            user.played.add(b.ItemId)
            resume.delete(b.ItemId)
          }
        }
      }
      res.writeHead(204).end()
      return
    }

    // --- media -------------------------------------------------------------------------
    const media = opts.mediaDir
    const stream = /^\/Videos\/([^/]+)\/stream$/.exec(path)
    if (stream) {
      if (!needAuth(false)) return
      if (!media || opts.breakMedia) return void res.writeHead(404).end()
      return serveFile(req, res, join(media, 'sample.mp4'), 'video/mp4')
    }
    // Lyrics: timed ones for tracks whose id ends in 1, plain ones for 2 (a plugin has timed ones to offer) and 4 (it has not), none (404) for the rest, like a server with LrcLib.
    const lyricsRoute = /^\/Audio\/([^/]+)\/Lyrics$/.exec(path)
    if (lyricsRoute && req.method === 'GET') {
      if (!needAuth()) return
      const last = (lyricsRoute[1] as string).slice(-1)
      if (last === '1' || savedLyrics.has(lyricsRoute[1] as string)) return json(res, 200, { Metadata: { IsSynced: true }, Lyrics: timedLyrics })
      if (last === '2' || last === '4') return json(res, 200, { Metadata: {}, Lyrics: [{ Text: 'Plain one' }, { Text: 'Plain two' }] })
      return void res.writeHead(404).end()
    }
    // Timed lyrics from a lyrics plugin: offered for tracks whose id ends in 2 (which only have plain ones), saved on request.
    const remoteLyrics = /^\/Audio\/([^/]+)\/RemoteSearch\/Lyrics(?:\/([^/]+))?$/.exec(path)
    if (remoteLyrics) {
      if (!needAuth()) return
      const id = remoteLyrics[1] as string
      if (req.method === 'GET') {
        return json(res, 200, id.endsWith('2') ? [{ Id: 'remote-timed', ProviderName: 'Lyrics', Lyrics: { Metadata: { IsSynced: true }, Lyrics: timedLyrics } }] : [])
      }
      if (req.method === 'POST') {
        savedLyrics.add(id)
        return json(res, 200, { Metadata: { IsSynced: true }, Lyrics: timedLyrics })
      }
    }
    // Instant mixes ("radio"): the songs of the seed's artist first, then the others, nearest artist first.
    const instantMix = /^\/(Artists|Albums|Songs)\/([^/]+)\/InstantMix$/.exec(path)
    if (instantMix && req.method === 'GET') {
      if (!needAuth()) return
      if (opts.musicArtists === 0) return void res.writeHead(404).end()
      const seed = instantMix[2] as string
      const seedNumber = Number(/(\d{4})/.exec(seed)?.[1] ?? 1)
      const tracks = musicRows(opts.musicArtists).filter((r) => r.type === 'Audio')
      const distance = (id: string) => {
        const n = Number(/^tr(\d{4})/.exec(id)?.[1] ?? 0)
        return (n - seedNumber + opts.musicArtists) % opts.musicArtists
      }
      const ordered = [...tracks].filter((r) => r.id !== seed).sort((a, b) => distance(a.id) - distance(b.id) || a.id.localeCompare(b.id))
      const limit = Number(query.limit ?? 50)
      adminLog.push(`mix ${instantMix[1]} ${seed}`)
      const items = ordered.slice(0, limit).map((r) => dtoFor(r.id, user, opts))
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    // Subtitles from the internet: a search (three results, the first one matching the file; "zzz" finds nothing) and saving one.
    const remoteSubtitles = /^\/Items\/([^/]+)\/RemoteSearch\/Subtitles\/([^/]+)$/.exec(path)
    if (remoteSubtitles) {
      if (!needAuth()) return
      if (opts.noSubtitlePlugin) return void res.writeHead(404).end()
      if (opts.admin === false) return void res.writeHead(403).end()
      const id = remoteSubtitles[1] as string
      const arg = remoteSubtitles[2] as string
      if (req.method === 'GET') {
        adminLog.push(`subtitle-search ${id} ${arg}${query.isPerfectMatch === 'true' ? ' exact' : ''}`)
        if (arg === 'zzz') return json(res, 200, [])
        return json(res, 200, [
          { Id: 'os-popular', Name: 'Mock.Movie.2020.WEB-DL', ProviderName: 'Open Subtitles', ThreeLetterISOLanguageName: arg, Format: 'srt', Author: 'ana', DownloadCount: 9000, CommunityRating: 8, IsHashMatch: false },
          { Id: 'os-exact', Name: 'Mock.Movie.2020.1080p.BluRay', ProviderName: 'Open Subtitles', ThreeLetterISOLanguageName: arg, Format: 'srt', Author: 'luis', DownloadCount: 12, IsHashMatch: true, HearingImpaired: true },
          { Id: 'os-machine', Name: 'Mock Movie (machine)', ProviderName: 'Open Subtitles', ThreeLetterISOLanguageName: arg, Format: 'srt', DownloadCount: 50000, MachineTranslated: true },
        ])
      }
      if (req.method === 'POST') {
        adminLog.push(`subtitle-download ${id} ${arg}`)
        savedSubtitles.set(id, (savedSubtitles.get(id) ?? 0) + 1)
        return void res.writeHead(204).end()
      }
    }
    // Watch together (SyncPlay): groups, a queue, and commands pushed over the sockets, as the real server does them in outline. The
    // server waits for every member to say it is ready before it starts anything (a seek or a buffering member holds everyone).
    if (path === '/GetUtcTime' && req.method === 'GET') {
      const received = new Date(serverNow()).toISOString()
      return json(res, 200, { RequestReceptionTime: received, ResponseTransmissionTime: new Date(serverNow()).toISOString() })
    }
    if (path.startsWith('/SyncPlay/')) {
      if (!needAuth() || !token) return
      if (opts.syncPlayDenied) return void res.writeHead(403).end()
      const name = path.slice('/SyncPlay/'.length)
      const b = (body ?? {}) as Record<string, unknown>
      const own = groupOf(token)
      if (name === 'List' && req.method === 'GET') return json(res, 200, [...groups.values()].map(groupInfo))
      if (name === 'New') {
        if (own) leaveSync(token)
        const made: MockGroup = {
          id: `group-${++groupCount}`,
          name: String(b.GroupName ?? 'Group'),
          state: 'Idle',
          members: new Set([token]),
          ignoring: new Set(),
          notReady: new Set(),
          itemIds: [],
          playlistItemIds: [],
          index: 0,
          positionTicks: 0,
          positionAt: 0,
          wantPlaying: false,
        }
        groups.set(made.id, made)
        sendUpdate(made, [token], 'GroupJoined', groupInfo(made))
        return json(res, 200, groupInfo(made))
      }
      if (name === 'Join') {
        const found = groups.get(String(b.GroupId))
        if (!found) return void res.writeHead(404).end()
        if (own) leaveSync(token)
        found.members.add(token)
        sendUpdate(found, [token], 'GroupJoined', groupInfo(found))
        sendUpdate(found, [...found.members].filter((m) => m !== token), 'UserJoined', opts.username)
        if (found.itemIds.length > 0) {
          // Someone arrives while a title is on: everyone waits at the place it has reached, and the newcomer loads it.
          const at = positionNow(found)
          found.positionTicks = at
          found.wantPlaying = found.state === 'Playing' || found.wantPlaying
          found.state = 'Waiting'
          found.notReady.add(token)
          sendQueue(found, [token], 'NewPlaylist', at)
          sendState(found, 'Waiting', 'Join')
          broadcast(found, 'Pause', serverNow(), at)
        }
        return void res.writeHead(204).end()
      }
      if (!own) {
        res.writeHead(400).end()
        return
      }
      const ticksOf = (value: unknown) => (typeof value === 'number' ? value : 0)
      switch (name) {
        case 'Leave':
          leaveSync(token)
          break
        case 'SetNewQueue': {
          const ids = Array.isArray(b.PlayingQueue) ? (b.PlayingQueue as string[]) : []
          own.itemIds = ids
          own.playlistItemIds = ids.map((_, i) => `pl-${own.id}-${++playlistCount}-${i}`)
          own.index = Math.min(Number(b.PlayingItemPosition ?? 0), Math.max(0, ids.length - 1))
          own.positionTicks = ticksOf(b.StartPositionTicks)
          own.state = 'Waiting'
          own.wantPlaying = true
          own.notReady = new Set([...own.members])
          sendQueue(own, [...own.members], 'NewPlaylist', own.positionTicks)
          sendState(own, 'Waiting', 'NewPlaylist')
          break
        }
        case 'Pause':
          own.positionTicks = positionNow(own)
          own.state = 'Paused'
          own.wantPlaying = false
          sendState(own, 'Paused', 'Pause')
          broadcast(own, 'Pause', serverNow(), own.positionTicks)
          break
        case 'Unpause':
          if (own.state === 'Paused') startPlaying(own)
          break
        case 'Stop':
          own.state = 'Idle'
          own.wantPlaying = false
          sendState(own, 'Idle', 'Stop')
          broadcast(own, 'Stop', serverNow(), 0)
          break
        case 'Seek':
          own.positionTicks = ticksOf(b.PositionTicks)
          own.state = 'Waiting'
          own.notReady = new Set([...own.members])
          sendState(own, 'Waiting', 'Seek')
          broadcast(own, 'Seek', serverNow(), own.positionTicks)
          break
        case 'Buffering':
          own.positionTicks = ticksOf(b.PositionTicks)
          own.wantPlaying = b.IsPlaying === true
          own.state = 'Waiting'
          own.notReady.add(token)
          sendState(own, 'Waiting', 'Buffer')
          broadcast(own, 'Pause', serverNow(), own.positionTicks)
          break
        case 'Ready':
          own.notReady.delete(token)
          if (own.state === 'Waiting') {
            own.positionTicks = ticksOf(b.PositionTicks)
            resumeIfReady(own)
          }
          break
        case 'SetIgnoreWait':
          if (b.IgnoreWait === true) own.ignoring.add(token)
          else own.ignoring.delete(token)
          resumeIfReady(own)
          break
        case 'Ping':
          break
        default:
          return void res.writeHead(404).end()
      }
      return void res.writeHead(204).end()
    }
    // Live TV: the channels (with what is on now), one channel, and the guide.
    if (path === '/LiveTv/Channels' && req.method === 'GET') {
      if (!needAuth()) return
      let numbers = Array.from({ length: opts.liveTv }, (_, i) => i + 1)
      if (query.isFavorite === 'true') numbers = numbers.filter((n) => user.favorites.has(channelId(n)))
      // The kind of a channel follows its number: movies, series, sports, news and kids in turn.
      for (const [param, kind] of Object.entries(CHANNEL_KIND_PARAM)) {
        if (query[param] === 'true') numbers = numbers.filter((n) => channelKind(n) === kind)
      }
      const start = Number(query.startIndex ?? 0)
      const limit = Number(query.limit ?? numbers.length)
      const items = numbers.slice(start, start + limit).map((n) => channelDto(n, user))
      return json(res, 200, { Items: items, TotalRecordCount: numbers.length, StartIndex: start })
    }
    const oneChannel = /^\/LiveTv\/Channels\/([^/]+)$/.exec(path)
    if (oneChannel && req.method === 'GET') {
      if (!needAuth()) return
      const found = dtoFor(oneChannel[1] as string, user, opts)
      return found ? json(res, 200, found) : void res.writeHead(404).end()
    }
    if (path === '/LiveTv/Programs' && req.method === 'POST') {
      if (!needAuth()) return
      const b = (body ?? {}) as { ChannelIds?: string[]; MinEndDate?: string; MaxStartDate?: string }
      const minEnd = b.MinEndDate ? Date.parse(b.MinEndDate) : -Infinity
      const maxStart = b.MaxStartDate ? Date.parse(b.MaxStartDate) : Infinity
      const items = (b.ChannelIds ?? [])
        .filter((id) => CHANNEL_ID.test(id) && Number(id.slice(2)) <= opts.liveTv)
        .flatMap((id) => programsOf(Number(id.slice(2)), Date.now()))
        .filter((p) => Date.parse(p.EndDate) > minEnd && Date.parse(p.StartDate) < maxStart)
      return json(res, 200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 })
    }
    // A book's own file, for reading or saving (an account may be forbidden to download).
    const download = /^\/Items\/([^/]+)\/Download$/.exec(path)
    if (download) {
      if (!needAuth()) return
      if (opts.noDownload) return void res.writeHead(403).end()
      const id = download[1] as string
      const file = BOOK_ID.test(id) && Number(id.slice(2)) <= opts.books ? bookFile(Number(id.slice(2))) : undefined
      if (!file) return void res.writeHead(404).end()
      res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.bytes.length })
      return void res.end(Buffer.from(file.bytes))
    }
    const audioStream = /^\/Audio\/([^/]+)\/stream$/.exec(path)
    if (audioStream) {
      if (!needAuth(false)) return
      if (!media || opts.breakMedia) return void res.writeHead(404).end()
      return serveFile(req, res, join(media, 'sample.mp3'), 'audio/mpeg')
    }
    const audioMaster = /^\/audio\/([^/]+)\/master\.m3u8$/.exec(path)
    if (audioMaster) {
      if (!needAuth()) return
      if (!media || opts.breakMedia === 'all') return void res.writeHead(404).end()
      return serveFile(req, res, join(media, 'hls-music', 'master.m3u8'), 'application/vnd.apple.mpegurl')
    }
    const audioSegment = /^\/audio\/([^/]+)\/(seg\d+\.ts)$/.exec(path)
    if (audioSegment) {
      if (!needAuth()) return
      if (!media || opts.breakMedia === 'all') return void res.writeHead(404).end()
      return serveFile(req, res, join(media, 'hls-music', audioSegment[2] as string), 'video/mp2t')
    }
    const master = /^\/videos\/([^/]+)\/master\.m3u8$/.exec(path)
    if (master) {
      if (!needAuth()) return
      if (!media || opts.breakMedia === 'all') return void res.writeHead(404).end()
      const dir = query.AudioStreamIndex === '2' ? 'hls-a2' : 'hls'
      return serveFile(req, res, join(media, dir, 'master.m3u8'), 'application/vnd.apple.mpegurl')
    }
    const segment = /^\/videos\/([^/]+)\/(seg\d+\.ts)$/.exec(path)
    if (segment) {
      if (!needAuth()) return
      if (!media || opts.breakMedia === 'all') return void res.writeHead(404).end()
      const dir = query.AudioStreamIndex === '2' ? 'hls-a2' : 'hls'
      return serveFile(req, res, join(media, dir, segment[2] as string), 'video/mp2t')
    }
    if (/^\/Videos\/[^/]+\/[^/]+\/Subtitles\/\d+\/Stream\.vtt$/.test(path)) {
      if (!needAuth()) return
      const line = path.includes('/Subtitles/9/') ? 'Segunda linea de prueba' : 'Mock subtitle line'
      res
        .writeHead(200, { 'Content-Type': 'text/vtt' })
        .end(`WEBVTT\n\n00:00:00.000 --> 00:00:29.000\n${line}\n`)
      return
    }

    res.writeHead(404).end()
  })

  // The socket other devices' commands reach a browser through (`/socket?ApiKey=<token>&deviceId=<id>`).
  server.on('upgrade', (req, socket: Duplex) => {
    const url = new URL(req.url ?? '/', 'http://mock')
    const accessToken = url.searchParams.get('ApiKey') ?? url.searchParams.get('api_key') ?? ''
    const key = req.headers['sec-websocket-key']
    const session = sessions.get(accessToken)
    if (url.pathname !== '/socket' || !tokens.has(accessToken) || !session || typeof key !== 'string') {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    peers.add(socket)
    const peer: Peer = { send: (text) => socket.write(textFrame(text)), close: () => socket.end(Buffer.from([0x88, 0])) }
    session.peer = peer
    const drop = () => {
      peers.delete(socket)
      if (session.peer === peer) {
        session.peer = undefined
        // A device whose socket is gone is no longer in its group.
        leaveSync(accessToken)
      }
    }
    socket.on(
      'data',
      frameReader(
        (text) => socketLog.push(`${session.deviceId} ${text}`),
        () => socket.write(Buffer.from([0x8a, 0])),
        () => {
          peer.close()
          drop()
        },
      ),
    )
    socket.on('close', drop)
    socket.on('error', drop)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    resume,
    user,
    options: opts,
    tokens,
    flakyHits: () => flakyHits,
    quickConnectCodes,
    remoteLog,
    taskLog,
    reportingQueries,
    adminLog,
    accounts,
    setDelay: (ms: number) => {
      delayMs = ms
    },
    peakApiRequests: () => peakApi,
    resetPeakApiRequests: () => {
      peakApi = apiInFlight
    },
    connectedDevices: () => [...sessions.values()].filter((s) => s.peer).map((s) => s.deviceId),
    socketLog,
    push: (deviceId, message) => {
      const target = [...sessions.values()].find((s) => s.deviceId === deviceId)
      if (!target?.peer) return false
      target.peer.send(JSON.stringify(message))
      return true
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of peers) socket.destroy()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
