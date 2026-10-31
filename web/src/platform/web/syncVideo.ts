import type { SyncAction } from '../../core'

/** What the video needs from the group, and what it tells it. */
export interface SyncVideoHost {
  /** Whether the group is playing now (the viewer pressing play while it is not asks the group, it does not start alone). */
  groupPlaying(): boolean
  /** The viewer did this on their own: the group is asked, and the answer comes back as a command. */
  requestPlay(positionSeconds: number): void
  requestPause(positionSeconds: number): void
  requestSeek(positionSeconds: number): void
  /** This player stopped to load more; or it can start. */
  buffering(positionSeconds: number): void
  ready(positionSeconds: number, playing: boolean): void
  /** The browser would not start the video by itself (it wants a click first). */
  blocked(): void
}

const NAMES = ['play', 'pause', 'seeked', 'waiting', 'canplay', 'playing', 'emptied'] as const

/** How far the video may be from where a command says before it is moved. */
const NEAR_SECONDS = 0.4
/** What this video does by itself leaves a trace; a trace that never gets its event is dropped after this long. */
const TRACE_MS = 4000

/**
 * Makes one `<video>` part of a group. Commands from the group are applied to it (pause here, play at that moment, seek there); what the
 * viewer does with the controls is not done alone: it is told to the group, which sends the command back to everyone. The events a
 * command itself causes are told apart from the viewer's, so that nothing is sent back to the group in a circle.
 */
export class VideoSync {
  private timer: ReturnType<typeof setTimeout> | null = null
  /** How many pauses, plays and seeks this class did that have not yet shown up as events, each with when it will be forgotten. */
  private own = { pause: [] as number[], play: [] as number[], seek: [] as number[] }
  /** The player has to say it is ready: at the start, after a seek, after it stopped to load. */
  private needReady = true
  private disposed = false

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly host: SyncVideoHost,
  ) {
    for (const name of NAMES) video.addEventListener(name, this.handlers[name])
    // The video may already be able to play when it is joined to the group.
    if (video.readyState >= 3) queueMicrotask(() => this.sayReady())
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const name of NAMES) this.video.removeEventListener(name, this.handlers[name])
  }

  apply(action: SyncAction): void {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const { video } = this
    switch (action.type) {
      case 'pause':
        this.pause()
        this.moveTo(action.positionSeconds)
        return
      case 'seek':
        this.moveTo(action.positionSeconds, true)
        this.needReady = true
        // (Seeking to where it already is does not seek: it is ready as soon as it can play.)
        if (video.readyState >= 3) queueMicrotask(() => this.sayReady())
        return
      case 'stop':
        this.pause()
        return
      case 'play':
        this.moveTo(action.positionSeconds)
        this.timer = setTimeout(() => {
          this.timer = null
          this.start()
        }, Math.max(0, action.delayMs))
        return
    }
  }

  private start(): void {
    if (this.disposed || !this.video.paused) return
    this.trace(this.own.play)
    void this.video.play().catch(() => {
      this.own.play.pop()
      this.host.blocked()
    })
  }

  private pause(): void {
    if (this.video.paused) return
    this.trace(this.own.pause)
    this.video.pause()
  }

  /** Moves the video, unless it is already there (or [force]d: a seek command is always answered with a ready). */
  private moveTo(seconds: number, force = false): void {
    const { video } = this
    if (!force && Math.abs(video.currentTime - seconds) <= NEAR_SECONDS) return
    this.trace(this.own.seek)
    video.currentTime = Math.max(0, seconds)
  }

  private trace(list: number[]): void {
    list.push(Date.now() + TRACE_MS)
  }

  /** True (and the trace is used up) when this event is the result of something this class did. */
  private ours(list: number[]): boolean {
    const now = Date.now()
    while (list.length > 0 && (list[0] as number) < now) list.shift()
    return list.shift() !== undefined
  }

  private sayReady(): void {
    if (!this.needReady || this.disposed || this.video.readyState < 3 || this.video.seeking) return
    this.needReady = false
    this.host.ready(this.video.currentTime, this.host.groupPlaying())
  }

  private readonly handlers = {
    play: () => {
      if (this.ours(this.own.play)) return
      // Pressed play: the group decides when everyone starts. Until it says so, the picture waits.
      if (!this.host.groupPlaying()) {
        this.pause()
        this.host.requestPlay(this.video.currentTime)
      }
    },
    pause: () => {
      if (this.ours(this.own.pause) || this.video.ended || this.video.seeking) return
      this.host.requestPause(this.video.currentTime)
    },
    seeked: () => {
      if (!this.ours(this.own.seek)) {
        this.needReady = true
        this.host.requestSeek(this.video.currentTime)
      }
      this.sayReady()
    },
    waiting: () => {
      if (this.video.seeking || this.video.paused || !this.host.groupPlaying()) return
      this.needReady = true
      this.host.buffering(this.video.currentTime)
    },
    canplay: () => this.sayReady(),
    playing: () => this.sayReady(),
    // The stream was loaded again (another quality or sound): the group is told when it can play once more.
    emptied: () => {
      this.needReady = true
    },
  }
}
