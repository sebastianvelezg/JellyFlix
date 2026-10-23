import { shuffle } from './library'
import type { Track } from './music'

export type RepeatMode = 'off' | 'all' | 'one'

/** A track in the queue. The key tells two copies of the same track apart. */
export interface QueueItem {
  key: number
  track: Track
}

/**
 * What is playing and what comes next. Immutable: every operation returns a new queue, so UI code can
 * compare and render it directly. It has no idea about audio elements or servers, which keeps it reusable
 * (a TV or phone app can drive its own player from it).
 */
export interface PlayQueue {
  /** Play order. With shuffle on, this is the shuffled order. */
  items: QueueItem[]
  /** The order the tracks were added in, restored when shuffle is turned off. */
  original: QueueItem[]
  index: number
  shuffle: boolean
  repeat: RepeatMode
  /** The key to give the next track that is added. */
  nextKey: number
}

type Random = () => number

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)

/** Starts a queue with `tracks`, playing `startIndex` first. With `shuffle`, that track still plays first and the rest follow in random order. */
export function startQueue(
  tracks: Track[],
  startIndex = 0,
  opts: { shuffle?: boolean; repeat?: RepeatMode; random?: Random } = {},
): PlayQueue | null {
  if (tracks.length === 0) return null
  const original = tracks.map((track, key) => ({ key, track }))
  const queue: PlayQueue = {
    items: original,
    original,
    index: clamp(startIndex, 0, tracks.length - 1),
    shuffle: false,
    repeat: opts.repeat ?? 'off',
    nextKey: tracks.length,
  }
  return opts.shuffle ? setShuffle(queue, true, opts.random) : queue
}

export function currentItem(queue: PlayQueue): QueueItem | undefined {
  return queue.items[queue.index]
}

export function currentTrack(queue: PlayQueue): Track | undefined {
  return currentItem(queue)?.track
}

/** Tracks that will play after the current one. */
export function upcoming(queue: PlayQueue): QueueItem[] {
  return queue.items.slice(queue.index + 1)
}

/** Whether `next` would move to another track (it would not at the end with repeat off). */
export function hasNext(queue: PlayQueue): boolean {
  return queue.repeat === 'all' ? queue.items.length > 0 : queue.index < queue.items.length - 1
}

/**
 * The queue after the current track ends on its own (`auto`) or is skipped. At the end it wraps with
 * repeat-all and otherwise returns null (playback stops). With repeat-one, a track that ends by itself plays again
 * (`restart`); skipping still moves on.
 */
export function advance(queue: PlayQueue, reason: 'auto' | 'skip'): { queue: PlayQueue; restart: boolean } | null {
  if (reason === 'auto' && queue.repeat === 'one') return { queue, restart: true }
  if (queue.index < queue.items.length - 1) return { queue: { ...queue, index: queue.index + 1 }, restart: false }
  if (queue.repeat === 'all') return { queue: { ...queue, index: 0 }, restart: queue.items.length === 1 }
  return null
}

/**
 * "Previous": more than a few seconds into a track it starts the track over; otherwise it goes back one
 * (wrapping with repeat-all, or restarting the first track).
 */
export function back(queue: PlayQueue, positionSeconds: number, restartAfter = 3): { queue: PlayQueue; restart: boolean } {
  if (positionSeconds > restartAfter) return { queue, restart: true }
  if (queue.index > 0) return { queue: { ...queue, index: queue.index - 1 }, restart: false }
  if (queue.repeat === 'all' && queue.items.length > 1) return { queue: { ...queue, index: queue.items.length - 1 }, restart: false }
  return { queue, restart: true }
}

/** Jumps to a position in the play order. */
export function jumpTo(queue: PlayQueue, index: number): PlayQueue {
  return { ...queue, index: clamp(index, 0, queue.items.length - 1) }
}

/**
 * Shuffle on: the current track stays first and everything else follows in random order. Shuffle off: the
 * original order comes back, with the current track still current.
 */
export function setShuffle(queue: PlayQueue, on: boolean, random: Random = Math.random): PlayQueue {
  if (on === queue.shuffle) return queue
  const current = currentItem(queue)
  if (!current) return { ...queue, shuffle: on }
  if (on) {
    const others = queue.items.filter((item) => item.key !== current.key)
    return { ...queue, shuffle: true, items: [current, ...shuffle(others, random)], index: 0 }
  }
  return { ...queue, shuffle: false, items: queue.original, index: Math.max(0, queue.original.findIndex((i) => i.key === current.key)) }
}

export function setRepeat(queue: PlayQueue, repeat: RepeatMode): PlayQueue {
  return { ...queue, repeat }
}

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }
export function cycleRepeat(queue: PlayQueue): PlayQueue {
  return setRepeat(queue, NEXT_REPEAT[queue.repeat])
}

const wrap = (queue: PlayQueue, tracks: Track[]) =>
  tracks.map((track, i): QueueItem => ({ key: queue.nextKey + i, track }))

/** Adds tracks to the end of the queue. */
export function enqueue(queue: PlayQueue, tracks: Track[]): PlayQueue {
  if (tracks.length === 0) return queue
  const added = wrap(queue, tracks)
  return { ...queue, items: [...queue.items, ...added], original: [...queue.original, ...added], nextKey: queue.nextKey + tracks.length }
}

/** Adds tracks right after the current one ("Play next"). */
export function playNext(queue: PlayQueue, tracks: Track[]): PlayQueue {
  if (tracks.length === 0) return queue
  const added = wrap(queue, tracks)
  const at = queue.index + 1
  const items = [...queue.items.slice(0, at), ...added, ...queue.items.slice(at)]
  // In the original order they go after the current track too, so turning shuffle off keeps them close.
  const current = currentItem(queue)
  const originalAt = current ? queue.original.findIndex((i) => i.key === current.key) + 1 : queue.original.length
  const original = [...queue.original.slice(0, originalAt), ...added, ...queue.original.slice(originalAt)]
  return { ...queue, items, original, nextKey: queue.nextKey + tracks.length }
}

/**
 * Moves the track at `from` to `to`. The track that is playing keeps playing (the queue follows it to its new place). With
 * shuffle off the order they were added in follows the move, so it is not undone by turning shuffle on and off.
 */
export function moveItem(queue: PlayQueue, from: number, to: number): PlayQueue {
  const n = queue.items.length
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return queue
  const items = [...queue.items]
  const [moved] = items.splice(from, 1)
  items.splice(to, 0, moved as QueueItem)
  const playing = queue.items[queue.index]
  return { ...queue, items, original: queue.shuffle ? queue.original : items, index: playing ? items.indexOf(playing) : queue.index }
}

/**
 * Takes one track out. Removing the current track moves on to the one after it (or returns null if the queue
 * is now empty).
 */
export function removeAt(queue: PlayQueue, index: number): PlayQueue | null {
  const item = queue.items[index]
  if (!item) return queue
  const items = queue.items.filter((_, i) => i !== index)
  if (items.length === 0) return null
  const original = queue.original.filter((i) => i.key !== item.key)
  const newIndex = index < queue.index ? queue.index - 1 : Math.min(queue.index, items.length - 1)
  return { ...queue, items, original, index: newIndex }
}
