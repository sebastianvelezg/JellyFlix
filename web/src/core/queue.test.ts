// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Track } from './music'
import {
  advance,
  back,
  currentTrack,
  cycleRepeat,
  enqueue,
  moveItem,
  hasNext,
  jumpTo,
  playNext,
  removeAt,
  setRepeat,
  setShuffle,
  startQueue,
  upcoming,
  type PlayQueue,
} from './queue'

const track = (id: string): Track => ({
  id,
  name: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  favorite: false,
  playCount: 0,
})
const tracks = ['a', 'b', 'c', 'd', 'e'].map(track)
const ids = (q: PlayQueue) => q.items.map((i) => i.track.id).join('')
const fixed = () => 0.42

describe('starting a queue', () => {
  it('plays from the chosen track, and an empty list gives no queue', () => {
    const q = startQueue(tracks, 2) as PlayQueue
    expect(ids(q)).toBe('abcde')
    expect(currentTrack(q)?.id).toBe('c')
    expect(startQueue([])).toBeNull()
    expect(currentTrack(startQueue(tracks, 99) as PlayQueue)?.id).toBe('e') // out of range is clamped
  })

  it('can start shuffled while still playing the chosen track first', () => {
    const q = startQueue(tracks, 3, { shuffle: true, random: fixed }) as PlayQueue
    expect(currentTrack(q)?.id).toBe('d')
    expect(q.index).toBe(0)
    expect([...ids(q)].sort().join('')).toBe('abcde')
    expect(q.shuffle).toBe(true)
  })
})

describe('moving through the queue', () => {
  it('goes to the next track and stops at the end unless repeating', () => {
    let q = startQueue(tracks, 3) as PlayQueue
    q = advance(q, 'auto')?.queue as PlayQueue
    expect(currentTrack(q)?.id).toBe('e')
    expect(hasNext(q)).toBe(false)
    expect(advance(q, 'auto')).toBeNull()
    expect(advance(q, 'skip')).toBeNull()

    const wrapped = advance(setRepeat(q, 'all'), 'auto')
    expect(currentTrack(wrapped?.queue as PlayQueue)?.id).toBe('a')
    expect(hasNext(setRepeat(q, 'all'))).toBe(true)
  })

  it('repeat-one replays the track when it ends, but skipping still moves on', () => {
    const q = setRepeat(startQueue(tracks, 1) as PlayQueue, 'one')
    const auto = advance(q, 'auto')
    expect(auto?.restart).toBe(true)
    expect(currentTrack(auto?.queue as PlayQueue)?.id).toBe('b')
    const skip = advance(q, 'skip')
    expect(skip?.restart).toBe(false)
    expect(currentTrack(skip?.queue as PlayQueue)?.id).toBe('c')
  })

  it('a one-track queue on repeat-all restarts itself', () => {
    const q = setRepeat(startQueue([track('x')]) as PlayQueue, 'all')
    expect(advance(q, 'auto')?.restart).toBe(true)
  })

  it('"previous" restarts the track after a few seconds, otherwise goes back', () => {
    const q = startQueue(tracks, 2) as PlayQueue
    expect(back(q, 10).restart).toBe(true)
    const earlier = back(q, 1)
    expect(earlier.restart).toBe(false)
    expect(currentTrack(earlier.queue)?.id).toBe('b')
    // At the very start: restart, or wrap to the last track with repeat-all.
    const first = startQueue(tracks, 0) as PlayQueue
    expect(back(first, 1).restart).toBe(true)
    expect(currentTrack(back(setRepeat(first, 'all'), 1).queue)?.id).toBe('e')
  })

  it('cycles repeat off, all, one', () => {
    let q = startQueue(tracks) as PlayQueue
    const seen = []
    for (let i = 0; i < 4; i += 1) {
      q = cycleRepeat(q)
      seen.push(q.repeat)
    }
    expect(seen).toEqual(['all', 'one', 'off', 'all'])
  })

  it('jumps to a position', () => {
    const q = jumpTo(startQueue(tracks) as PlayQueue, 3)
    expect(currentTrack(q)?.id).toBe('d')
    expect(upcoming(q).map((i) => i.track.id)).toEqual(['e'])
  })
})

describe('shuffle', () => {
  it('keeps the current track, and turning it off restores the original order around it', () => {
    const q = startQueue(tracks, 2) as PlayQueue
    const shuffled = setShuffle(q, true, fixed)
    expect(currentTrack(shuffled)?.id).toBe('c')
    expect(shuffled.index).toBe(0)
    expect(shuffled.items).toHaveLength(5)
    const on = advance(shuffled, 'skip')?.queue as PlayQueue
    const nowPlaying = currentTrack(on)?.id
    const off = setShuffle(on, false)
    expect(ids(off)).toBe('abcde')
    expect(currentTrack(off)?.id).toBe(nowPlaying)
    expect(setShuffle(q, false)).toBe(q) // already off: nothing changes
  })
})

describe('editing the queue', () => {
  it('adds to the end and right after the current track', () => {
    let q = startQueue(tracks.slice(0, 3), 0) as PlayQueue
    q = enqueue(q, [track('x')])
    expect(ids(q)).toBe('abcx')
    q = playNext(q, [track('y'), track('z')])
    expect(ids(q)).toBe('ayzbcx')
    expect(currentTrack(q)?.id).toBe('a')
    // The same song twice is allowed and stays distinct.
    q = enqueue(q, [track('a')])
    expect(new Set(q.items.map((i) => i.key)).size).toBe(q.items.length)
    expect(enqueue(q, [])).toBe(q)
  })

  it('"play next" lands after the current track in the original order too', () => {
    let q = startQueue(tracks, 1) as PlayQueue
    q = playNext(q, [track('n')])
    q = setShuffle(q, true, fixed)
    q = setShuffle(q, false)
    expect(ids(q)).toBe('abncde')
  })

  it('removes a track, keeping what is playing', () => {
    const q = startQueue(tracks, 2) as PlayQueue
    const before = removeAt(q, 0) as PlayQueue
    expect(ids(before)).toBe('bcde')
    expect(currentTrack(before)?.id).toBe('c')
    const after = removeAt(q, 4) as PlayQueue
    expect(currentTrack(after)?.id).toBe('c')
    // Removing the current track moves on to the next one; removing the last track empties the queue.
    expect(currentTrack(removeAt(q, 2) as PlayQueue)?.id).toBe('d')
    expect(removeAt(startQueue([track('x')]) as PlayQueue, 0)).toBeNull()
    expect(removeAt(q, 99)).toBe(q)
  })
})

describe('moving a track in the queue', () => {
  it('moves a track and keeps the one that is playing playing', () => {
    const queue = startQueue(tracks, 1) as PlayQueue // playing b
    const moved = moveItem(queue, 3, 0)
    expect(ids(moved)).toBe('dabce')
    expect(currentTrack(moved)?.id).toBe('b') // still b, now at index 2
    expect(moved.index).toBe(2)
    const past = moveItem(queue, 1, 4) // the playing track itself moves
    expect(ids(past)).toBe('acdeb')
    expect(currentTrack(past)?.id).toBe('b')
    expect(past.index).toBe(4)
  })

  it('follows the order tracks were added in, unless shuffle is on', () => {
    const queue = startQueue(tracks, 0) as PlayQueue
    const moved = moveItem(queue, 2, 1)
    expect(ids(moved)).toBe('acbde')
    expect(moved.original).toEqual(moved.items)
    const shuffled = setShuffle(queue, true, fixed)
    expect(moveItem(shuffled, 2, 1).original).toBe(shuffled.original)
  })

  it('ignores moves that go nowhere', () => {
    const queue = startQueue(tracks, 0) as PlayQueue
    expect(moveItem(queue, 1, 1)).toBe(queue)
    expect(moveItem(queue, -1, 1)).toBe(queue)
    expect(moveItem(queue, 0, 5)).toBe(queue)
  })
})
