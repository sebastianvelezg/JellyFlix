import { getSyncPlayApi } from '@jellyfin/sdk/lib/utils/api/sync-play-api'
import type { Session } from './jellyfin'
import { secondsToTicks, ticksToSeconds } from './ticks'

/**
 * Watch together, on the server's own SyncPlay: a group is made on the server, everyone in it is told by the server's socket what to do
 * (pause, play at a given moment, seek), and each one tells the server what happened to them (paused, buffering, ready). The listening
 * and the video are in the browser (`platform/web`); everything here is plain data and calls.
 */

export type GroupState = 'Idle' | 'Waiting' | 'Paused' | 'Playing'

export interface SyncGroup {
  id: string
  name: string
  state: GroupState
  /** The names of the people in the group. */
  participants: string[]
}

/** What the group is watching: one title, or a list of them, with the one being played. */
export interface SyncQueue {
  itemIds: string[]
  playlistItemIds: string[]
  index: number
  startSeconds: number
  playing: boolean
  reason: string
}

export const currentItemId = (queue: SyncQueue | null): string | null => queue?.itemIds[queue.index] ?? null

export type SyncCommandName = 'Pause' | 'Unpause' | 'Seek' | 'Stop'

export type SyncMessage =
  | { kind: 'command'; groupId: string; command: SyncCommandName; whenMs: number; positionSeconds: number; playlistItemId: string; emittedAtMs: number }
  | { kind: 'joined'; group: SyncGroup }
  | { kind: 'left'; groupId: string }
  | { kind: 'userJoined'; name: string }
  | { kind: 'userLeft'; name: string }
  | { kind: 'state'; state: GroupState; reason: string; positionSeconds: number }
  | { kind: 'queue'; queue: SyncQueue }
  | { kind: 'problem'; problem: 'notInGroup' | 'groupMissing' | 'libraryDenied' }

const STATES: ReadonlySet<string> = new Set<GroupState>(['Idle', 'Waiting', 'Paused', 'Playing'])
const COMMANDS: ReadonlySet<string> = new Set<SyncCommandName>(['Pause', 'Unpause', 'Seek', 'Stop'])

const asString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
const asTime = (value: unknown): number | null => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isNaN(ms) ? null : ms
}
const asState = (value: unknown): GroupState => (typeof value === 'string' && STATES.has(value) ? (value as GroupState) : 'Idle')

function toGroup(data: Record<string, unknown>): SyncGroup | null {
  const id = asString(data.GroupId)
  if (!id) return null
  return {
    id,
    name: asString(data.GroupName) ?? '',
    state: asState(data.State),
    participants: Array.isArray(data.Participants) ? data.Participants.filter((p): p is string => typeof p === 'string') : [],
  }
}

function toQueue(data: Record<string, unknown>): SyncQueue | null {
  const playlist = Array.isArray(data.Playlist) ? (data.Playlist as Array<Record<string, unknown>>) : []
  const entries = playlist.map((entry) => ({ itemId: asString(entry?.ItemId), playlistItemId: asString(entry?.PlaylistItemId) ?? '' })).filter((e): e is { itemId: string; playlistItemId: string } => e.itemId !== null)
  if (entries.length === 0) return null
  const wanted = typeof data.PlayingItemIndex === 'number' ? data.PlayingItemIndex : 0
  return {
    itemIds: entries.map((e) => e.itemId),
    playlistItemIds: entries.map((e) => e.playlistItemId),
    index: Math.min(Math.max(0, wanted), entries.length - 1),
    startSeconds: ticksToSeconds(typeof data.StartPositionTicks === 'number' ? data.StartPositionTicks : 0),
    playing: data.IsPlaying === true,
    reason: asString(data.Reason) ?? '',
  }
}

/** Reads one socket message that belongs to SyncPlay; anything else (or anything malformed) gives null. */
export function parseSyncMessage(type: string, data: unknown): SyncMessage | null {
  if (data === null || typeof data !== 'object') return null
  const body = data as Record<string, unknown>
  if (type === 'SyncPlayCommand') {
    const groupId = asString(body.GroupId)
    const command = typeof body.Command === 'string' && COMMANDS.has(body.Command) ? (body.Command as SyncCommandName) : null
    const whenMs = asTime(body.When)
    if (!groupId || !command || whenMs === null) return null
    return {
      kind: 'command',
      groupId,
      command,
      whenMs,
      positionSeconds: ticksToSeconds(typeof body.PositionTicks === 'number' ? body.PositionTicks : 0),
      playlistItemId: asString(body.PlaylistItemId) ?? '',
      emittedAtMs: asTime(body.EmittedAt) ?? whenMs,
    }
  }
  if (type !== 'SyncPlayGroupUpdate') return null
  const inner = (body.Data ?? null) as unknown
  const record = inner !== null && typeof inner === 'object' ? (inner as Record<string, unknown>) : {}
  switch (body.Type) {
    case 'GroupJoined': {
      const group = toGroup(record)
      return group ? { kind: 'joined', group } : null
    }
    case 'GroupLeft':
      return { kind: 'left', groupId: asString(body.GroupId) ?? '' }
    case 'UserJoined':
      return typeof inner === 'string' ? { kind: 'userJoined', name: inner } : null
    case 'UserLeft':
      return typeof inner === 'string' ? { kind: 'userLeft', name: inner } : null
    case 'StateUpdate':
      return { kind: 'state', state: asState(record.State), reason: asString(record.Reason) ?? '', positionSeconds: ticksToSeconds(typeof record.PositionTicks === 'number' ? record.PositionTicks : 0) }
    case 'PlayQueue': {
      const queue = toQueue(record)
      return queue ? { kind: 'queue', queue } : null
    }
    case 'NotInGroup':
      return { kind: 'problem', problem: 'notInGroup' }
    case 'GroupDoesNotExist':
      return { kind: 'problem', problem: 'groupMissing' }
    case 'LibraryAccessDenied':
      return { kind: 'problem', problem: 'libraryDenied' }
    default:
      return null
  }
}

// ---- the state of the group on this device -----------------------------------------------------------------------

export interface SyncState {
  group: SyncGroup | null
  queue: SyncQueue | null
}

export const NO_GROUP: SyncState = { group: null, queue: null }

/** The group as this device knows it, after a message from the server. Commands do not change it (the state updates do). */
export function syncReducer(state: SyncState, message: SyncMessage): SyncState {
  switch (message.kind) {
    case 'joined':
      return { group: message.group, queue: null }
    case 'left':
      return NO_GROUP
    case 'problem':
      return message.problem === 'libraryDenied' ? state : NO_GROUP
    // (Two devices of one account are two entries with the same name: each join adds one, each leave takes one away.)
    case 'userJoined':
      return state.group ? { ...state, group: { ...state.group, participants: [...state.group.participants, message.name] } } : state
    case 'userLeft': {
      if (!state.group) return state
      const at = state.group.participants.indexOf(message.name)
      return at < 0 ? state : { ...state, group: { ...state.group, participants: state.group.participants.filter((_, i) => i !== at) } }
    }
    case 'state':
      return state.group ? { ...state, group: { ...state.group, state: message.state } } : state
    case 'queue':
      return state.group ? { ...state, queue: message.queue } : state
    case 'command':
      return state
  }
}

// ---- the clock ---------------------------------------------------------------------------------------------------

/** One round trip to the server's clock: when it was sent, when the server got it and answered, when the answer arrived (all in ms). */
export interface TimeSample {
  sentMs: number
  serverReceivedMs: number
  serverSentMs: number
  receivedMs: number
}

/** How far the server's clock is ahead of this one (negative when it is behind), and how long the round trip took. */
export function offsetOf(sample: TimeSample): { offsetMs: number; roundTripMs: number } {
  const roundTripMs = sample.receivedMs - sample.sentMs - (sample.serverSentMs - sample.serverReceivedMs)
  const offsetMs = (sample.serverReceivedMs - sample.sentMs + (sample.serverSentMs - sample.receivedMs)) / 2
  return { offsetMs, roundTripMs }
}

/** The offset of the quickest round trip: the shortest one is the one least disturbed by the network. Null without samples. */
export function bestOffset(samples: TimeSample[]): { offsetMs: number; roundTripMs: number } | null {
  let best: { offsetMs: number; roundTripMs: number } | null = null
  for (const sample of samples) {
    const found = offsetOf(sample)
    if (!best || found.roundTripMs < best.roundTripMs) best = found
  }
  return best
}

export const serverToLocalMs = (serverMs: number, offsetMs: number): number => serverMs - offsetMs
export const localToServerMs = (localMs: number, offsetMs: number): number => localMs + offsetMs

/** Reads the server's clock a few times and keeps the best. */
export async function measureClock(session: Session, rounds = 5): Promise<{ offsetMs: number; roundTripMs: number } | null> {
  const samples: TimeSample[] = []
  for (let i = 0; i < rounds; i++) {
    const sentMs = Date.now()
    try {
      const { data } = await session.api.axiosInstance.get<{ RequestReceptionTime?: string; ResponseTransmissionTime?: string }>(`${session.api.basePath}/GetUtcTime`, {
        headers: { Authorization: session.api.authorizationHeader },
      })
      const receivedMs = Date.now()
      const serverReceivedMs = asTime(data.RequestReceptionTime)
      const serverSentMs = asTime(data.ResponseTransmissionTime)
      if (serverReceivedMs !== null && serverSentMs !== null) samples.push({ sentMs, serverReceivedMs, serverSentMs, receivedMs })
    } catch {
      // A lost round trip is only one sample fewer.
    }
  }
  return bestOffset(samples)
}

// ---- what to do with a command -----------------------------------------------------------------------------------

export type SyncAction =
  | { type: 'pause'; positionSeconds: number }
  | { type: 'play'; positionSeconds: number; delayMs: number }
  | { type: 'seek'; positionSeconds: number }
  | { type: 'stop' }

/**
 * What this device has to do for a command. "Unpause" says at what moment (the server's clock) to start: if that is still ahead, wait for it;
 * if it has gone by, start now at the place the others have reached by then.
 */
export function planCommand(message: Extract<SyncMessage, { kind: 'command' }>, nowLocalMs: number, offsetMs: number): SyncAction {
  switch (message.command) {
    case 'Pause':
      return { type: 'pause', positionSeconds: message.positionSeconds }
    case 'Seek':
      return { type: 'seek', positionSeconds: message.positionSeconds }
    case 'Stop':
      return { type: 'stop' }
    case 'Unpause': {
      const whenLocal = serverToLocalMs(message.whenMs, offsetMs)
      if (whenLocal >= nowLocalMs) return { type: 'play', positionSeconds: message.positionSeconds, delayMs: whenLocal - nowLocalMs }
      return { type: 'play', positionSeconds: message.positionSeconds + (nowLocalMs - whenLocal) / 1000, delayMs: 0 }
    }
  }
}

// ---- calls to the server -----------------------------------------------------------------------------------------

/** The account is not allowed to use SyncPlay (or to make groups): the administrator decides that. */
export class SyncPlayDenied extends Error {
  constructor() {
    super('Watching together is not allowed for this account.')
    this.name = 'SyncPlayDenied'
  }
}

async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    if (status === 403 || status === 401) throw new SyncPlayDenied()
    throw e
  }
}

/** The groups that can be joined right now. */
export async function listGroups(session: Session): Promise<SyncGroup[]> {
  const { data } = await guarded(() => getSyncPlayApi(session.api).syncPlayGetGroups())
  return (data ?? []).map((g) => toGroup(g as Record<string, unknown>)).filter((g): g is SyncGroup => g !== null)
}

/** Makes a group and joins it. The group comes back when the server says what it made (older servers only say it by the socket). */
export async function createGroup(session: Session, name: string): Promise<SyncGroup | null> {
  const { data } = await guarded(() => getSyncPlayApi(session.api).syncPlayCreateGroup({ newGroupRequestDto: { GroupName: name } }))
  return data && typeof data === 'object' ? toGroup(data as Record<string, unknown>) : null
}
export const joinGroup = (session: Session, groupId: string) => guarded(() => getSyncPlayApi(session.api).syncPlayJoinGroup({ joinGroupRequestDto: { GroupId: groupId } }))
export const leaveGroup = (session: Session) => guarded(() => getSyncPlayApi(session.api).syncPlayLeaveGroup())

/** A new title for the whole group: everyone's player opens it, waits for the others and starts together. */
export const setGroupQueue = (session: Session, itemIds: string[], startIndex = 0, startSeconds = 0) =>
  guarded(() => getSyncPlayApi(session.api).syncPlaySetNewQueue({ playRequestDto: { PlayingQueue: itemIds, PlayingItemPosition: startIndex, StartPositionTicks: secondsToTicks(startSeconds) } }))

export const groupPause = (session: Session) => guarded(() => getSyncPlayApi(session.api).syncPlayPause())
export const groupUnpause = (session: Session) => guarded(() => getSyncPlayApi(session.api).syncPlayUnpause())
export const groupStop = (session: Session) => guarded(() => getSyncPlayApi(session.api).syncPlayStop())
export const groupSeek = (session: Session, positionSeconds: number) => guarded(() => getSyncPlayApi(session.api).syncPlaySeek({ seekRequestDto: { PositionTicks: secondsToTicks(positionSeconds) } }))

/** What a player says about itself when it stops to buffer or is ready to go: where it is, whether it is playing, and when (server clock). */
export interface PlayerReport {
  serverNowMs: number
  positionSeconds: number
  playing: boolean
  playlistItemId: string
}

const reportBody = (report: PlayerReport) => ({ When: new Date(report.serverNowMs).toISOString(), PositionTicks: secondsToTicks(report.positionSeconds), IsPlaying: report.playing, PlaylistItemId: report.playlistItemId })

export const reportBuffering = (session: Session, report: PlayerReport) => guarded(() => getSyncPlayApi(session.api).syncPlayBuffering({ bufferRequestDto: reportBody(report) }))
export const reportReady = (session: Session, report: PlayerReport) => guarded(() => getSyncPlayApi(session.api).syncPlayReady({ readyRequestDto: reportBody(report) }))

/** A player that is not on screen asks the group not to wait for it (and asks it to wait again once it is back). */
export const setIgnoreWait = (session: Session, ignore: boolean) => guarded(() => getSyncPlayApi(session.api).syncPlaySetIgnoreWait({ ignoreWaitRequestDto: { IgnoreWait: ignore } }))
/** Tells the server how long this device takes to answer, so that it can pick a start moment everyone can meet. */
export const sendPing = (session: Session, pingMs: number) => guarded(() => getSyncPlayApi(session.api).syncPlayPing({ pingRequestDto: { Ping: Math.round(pingMs) } }))
