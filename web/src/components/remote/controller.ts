/**
 * What the remote-control layer needs from a player to drive it: the video player and the music player each offer one.
 * Commands from other devices ("pause", "seek", "next") and "send what I am playing to another device" go through it.
 */
export interface PlaybackController {
  pause(): void
  resume(): void
  toggle(): void
  /** Stops and leaves the player (the video player closes). Resolves when the final position has been reported. */
  stop(): void | Promise<void>
  seek(seconds: number): void
  /** Jumps by this many seconds (negative goes back). */
  skip(deltaSeconds: number): void
  next(): void
  previous(): void
  /** 0 to 1. */
  setVolume(level: number): void
  setMuted(muted: boolean | 'toggle'): void
  /** What is playing, for handing it to another device; null when there is nothing to hand over. */
  snapshot(): PlaybackSnapshot | null
}

export interface PlaybackSnapshot {
  /** The title, or the songs from the current one on, in play order. */
  itemIds: string[]
  /** Which of [itemIds] to begin with. */
  startIndex: number
  positionSeconds: number
}

export type PlaybackKind = 'video' | 'audio'
