import {
  advance,
  back,
  coverUrl,
  currentTrack,
  cycleRepeat,
  enqueue,
  jumpTo,
  negotiatePlayback,
  PlaybackSession,
  playNext,
  moveItem,
  removeAt,
  setShuffle,
  startQueue,
  type DeviceCapabilities,
  type DeviceState,
  type PlaybackPlan,
  type PlayQueue,
  type Session,
  type Track,
} from '../../core'
import { reportStopOnPageHide } from './browser'
import { detectCapabilities } from './capabilities'
import { attachMedia, type Attached } from './mediaAttach'
import { readPlayerPrefs, writePlayerPrefs } from './prefs'

export interface MusicState {
  queue: PlayQueue | null
  /** `loading`: asking the server and starting the stream. `paused` includes "at the end of the queue". */
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error'
  /** Playing, but waiting for data. */
  buffering: boolean
  error: string | null
  duration: number
  volume: number
  muted: boolean
  /** A sleep timer: the music pauses at that time (`minutes`) or when the song that is playing ends (`track`). */
  sleep: { kind: 'minutes'; endsAt: number } | { kind: 'track' } | null
}

const PROGRESS_INTERVAL_MS = 10_000
/** After a song that cannot be played, the next one starts after this long. */
const SKIP_BROKEN_AFTER_MS = 1800

/**
 * The music player: one `<audio>` element, the play queue, and the reporting of what you listen to. It lives
 * as long as you are signed in, so music keeps playing while you browse (and the video player pauses it).
 * It is plain TypeScript (no React); components read it through `useMusicState()` and `useMusicPosition()`.
 */
export class MusicPlayer {
  private readonly audio: HTMLAudioElement
  private readonly capabilities: () => DeviceCapabilities
  private state: MusicState
  private position = 0
  private listeners = new Set<() => void>()
  private timeListeners = new Set<() => void>()

  private loadId = 0
  private plan: PlaybackPlan | null = null
  private playback: PlaybackSession | null = null
  private attached: Attached | null = null
  private triedTranscode = false
  private progressTimer: ReturnType<typeof setInterval> | null = null
  private skipTimer: ReturnType<typeof setTimeout> | null = null
  private sleepTimer: ReturnType<typeof setTimeout> | null = null
  private connected = false
  /** Where the next song to load begins (a song handed over by another device keeps its place). */
  private startAt = 0
  private unbindSession: (() => void) | null = null

  constructor(
    private readonly session: Session,
    opts: { audio?: HTMLAudioElement; capabilities?: () => DeviceCapabilities } = {},
  ) {
    this.audio = opts.audio ?? new Audio()
    this.capabilities = opts.capabilities ?? (() => detectCapabilities())
    const prefs = readPlayerPrefs()
    this.state = { queue: null, status: 'idle', buffering: false, error: null, duration: 0, volume: prefs.volume, muted: prefs.muted, sleep: null }
    this.audio.volume = prefs.volume
    this.audio.muted = prefs.muted
  }

  // ---- subscriptions (for React's useSyncExternalStore) ------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
  subscribePosition = (listener: () => void): (() => void) => {
    this.timeListeners.add(listener)
    return () => void this.timeListeners.delete(listener)
  }
  getState = (): MusicState => this.state
  getPosition = (): number => this.position

  private set(patch: Partial<MusicState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }
  private setPosition(seconds: number): void {
    this.position = seconds
    for (const l of this.timeListeners) l()
  }

  /** The track now playing (or paused on), if any. */
  get current(): Track | undefined {
    return this.state.queue ? currentTrack(this.state.queue) : undefined
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------------

  /** Starts listening to the audio element. Safe to call again after `disconnect` (React StrictMode does). */
  connect(): void {
    if (this.connected) return
    this.connected = true
    // In the page (hidden) rather than loose: browsers treat it as ordinary page media, and tests can find it.
    this.audio.hidden = true
    this.audio.dataset.testid = 'music-audio'
    if (!this.audio.isConnected) document.body.append(this.audio)
    for (const [name, handler] of this.handlers) this.audio.addEventListener(name, handler)
    window.addEventListener('pagehide', this.onPageHide)
    this.progressTimer = setInterval(() => this.playback?.tick(this.device()), PROGRESS_INTERVAL_MS)
  }

  /** Stops everything: pauses, reports what was heard, and detaches. */
  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    for (const [name, handler] of this.handlers) this.audio.removeEventListener(name, handler)
    window.removeEventListener('pagehide', this.onPageHide)
    if (this.progressTimer) clearInterval(this.progressTimer)
    if (this.skipTimer) clearTimeout(this.skipTimer)
    this.stopSleepTimer()
    this.releaseCurrent()
    this.unbindSession?.()
    this.unbindSession = null
    this.audio.remove()
  }

  private device(): DeviceState {
    return { paused: this.audio.paused, muted: this.audio.muted, volume: this.audio.volume }
  }

  private readonly onPageHide = () => {
    if (this.playback) reportStopOnPageHide(this.playback, this.device())
  }

  // ---- controls -------------------------------------------------------------------------------------------------

  /** Plays `tracks` from `startIndex`, optionally in random order (the chosen track still plays first). */
  play(tracks: Track[], startIndex = 0, opts: { shuffle?: boolean; startSeconds?: number } = {}): void {
    const queue = startQueue(tracks, startIndex, { shuffle: opts.shuffle, repeat: this.state.queue?.repeat })
    if (!queue) return
    this.startAt = opts.startSeconds && opts.startSeconds > 0 ? opts.startSeconds : 0
    this.set({ queue })
    void this.load()
  }

  toggle(): void {
    if (this.state.status === 'playing' || (this.state.status === 'loading' && !this.audio.paused)) this.pause()
    else this.resume()
  }

  pause(): void {
    this.audio.pause()
  }

  resume(): void {
    if (!this.state.queue) return
    if (this.state.status === 'error' || this.state.status === 'idle') void this.load()
    else if (this.audio.ended || (this.plan === null && this.state.status === 'paused')) void this.load()
    else void this.audio.play().catch(() => undefined)
  }

  next(): void {
    const queue = this.state.queue
    const step = queue && advance(queue, 'skip')
    if (!step) return
    this.set({ queue: step.queue })
    void this.load()
  }

  previous(): void {
    const queue = this.state.queue
    if (!queue) return
    const step = back(queue, this.position)
    if (step.restart) {
      this.seek(0)
      void this.audio.play().catch(() => undefined)
      return
    }
    this.set({ queue: step.queue })
    void this.load()
  }

  seek(seconds: number): void {
    const max = Number.isFinite(this.audio.duration) ? this.audio.duration : seconds
    this.audio.currentTime = Math.min(Math.max(0, seconds), max)
    this.setPosition(this.audio.currentTime)
    this.playback?.stateChanged(this.audio.currentTime, this.device())
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.min(1, Math.max(0, volume))
    this.audio.muted = volume <= 0
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted
  }

  toggleMute(): void {
    this.audio.muted = !this.audio.muted
  }

  toggleShuffle(): void {
    const queue = this.state.queue
    if (queue) this.set({ queue: setShuffle(queue, !queue.shuffle) })
  }

  cycleRepeat(): void {
    const queue = this.state.queue
    if (queue) this.set({ queue: cycleRepeat(queue) })
  }

  /** Plays the track at a position of the queue. */
  jumpTo(index: number): void {
    const queue = this.state.queue
    if (!queue) return
    this.set({ queue: jumpTo(queue, index) })
    void this.load()
  }

  /** Adds tracks after the current one. Starts playing if nothing is queued. */
  playNext(tracks: Track[]): void {
    if (this.state.queue) this.set({ queue: playNext(this.state.queue, tracks) })
    else this.play(tracks)
  }

  /** Adds tracks to the end of the queue. Starts playing if nothing is queued. */
  enqueue(tracks: Track[]): void {
    if (this.state.queue) this.set({ queue: enqueue(this.state.queue, tracks) })
    else this.play(tracks)
  }

  /** Takes a track out of the queue; taking out the one playing moves on to the next. */
  remove(index: number): void {
    const queue = this.state.queue
    if (!queue) return
    const removingCurrent = index === queue.index
    const rest = removeAt(queue, index)
    if (!rest) return this.clear()
    this.set({ queue: rest })
    if (removingCurrent) void this.load()
  }

  /** Moves a track of the queue to another place (the one playing keeps playing). */
  move(from: number, to: number): void {
    if (this.state.queue) this.set({ queue: moveItem(this.state.queue, from, to) })
  }

  // ---- sleep timer ---------------------------------------------------------------------------------------------

  /** Pauses the music after this many minutes. Another call replaces the timer; 0 or less turns it off. */
  sleepIn(minutes: number): void {
    this.stopSleepTimer()
    if (!(minutes > 0)) return
    const ms = minutes * 60_000
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null
      this.set({ sleep: null })
      this.pause()
    }, ms)
    this.set({ sleep: { kind: 'minutes', endsAt: Date.now() + ms } })
  }

  /** Pauses the music when the song that is playing now ends, instead of going on to the next one. */
  sleepAfterTrack(): void {
    this.stopSleepTimer()
    this.set({ sleep: { kind: 'track' } })
  }

  cancelSleep(): void {
    this.stopSleepTimer()
  }

  private stopSleepTimer(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.sleepTimer = null
    if (this.state.sleep) this.set({ sleep: null })
  }

  /** Stops and empties the queue. */
  clear(): void {
    this.stopSleepTimer()
    this.releaseCurrent()
    this.set({ queue: null, status: 'idle', buffering: false, error: null, duration: 0 })
    this.setPosition(0)
    this.unbindSession?.()
    this.unbindSession = null
  }

  // ---- loading the current track --------------------------------------------------------------------------------

  /** Reports the end of what was playing and lets go of the stream. */
  private releaseCurrent(): void {
    this.loadId += 1
    if (this.skipTimer) clearTimeout(this.skipTimer)
    this.skipTimer = null
    const playback = this.playback
    const device = this.device()
    this.playback = null
    this.plan = null
    if (playback) void playback.stop(device)
    this.attached?.destroy()
    this.attached = null
  }

  private async load(opts: { forceTranscode?: boolean } = {}): Promise<void> {
    const track = this.current
    if (!track) return
    this.releaseCurrent()
    const id = this.loadId
    if (!opts.forceTranscode) this.triedTranscode = false
    const startSeconds = this.startAt
    this.startAt = 0
    this.set({ status: 'loading', buffering: true, error: null, duration: (track.runtimeTicks ?? 0) / 10_000_000 })
    this.setPosition(startSeconds)
    this.announce(track)
    try {
      const plan = await negotiatePlayback(this.session, track.id, {
        capabilities: this.capabilities(),
        mediaType: 'audio',
        forceTranscode: opts.forceTranscode,
      })
      if (id !== this.loadId) return
      this.plan = plan
      this.playback = new PlaybackSession(this.session, plan, startSeconds)
      this.attached = attachMedia({
        video: this.audio,
        plan,
        token: this.session.accessToken,
        authorization: this.session.api.authorizationHeader,
        startSeconds,
        onFatal: (message) => {
          if (id === this.loadId) this.fail(message)
        },
      })
    } catch (e) {
      if (id === this.loadId) this.fail(e instanceof Error ? e.message : 'Could not start this song.')
    }
  }

  private fail(message: string): void {
    const track = this.current
    this.set({ status: 'error', buffering: false, error: track ? `Could not play “${track.name}”. ${message}` : message })
    // A song that cannot be played should not stop the music: move on to the next one shortly.
    const id = this.loadId
    const queue = this.state.queue
    if (queue && advance(queue, 'skip')) {
      this.skipTimer = setTimeout(() => {
        if (id === this.loadId && this.state.status === 'error') this.next()
      }, SKIP_BROKEN_AFTER_MS)
    }
  }

  // ---- audio element events --------------------------------------------------------------------------------------

  private readonly handlers: Array<[string, () => void]> = [
    [
      'playing',
      () => {
        this.set({ status: 'playing', buffering: false, error: null })
        this.playback?.playing(this.audio.currentTime, this.device())
      },
    ],
    [
      'pause',
      () => {
        if (this.audio.ended || this.state.status === 'loading' || this.state.status === 'idle' || !this.plan) return
        this.set({ status: 'paused', buffering: false })
        this.playback?.stateChanged(this.audio.currentTime, this.device())
      },
    ],
    ['waiting', () => this.state.status === 'playing' && this.set({ buffering: true })],
    ['canplay', () => this.state.buffering && this.set({ buffering: false })],
    [
      'timeupdate',
      () => {
        this.setPosition(this.audio.currentTime)
        this.playback?.moved(this.audio.currentTime)
        this.updateSessionPosition()
      },
    ],
    [
      'durationchange',
      () => {
        if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) this.set({ duration: this.audio.duration })
      },
    ],
    [
      'volumechange',
      () => {
        this.set({ volume: this.audio.volume, muted: this.audio.muted })
        writePlayerPrefs({ volume: this.audio.volume, muted: this.audio.muted })
      },
    ],
    ['ended', () => void this.onEnded()],
    ['error', () => this.onMediaError()],
  ]

  private async onEnded(): Promise<void> {
    const queue = this.state.queue
    if (!queue) return
    const playback = this.playback
    const id = this.loadId
    // The song finished: tell the server (it counts the play), then go on to the next one.
    if (playback) await playback.ended(this.audio.duration, this.device())
    if (id !== this.loadId) return
    // "Sleep after this song": the song has played to its end, so stop here (pressing play starts the next one).
    if (this.state.sleep?.kind === 'track') {
      this.set({ sleep: null })
      const following = advance(queue, 'auto')
      if (following) this.set({ queue: following.queue })
      this.audio.pause()
      this.set({ status: 'paused', buffering: false })
      this.plan = null
      return
    }
    const step = advance(queue, 'auto')
    if (!step) {
      this.set({ status: 'paused', buffering: false })
      return
    }
    this.set({ queue: step.queue })
    void this.load()
  }

  private onMediaError(): void {
    const error = this.audio.error
    if (!error || error.code === MediaError.MEDIA_ERR_ABORTED || !this.plan) return
    if (this.attached?.handlesErrors) return
    const undecodable = error.code === MediaError.MEDIA_ERR_DECODE || error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
    // The browser could not decode what the profile promised: let the server convert it, once.
    if (undecodable && !this.triedTranscode && this.plan.playMethod === 'DirectPlay') {
      this.triedTranscode = true
      void this.load({ forceTranscode: true })
      return
    }
    this.fail(undecodable ? 'This format cannot be played in the browser.' : 'The connection to the server was lost.')
  }

  // ---- the operating system's media controls --------------------------------------------------------------------------

  /** Shows the song in the OS media overlay / lock screen and wires its buttons (best effort). */
  private announce(track: Track): void {
    this.unbindSession?.()
    this.unbindSession = null
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    try {
      const art = coverUrl(this.session.serverUrl, track, 512)
      session.metadata = new MediaMetadata({
        title: track.name,
        artist: track.artist,
        album: track.album,
        artwork: art ? [{ src: art, sizes: '512x512' }] : [],
      })
    } catch {
      // Unsupported metadata: the buttons still work.
    }
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => this.resume()],
      ['pause', () => this.pause()],
      ['previoustrack', () => this.previous()],
      ['nexttrack', () => this.next()],
      ['seekto', (d) => d.seekTime != null && this.seek(d.seekTime)],
      ['seekbackward', (d) => this.seek(this.audio.currentTime - (d.seekOffset ?? 10))],
      ['seekforward', (d) => this.seek(this.audio.currentTime + (d.seekOffset ?? 10))],
    ]
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // Not supported by this browser.
      }
    }
    this.unbindSession = () => {
      for (const [action] of actions) {
        try {
          session.setActionHandler(action, null)
        } catch {
          // ignore
        }
      }
      session.metadata = null
    }
  }

  private updateSessionPosition(): void {
    if (!('mediaSession' in navigator) || !Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate,
        position: Math.min(this.audio.currentTime, this.audio.duration),
      })
    } catch {
      // Positions the browser rejects are not worth reporting.
    }
  }
}
