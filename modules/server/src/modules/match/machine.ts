import type { MatchCard, MatchFilters, MatchMode, MatchPhase, MatchRoomView, MatchSummary, MatchVote } from '../../../../contract/index.ts'
import { hashSeed, seededRandom } from '../../util.ts'

/**
 * The rules of a Match room, with no database and no network. A room is a small bundle of data; these functions change it and say
 * what each person may see. The rules:
 *
 *  1. Everybody swipes the same cards (like or pass).
 *  2. When all have finished, the cards everybody liked go on to the next round, and so on.
 *  3. One left = the winner. None left = a fresh set of cards. Everybody liked all of them (or many rounds went by) = each person
 *     picks one favourite; if the picks differ, chance decides between them.
 */

export interface RoomMember {
  id: string
  name: string
}

/** What happened in a round that has ended, kept for the summary at the end. */
export interface RoundRecord {
  round: number
  kind: 'swipe' | 'pick'
  total: number
  /** person -> how many cards they liked. */
  liked: Record<string, number>
  /** How many everybody liked. */
  both: number
  /** person -> the name of the card they chose (pick rounds). */
  picks?: Record<string, string>
}

export interface RoomData {
  id: string
  code: string
  createdBy: string
  /** Who started it (shown to the people who join). */
  hostName: string
  mode: MatchMode
  round: number
  phase: MatchPhase
  /** The people who vote. In a Match for phones the one who started it only votes if they join from their own phone. */
  members: RoomMember[]
  deck: MatchCard[]
  /** person -> card -> vote. Only for the round in progress. */
  votes: Record<string, Record<string, MatchVote>>
  /** person -> the card chosen as favourite (pick phase). */
  picks: Record<string, string>
  /** Every card shown so far, so a fresh set does not repeat any. */
  seen: string[]
  /** What everybody liked in the round that just ended. */
  lastLiked: string[]
  deckSize: number
  /** What the cards may be; kept so a fresh set (or another round) is of the same kind. */
  filters: MatchFilters
  history: RoundRecord[]
  winner?: MatchCard
  winnerBy?: 'agreement' | 'coin' | 'none'
  /** The cards that got the most likes in the rounds that ended without everybody agreeing (best first), kept for a Match that ends without a winner. */
  near?: Array<{ card: MatchCard; likes: number }>
  finalists?: MatchCard[]
}

/** After this many rounds of swiping, the ones left go straight to choosing a favourite. */
export const MAX_SWIPE_ROUNDS = 4
/** A room where, this many times, nobody liked the same film, ends without agreement (and shows the films that came closest). */
export const MAX_EMPTY_ROUNDS = 3
/** How many finalists a Match without agreement shows. */
export const FINALISTS = 3

/**
 * A new room. One for a single device starts at once, with its cards and the person who started it. One for phones starts in the lobby,
 * without cards and without members: they come as the people join, and the host starts the swiping when they are all in.
 */
export function newRoom(init: { id: string; code: string; creator: RoomMember; mode: MatchMode; deck: MatchCard[]; deckSize: number; filters?: MatchFilters }): RoomData {
  const phones = init.mode === 'phones'
  const deck = phones ? [] : init.deck
  return {
    id: init.id,
    code: init.code,
    createdBy: init.creator.id,
    hostName: init.creator.name,
    mode: init.mode,
    round: 1,
    phase: phones ? 'lobby' : 'swipe',
    members: phones ? [] : [init.creator],
    deck,
    votes: {},
    picks: {},
    seen: deck.map((c) => c.id),
    lastLiked: [],
    deckSize: init.deckSize,
    filters: init.filters ?? {},
    history: [],
  }
}

/** The host starts the swiping of a Match for phones: the cards are dealt and the first round begins. */
export function startSwiping(room: RoomData, deck: MatchCard[]): RoomData {
  if (room.phase !== 'lobby') throw new RuleError('This Match has already started.')
  if (room.members.length === 0) throw new RuleError('Nobody has joined yet.')
  return { ...room, phase: 'swipe', round: 1, deck, votes: {}, picks: {}, seen: deck.map((c) => c.id) }
}

const isMember = (room: RoomData, userId: string): boolean => room.members.some((m) => m.id === userId)

export function addMember(room: RoomData, member: RoomMember): RoomData {
  if (isMember(room, member.id)) return room
  return { ...room, members: [...room.members, member] }
}

export function removeMember(room: RoomData, userId: string): RoomData {
  const votes = { ...room.votes }
  const picks = { ...room.picks }
  delete votes[userId]
  delete picks[userId]
  return { ...room, members: room.members.filter((m) => m.id !== userId), votes, picks }
}

export class RuleError extends Error {}

/** The cards of the round in progress with the likes they have so far, and the best of the rounds before, most liked first. */
function tally(room: RoomData): Array<{ card: MatchCard; likes: number }> {
  const best = new Map<string, { card: MatchCard; likes: number }>()
  for (const entry of room.near ?? []) best.set(entry.card.id, entry)
  for (const card of room.deck) {
    const likes = room.members.filter((m) => room.votes[m.id]?.[card.id] === 'like').length
    const before = best.get(card.id)
    if (likes > 0 && (!before || likes > before.likes)) best.set(card.id, { card, likes })
  }
  return [...best.values()].sort((a, b) => b.likes - a.likes)
}

/** Ends a Match nobody could settle: no winner, but the films that came closest are kept and shown. */
export function endWithoutAgreement(room: RoomData): RoomData {
  if (room.phase === 'lobby' || room.phase === 'done') throw new RuleError('There is nothing to end yet.')
  const finalists = tally(room)
    .slice(0, FINALISTS)
    .map((entry) => entry.card)
  const { winner: _winner, ...rest } = room
  return { ...rest, phase: 'done', winnerBy: 'none', finalists, near: [] }
}

/** Whether any film got at least one like (so there is something to show as a finalist). */
export const hasFinalists = (room: RoomData): boolean => tally(room).length > 0

export function vote(room: RoomData, userId: string, cardId: string, value: MatchVote): RoomData {
  if (!isMember(room, userId)) throw new RuleError('You are not in this room.')
  if (room.phase !== 'swipe') throw new RuleError('This round is not for swiping.')
  if (!room.deck.some((c) => c.id === cardId)) throw new RuleError('That card is not in this round.')
  return { ...room, votes: { ...room.votes, [userId]: { ...room.votes[userId], [cardId]: value } } }
}

export function pick(room: RoomData, userId: string, cardId: string): RoomData {
  if (!isMember(room, userId)) throw new RuleError('You are not in this room.')
  if (room.phase !== 'pick') throw new RuleError('This round is not for choosing.')
  if (!room.deck.some((c) => c.id === cardId)) throw new RuleError('That card is not in this round.')
  return { ...room, picks: { ...room.picks, [userId]: cardId } }
}

export function memberDone(room: RoomData, userId: string): boolean {
  if (room.phase === 'lobby') return false
  if (room.phase === 'done') return true
  if (room.phase === 'pick') return room.picks[userId] !== undefined
  const mine = room.votes[userId] ?? {}
  return room.deck.every((c) => mine[c.id] !== undefined)
}

export const roundComplete = (room: RoomData): boolean => room.phase !== 'done' && room.phase !== 'lobby' && room.members.length >= 1 && room.members.every((m) => memberDone(room, m.id))

export type Step = { kind: 'waiting'; room: RoomData } | { kind: 'next'; room: RoomData } | { kind: 'needs-fresh'; room: RoomData }

/** Moves a room on when everybody has finished the round; otherwise leaves it as it is. */
export function advance(room: RoomData): Step {
  if (!roundComplete(room)) return { kind: 'waiting', room }

  if (room.phase === 'pick') {
    const chosen = [...new Set(room.members.map((m) => room.picks[m.id]).filter((x): x is string => !!x))]
    const winnerId = chosen.length === 1 ? (chosen[0] as string) : (chosen[Math.floor(seededRandom(hashSeed(`${room.id}:${room.round}`))() * chosen.length)] as string)
    const winner = room.deck.find((c) => c.id === winnerId)
    const picks: Record<string, string> = {}
    for (const m of room.members) {
      const card = room.deck.find((c) => c.id === room.picks[m.id])
      if (card) picks[m.id] = card.name
    }
    const record: RoundRecord = { round: room.round, kind: 'pick', total: room.deck.length, liked: {}, both: 0, picks }
    return { kind: 'next', room: { ...room, history: [...(room.history ?? []), record], phase: 'done', ...(winner ? { winner } : {}), winnerBy: chosen.length === 1 ? 'agreement' : 'coin' } }
  }

  // swipe
  const liked = room.deck.filter((card) => room.members.every((m) => room.votes[m.id]?.[card.id] === 'like'))
  const lastLiked = liked.map((c) => c.id)
  const record: RoundRecord = {
    round: room.round,
    kind: 'swipe',
    total: room.deck.length,
    liked: Object.fromEntries(room.members.map((m) => [m.id, room.deck.filter((c) => room.votes[m.id]?.[c.id] === 'like').length])),
    both: liked.length,
  }
  const history = [...(room.history ?? []), record]
  if (liked.length === 1) {
    return { kind: 'next', room: { ...room, history, phase: 'done', winner: liked[0] as MatchCard, winnerBy: 'agreement', lastLiked } }
  }
  if (liked.length === 0) {
    const kept = { ...room, history, lastLiked, near: tally(room).slice(0, 6) }
    const empty = history.filter((r) => r.kind === 'swipe' && r.both === 0).length
    // Several fresh sets in a row and still no film in common: the Match ends here, with the ones that came closest.
    if (empty >= MAX_EMPTY_ROUNDS && hasFinalists(kept)) return { kind: 'next', room: endWithoutAgreement(kept) }
    return { kind: 'needs-fresh', room: kept }
  }
  const everythingLiked = liked.length === room.deck.length
  if (everythingLiked || room.round >= MAX_SWIPE_ROUNDS) {
    return { kind: 'next', room: { ...room, history, phase: 'pick', deck: liked, picks: {}, lastLiked } }
  }
  return { kind: 'next', room: { ...room, history, round: room.round + 1, deck: liked, votes: {}, lastLiked } }
}

/** A round with a fresh set of cards (when nothing was liked by everybody). */
export function startRound(room: RoomData, deck: MatchCard[]): RoomData {
  return { ...room, round: room.round + 1, phase: 'swipe', deck, votes: {}, picks: {}, seen: [...room.seen, ...deck.map((c) => c.id)] }
}

/** Starts again from the beginning with a fresh set (after a winner). */
export function restart(room: RoomData, deck: MatchCard[]): RoomData {
  const { winner: _winner, winnerBy: _by, finalists: _finalists, ...rest } = room
  return { ...rest, near: [], round: 1, phase: 'swipe', deck, votes: {}, picks: {}, lastLiked: [], history: [], seen: [...room.seen, ...deck.map((c) => c.id)] }
}

/** How the Match went, for the screen at the end. */
export function summaryOf(room: RoomData): MatchSummary {
  const history = room.history ?? []
  const swipes = history.filter((r) => r.kind === 'swipe')
  const first = swipes[0]
  const pick = history.find((r) => r.kind === 'pick')
  return {
    rounds: history.length,
    ...(first
      ? {
          firstRound: {
            total: first.total,
            both: first.both,
            percent: first.total ? Math.round((first.both / first.total) * 100) : 0,
            liked: room.members.map((m) => ({ id: m.id, name: m.name, count: first.liked[m.id] ?? 0 })),
          },
        }
      : {}),
    picks: pick ? room.members.filter((m) => pick.picks?.[m.id]).map((m) => ({ id: m.id, name: m.name, card: pick.picks?.[m.id] as string })) : [],
  }
}

/** What one person is shown. Other people's votes stay hidden, except for what everybody liked once a round is over. */
export function viewFor(room: RoomData, userId: string, version: number): MatchRoomView {
  const mine = room.votes[userId] ?? {}
  const remaining = room.phase === 'swipe' ? room.deck.filter((c) => mine[c.id] === undefined) : room.phase === 'pick' && room.picks[userId] === undefined ? room.deck : []
  return {
    id: room.id,
    code: room.code,
    mode: room.mode ?? 'local',
    hostId: room.createdBy,
    hostName: room.hostName ?? '',
    filters: room.filters ?? {},
    ...(room.phase === 'done' ? { summary: summaryOf(room) } : {}),
    version,
    phase: room.phase,
    round: room.round,
    me: userId,
    members: room.members.map((m) => ({ id: m.id, name: m.name, done: memberDone(room, m.id) })),
    deck: room.deck,
    myVotes: mine,
    ...(room.picks[userId] ? { myPick: room.picks[userId] } : {}),
    remaining,
    lastLiked: room.lastLiked,
    ...(room.winner ? { winner: room.winner } : {}),
    ...(room.winnerBy ? { winnerBy: room.winnerBy } : {}),
    ...(room.winnerBy === 'none' ? { finalists: room.finalists ?? [] } : {}),
  }
}
