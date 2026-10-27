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
import { readPlayerPrefs, writePlayerPrefs, type PlayerPrefs } from './prefs'

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
/** The next song is made ready this many seconds (plus the crossfade) before the one playing ends. */
const PRELOAD_BEFORE_END_SECONDS = 25
/** The fade between two songs is redrawn this often. */
const FADE_STEP_MS = 50
/** Settings are read from storage at most this often while a song plays. */
const PREFS_CACHE_MS = 1000

/** A song loaded ahead of time on the spare audio element, so it can follow the one playing without a gap. */
interface Preloaded {
  trackId: string
  audio: HTMLAudioElement
  plan: PlaybackPlan
  attached: Attached
}

/** The song that is fading out while the next one fades in. */
interface Outgoing {
  audio: HTMLAudioElement
  attached: Attached | null
}

/**
 * The music player: one `<audio>` element, the play queue, and the reporting of what you listen to. It lives
 * as long as you are signed in, so music keeps playing while you browse (and the video player pauses it).
 * It is plain TypeScript (no React); components read it through `useMusicState()` and `useMusicPosition()`.
 */
export class MusicPlayer {
  /** The element of the song playing now. A second one (`spare`) gets the next song ready, and they swap at each change. */
  private audio: HTMLAudioElement
  private spare: HTMLAudioElement
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
  /** The volume and mute choice. The elements follow it (during a crossfade their own volume is part-way). */
  private volume: number
  private muted: boolean
  private pre: Preloaded | null = null
  private preloadToken = 0
  /** The song being asked about for the spare element (so it is not asked twice). */
  private preloading: string | null = null
  private fade: { outgoing: Outgoing; timer: ReturnType<typeof setInterval> } | null = null
  private prefsRead: { at: number; prefs: PlayerPrefs } | null = null
  private readonly handlerSets = new Map<HTMLAudioElement, Array<[string, () => void]>>()
  /** The visualizer is on: songs are loaded in a way that lets the browser read their sound (CORS), and the sound is analysed. */
  private analysis: boolean
  /** Once a song's sound runs through the analyser it must keep being loaded that way, or it would play silent. */
  private corsSticky = false
  private readonly corsLoaded = new WeakSet<HTMLAudioElement>()
  private graph: { ctx: AudioContext; analyser: AnalyserNode; connected: WeakSet<HTMLAudioElement> } | null = null

  constructor(
    private readonly session: Session,
    opts: { audio?: HTMLAudioElement; capabilities?: () => DeviceCapabilities } = {},
  ) {
    this.audio = opts.audio ?? new Audio()
    this.spare = new Audio()
    this.capabilities = opts.capabilities ?? (() => detectCapabilities())
    const prefs = readPlayerPrefs()
    this.volume = prefs.volume
    this.muted = prefs.muted
    this.analysis = prefs.visualizer
    this.state = { queue: null, status: 'idle', buffering: false, error: null, duration: 0, volume: prefs.volume, muted: prefs.muted, sleep: null }
    this.syncElements()
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
    for (const el of [this.audio, this.spare]) {
      el.hidden = true
      if (!el.isConnected) document.body.append(el)
      const handlers = this.handlersFor(el)
      this.handlerSets.set(el, handlers)
      for (const [name, handler] of handlers) el.addEventListener(name, handler)
    }
    this.labelElements()
    window.addEventListener('pagehide', this.onPageHide)
    this.progressTimer = setInterval(() => this.playback?.tick(this.device()), PROGRESS_INTERVAL_MS)
  }

  /** Stops everything: pauses, reports what was heard, and detaches. */
  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    for (const [el, handlers] of this.handlerSets) for (const [name, handler] of handlers) el.removeEventListener(name, handler)
    this.handlerSets.clear()
    window.removeEventListener('pagehide', this.onPageHide)
    if (this.progressTimer) clearInterval(this.progressTimer)
    if (this.skipTimer) clearTimeout(this.skipTimer)
    this.stopSleepTimer()
    this.releaseCurrent()
    this.unbindSession?.()
    this.unbindSession = null
    this.audio.remove()
    this.spare.remove()
    void this.graph?.ctx.close().catch(() => undefined)
    this.graph = null
  }

  /** The element playing is the one tests and tools look for; the spare one is told apart. */
  private labelElements(): void {
    this.audio.dataset.testid = 'music-audio'
    this.spare.dataset.testid = 'music-audio-spare'
  }

  private device(): DeviceState {
    return { paused: this.audio.paused, muted: this.muted, volume: this.volume }
  }

  /** The settings that matter while a song plays (crossfade, gapless), without reading storage at every tick. */
  private prefs(): PlayerPrefs {
    const now = Date.now()
    if (!this.prefsRead || now - this.prefsRead.at > PREFS_CACHE_MS) this.prefsRead = { at: now, prefs: readPlayerPrefs() }
    return this.prefsRead.prefs
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
    this.endFade()
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
    this.endFade()
    const max = Number.isFinite(this.audio.duration) ? this.audio.duration : seconds
    this.audio.currentTime = Math.min(Math.max(0, seconds), max)
    this.setPosition(this.audio.currentTime)
    this.playback?.stateChanged(this.audio.currentTime, this.device())
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
    this.muted = volume <= 0
    this.volumeChanged()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.volumeChanged()
  }

  toggleMute(): void {
    this.setMuted(!this.muted)
  }

  /** Puts the volume and mute choice on the elements, tells the screens and remembers it. */
  private volumeChanged(): void {
    this.syncElements()
    this.set({ volume: this.volume, muted: this.muted })
    writePlayerPrefs({ volume: this.volume, muted: this.muted })
  }

  /** Every element follows the choice; one that is part-way through a fade is moved by the fade itself. */
  private syncElements(): void {
    for (const el of [this.audio, this.spare, this.fade?.outgoing.audio]) {
      if (!el) continue
      el.muted = this.muted
      if (!this.fade) el.volume = this.volume
    }
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

  // ---- the visualizer (reading the sound that is playing) ---------------------------------------------------------

  /** How many values `readSpectrum` fills. */
  readonly spectrumSize = 64

  /**
   * Turns the analysis of the sound on or off. Reading a song's sound needs it loaded with CORS, so the song playing
   * is loaded again at the same place when the visualizer is switched on (the next songs are loaded that way anyway).
   */
  async setVisualizer(on: boolean): Promise<void> {
    this.analysis = on
    writePlayerPrefs({ visualizer: on })
    if (!on) return
    await this.ensureGraph()
    if (this.state.status === 'playing' && !this.corsLoaded.has(this.audio)) {
      this.startAt = this.audio.currentTime
      void this.load()
    } else {
      this.connectToGraph(this.audio)
      this.connectToGraph(this.spare)
    }
  }

  /** Fills `out` (0-255 per frequency band, low to high) with what is playing now. False when the sound cannot be read (the caller then makes up a movement). */
  readSpectrum(out: Uint8Array<ArrayBuffer>): boolean {
    const graph = this.graph
    if (!graph || graph.ctx.state !== 'running' || !graph.connected.has(this.audio)) return false
    const bins = new Uint8Array(graph.analyser.frequencyBinCount)
    graph.analyser.getByteFrequencyData(bins)
    // The upper half of the bands is mostly empty for music: spread the useful lower part over the bars.
    const useful = Math.floor(bins.length * 0.75)
    for (let i = 0; i < out.length; i += 1) out[i] = bins[Math.floor((i * useful) / out.length)] ?? 0
    return true
  }

  private async ensureGraph(): Promise<void> {
    if (!this.graph) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Context) return
      const ctx = new Context()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = this.spectrumSize * 4
      analyser.smoothingTimeConstant = 0.78
      analyser.connect(ctx.destination)
      this.graph = { ctx, analyser, connected: new WeakSet() }
    }
    // A browser lets sound start only after the person has done something on the page: this runs from a click.
    if (this.graph.ctx.state === 'suspended') await this.graph.ctx.resume().catch(() => undefined)
  }

  /** The way an element loads its next song: with CORS when the sound is to be read (and from then on). */
  private useCors(el: HTMLAudioElement): void {
    if (this.analysis || this.corsSticky) {
      el.crossOrigin = 'anonymous'
      this.corsLoaded.add(el)
    } else {
      el.removeAttribute('crossorigin')
      this.corsLoaded.delete(el)
    }
  }

  /** Sends an element's sound through the analyser, if it was loaded with CORS (otherwise the browser would silence it). */
  private connectToGraph(el: HTMLAudioElement): void {
    const graph = this.graph
    if (!graph || graph.ctx.state !== 'running' || !this.corsLoaded.has(el) || graph.connected.has(el)) return
    try {
      graph.ctx.createMediaElementSource(el).connect(graph.analyser)
      graph.connected.add(el)
      this.corsSticky = true
    } catch {
      // The element cannot be analysed: it keeps playing as it did.
    }
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
    this.endFade()
    this.dropPreload()
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
      this.useCors(this.audio)
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
      this.connectToGraph(this.audio)
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

  /** What each audio element reports. Only the element of the song playing is listened to; the spare one is just getting ready. */
  private handlersFor(el: HTMLAudioElement): Array<[string, () => void]> {
    const mine = (fn: () => void) => () => {
      if (el === this.audio) fn()
    }
    return [
      [
        'playing',
        mine(() => {
          this.set({ status: 'playing', buffering: false, error: null })
          this.playback?.playing(this.audio.currentTime, this.device())
        }),
      ],
      [
        'pause',
        mine(() => {
          if (this.audio.ended || this.state.status === 'loading' || this.state.status === 'idle' || !this.plan) return
          this.set({ status: 'paused', buffering: false })
          this.playback?.stateChanged(this.audio.currentTime, this.device())
        }),
      ],
      ['waiting', mine(() => this.state.status === 'playing' && this.set({ buffering: true }))],
      ['canplay', mine(() => this.state.buffering && this.set({ buffering: false }))],
      [
        'timeupdate',
        mine(() => {
          this.setPosition(this.audio.currentTime)
          this.playback?.moved(this.audio.currentTime)
          this.updateSessionPosition()
          this.lookAhead()
        }),
      ],
      [
        'durationchange',
        mine(() => {
          if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) this.set({ duration: this.audio.duration })
        }),
      ],
      ['ended', mine(() => void this.onEnded())],
      ['error', mine(() => this.onMediaError())],
    ]
  }

  private async onEnded(): Promise<void> {
    const queue = this.state.queue
    if (!queue) return
    const playback = this.playback
    const id = this.loadId
    const duration = this.audio.duration
    const device = this.device()
    const stopHere = this.state.sleep?.kind === 'track'
    // Gapless: the next song is already loaded, so it starts at once and the server hears about this one meanwhile.
    const following = stopHere ? null : advance(queue, 'auto')
    if (following && this.promote(following)) {
      void playback?.ended(duration, device)
      return
    }
    // The song finished: tell the server (it counts the play), then go on to the next one.
    if (playback) await playback.ended(duration, device)
    if (id !== this.loadId) return
    // "Sleep after this song": the song has played to its end, so stop here (pressing play starts the next one).
    if (stopHere) {
      this.set({ sleep: null })
      const next = advance(queue, 'auto')
      if (next) this.set({ queue: next.queue })
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

  // ---- the next song, made ready ahead of time (no pause between songs, and crossfade) ---------------------------

  /** The song that follows this one by itself, if the music would go on and this player may prepare it. */
  private followingSong(): { queue: PlayQueue; track: Track } | null {
    const queue = this.state.queue
    // "Repeat one" starts the same song again from the start (its stream is open already); "sleep after this song" stops.
    if (!queue || queue.repeat === 'one' || this.state.sleep?.kind === 'track') return null
    const step = advance(queue, 'auto')
    const track = step && currentTrack(step.queue)
    return step && track ? { queue: step.queue, track } : null
  }

  /** Called as the song plays: prepares the next one when the end is near, and starts the crossfade when it is time. */
  private lookAhead(): void {
    if (this.state.status !== 'playing' || this.audio.paused) return
    const prefs = this.prefs()
    const fadeSeconds = prefs.crossfadeSeconds
    if (!prefs.gapless && !(fadeSeconds > 0)) return this.dropPreload()
    const duration = this.audio.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    const next = this.followingSong()
    if (!next) return this.dropPreload()
    const remaining = duration - this.audio.currentTime
    if (remaining > PRELOAD_BEFORE_END_SECONDS + fadeSeconds) return
    this.preload(next.track)
    // A song shorter than twice the fade would be mostly fade: those just follow each other.
    if (fadeSeconds > 0 && !this.fade && remaining <= fadeSeconds && duration >= fadeSeconds * 2 && this.pre?.trackId === next.track.id) {
      const outgoing = this.promote({ queue: next.queue }, { fadeMs: fadeSeconds * 1000 })
      if (outgoing) void outgoing.playback?.ended(duration, outgoing.device)
    }
  }

  /** Loads a song on the spare element (without playing it), unless that is already done or going on. */
  private preload(track: Track): void {
    if (this.pre?.trackId === track.id || this.preloading === track.id) return
    // The spare element may still be fading out the song before this one.
    if (this.fade) return
    this.dropPreload()
    const token = ++this.preloadToken
    this.preloading = track.id
    void negotiatePlayback(this.session, track.id, { capabilities: this.capabilities(), mediaType: 'audio' })
      .then((plan) => {
        if (token !== this.preloadToken) return
        this.preloading = null
        const el = this.spare
        el.preload = 'auto'
        this.useCors(el)
        const attached = attachMedia({
          video: el,
          plan,
          token: this.session.accessToken,
          authorization: this.session.api.authorizationHeader,
          startSeconds: 0,
          autoplay: false,
          // A song that cannot be prepared is simply loaded the usual way when its turn comes.
          onFatal: () => {
            if (this.pre?.audio === el) this.dropPreload()
          },
        })
        this.pre = { trackId: track.id, audio: el, plan, attached }
        this.connectToGraph(el)
      })
      .catch(() => {
        if (token === this.preloadToken) this.preloading = null
      })
  }

  private dropPreload(): void {
    this.preloadToken += 1
    this.preloading = null
    const pre = this.pre
    this.pre = null
    pre?.attached.destroy()
  }

  /**
   * Makes the prepared song the one playing and starts it, instead of loading it the slow way. With `fadeMs` the song
   * that was playing fades out while the new one fades in. Returns what was playing (so the caller can report it), or
   * null when nothing was ready for this queue position.
   */
  private promote(
    step: { queue: PlayQueue },
    opts: { fadeMs?: number } = {},
  ): { playback: PlaybackSession | null; device: DeviceState } | null {
    const pre = this.pre
    const track = currentTrack(step.queue)
    if (!pre || !track || pre.trackId !== track.id || pre.audio.error) return null
    const device = this.device()
    const outgoing: Outgoing = { audio: this.audio, attached: this.attached }
    const playback = this.playback
    if (this.skipTimer) clearTimeout(this.skipTimer)
    this.skipTimer = null
    this.pre = null
    this.preloadToken += 1
    this.loadId += 1
    this.audio = pre.audio
    this.spare = outgoing.audio
    this.labelElements()
    this.plan = pre.plan
    this.attached = pre.attached
    this.triedTranscode = false
    this.playback = new PlaybackSession(this.session, pre.plan, 0)
    this.set({ queue: step.queue, status: 'loading', buffering: true, error: null, duration: (track.runtimeTicks ?? 0) / 10_000_000 })
    this.setPosition(0)
    this.announce(track)
    if (opts.fadeMs) {
      this.audio.volume = 0
      this.startFade(outgoing, opts.fadeMs)
    } else {
      this.audio.volume = this.volume
      outgoing.attached?.destroy()
    }
    void this.audio.play().catch(() => undefined)
    return { playback, device }
  }

  /** Raises the new song and lowers the old one together (equal power, so the sum does not dip in the middle). */
  private startFade(outgoing: Outgoing, ms: number): void {
    this.endFade()
    const started = Date.now()
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / ms)
      this.audio.volume = this.volume * Math.sin((t * Math.PI) / 2)
      outgoing.audio.volume = this.volume * Math.cos((t * Math.PI) / 2)
      if (t >= 1) this.endFade()
    }, FADE_STEP_MS)
    this.fade = { outgoing, timer }
  }

  /** Finishes a fade at once: the old song is let go and the new one is at full volume. */
  private endFade(): void {
    const fade = this.fade
    if (!fade) return
    clearInterval(fade.timer)
    this.fade = null
    fade.outgoing.audio.pause()
    fade.outgoing.attached?.destroy()
    this.syncElements()
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
