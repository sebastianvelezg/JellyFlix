import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  audioChangeRequest,
  episodeCode,
  isEpisode,
  defaultSearchLanguage,
  PlaybackSession,
  playbackTitle,
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
import { readPlayerPrefs, readSeriesPrefs, writePlayerPrefs } from '../../platform/web/prefs'
import { getStreak, setSleepTimer, useSleepTimer } from '../../platform/web/watchGuard'
import type { PlaybackController } from '../remote/controller'
import { useRegisterPlayback } from '../remote/RemoteProvider'
import { useSyncPlay, useSyncPlayVideo } from '../syncplay/SyncPlayProvider'
import { Controls, type ChannelChrome } from './Controls'
import { DOCK_BAR_CLASS, DOCK_THUMB_CLASS } from './dock'
import { enterFullscreen, inFullscreen, leaveFullscreen } from './fullscreen'
import { BufferingSpinner, Curtain, ErrorPanel, MiniBar, SkipSegmentButton, SleepWarning, StillWatchingDialog, SubtitleNotice, SyncNote, UpNextCard } from './PlayerOverlays'
import { handlePlayerKey } from './playerKeys'
import { SubtitleOverlay, type SubtitleStyle } from './SubtitleOverlay'
import { SubtitleSearchDialog } from './SubtitleSearchDialog'
import { useControlsVisibility } from './useControlsVisibility'
import { useSegmentSkipping } from './useSegmentSkipping'
import { useStageEnvironment } from './useStageEnvironment'
import { useSubtitleSync } from './useSubtitleSync'
import { useSubtitleTrack } from './useSubtitleTrack'
import { useTrickplay } from './useTrickplay'
import { useUpNext } from './useUpNext'
import { useWatchGuard } from './useWatchGuard'
import { getLanguage, t } from '../../i18n'

const PROGRESS_INTERVAL_MS = 10_000
const STOP_TIMEOUT_MS = 2000
/** The fade out of cinema mode starts this long before the end. */
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
  secondSubtitleIndex = null,
  onSecondSubtitle,
  next = null,
  onNext,
  onPickEpisode,
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
  channelChrome,
}: {
  /** Present when the video is a retro TV channel: its own controls are added (see Controls). */
  channelChrome?: ChannelChrome
  session: Session
  movie: Movie
  plan: PlaybackPlan
  startSeconds: number
  fallback: boolean
  /** Speed and subtitle choice live in the parent so they survive switching audio track. */
  speed: number
  subtitleIndex: number | null
  /** The second subtitle track (shown above the first), and how to change it. */
  secondSubtitleIndex?: number | null
  onSecondSubtitle?: (index: number | null) => void
  /** The episode after this one (if this is an episode and there is one). */
  /** What plays after this: the next episode, or the next title of the playlist being played. */
  next?: Movie | null
  onNext?: () => void
  /** Another episode of the series was picked from the player's list. */
  onPickEpisode?: (episode: Movie) => void
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
  // Watching together: the video follows the group (and waits at the start until everyone is ready).
  const together = useSyncPlay()
  const togetherRef = useRef(together)
  useEffect(() => {
    togetherRef.current = together
  })
  useSyncPlayVideo(videoRef, plan.itemId)
  const onPlayingRef = useRef(onPlaying)
  useEffect(() => {
    onPlayingRef.current = onPlaying
  })
  const containerRef = useRef<HTMLDivElement>(null)
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
  const { subtitleOffset, offsetNow, syncNote, setSubtitleOffset } = useSubtitleSync(syncKey)
  // (A video that follows another one starts in full screen when the one before was.)
  const [fullscreen, setFullscreen] = useState(inFullscreen)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = playbackTitle(movie)
  // One music video after another is meant to flow: the countdown runs over the last seconds of the video, and the next one starts
  // the moment it ends.
  const flow = !!movie.musicVideo
  const [countdownSeconds] = useState(flow ? FLOW_COUNTDOWN_SECONDS : initialPrefs.autoplayCountdown)
  const [autoplay, setAutoplay] = useState(initialPrefs.autoplayNext)
  // Cinema mode: the picture fades in from black, and the controls leave when you are not using them, even while paused.
  const [cinema, setCinema] = useState(initialPrefs.cinemaMode)
  const [curtainUp, setCurtainUp] = useState(false)
  const [pip, setPip] = useState(false)
  const canPip = typeof document !== 'undefined' && document.pictureInPictureEnabled === true
  const { awake, poke, pokeRef } = useControlsVisibility(cinema)

  // A file from the viewer's device replaces the server's track while it is in use.
  const subtitle = useSubtitleTrack(session, plan, localSubtitle ? null : subtitleIndex)
  const subtitleUrl = localSubtitle?.url ?? subtitle.url
  const showingSubtitles = subtitleIndex !== null || !!localSubtitle
  const secondSubtitle = useSubtitleTrack(session, plan, secondSubtitleIndex)
  const secondUrl = showingSubtitles ? secondSubtitle.url : null

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

  // Leaving, or moving on to another title, first waits (briefly) for the final position to reach the server so the library shows it.
  const stopped = useCallback(
    () => Promise.race([playback.stop(device()), new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))]),
    [playback, device],
  )
  const back = useCallback(async () => {
    await stopped()
    onExit()
  }, [stopped, onExit])
  /** Closing the mini bar: the same wait for the final position, then the video goes away. */
  const closeBar = useCallback(async () => {
    await stopped()
    onClose?.()
  }, [stopped, onClose])
  /** Report where this episode stopped (so it counts as watched), then move on to the next one. */
  const goNext = useCallback(async () => {
    if (!onNext) return
    await stopped()
    onNext()
  }, [stopped, onNext])
  /** Report where this one stopped, then play the episode picked from the list. */
  const pickEpisode = useCallback(
    async (episode: Movie) => {
      if (!onPickEpisode) return
      await stopped()
      onPickEpisode(episode)
    },
    [stopped, onPickEpisode],
  )

  // Near the end the card shows what follows; once the title ends it counts down (when autoplay is on) and moves on.
  // "Are you still watching?" and the sleep timer decide whether the next title starts by itself.
  const guard = useWatchGuard({ itemId: movie.id, next, limit: initialPrefs.stillWatchingAfter, goNext, stop: back, flow })
  const upNext = useUpNext({ flow, next, error: !!error, autoplay, duration, currentTime, countdownSeconds, goNext: guard.autoNext, onNext })
  const sleepTimer = useSleepTimer()
  const { onTitleEnded } = guard
  useEffect(() => {
    if (upNext.ended) onTitleEnded()
  }, [upNext.ended, onTitleEnded])

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
      autoplay: togetherRef.current ? togetherRef.current.shouldAutoplay() : true,
      onFatal: setError,
    })
    attachedRef.current = attached
    return () => {
      attached.destroy()
      attachedRef.current = null
    }
  }, [plan, session, startSeconds])

  useStageEnvironment({ videoRef, containerRef, title, mini })

  // Mirror <video> state into React and drive progress reporting from the same events.
  const { markPlaying, markEnded } = upNext
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
        // Cinema mode: the controls show for a moment after pausing, then leave (see `poke`).
        pokeRef.current()
      },
      playing: () => {
        markPlaying()
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
        markEnded()
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
  }, [playback, device, plan, fallback, onRequest, markPlaying, markEnded, pokeRef])

  useEffect(() => {
    // Full screen is not left here: the next video (a new player) goes on in it. Leaving the player ends it (see the app).
    const onChange = () => setFullscreen(inFullscreen())
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

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
    if (document.fullscreenElement) leaveFullscreen()
    else enterFullscreen()
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

  const { segment, segmentKey, segmentAction, staleSegment, skipSegment } = useSegmentSkipping({
    extras,
    currentTime,
    next,
    mini,
    skipActions: initialPrefs.skipActions,
    goNext,
    seek,
  })

  // Dragging the seek bar can hold the picture still until it is let go.
  const scrubResume = useRef(false)
  const scrubbing = useCallback(
    (on: boolean) => {
      const video = videoRef.current
      if (!video || !initialPrefs.pauseWhileScrubbing) return
      if (on) {
        scrubResume.current = !video.paused
        video.pause()
      } else if (scrubResume.current) {
        scrubResume.current = false
        void video.play().catch(() => undefined)
      }
    },
    [initialPrefs.pauseWhileScrubbing],
  )

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
    handlePlayerKey(event, {
      duration,
      seek,
      skip,
      togglePlay,
      volume: () => videoRef.current?.volume ?? 1,
      changeVolume,
      toggleMute,
      toggleFullscreen,
      toggleSubtitles,
      showingSubtitles,
      nudgeSubtitles: (direction, large) =>
        setSubtitleOffset(stepOffset(offsetNow.current, direction * (large ? SYNC_STEP_LARGE : SYNC_STEP))),
      hasNext: !!next,
      goNext: () => void goNext(),
      skipSegment,
      canPip,
      togglePip,
      back: () => void back(),
    })
  }

  // Cinema mode lets go of the "paused means controls" rule: they come back with the mouse, a key or a tap.
  const controlsVisible = (!cinema && paused) || awake || menuOpen || !!error
  // The black curtain: closed until playback starts, and closing again in the last moments of the title.
  const curtainDown =
    cinema && (!curtainUp || upNext.ended || (!paused && duration > 0 && duration - currentTime < CURTAIN_OUT_SECONDS))
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
        {subtitleUrl && <track key={subtitleUrl} data-slot="main" kind="subtitles" src={subtitleUrl} label={t('Subtitles')} />}
        {secondUrl && <track key={secondUrl} data-slot="second" kind="subtitles" src={secondUrl} label={t('Second subtitle')} />}
      </video>

      {mini && (
        <MiniBar
          title={title}
          movie={movie}
          error={error}
          buffering={buffering}
          upNextTitle={upNext.visible && next ? next.name : null}
          paused={paused}
          hasNext={!!next}
          currentTime={currentTime}
          duration={duration}
          onExpand={onExpand}
          onTogglePlay={togglePlay}
          onNext={() => void goNext()}
          onRetry={retry}
          onClose={() => void closeBar()}
          onSeek={seek}
        />
      )}

      {!mini && (
        <>
          <SubtitleOverlay videoRef={videoRef} trackUrl={subtitleUrl} secondUrl={secondUrl} lifted={controlsVisible} style={subtitleStyle} offset={subtitleOffset} />

          {cinema && <Curtain down={curtainDown} />}

          {syncNote && <SyncNote text={syncNote} />}

          {(subtitle.loading || subtitle.failed) && (
            <SubtitleNotice loading={subtitle.loading} onRetry={subtitle.retry} onTurnOff={() => chooseSubtitle(null)} />
          )}

          {showSpinner && <BufferingSpinner />}

          {error && (
            <ErrorPanel message={error} transcodeInstead={transcodeInstead} onRetry={retry} onRequest={onRequest} onBack={() => void back()} />
          )}

          {segment && segmentAction === 'ask' && (controlsVisible || staleSegment !== segmentKey) && !upNext.visible && (
            <SkipSegmentButton segment={segment} next={next} onSkip={skipSegment} />
          )}

          {guard.asking && (
            <StillWatchingDialog count={getStreak().count} secondsLeft={guard.answerLeft} onKeep={guard.keepWatching} onStop={guard.stopWatching} />
          )}

          {guard.sleepWarning !== null && !guard.asking && <SleepWarning secondsLeft={guard.sleepWarning} onKeep={guard.cancelSleep} />}

          {upNext.visible && next && !guard.asking && (
            <UpNextCard
              next={next}
              phase={upNext.phase}
              counting={upNext.counting}
              flow={flow}
              flowSeconds={upNext.flowSeconds}
              shownSeconds={upNext.shownSeconds}
              secondsLeft={upNext.secondsLeft}
              countdownSeconds={countdownSeconds}
              onPlayNow={() => void goNext()}
              onDismiss={upNext.dismiss}
            />
          )}

          <Controls
            channel={channelChrome}
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
            secondSubtitleIndex={secondSubtitleIndex}
            onSecondSubtitle={onSecondSubtitle}
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
            chapterMarks={initialPrefs.chapterMarks}
            timeLabels={{ left: initialPrefs.timeLeft, right: initialPrefs.timeRight }}
            onScrubbing={scrubbing}
            trickplay={trickplay}
            pictureInPicture={canPip ? { active: pip, onToggle: togglePip } : undefined}
            nextEpisode={next ? { label: `${isEpisode(next) ? episodeCode(next) : ''} ${next.name}`.trim(), onPlay: () => void goNext() } : undefined}
            repeatQueue={repeat}
            episodes={isEpisode(movie) && onPickEpisode ? { session, current: movie, onPick: (episode) => void pickEpisode(episode) } : undefined}
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
            sleepTimer={flow || mini ? undefined : { value: sleepTimer, onChange: setSleepTimer }}
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