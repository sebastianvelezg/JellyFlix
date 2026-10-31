// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseRemoteMessage } from './remoteControl'
import {
  bestOffset,
  currentItemId,
  NO_GROUP,
  offsetOf,
  parseSyncMessage,
  planCommand,
  serverToLocalMs,
  syncReducer,
  type SyncGroup,
  type SyncMessage,
  type SyncQueue,
} from './syncplay'

const group: SyncGroup = { id: 'g1', name: 'Friday film', state: 'Idle', participants: ['ana'] }
const queue: SyncQueue = { itemIds: ['m1', 'm2'], playlistItemIds: ['p1', 'p2'], index: 1, startSeconds: 12, playing: false, reason: 'NewPlaylist' }

const update = (Type: string, Data: unknown, GroupId = 'g1') => parseSyncMessage('SyncPlayGroupUpdate', { GroupId, Type, Data })

describe('reading what the server sends', () => {
  it('reads a command with its moment, its place and who it is for', () => {
    expect(
      parseSyncMessage('SyncPlayCommand', { GroupId: 'g1', PlaylistItemId: 'p1', When: '2026-10-31T10:00:05.000Z', PositionTicks: 600_000_000, Command: 'Unpause', EmittedAt: '2026-10-31T10:00:03.000Z' }),
    ).toEqual({ kind: 'command', groupId: 'g1', command: 'Unpause', whenMs: Date.parse('2026-10-31T10:00:05.000Z'), positionSeconds: 60, playlistItemId: 'p1', emittedAtMs: Date.parse('2026-10-31T10:00:03.000Z') })
  })

  it('refuses a command it does not know, without a time or without a group', () => {
    expect(parseSyncMessage('SyncPlayCommand', { GroupId: 'g1', When: '2026-10-31T10:00:05Z', Command: 'Explode' })).toBeNull()
    expect(parseSyncMessage('SyncPlayCommand', { GroupId: 'g1', Command: 'Pause' })).toBeNull()
    expect(parseSyncMessage('SyncPlayCommand', { When: '2026-10-31T10:00:05Z', Command: 'Pause' })).toBeNull()
    expect(parseSyncMessage('SyncPlayCommand', null)).toBeNull()
    expect(parseSyncMessage('Play', { GroupId: 'g1' })).toBeNull()
  })

  it('reads the group updates', () => {
    expect(update('GroupJoined', { GroupId: 'g1', GroupName: 'Friday film', State: 'Idle', Participants: ['ana', 7] })).toEqual({ kind: 'joined', group })
    expect(update('GroupLeft', 'g1')).toEqual({ kind: 'left', groupId: 'g1' })
    expect(update('UserJoined', 'bo')).toEqual({ kind: 'userJoined', name: 'bo' })
    expect(update('UserLeft', 'bo')).toEqual({ kind: 'userLeft', name: 'bo' })
    expect(update('StateUpdate', { State: 'Paused', Reason: 'Pause', PositionTicks: 50_000_000 })).toEqual({ kind: 'state', state: 'Paused', reason: 'Pause', positionSeconds: 5 })
    expect(update('NotInGroup', '')).toEqual({ kind: 'problem', problem: 'notInGroup' })
    expect(update('GroupDoesNotExist', 'g1')).toEqual({ kind: 'problem', problem: 'groupMissing' })
    expect(update('LibraryAccessDenied', null)).toEqual({ kind: 'problem', problem: 'libraryDenied' })
    expect(update('Something', {})).toBeNull()
  })

  it('reads a queue, with the item being played and where it starts', () => {
    const read = update('PlayQueue', { Reason: 'NewPlaylist', Playlist: [{ ItemId: 'm1', PlaylistItemId: 'p1' }, { ItemId: 'm2', PlaylistItemId: 'p2' }], PlayingItemIndex: 1, StartPositionTicks: 120_000_000, IsPlaying: false })
    expect(read).toEqual({ kind: 'queue', queue })
    expect(currentItemId(queue)).toBe('m2')
    expect(currentItemId(null)).toBeNull()
    // An index out of range falls back to the nearest item; a queue with nothing in it is no queue.
    expect((update('PlayQueue', { Playlist: [{ ItemId: 'a', PlaylistItemId: 'x' }], PlayingItemIndex: 9 }) as { queue: SyncQueue }).queue.index).toBe(0)
    expect(update('PlayQueue', { Playlist: [] })).toBeNull()
  })

  it('comes through the same socket reader as the remote commands', () => {
    const raw = JSON.stringify({ MessageType: 'SyncPlayCommand', Data: { GroupId: 'g1', When: '2026-10-31T10:00:05Z', Command: 'Pause', PositionTicks: 0 } })
    expect(parseRemoteMessage(raw)).toMatchObject({ kind: 'sync', message: { kind: 'command', command: 'Pause' } })
    expect(parseRemoteMessage(JSON.stringify({ MessageType: 'SyncPlayGroupUpdate', Data: { GroupId: 'g1', Type: 'Nope', Data: {} } }))).toBeNull()
  })
})

describe('the group on this device', () => {
  const msg = (m: SyncMessage) => m
  it('follows who joins and leaves, the state and the queue, and forgets everything when it leaves', () => {
    let state = syncReducer(NO_GROUP, msg({ kind: 'joined', group }))
    expect(state.group?.name).toBe('Friday film')
    state = syncReducer(state, msg({ kind: 'userJoined', name: 'bo' }))
    expect(state.group?.participants).toEqual(['ana', 'bo'])
    // The same account on a second device is a second entry; leaving takes one away.
    state = syncReducer(state, msg({ kind: 'userJoined', name: 'bo' }))
    expect(state.group?.participants).toEqual(['ana', 'bo', 'bo'])
    state = syncReducer(state, msg({ kind: 'userLeft', name: 'bo' }))
    state = syncReducer(state, msg({ kind: 'userLeft', name: 'ana' }))
    expect(state.group?.participants).toEqual(['bo'])
    expect(syncReducer(state, msg({ kind: 'userLeft', name: 'zed' })).group?.participants).toEqual(['bo'])
    state = syncReducer(state, msg({ kind: 'queue', queue }))
    state = syncReducer(state, msg({ kind: 'state', state: 'Playing', reason: 'Unpause', positionSeconds: 0 }))
    expect(state.group?.state).toBe('Playing')
    expect(currentItemId(state.queue)).toBe('m2')
    expect(syncReducer(state, msg({ kind: 'left', groupId: 'g1' }))).toEqual(NO_GROUP)
  })

  it('ignores updates when there is no group, and leaves when the server says it is not in one', () => {
    expect(syncReducer(NO_GROUP, msg({ kind: 'queue', queue }))).toEqual(NO_GROUP)
    expect(syncReducer(NO_GROUP, msg({ kind: 'state', state: 'Playing', reason: '', positionSeconds: 0 }))).toEqual(NO_GROUP)
    const inGroup = { group, queue }
    expect(syncReducer(inGroup, msg({ kind: 'problem', problem: 'notInGroup' }))).toEqual(NO_GROUP)
    // Not being allowed to see a title does not take anyone out of the group.
    expect(syncReducer(inGroup, msg({ kind: 'problem', problem: 'libraryDenied' }))).toBe(inGroup)
  })
})

describe('the server clock', () => {
  it('works out how far ahead the server is from one round trip', () => {
    // Sent at 1000 (ours); the server got it at 5100 and answered at 5110 (its clock); it arrived at 1220 (ours).
    expect(offsetOf({ sentMs: 1000, serverReceivedMs: 5100, serverSentMs: 5110, receivedMs: 1220 })).toEqual({ offsetMs: 3995, roundTripMs: 210 })
  })

  it('trusts the quickest round trip', () => {
    const slow = { sentMs: 0, serverReceivedMs: 9000, serverSentMs: 9000, receivedMs: 1000 }
    const quick = { sentMs: 2000, serverReceivedMs: 5010, serverSentMs: 5010, receivedMs: 2020 }
    expect(bestOffset([slow, quick])?.offsetMs).toBe(3000)
    expect(bestOffset([])).toBeNull()
  })

  it('turns a moment of the server into a moment of ours', () => {
    expect(serverToLocalMs(10_000, 4000)).toBe(6000)
  })
})

describe('what a command asks this device to do', () => {
  const command = (name: 'Pause' | 'Unpause' | 'Seek' | 'Stop', whenMs: number, positionSeconds = 30) =>
    ({ kind: 'command', groupId: 'g1', command: name, whenMs, positionSeconds, playlistItemId: 'p1', emittedAtMs: whenMs }) as const

  it('pauses and seeks at the place given, and stops', () => {
    expect(planCommand(command('Pause', 0, 12), 1000, 0)).toEqual({ type: 'pause', positionSeconds: 12 })
    expect(planCommand(command('Seek', 0, 40), 1000, 0)).toEqual({ type: 'seek', positionSeconds: 40 })
    expect(planCommand(command('Stop', 0), 1000, 0)).toEqual({ type: 'stop' })
  })

  it('waits for the moment to start when it is still ahead, on our clock and not the server\'s', () => {
    // The server says "at 15 000"; its clock is 4 000 ahead of ours, so on ours that is 11 000; it is 10 000 now.
    expect(planCommand(command('Unpause', 15_000, 30), 10_000, 4000)).toEqual({ type: 'play', positionSeconds: 30, delayMs: 1000 })
  })

  it('starts at once, further on, when the moment has gone by', () => {
    expect(planCommand(command('Unpause', 8000, 30), 10_000, 0)).toEqual({ type: 'play', positionSeconds: 32, delayMs: 0 })
  })
})
