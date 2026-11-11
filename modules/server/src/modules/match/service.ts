import type { MatchCard, MatchCreateRequest, MatchFilters, MatchLength, MatchOptions, MatchRoomSummary, MatchRoomView, MatchVote } from '../../../../contract/index.ts'
import { transaction, type Db } from '../../db/db.ts'
import { HttpError, type AuthUser } from '../../http/router.ts'
import type { JellyfinClient } from '../../jellyfin/client.ts'
import { newId, newRoomCode, seededRandom, hashSeed, shuffled } from '../../util.ts'
import { addMember, advance, newRoom, pick, removeMember, restart, RuleError, startRound, startSwiping, viewFor, vote, type RoomData } from './machine.ts'

const DEFAULT_DECK = 10
const notEnough = (filters: MatchFilters): string =>
  Object.keys(filters).length ? 'There are not enough films that fit those choices (or you have watched them all). Try fewer filters.' : 'There are not enough unwatched films to play with.'
const MIN_DECK = 4
const MAX_DECK = 20
/** How many ids go in one question to Jellyfin (the same as the guides of Retro TV use). */
const ID_BATCH = 50
const NEEDS_KEY = 'A Match on phones needs a Jellyfin API key (JELLYFIN_API_KEY) in the modules container, so that no title is dealt that somebody in the room may not watch.'
/** Rooms nobody touched for this long are forgotten. */
const KEEP_ROOMS_SECONDS = 7 * 86400
const TICKS = 10_000_000

interface RoomRow {
  id: string
  code: string
  data: string
  version: number
  updated_at: number
}

interface Dto {
  Id?: string
  Name?: string
  Type?: string
  ProductionYear?: number
  Overview?: string
  Genres?: string[]
  RunTimeTicks?: number
  CommunityRating?: number
  OfficialRating?: string
}

export function toCard(dto: Dto): MatchCard | null {
  if (!dto.Id || !dto.Name) return null
  const overview = dto.Overview ? (dto.Overview.length > 360 ? `${dto.Overview.slice(0, 357)}…` : dto.Overview) : undefined
  return {
    id: dto.Id,
    name: dto.Name,
    kind: dto.Type === 'Series' ? 'Series' : 'Movie',
    ...(dto.ProductionYear ? { year: dto.ProductionYear } : {}),
    ...(overview ? { overview } : {}),
    genres: (dto.Genres ?? []).slice(0, 4),
    ...(dto.RunTimeTicks ? { runtimeMinutes: Math.round(dto.RunTimeTicks / TICKS / 60) } : {}),
    ...(dto.CommunityRating ? { rating: Math.round(dto.CommunityRating * 10) / 10 } : {}),
    ...(dto.OfficialRating ? { officialRating: dto.OfficialRating } : {}),
  }
}

/** Whether a title fits the length asked for. A series has no length of its own: it counts as short or medium, like its episodes. */
export function fitsLength(card: MatchCard, length: MatchLength | undefined): boolean {
  if (!length) return true
  if (card.kind === 'Series') return length !== 'long'
  const minutes = card.runtimeMinutes
  if (minutes === undefined) return false
  return length === 'short' ? minutes < 90 : length === 'medium' ? minutes >= 90 && minutes <= 120 : minutes > 120
}

/** The years of a decade, as Jellyfin asks for them. */
const yearsOf = (decade: number): string[] => Array.from({ length: 10 }, (_, i) => String(decade + i))

export interface MatchService {
  options(user: AuthUser): Promise<MatchOptions>
  create(user: AuthUser, request: MatchCreateRequest, now: number): Promise<MatchRoomView>
  /** The host of a Match for phones starts the swiping, once the people are in. */
  start(user: AuthUser, id: string, now: number): Promise<MatchRoomView>
  join(user: AuthUser, code: string, now: number): MatchRoomView
  mine(user: AuthUser): MatchRoomSummary[]
  view(user: AuthUser, id: string, since: number | undefined): MatchRoomView | { unchanged: true; version: number }
  swipe(user: AuthUser, id: string, cardId: string, value: MatchVote, now: number): Promise<MatchRoomView>
  choose(user: AuthUser, id: string, cardId: string, now: number): Promise<MatchRoomView>
  again(user: AuthUser, id: string, now: number): Promise<MatchRoomView>
  leave(user: AuthUser, id: string, now: number): void
}

/** Wrong room codes per person: after a few in a minute the person waits (codes are short, and a code is all that opens a room). */
function joinAttempts() {
  const WINDOW = 60
  const MAX_WRONG = 8
  const wrong = new Map<string, number[]>()
  const recent = (userId: string, now: number): number[] => (wrong.get(userId) ?? []).filter((t) => t > now - WINDOW)
  return {
    allowed: (userId: string, now: number): boolean => recent(userId, now).length < MAX_WRONG,
    failed(userId: string, now: number): void {
      if (wrong.size > 1000) wrong.clear()
      wrong.set(userId, [...recent(userId, now), now])
    },
  }
}

export function createMatchService(db: Db, jellyfin: JellyfinClient): MatchService {
  const attempts = joinAttempts()
  const load = (id: string): { room: RoomData; row: RoomRow } => {
    const row = db.prepare('SELECT * FROM match_rooms WHERE id = ?').get(id) as RoomRow | undefined
    if (!row) throw new HttpError(404, 'That room does not exist.')
    return { room: JSON.parse(row.data) as RoomData, row }
  }
  const inRoom = (userId: string, id: string): boolean => !!db.prepare('SELECT 1 FROM match_members WHERE room_id = ? AND user_id = ?').get(id, userId)

  function save(room: RoomData, now: number, create = false): number {
    return transaction(db, () => {
      if (create) {
        db.prepare('INSERT INTO match_rooms (id, code, data, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(room.id, room.code, JSON.stringify(room), now, now)
      } else {
        db.prepare('UPDATE match_rooms SET data = ?, version = version + 1, updated_at = ? WHERE id = ?').run(JSON.stringify(room), now, room.id)
      }
      db.prepare('DELETE FROM match_members WHERE room_id = ?').run(room.id)
      const insert = db.prepare('INSERT INTO match_members (room_id, user_id) VALUES (?, ?)')
      // (The host of a Match for phones can see the room, and finds it in their list, even if they do not vote.)
      for (const userId of new Set([...room.members.map((m) => m.id), room.createdBy])) insert.run(room.id, userId)
      return (db.prepare('SELECT version FROM match_rooms WHERE id = ?').get(room.id) as { version: number }).version
    })
  }

  /** What the room's cards are meant to be, from rooms saved before there were filters too. */
  const filtersOf = (room: RoomData): MatchFilters => room.filters ?? ((room as { genre?: string }).genre ? { genre: (room as { genre?: string }).genre as string } : {})

  /**
   * Which of `ids` the person (asked about with the container's own key) may see, optionally only those that also fit `filters`. The ids
   * go in small batches: all of them in one address can be several kilobytes long, and Jellyfin refuses an address over 8 kB.
   */
  async function askAsService(userId: string, ids: readonly string[], filters?: string[]): Promise<Set<string>> {
    const found = new Set<string>()
    for (let i = 0; i < ids.length; i += ID_BATCH) {
      const batch = ids.slice(i, i + ID_BATCH)
      const answer = await jellyfin.getAsService<{ Items?: Dto[] }>('/Items', { userId, ids: batch, limit: batch.length, ...(filters ? { filters } : {}) })
      for (const d of answer.Items ?? []) if (d.Id) found.add(d.Id)
    }
    return found
  }

  /** Titles the person has not watched, in a random order, that fit the filters, none of them in `exclude`. */
  async function candidates(user: AuthUser, count: number, exclude: readonly string[], filters: MatchFilters, others: readonly string[]): Promise<MatchCard[]> {
    const answer = await jellyfin.get<{ Items?: Dto[] }>('/Items', user.token, {
      userId: user.id,
      recursive: true,
      includeItemTypes: filters.series ? ['Movie', 'Series'] : ['Movie'],
      filters: ['IsUnplayed'],
      sortBy: ['Random'],
      genres: filters.genre ? [filters.genre] : undefined,
      years: filters.decade ? yearsOf(filters.decade) : undefined,
      fields: ['Genres', 'Overview'],
      // The length is looked at here, not by Jellyfin, so more are asked for when it narrows the choice.
      limit: filters.length || filters.series ? 300 : Math.max(60, count * 6),
    })
    const skip = new Set(exclude)
    let cards = (answer.Items ?? [])
      .filter((d) => d.Id && !skip.has(d.Id) && (d.Type === 'Series' || d.RunTimeTicks))
      .map(toCard)
      .filter((c): c is MatchCard => c !== null && fitsLength(c, filters.length))
    // With the container's own Jellyfin key the other people are looked at too (without it only the library of the person asking is
    // known, and the people in a room should be able to see the same libraries).
    if (jellyfin.hasServiceKey && others.length) {
      for (const other of others) {
        if (cards.length === 0) break
        // First, what that person may see at all: a title from a library hidden from them, or over their age limit, is never dealt to
        // the room (their screen would show its name and picture). If Jellyfin cannot say, nothing is dealt: it is better to ask again.
        try {
          const seen = await askAsService(other, cards.map((c) => c.id))
          cards = cards.filter((c) => seen.has(c.id))
        } catch {
          throw new HttpError(502, 'Jellyfin could not say what everybody in the room may watch. Try again.')
        }
        if (cards.length === 0) break
        // Then, the ones they have not watched (a preference: if Jellyfin cannot say, the cards stay).
        try {
          const ok = await askAsService(other, cards.map((c) => c.id), ['IsUnplayed'])
          cards = cards.filter((c) => ok.has(c.id))
        } catch {
          // If Jellyfin cannot say, the cards stay.
        }
      }
    }
    return cards.slice(0, count)
  }

  const summary = (room: RoomData, updatedAt: number): MatchRoomSummary => ({ id: room.id, code: room.code, mode: room.mode ?? 'local', phase: room.phase, members: room.members.map((m) => m.name), updatedAt })
  /** The person is the host or one of the people who vote. */
  const takesPart = (room: RoomData, userId: string): boolean => room.createdBy === userId || room.members.some((m) => m.id === userId)

  /** Everybody who sees the cards, but the person asking: the people who vote and the host (whose screen shows them and plays the winner). */
  const othersOf = (room: RoomData, user: AuthUser): string[] => [...new Set([room.createdBy, ...room.members.map((m) => m.id)])].filter((id) => id !== user.id)

  /** After a change: if the round is over, moves the room on (asking Jellyfin for a fresh set of cards when nobody agreed). */
  async function settle(user: AuthUser, room: RoomData, now: number): Promise<MatchRoomView> {
    const step = advance(room)
    if (step.kind === 'next') {
      const version = save(step.room, now)
      return viewFor(step.room, user.id, version)
    }
    if (step.kind === 'waiting') {
      const version = save(step.room, now)
      return viewFor(step.room, user.id, version)
    }
    // Nobody liked the same film: a fresh set. If there is none to be had (nothing left that fits, or Jellyfin cannot say right now), the
    // last votes are kept all the same and the people choose a favourite among the cards of this round, so the room always finishes.
    let fresh: MatchCard[] = []
    try {
      fresh = await candidates(user, step.room.deckSize, step.room.seen, filtersOf(step.room), othersOf(step.room, user))
    } catch {
      fresh = []
    }
    // The room may have changed while Jellyfin answered.
    const { room: current, row } = load(room.id)
    if (current.round !== room.round || current.phase !== 'swipe') return viewFor(current, user.id, row.version)
    if (fresh.length === 0) {
      const choosing: RoomData = { ...step.room, phase: 'pick', picks: {} }
      const version = save(choosing, now)
      return viewFor(choosing, user.id, version)
    }
    const next = startRound({ ...step.room }, fresh)
    const version = save(next, now)
    return viewFor(next, user.id, version)
  }

  const guard = <T>(work: () => T): T => {
    try {
      return work()
    } catch (e) {
      if (e instanceof RuleError) throw new HttpError(409, e.message)
      throw e
    }
  }

  return {
    async options(user) {
      const filters = await jellyfin.get<{ Genres?: string[] }>('/Items/Filters', user.token, { userId: user.id, includeItemTypes: ['Movie', 'Series'] })
      return { genres: [...new Set(filters.Genres ?? [])].sort((a, b) => a.localeCompare(b)) }
    },

    async create(user, request, now) {
      const deckSize = Math.min(MAX_DECK, Math.max(MIN_DECK, Math.floor(request.deckSize ?? DEFAULT_DECK)))
      const genre = typeof request.genre === 'string' && request.genre.trim() ? request.genre.trim().slice(0, 60) : undefined
      const decade = typeof request.decade === 'number' && Number.isInteger(request.decade) && request.decade >= 1900 && request.decade <= 2090 ? Math.floor(request.decade / 10) * 10 : undefined
      const length = request.length === 'short' || request.length === 'medium' || request.length === 'long' ? request.length : undefined
      const filters: MatchFilters = { ...(genre ? { genre } : {}), ...(decade ? { decade } : {}), ...(length ? { length } : {}), ...(request.series ? { series: true } : {}) }
      db.prepare('DELETE FROM match_rooms WHERE updated_at < ?').run(now - KEEP_ROOMS_SECONDS)
      const mode = request.mode === 'phones' ? 'phones' : 'local'
      // On phones the cards are shown to people other than the host: without the container's own key there is no way to know what
      // each of them may see, and a child's account would be shown titles hidden from it.
      if (mode === 'phones' && !jellyfin.hasServiceKey) throw new HttpError(409, NEEDS_KEY)
      // (For phones the cards are dealt when the host starts; this only makes sure there will be enough, before everybody is called in.)
      const deck = await candidates(user, deckSize, [], filters, [])
      if (deck.length < MIN_DECK) throw new HttpError(422, notEnough(filters))
      let code = newRoomCode()
      for (let tries = 0; tries < 20 && db.prepare('SELECT 1 FROM match_rooms WHERE code = ?').get(code); tries += 1) code = newRoomCode()
      const room = newRoom({ id: newId(), code, creator: { id: user.id, name: user.name }, mode, deck, deckSize, filters })
      const version = save(room, now, true)
      return viewFor(room, user.id, version)
    },

    async start(user, id, now) {
      const { room } = load(id)
      if (room.createdBy !== user.id) throw new HttpError(403, 'Only the person who started the Match can start it.')
      if (room.phase !== 'lobby') throw new HttpError(409, 'This Match has already started.')
      if (room.members.length === 0) throw new HttpError(409, 'Nobody has joined yet.')
      // (A room opened before this was required can still be waiting in its lobby.)
      if (!jellyfin.hasServiceKey) throw new HttpError(409, NEEDS_KEY)
      const deck = await candidates(user, room.deckSize, [], filtersOf(room), othersOf(room, user))
      if (deck.length < MIN_DECK) throw new HttpError(422, notEnough(filtersOf(room)))
      const { room: current } = load(id)
      const started = guard(() => startSwiping(current, deck))
      const version = save(started, now)
      return viewFor(started, user.id, version)
    },

    join(user, code, now) {
      if (!attempts.allowed(user.id, now)) throw new HttpError(429, 'Too many wrong codes. Wait a minute and try again.')
      const row = db.prepare('SELECT * FROM match_rooms WHERE code = ?').get(code.trim().toUpperCase()) as RoomRow | undefined
      if (!row) {
        attempts.failed(user.id, now)
        throw new HttpError(404, 'No room has that code.')
      }
      const room = JSON.parse(row.data) as RoomData
      // Somebody already in gets the room back (opening the invitation twice is fine).
      if (room.members.some((m) => m.id === user.id)) return viewFor(room, user.id, row.version)
      if (room.mode === 'local') throw new HttpError(409, 'That Match is on one device only: nobody else can join it.')
      if (room.phase !== 'lobby') throw new HttpError(409, 'That Match has already started.')
      if (room.members.length >= 6) throw new HttpError(409, 'That room is full.')
      const joined = addMember(room, { id: user.id, name: user.name })
      const version = joined === room ? row.version : save(joined, now)
      return viewFor(joined, user.id, version)
    },

    mine(user) {
      const rows = db
        .prepare('SELECT r.* FROM match_rooms r JOIN match_members m ON m.room_id = r.id WHERE m.user_id = ? ORDER BY r.updated_at DESC LIMIT 20')
        .all(user.id) as unknown as RoomRow[]
      return rows.map((row) => summary(JSON.parse(row.data) as RoomData, row.updated_at))
    },

    view(user, id, since) {
      const { room, row } = load(id)
      if (!inRoom(user.id, id) || !takesPart(room, user.id)) throw new HttpError(403, 'You are not in this room.')
      if (since !== undefined && since === row.version) return { unchanged: true, version: row.version }
      return viewFor(room, user.id, row.version)
    },

    async swipe(user, id, cardId, value, now) {
      const { room } = load(id)
      return settle(user, guard(() => vote(room, user.id, cardId, value)), now)
    },

    async choose(user, id, cardId, now) {
      const { room } = load(id)
      return settle(user, guard(() => pick(room, user.id, cardId)), now)
    },

    async again(user, id, now) {
      const { room } = load(id)
      if (!takesPart(room, user.id)) throw new HttpError(403, 'You are not in this room.')
      if (room.phase !== 'done') throw new HttpError(409, 'The room has not finished.')
      const fresh = await candidates(user, room.deckSize, room.seen, filtersOf(room), othersOf(room, user))
      if (fresh.length < MIN_DECK) throw new HttpError(409, 'There are no more films to suggest.')
      // Somebody else may have started the next round while Jellyfin answered.
      const { room: latest } = load(id)
      if (latest.phase !== 'done') throw new HttpError(409, 'The room has not finished.')
      const next = restart(latest, shuffled(fresh, seededRandom(hashSeed(`${id}:${now}`))))
      const version = save(next, now)
      return viewFor(next, user.id, version)
    },

    leave(user, id, now) {
      const { room } = load(id)
      // The host closes a Match for phones for everybody.
      if (room.createdBy === user.id && room.mode === 'phones') {
        db.prepare('DELETE FROM match_rooms WHERE id = ?').run(id)
        return
      }
      if (!room.members.some((m) => m.id === user.id)) return
      const left = removeMember(room, user.id)
      // An empty room is forgotten, except a Match for phones, whose host is still looking at it.
      if (left.members.length === 0 && room.mode !== 'phones') {
        db.prepare('DELETE FROM match_rooms WHERE id = ?').run(id)
        return
      }
      // The others may have been the only ones left to finish a round.
      const step = advance(left)
      save(step.kind === 'next' || step.kind === 'waiting' ? step.room : left, now)
    },
  }
}
