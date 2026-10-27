import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  activeSegment,
  audioChangeRequest,
  episodeCode,
  formatTime,
  isEpisode,
  defaultSearchLanguage,
  PlaybackSession,
  playbackTitle,
  upNextPhase,
  FLOW_COUNTDOWN_SECONDS,
  describePlayback,
  retryRequest,
  stepOffset,
  SYNC_STEP,
  SYNC_STEP_LARGE,
  ticksToSeconds,
  transcodeFallbackRequest,
  type DeviceState,
  type Movie,
  type PlaybackExtras,
  type PlaybackPlan,
  type Session,
  type StreamRequest,
} from '../../core'
import { reportStopOnPageHide } from '../../platform/web/browser'
import { attachMedia, type Attached } from '../../platform/web/mediaAttach'
import { bindMediaSession, keepScreenAwake } from '../../platform/web/mediaSession'
import {
  readPlayerPrefs,
  readSeriesPrefs,
  readSubtitleOffset,
  writePlayerPrefs,
  writeSubtitleOffset,
} from '../../platform/web/prefs'
import { CloseIcon, FullscreenIcon, PauseIcon, PlayIcon, SkipIcon, SkipNextIcon } from '../icons'
import { Range } from '../music/controls'
import type { PlaybackController } from '../remote/controller'
import { useRegisterPlayback } from '../remote/RemoteProvider'
import { Controls } from './Controls'
import { DOCK_BAR_CLASS, DOCK_BUTTON, DOCK_THUMB_CLASS } from './dock'
import { SubtitleOverlay, type SubtitleStyle } from './SubtitleOverlay'
import { SubtitleSearchDialog } from './SubtitleSearchDialog'
import { useSubtitleTrack } from './useSubtitleTrack'
import { useTrickplay } from './useTrickplay'
import { getLanguage, t } from '../../i18n'
import { offsetLabel } from '../offsetLabel'

const HIDE_CONTROLS_MS = 3000
/** In cinema mode the controls get out of the way sooner. */
const HIDE_CONTROLS_CINEMA_MS = 1800
const PROGRESS_INTERVAL_MS = 10_000
const STOP_TIMEOUT_MS = 2000
const SKIP_SECONDS = 10
/** How long the picture takes to fade in from black (and out at the very end) in cinema mode. */
const CURTAIN_MS = 1400
/** The fade out starts this long before the end. */
const CURTAIN_OUT_SECONDS = 1.5

function mediaErrorMessage(error: MediaError): string {
  switch (error.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return t('The connection to the server was lost while loading the video.')
    case MediaError.MEDIA_ERR_DECODE:
      return t('The browser could not decode this video.')
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return t('The browser cannot play this video format.')
    default:
      return t('Playback failed.')
  }
}

/** End of the buffered range that contains `time`, or `time` itself when nothing is buffered there. */
function bufferedEndAt(video: HTMLVideoElement, time: number): number {
  const ranges = video.buffered
  for (let i = 0; i < ranges.length; i += 1) {
    if (time >= ranges.start(i) - 0.25 && time <= ranges.end(i)) return ranges.end(i)
  }
  return time
}

export function PlayerStage({
  session,
  movie,
  plan,
  startSeconds,
  fallback,
  speed,
  subtitleIndex,
  next = null,
  onNext,
  repeat,
  extras,
  localSubtitle,
  subtitleFileError,
  onSubtitleFile,
  onClearLocalSubtitle,
  onSubtitleSaved,
  onSpeed,
  onSubtitle,
  onRequest,
  onExit,
  mini = false,
  onClose,
  onExpand,
  onPlaying,
}: {
  session: Session
  movie: Movie
  plan: PlaybackPlan
  startSeconds: number
  fallback: boolean
  /** Speed and subtitle choice live in the parent so they survive switching audio track. */
  speed: number
  subtitleIndex: number | null
  /** The episode after this one (if this is an episode and there is one). */
  /** What plays after this: the next episode, or the next title of the playlist being played. */
  next?: Movie | null
  onNext?: () => void
  /** Present when this is part of a queue: play it again from the start after the last title. */
  repeat?: { enabled: boolean; onChange: (enabled: boolean) => void }
  /** Intro/credits segments and chapters (empty when the server has none). */
  extras: PlaybackExtras
  /** A subtitle file the viewer loaded from their device (instead of one of the server's tracks), already as a blob URL. */
  localSubtitle: { name: string; url: string } | null
  subtitleFileError: string | null
  onSubtitleFile: (file: File) => void
  /** Drops the loaded file (choosing a server track or turning subtitles off does this). */
  onClearLocalSubtitle: () => void
  /** A subtitle from the internet was saved on the server: ask for this video again (at this position) so it shows up as a track. */
  onSubtitleSaved: (startSeconds: number) => void
  onSpeed: (speed: number) => void
  onSubtitle: (index: number | null) => void
  onRequest: (request: StreamRequest) => void
  onExit: () => void
  /** Shown as a bar at the bottom of the page, over the page being browsed, instead of full screen. The same <video> goes on playing. */
  mini?: boolean
  /** Stop and take the bar away (only the mini bar offers it). */
  onClose?: () => void
  /** Bring the video back full screen (from the mini bar). */
  onExpand?: () => void
  /** The video started playing: whatever else is playing (the music) makes way for it. */
  onPlaying?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onPlayingRef = useRef(onPlaying)
  useEffect(() => {
    onPlayingRef.current = onPlaying
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The latest `poke` (shows the controls for a moment), for the video's own event handlers.
  const pokeRef = useRef<() => void>(() => undefined)
  const attachedRef = useRef<Attached | null>(null)
  const lastSubtitle = useRef<number | null>(null)

  const [initialPrefs] = useState(readPlayerPrefs)
  const fallbackDuration = ticksToSeconds(plan.durationTicks ?? movie.runtimeTicks)
  const [paused, setPaused] = useState(true)
  const [buffering, setBuffering] = useState(true)
  const [currentTime, setCurrentTime] = useState(startSeconds)
  const [now, setNow] = useState(() => Date.now())
  const [bufferedEnd, setBufferedEnd] = useState(startSeconds)
  const [duration, setDuration] = useState(fallbackDuration)
  const [volume, setVolume] = useState(initialPrefs.volume)
  const [muted, setMuted] = useState(initialPrefs.muted)
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({
    size: initialPrefs.subtitleSize,
    color: initialPrefs.subtitleColor,
    background: initialPrefs.subtitleBackground,
    position: initialPrefs.subtitlePosition,
  })
  // Sync is remembered per movie, and per series for episodes (its episodes usually share one release).
  const syncKey = isEpisode(movie) ? movie.seriesId : movie.id
  const [subtitleOffset, setSubtitleOffsetState] = useState(() => readSubtitleOffset(syncKey))
  // Keys can arrive faster than the screen updates (holding one down), so the next step starts from this, not from the last render.
  const offsetNow = useRef(subtitleOffset)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const syncNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [awake, setAwake] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = playbackTitle(movie)
  // Up next: set when an episode finishes; counts down, then starts the next episode.
  const [ended, setEnded] = useState(false)
  // Set once a flow has moved on to the next video, so that it happens once.
  const advanced = useRef(false)
  const [upNextDismissed, setUpNextDismissed] = useState(false)
  // After a title ends the next one starts by itself once this many seconds have counted down (chosen in Settings).
  // One music video after another is meant to flow: the countdown runs over the last seconds of the video, and the next one starts
  // the moment it ends.
  const flow = !!movie.musicVideo
  const [countdownSeconds] = useState(flow ? FLOW_COUNTDOWN_SECONDS : initialPrefs.autoplayCountdown)
  const [secondsLeft, setSecondsLeft] = useState(countdownSeconds)
  const [autoplay, setAutoplay] = useState(initialPrefs.autoplayNext)
  // Cinema mode: the picture fades in from black, and the controls leave when you are not using them, even while paused.
  const [cinema, setCinema] = useState(initialPrefs.cinemaMode)
  const [curtainUp, setCurtainUp] = useState(false)
  const [pip, setPip] = useState(false)
  const canPip = typeof document !== 'undefined' && document.pictureInPictureEnabled === true

  // A file from the viewer's device replaces the server's track while it is in use.
  const subtitle = useSubtitleTrack(session, plan, localSubtitle ? null : subtitleIndex)
  const subtitleUrl = localSubtitle?.url ?? subtitle.url
  const showingSubtitles = subtitleIndex !== null || !!localSubtitle

  const setSubtitleOffset = useCallback(
    (seconds: number) => {
      offsetNow.current = seconds
      setSubtitleOffsetState(seconds)
      writeSubtitleOffset(syncKey, seconds)
      setSyncNote(t('Subtitles: {offset}', { offset: offsetLabel(seconds) }))
      if (syncNoteTimer.current) clearTimeout(syncNoteTimer.current)
      syncNoteTimer.current = setTimeout(() => setSyncNote(null), 1800)
    },
    [syncKey],
  )
  useEffect(
    () => () => {
      if (syncNoteTimer.current) clearTimeout(syncNoteTimer.current)
    },
    [],
  )

  // All server reporting (start / progress / stop and which position to trust) lives in core.
  const playback = useMemo(() => new PlaybackSession(session, plan, startSeconds), [session, plan, startSeconds])

  useEffect(() => {
    playback.setSubtitleIndex(subtitleIndex)
  }, [playback, subtitleIndex])

  const device = useCallback((): DeviceState => {
    const video = videoRef.current
    return {
      paused: video?.paused ?? true,
      muted: video?.muted ?? false,
      volume: video?.volume ?? 1,
    }
  }, [])

  // Apply remembered volume and the chosen speed before the stream starts.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = initialPrefs.volume
    video.muted = initialPrefs.muted
  }, [initialPrefs])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // Loading a stream resets playbackRate to defaultPlaybackRate, so set both.
    video.defaultPlaybackRate = speed
    video.playbackRate = speed
  }, [speed, plan])

  // Connect the stream to the <video> element (attachMedia also starts playback).
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const attached = attachMedia({
      video,
      plan,
      token: session.accessToken,
      authorization: session.api.authorizationHeader,
      startSeconds,
      onFatal: setError,
    })
    attachedRef.current = attached
    return () => {
      attached.destroy()
      attachedRef.current = null
    }
  }, [plan, session, startSeconds])

  // OS media keys / now-playing while this stage is open (also in the mini bar, so the keys of the keyboard still work).
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    return bindMediaSession(video, title)
  }, [title])

  // The screen wake lock and the tab title are for the full-screen player; the bar leaves the page its own.
  useEffect(() => {
    if (mini) return
    const release = keepScreenAwake()
    const previousTitle = document.title
    document.title = `▶ ${title}`
    return () => {
      release()
      document.title = previousTitle
    }
  }, [title, mini])

  // The mini bar is not a full-screen element, and it does not take the keyboard: it gives both back, and takes them again when opened.
  useEffect(() => {
    if (mini) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
      const active = document.activeElement
      if (active instanceof HTMLElement && containerRef.current?.contains(active)) active.blur()
    } else {
      containerRef.current?.focus()
    }
  }, [mini])

  // Mirror <video> state into React and drive progress reporting from the same events.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const on = {
      play: () => {
        setPaused(false)
        onPlayingRef.current?.()
      },
      pause: () => {
        setPaused(true)
        playback.stateChanged(video.currentTime, device())
        // Cinema mode: the controls show for a moment after pausing, then leave (see `poke`, which is set further down).
        pokeRef.current()
      },
      playing: () => {
        setEnded(false)
        advanced.current = false
        setSecondsLeft(countdownSeconds)
        setCurtainUp(true)
        setBuffering(false)
        playback.playing(video.currentTime, device())
      },
      waiting: () => setBuffering(true),
      canplay: () => setBuffering(false),
      seeking: () => setBuffering(true),
      seeked: () => {
        setBuffering(video.readyState < 3)
        playback.stateChanged(video.currentTime, device())
      },
      timeupdate: () => {
        setCurrentTime(video.currentTime)
        setNow(Date.now())
        setBufferedEnd(bufferedEndAt(video, video.currentTime))
        playback.moved(video.currentTime)
      },
      progress: () => setBufferedEnd(bufferedEndAt(video, video.currentTime)),
      durationchange: () => {
        if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration)
      },
      enterpictureinpicture: () => setPip(true),
      leavepictureinpicture: () => setPip(false),
      volumechange: () => {
        setVolume(video.volume)
        setMuted(video.muted)
        writePlayerPrefs({ volume: video.volume, muted: video.muted })
      },
      ended: () => {
        setPaused(true)
        setEnded(true)
        void playback.ended(video.duration, device())
      },
      error: () => {
        const mediaError = video.error
        if (!mediaError || mediaError.code === MediaError.MEDIA_ERR_ABORTED) return
        // hls.js reports its own fatal errors (and may recover from MSE errors).
        if (attachedRef.current?.handlesErrors) return
        const undecodable =
          mediaError.code === MediaError.MEDIA_ERR_DECODE ||
          mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        // The browser could not decode what the profile promised: let the server transcode instead.
        const fallbackRequest = undecodable
          ? transcodeFallbackRequest(plan, { fallback, startSeconds: playback.position })
          : null
        if (fallbackRequest) {
          onRequest(fallbackRequest)
          return
        }
        setError(mediaErrorMessage(mediaError))
      },
    }
    for (const [name, handler] of Object.entries(on)) video.addEventListener(name, handler)

    const interval = setInterval(() => {
      playback.tick(device())
    }, PROGRESS_INTERVAL_MS)
    const onPageHide = () => reportStopOnPageHide(playback, device())
    window.addEventListener('pagehide', onPageHide)

    return () => {
      for (const [name, handler] of Object.entries(on)) video.removeEventListener(name, handler)
      clearInterval(interval)
      window.removeEventListener('pagehide', onPageHide)
      // Covers unmounting for any reason (audio switch, sign-out). A no-op if already stopped.
      void playback.stop(device())
    }
  }, [playback, device, plan, fallback, onRequest, countdownSeconds])

  useEffect(() => {
    const container = containerRef.current
    const onChange = () => setFullscreen(document.fullscreenElement === container)
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (document.fullscreenElement && document.fullscreenElement === container) void document.exitFullscreen().catch(() => undefined)
    }
  }, [])

  const poke = useCallback(() => {
    setAwake(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setAwake(false), cinema ? HIDE_CONTROLS_CINEMA_MS : HIDE_CONTROLS_MS)
  }, [cinema])
  useEffect(() => {
    pokeRef.current = poke
  }, [poke])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }, [])

  const seek = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video) return
    const max = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY
    const target = Math.min(Math.max(0, seconds), max)
    video.currentTime = target
    setCurrentTime(target)
  }, [])

  const skip = useCallback(
    (delta: number) => {
      const video = videoRef.current
      if (video) seek(video.currentTime + delta)
    },
    [seek],
  )

  const changeVolume = useCallback((next: number) => {
    const video = videoRef.current
    if (!video) return
    video.volume = Math.min(1, Math.max(0, next))
    video.muted = next <= 0
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (video) video.muted = !video.muted
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void containerRef.current?.requestFullscreen().catch(() => undefined)
  }, [])

  const chooseSubtitle = useCallback(
    (index: number | null) => {
      if (index !== null) lastSubtitle.current = index
      onClearLocalSubtitle()
      onSubtitle(index)
    },
    [onSubtitle, onClearLocalSubtitle],
  )

  const toggleSubtitles = useCallback(() => {
    if (localSubtitle) onClearLocalSubtitle()
    else if (subtitleIndex !== null) chooseSubtitle(null)
    else {
      const next = lastSubtitle.current ?? plan.subtitleTracks[0]?.index ?? null
      if (next !== null) chooseSubtitle(next)
    }
  }, [localSubtitle, onClearLocalSubtitle, subtitleIndex, chooseSubtitle, plan.subtitleTracks])

  // Subtitles from the internet: the video waits while you choose, and carries on if you change your mind.
  const [searchOpen, setSearchOpen] = useState(false)
  const resumeAfterSearch = useRef(false)
  const openSubtitleSearch = useCallback(() => {
    const video = videoRef.current
    resumeAfterSearch.current = !!video && !video.paused
    video?.pause()
    setSearchOpen(true)
  }, [])
  const closeSubtitleSearch = useCallback(() => {
    setSearchOpen(false)
    if (resumeAfterSearch.current) void videoRef.current?.play().catch(() => undefined)
  }, [])
  const searchLanguage = defaultSearchLanguage(
    (isEpisode(movie) ? readSeriesPrefs(movie.seriesId).subtitleLanguage : undefined) ?? readPlayerPrefs().subtitleLanguage,
    getLanguage(),
  )

  const back = useCallback(async () => {
    // Wait (briefly) for the final position to reach the server so the library shows it.
    await Promise.race([playback.stop(device()), new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))])
    onExit()
  }, [playback, device, onExit])

  /** Closing the mini bar: the same wait for the final position, then the video goes away. */
  const closeBar = useCallback(async () => {
    await Promise.race([playback.stop(device()), new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))])
    onClose?.()
  }, [playback, device, onClose])

  /** Report where this episode stopped (so it counts as watched), then move on to the next one. */
  const goNext = useCallback(async () => {
    if (!onNext) return
    await Promise.race([playback.stop(device()), new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))])
    onNext()
  }, [playback, device, onNext])

  // Other devices can drive this player ("pause", "seek", "send it to the TV"): see the remote-control provider.
  const remoteController = useMemo<PlaybackController>(
    () => ({
      pause: () => videoRef.current?.pause(),
      resume: () => void videoRef.current?.play().catch(() => undefined),
      toggle: togglePlay,
      stop: () => (mini ? closeBar() : back()),
      seek,
      skip,
      next: () => {
        if (onNext) void goNext()
      },
      previous: () => seek(0),
      setVolume: changeVolume,
      setMuted: (muted) => {
        const video = videoRef.current
        if (video) video.muted = muted === 'toggle' ? !video.muted : muted
      },
      snapshot: () => ({ itemIds: [plan.itemId], startIndex: 0, positionSeconds: videoRef.current?.currentTime ?? 0 }),
    }),
    [togglePlay, back, closeBar, mini, seek, skip, onNext, goNext, changeVolume, plan.itemId],
  )
  useRegisterPlayback('video', remoteController)

  const togglePip = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined)
    else void video.requestPictureInPicture().catch(() => undefined)
  }, [])

  // "Skip intro" / "Skip credits" while the playhead is inside such a segment.
  const segment = activeSegment(extras.segments, currentTime)
  const skipSegment = useCallback(() => {
    if (!segment) return
    if (segment.kind === 'outro' && next) void goNext()
    else seek(segment.endSeconds)
  }, [segment, next, goNext, seek])

  // Near the end the card shows what follows; once the title ends it counts down (when autoplay is on) and moves on.
  const phase = upNextPhase({
    hasNext: !!next,
    ended,
    remainingSeconds: duration - currentTime,
    durationSeconds: duration,
    dismissed: upNextDismissed,
    autoplay,
    error: !!error,
    flow,
  })
  const upNextVisible = phase !== 'hidden'
  const counting = phase === 'counting'
  // A flow counts with the video itself (its last seconds); anything else counts on a clock once the title has ended.
  const timed = counting && !flow
  useEffect(() => {
    if (!timed) return
    const timer = setInterval(() => setSecondsLeft((n) => n - 1), 1000)
    return () => clearInterval(timer)
  }, [timed])
  useEffect(() => {
    if (timed && secondsLeft <= 0) void goNext()
  }, [timed, secondsLeft, goNext])
  // The video ended and the next one follows: straight away (the end was already reported to the server when the video ended).
  useEffect(() => {
    if (!flow || !counting || !ended || advanced.current || !onNext) return
    advanced.current = true
    onNext()
  }, [flow, counting, ended, onNext])
  const flowSeconds = Math.min(FLOW_COUNTDOWN_SECONDS, Math.max(0, duration - currentTime))
  const shownSeconds = flow ? Math.max(1, Math.ceil(flowSeconds)) : Math.max(0, secondsLeft)

  const changeAudio = useCallback(
    (index: number) => {
      onRequest(audioChangeRequest(plan, index, { fallback, startSeconds: playback.position }))
    },
    [onRequest, fallback, plan, playback],
  )

  // The most the video may stream at (0 = no limit). Another limit means asking the server again, at the same place.
  const trickplay = useTrickplay(session, plan.itemId, plan.mediaSourceId)
  const [quality, setQuality] = useState(initialPrefs.maxBitrateMbps)
  const changeQuality = useCallback(
    (mbps: number) => {
      setQuality(mbps)
      writePlayerPrefs({ maxBitrateMbps: mbps })
      onRequest(retryRequest(plan, { fallback, startSeconds: playback.position }))
    },
    [onRequest, fallback, plan, playback],
  )

  const retry = () => onRequest(retryRequest(plan, { fallback, startSeconds: playback.position }))
  const retryRef = useRef(retry)
  useEffect(() => {
    retryRef.current = retry
  })
  // After a failure, coming back online picks the stream up again where it stopped.
  useEffect(() => {
    if (!error) return
    const onOnline = () => retryRef.current()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [error])
  const transcodeInstead = transcodeFallbackRequest(plan, { fallback, startSeconds: playback.position })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The mini bar has its own buttons and leaves the keys (Esc included) to the page behind it.
    if (mini) return
    poke()
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as HTMLElement
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
    const onButton = target.tagName === 'BUTTON'
    const key = event.key
    if (/^[0-9]$/.test(key) && duration > 0) {
      event.preventDefault()
      seek((Number(key) / 10) * duration)
      return
    }
    switch (key) {
      case ' ':
      case 'k':
        if (onButton) return
        event.preventDefault()
        togglePlay()
        break
      case 'ArrowLeft':
      case 'j':
        event.preventDefault()
        skip(-SKIP_SECONDS)
        break
      case 'ArrowRight':
      case 'l':
        event.preventDefault()
        skip(SKIP_SECONDS)
        break
      case 'ArrowUp':
        event.preventDefault()
        changeVolume((videoRef.current?.volume ?? 1) + 0.1)
        break
      case 'ArrowDown':
        event.preventDefault()
        changeVolume((videoRef.current?.volume ?? 1) - 0.1)
        break
      case 'Home':
        event.preventDefault()
        seek(0)
        break
      case 'End':
        event.preventDefault()
        seek(duration - 1)
        break
      case 'm':
        toggleMute()
        break
      case 'f':
        toggleFullscreen()
        break
      case 'c':
        toggleSubtitles()
        break
      case 'z':
      case 'Z':
      case 'x':
      case 'X':
        // Z shows the subtitles earlier, X later; Shift takes bigger steps.
        if (showingSubtitles) {
          event.preventDefault()
          const step = event.shiftKey ? SYNC_STEP_LARGE : SYNC_STEP
          setSubtitleOffset(stepOffset(offsetNow.current, key.toLowerCase() === 'z' ? -step : step))
        }
        break
      case 'n':
        if (next) void goNext()
        break
      case 's':
        skipSegment()
        break
      case 'p':
        if (canPip) togglePip()
        break
      case 'Escape':
        if (!document.fullscreenElement) void back()
        break
    }
  }

  // Cinema mode lets go of the "paused means controls" rule: they come back with the mouse, a key or a tap.
  const controlsVisible = (!cinema && paused) || awake || menuOpen || !!error
  // The black curtain: closed until playback starts, and closing again in the last moments of the title.
  const curtainDown =
    cinema && (!curtainUp || ended || (!paused && duration > 0 && duration - currentTime < CURTAIN_OUT_SECONDS))
  const showSpinner = buffering && !error

  return (
    <div
      ref={containerRef}
      tabIndex={mini ? undefined : -1}
      className={mini ? DOCK_BAR_CLASS : `fixed inset-0 z-50 bg-black outline-none ${controlsVisible ? '' : 'cursor-none'}`}
      onMouseMove={mini ? undefined : poke}
      onKeyDown={onKeyDown}
      role="region"
      aria-label={mini ? t('Video mini player: {title}', { title }) : t('Playing {title}', { title })}
    >
      {/* The same <video> in both: only its size and what it does when clicked change, so playback is never interrupted. */}
      <video
        ref={videoRef}
        className={mini ? DOCK_THUMB_CLASS : 'h-full w-full'}
        playsInline
        onClick={mini ? onExpand : togglePlay}
        onDoubleClick={mini ? undefined : toggleFullscreen}
        data-testid="video"
        data-play-method={plan.playMethod}
        data-protocol={plan.protocol}
      >
        {subtitleUrl && <track key={subtitleUrl} kind="subtitles" src={subtitleUrl} label={t('Subtitles')} />}
      </video>

      {mini && (
        <>
          <button
            type="button"
            onClick={onExpand}
            aria-label={t('Open the video full screen: {title}', { title: movie.artist ? `${title} — ${movie.artist}` : title })}
            className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] sm:w-1/4 sm:flex-none"
          >
            <span className="block truncate text-sm font-medium text-white">{title}</span>
            <span className={`block truncate text-xs ${error ? 'text-red-300' : 'text-neutral-400'}`}>
              {error
                ? t(error)
                : buffering
                  ? t('Loading…')
                  : upNextVisible && next
                    ? t('Up next: {title}', { title: next.name })
                    : movie.artist ?? ''}
            </span>
          </button>

          <div className="flex shrink-0 flex-col items-center gap-0.5 sm:flex-1">
            <div className="flex items-center gap-1 sm:gap-2">
              {error ? (
                <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={retry}>
                  {t('Try again')}
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={paused ? t('Play') : t('Pause')}
                  title={paused ? t('Play') : t('Pause')}
                  onClick={togglePlay}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition duration-150 hover:scale-105 active:scale-90"
                >
                  {paused ? <PlayIcon /> : <PauseIcon />}
                </button>
              )}
              <button
                type="button"
                aria-label={t('Next title')}
                title={t('Next title')}
                disabled={!next}
                onClick={() => void goNext()}
                className={DOCK_BUTTON}
              >
                <SkipNextIcon />
              </button>
            </div>
            <MiniSeek currentTime={currentTime} duration={duration} onSeek={seek} className="hidden w-full max-w-xl sm:flex" />
          </div>

          <div className="flex shrink-0 items-center justify-end gap-1 sm:w-1/4">
            <button type="button" aria-label={t('Full screen')} title={t('Full screen')} onClick={onExpand} className={DOCK_BUTTON}>
              <FullscreenIcon />
            </button>
            <button type="button" aria-label={t('Close the video player')} title={t('Close')} onClick={() => void closeBar()} className={DOCK_BUTTON}>
              <CloseIcon />
            </button>
          </div>
          {/* On a phone the timeline is a thin line along the top of the bar. */}
          <MiniSeek currentTime={currentTime} duration={duration} onSeek={seek} showTimes={false} className="absolute inset-x-0 -top-2.5 h-5 sm:hidden" />
        </>
      )}

      {!mini && (
      <>
      <SubtitleOverlay videoRef={videoRef} trackUrl={subtitleUrl} lifted={controlsVisible} style={subtitleStyle} offset={subtitleOffset} />

      {cinema && (
        <div
          aria-hidden="true"
          data-testid="curtain"
          data-down={curtainDown}
          className="pointer-events-none absolute inset-0 bg-black transition-opacity ease-in-out motion-reduce:transition-none"
          style={{ opacity: curtainDown ? 1 : 0, transitionDuration: `${CURTAIN_MS}ms` }}
        />
      )}

      {syncNote && (
        <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center">
          <p role="status" className="rounded-full border border-white/10 bg-black/75 px-4 py-1.5 text-sm tabular-nums text-neutral-100 backdrop-blur-xl">
            {syncNote}
          </p>
        </div>
      )}

      {(subtitle.loading || subtitle.failed) && (
        <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center">
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-black/75 px-4 py-2 text-sm text-neutral-100 shadow-lg backdrop-blur-xl"
          >
            {subtitle.loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-[var(--color-accent)]" aria-hidden="true" />
                {t('Loading subtitles… the first time can take a little while')}
              </>
            ) : (
              <>
                {t('Could not load subtitles')}
                <button type="button" className="font-semibold text-[var(--color-accent)] hover:underline" onClick={subtitle.retry}>
                  {t('Try again')}
                </button>
                <button type="button" className="text-neutral-400 hover:text-white" onClick={() => chooseSubtitle(null)}>
                  {t('Turn off')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showSpinner && (
        <div role="status" aria-label={t('Buffering')} className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/15 border-t-[var(--color-accent)] shadow-[0_0_30px_-4px_var(--glow)]" />
        </div>
      )}

      {error && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 p-6 text-center">
          <p className="max-w-md text-neutral-100">{t(error)}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-primary" onClick={retry}>
              {t('Try again')}
            </button>
            {transcodeInstead && (
              <button type="button" className="btn" onClick={() => onRequest(transcodeInstead)}>
                {t('Let the server transcode')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => void back()}>
              {t('Back')}
            </button>
          </div>
        </div>
      )}

      {segment && !upNextVisible && (
        <button
          type="button"
          onClick={skipSegment}
          className="btn-primary absolute bottom-28 right-4 z-20 gap-2 sm:right-6"
        >
          <SkipIcon />
          {segment.kind === 'intro' ? t('Skip intro') : segment.kind === 'recap' ? t('Skip recap') : segment.kind === 'preview' ? t('Skip preview') : next ? (isEpisode(next) ? t('Next episode') : t('Next title')) : t('Skip credits')}
        </button>
      )}

      {upNextVisible && next && (
        <div
          role="status"
          aria-label={t('Up next')}
          className="absolute bottom-28 right-4 z-20 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-4 shadow-[0_24px_70px_-10px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:right-6"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">{t('Up next')}</p>
          <p className="mt-1 truncate font-medium text-white">{next.name}</p>
          <p className="truncate text-sm text-neutral-400">
            {(isEpisode(next) ? [next.seriesName, episodeCode(next)] : [next.year ? String(next.year) : '']).filter(Boolean).join(' · ')}
          </p>
          {counting && <p className="mt-2 text-sm text-neutral-300">{t('Starting in {seconds}s', { seconds: shownSeconds })}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary flex-1 py-2" onClick={() => void goNext()}>
              {t('Play now')}
            </button>
            {(counting || phase === 'preview') && (
              <button type="button" className="btn py-2" onClick={() => setUpNextDismissed(true)}>
                {counting ? t('Cancel') : t('Close')}
              </button>
            )}
          </div>
          {counting && (
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
              <div
                data-testid="countdown-bar"
                className={`h-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--glow)] transition-[width] ease-linear motion-reduce:transition-none ${flow ? 'duration-300' : 'duration-1000'}`}
                style={{
                  width: `${
                    (flow ? flowSeconds / FLOW_COUNTDOWN_SECONDS : Math.max(0, Math.min(1, (secondsLeft - 1) / Math.max(1, countdownSeconds - 1)))) * 100
                  }%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      <Controls
        title={title}
        visible={controlsVisible}
        paused={paused}
        currentTime={currentTime}
        now={now}
        duration={duration}
        bufferedEnd={bufferedEnd}
        volume={volume}
        muted={muted}
        fullscreen={fullscreen}
        speed={speed}
        audioTracks={plan.audioTracks}
        audioIndex={plan.audioIndex}
        subtitleTracks={plan.subtitleTracks}
        subtitleIndex={localSubtitle ? null : subtitleIndex}
        subtitleStatus={subtitle.loading ? 'loading' : subtitle.failed ? 'failed' : 'idle'}
        subtitleStyle={subtitleStyle}
        subtitleOffset={subtitleOffset}
        localSubtitle={localSubtitle?.name ?? null}
        subtitleFileError={subtitleFileError}
        onBack={() => void back()}
        onTogglePlay={togglePlay}
        onSkip={skip}
        onSeek={seek}
        onVolume={changeVolume}
        onToggleMute={toggleMute}
        onToggleFullscreen={toggleFullscreen}
        onAudio={changeAudio}
        quality={quality}
        playback={describePlayback(plan)}
        onQuality={changeQuality}
        onSubtitle={chooseSubtitle}
        onSubtitleStyle={(patch) => {
          setSubtitleStyle((style) => ({ ...style, ...patch }))
          writePlayerPrefs({
            ...(patch.size && { subtitleSize: patch.size }),
            ...(patch.color && { subtitleColor: patch.color }),
            ...(patch.background && { subtitleBackground: patch.background }),
            ...(patch.position && { subtitlePosition: patch.position }),
          })
        }}
        onSubtitleOffset={setSubtitleOffset}
        onSubtitleFile={onSubtitleFile}
        onFindSubtitles={openSubtitleSearch}
        onSpeed={onSpeed}
        onMenuOpenChange={setMenuOpen}
        chapters={extras.chapters}
        trickplay={trickplay}
        pictureInPicture={canPip ? { active: pip, onToggle: togglePip } : undefined}
        nextEpisode={next ? { label: `${isEpisode(next) ? episodeCode(next) : ''} ${next.name}`.trim(), onPlay: () => void goNext() } : undefined}
        repeatQueue={repeat}
        cinemaMode={{
          enabled: cinema,
          onChange: (on) => {
            setCinema(on)
            writePlayerPrefs({ cinemaMode: on })
          },
        }}
        autoplayNext={next ? { enabled: autoplay, onChange: (on) => {
          setAutoplay(on)
          writePlayerPrefs({ autoplayNext: on })
        } } : undefined}
      />

      {searchOpen && (
        <SubtitleSearchDialog
          session={session}
          itemId={plan.itemId}
          title={title}
          initialLanguage={searchLanguage}
          onSaved={() => onSubtitleSaved(playback.position)}
          onClose={closeSubtitleSearch}
        />
      )}
      </>
      )}
    </div>
  )
}

/** The video's timeline in the mini bar: a thin bar that follows the video, and seeks when let go. */
function MiniSeek({
  currentTime,
  duration,
  onSeek,
  showTimes = true,
  className = '',
}: {
  currentTime: number
  duration: number
  onSeek: (seconds: number) => void
  showTimes?: boolean
  className?: string
}) {
  const [scrub, setScrub] = useState<number | null>(null)
  const value = scrub ?? currentTime
  const commit = () => {
    if (scrub !== null) {
      onSeek(scrub)
      setScrub(null)
    }
  }
  return (
    <div className={`items-center gap-3 ${showTimes ? '' : 'flex'} ${className}`}>
      {showTimes && <span className="w-10 text-right text-xs tabular-nums text-neutral-400">{formatTime(value)}</span>}
      <Range
        label={t('Seek')}
        value={value}
        max={duration}
        onChange={setScrub}
        onCommit={commit}
        valueText={t('{time} of {total}', { time: formatTime(value), total: formatTime(duration) })}
        className="flex-1"
      />
      {showTimes && <span className="w-10 text-xs tabular-nums text-neutral-400">{formatTime(duration)}</span>}
    </div>
  )
}
