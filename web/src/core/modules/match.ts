import type { MatchCreateRequest, MatchFilters, MatchOptions, MatchRoomSummary, MatchRoomView, MatchVote } from './contract'
import type { ModulesClient } from './client'

export const matchOptions = (client: ModulesClient) => client.get<MatchOptions>('/v1/match/options')
export const myRooms = (client: ModulesClient) => client.get<MatchRoomSummary[]>('/v1/match/rooms')
export const createRoom = (client: ModulesClient, request: MatchCreateRequest) => client.post<MatchRoomView>('/v1/match/rooms', request)
export const joinRoom = (client: ModulesClient, code: string) => client.post<MatchRoomView>('/v1/match/join', { code })
export const swipeCard = (client: ModulesClient, roomId: string, cardId: string, vote: MatchVote) =>
  client.post<MatchRoomView>(`/v1/match/rooms/${encodeURIComponent(roomId)}/swipe`, { cardId, vote })
export const pickCard = (client: ModulesClient, roomId: string, cardId: string) =>
  client.post<MatchRoomView>(`/v1/match/rooms/${encodeURIComponent(roomId)}/pick`, { cardId })
/** The host of a Match for phones starts the swiping, once the people are in. */
export const startMatch = (client: ModulesClient, roomId: string) => client.post<MatchRoomView>(`/v1/match/rooms/${encodeURIComponent(roomId)}/start`)
export const playAgain = (client: ModulesClient, roomId: string) => client.post<MatchRoomView>(`/v1/match/rooms/${encodeURIComponent(roomId)}/again`)
export const leaveRoom = (client: ModulesClient, roomId: string) => client.del<{ ok: true }>(`/v1/match/rooms/${encodeURIComponent(roomId)}`)

/** The room as it is now, or `unchanged` when it has not moved since `since`. */
export const readRoom = (client: ModulesClient, roomId: string, since?: number) =>
  client.get<MatchRoomView | { unchanged: true; version: number }>(`/v1/match/rooms/${encodeURIComponent(roomId)}${since !== undefined ? `?since=${since}` : ''}`)

export const isUnchanged = (answer: MatchRoomView | { unchanged: true; version: number }): answer is { unchanged: true; version: number } => 'unchanged' in answer

/** What the room is waiting for, from this person's side. */
export type RoomWait = 'others-to-finish' | 'you' | 'none'

export function whatIsWaiting(room: MatchRoomView): RoomWait {
  if (room.phase === 'done' || room.phase === 'lobby') return 'none'
  if (room.remaining.length > 0) return 'you'
  return room.members.some((m) => m.id !== room.me && !m.done) ? 'others-to-finish' : 'none'
}

/**
 * The link that takes another person straight into a room (what the QR code holds). It is this app's own address, with the address of
 * the modules container added when that is a full address the other phone may not know yet (a path such as "/modules" needs nothing).
 */
export function joinLink(here: { origin: string; pathname: string }, modulesUrl: string, code: string): string {
  const modules = /^https?:\/\//i.test(modulesUrl) ? `?modules=${encodeURIComponent(modulesUrl)}` : ''
  return `${here.origin}${here.pathname}${modules}#/modules/match?join=${encodeURIComponent(code)}`
}

/** The decades a Match can be limited to, newest first (the first year of each). */
export const MATCH_DECADES: readonly number[] = [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950]

/** Whether any filter is set. */
export const hasFilters = (filters: MatchFilters): boolean => !!(filters.genre || filters.decade || filters.length || filters.series)
