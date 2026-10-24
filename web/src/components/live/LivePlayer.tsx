import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeLiveStream,
  getChannel,
  getChannels,
  negotiatePlayback,
  neighbourChannel,
  PlaybackError,
  PlaybackSession,
  programProgress,
  splitChannelName,
  type Channel,
  type DeviceState,
  type Session,
} from '../../core'
import { reportStopOnPageHide } from '../../platform/web/browser'
import { detectCapabilities } from '../../platform/web/capabilities'
import { attachMedia } from '../../platform/web/mediaAttach'
import { QUALITY_CHOICES, readPlayerPrefs, writePlayerPrefs } from '../../platform/web/prefs'
import { lockPageScroll } from '../../platform/web/scrollLock'
import { BackIcon, ChevronLeftIcon, ChevronRightIcon, FullscreenIcon, ExitFullscreenIcon, MuteIcon, PauseIcon, PlayIcon, VolumeIcon } from '../icons'
import { ReadProgress } from '../reader/ReaderShell'
import { formatClock } from './time'
import { t } from '../../i18n'

const PROGRESS_INTERVAL_MS = 10_000
const REFRESH_PROGRAM_MS = 60_000
const CHROME_HIDE_MS = 3500

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'playing' }

/**
 * Watching a live channel: the stream the server opened, a title with what is on now, and the controls that make sense for a live feed
 * (pause, volume, full screen and the channel before and after). There is no seek bar, no end and no resume point. Arrow up and down
 * change channel. The page is made for one channel; changing channel opens another page of this kind.
 */
export function LivePlayer({ session, id, onChannel, onExit }: { session: Session; id: string; onChannel: (id: string) => void; onExit: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [channel, setChannel] = useState<Channel | null>(null)
  const [others, setOthers] = useState<Channel[]>([])
  const [state, setState] = useState<State>({ status: 'loading' })
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [chrome, setChrome] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [quality, setQuality] = useState(() => readPlayerPrefs().maxBitrateMbps)

  // What is on, and the channels to go to from here.
  useEffect(() => {
    let cancelled = false
    const read = () => {
      getChannel(session, id)
        .then((found) => !cancelled && setChannel(found))
        .catch(() => undefined)
      setNow(Date.now())
    }
    read()
    const timer = setInterval(read, REFRESH_PROGRAM_MS)
    getChannels(session, { limit: 200 })
      .then((page) => !cancelled && setOthers(page.channels))
      .catch(() => undefined)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [session, id])

  useEffect(() => lockPageScroll(), [])

  // The stream: asked for, attached to the picture, and reported to the server like any other playback.
  useEffect(() => {
    const element = video.current
    if (!element) return
    let cancelled = false
    let cleanup: (() => void) | null = null
    const device = (): DeviceState => ({ paused: element.paused, muted: element.muted, volume: element.volume })
    void (async () => {
      try {
        const plan = await negotiatePlayback(session, id, { live: true, capabilities: detectCapabilities(), maxBitrate: quality * 1_000_000 })
        if (cancelled) {
          // Left before it was tuned: the stream the server just opened would run on with nobody watching.
          if (plan.liveStreamId) void closeLiveStream(session, plan.liveStreamId)
          return
        }
        const playback = new PlaybackSession(session, plan, 0)
        const attached = attachMedia({
          video: element,
          plan,
          token: session.accessToken,
          authorization: session.api.authorizationHeader,
          startSeconds: 0,
          onFatal: (message) => !cancelled && setState({ status: 'error', message: t(message) }),
        })
        const onPlaying = () => {
          setState({ status: 'playing' })
          setPaused(false)
          playback.playing(element.currentTime, device())
        }
        const onPause = () => {
          setPaused(true)
          playback.stateChanged(element.currentTime, device())
        }
        const onTime = () => playback.moved(element.currentTime)
        const onVolume = () => setMuted(element.muted)
        const onPageHide = () => reportStopOnPageHide(playback, device())
        element.addEventListener('playing', onPlaying)
        element.addEventListener('pause', onPause)
        element.addEventListener('timeupdate', onTime)
        element.addEventListener('volumechange', onVolume)
        window.addEventListener('pagehide', onPageHide)
        const timer = setInterval(() => playback.tick(device()), PROGRESS_INTERVAL_MS)
        cleanup = () => {
          clearInterval(timer)
          element.removeEventListener('playing', onPlaying)
          element.removeEventListener('pause', onPause)
          element.removeEventListener('timeupdate', onTime)
          element.removeEventListener('volumechange', onVolume)
          window.removeEventListener('pagehide', onPageHide)
          const last = device()
          attached.destroy()
          // A stop is only reported for a stream that played; one that never did is closed directly.
          if (playback.hasStarted) void playback.stop(last)
          else if (plan.liveStreamId) void closeLiveStream(session, plan.liveStreamId)
        }
      } catch (e) {
        if (!cancelled) {
          setState({ status: 'error', message: t(e instanceof PlaybackError ? e.message : 'Could not start the channel. It may be off the air or blocked where the server is. Try another one.') })
        }
      }
    })()
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [session, id, attempt, quality])

  const goTo = useCallback((step: 1 | -1) => {
    const next = neighbourChannel(others, id, step)
    if (next) onChannel(next)
  }, [others, id, onChannel])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void container.current?.requestFullscreen().catch(() => undefined)
  }, [])
  const togglePause = useCallback(() => {
    const element = video.current
    if (!element) return
    if (element.paused) void element.play().catch(() => undefined)
    else element.pause()
  }, [])
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === container.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowUp' || e.key === 'PageUp') goTo(-1)
      else if (e.key === 'ArrowDown' || e.key === 'PageDown') goTo(1)
      else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        togglePause()
      } else if (e.key === 'm' && video.current) video.current.muted = !video.current.muted
      else if (e.key === 'f') toggleFullscreen()
      else if (e.key === 'Escape' && !document.fullscreenElement) onExit()
      setChrome(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, togglePause, toggleFullscreen, onExit])

  // The controls fade away while you watch and come back when you move.
  const wake = useCallback(() => {
    setChrome(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChrome(false), CHROME_HIDE_MS)
  }, [])
  useEffect(() => {
    hideTimer.current = setTimeout(() => setChrome(false), CHROME_HIDE_MS)
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  const program = channel?.now && channel.now.endMs > now ? channel.now : undefined
  const name = channel ? splitChannelName(channel.name) : null
  const title = name && channel ? `${channel.number ? `${channel.number} · ` : ''}${name.title}` : t('Live TV')
  const canChange = neighbourChannel(others, id, 1) !== null

  return (
    <div
      ref={container}
      role="region"
      aria-label={t('Watching {title}', { title })}
      className={`fixed inset-0 z-50 bg-black ${chrome ? '' : 'cursor-none'}`}
      onMouseMove={wake}
      onTouchStart={wake}
    >
      <video ref={video} data-testid="video" className="h-full w-full bg-black" playsInline autoPlay onClick={togglePause} />

      {state.status === 'loading' && (
        <div role="status" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 text-neutral-300">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-[var(--color-accent)]" aria-hidden="true" />
          <p>{t('Tuning {title}…', { title })}</p>
        </div>
      )}
      {state.status === 'error' && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 p-6 text-center">
          <p className="max-w-md text-neutral-100">{state.message}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setState({ status: 'loading' })
                setAttempt((n) => n + 1)
              }}
            >
              {t('Try again')}
            </button>
            <button type="button" className="btn" onClick={onExit}>
              {t('Back')}
            </button>
          </div>
        </div>
      )}

      <div className={`transition-opacity duration-300 ${chrome || paused || state.status !== 'playing' ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <div className="absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-10 pt-[max(1rem,var(--safe-top))]">
          <button type="button" className="btn" onClick={onExit}>
            <BackIcon /> {t('Back')}
          </button>
          <span className="rounded bg-rose-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">{t('Live')}</span>
          <h1 className="min-w-0 truncate text-base font-semibold text-white" title={channel?.name}>{title}</h1>
          {name?.tags.map((tag) => (
            <span key={tag} className="hidden rounded border border-white/20 px-1.5 text-[11px] leading-5 text-neutral-300 sm:inline">
              {tag}
            </span>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/85 to-transparent px-4 pb-[max(1rem,var(--safe-bottom))] pt-16">
          {program ? (
            <div className="max-w-3xl space-y-1.5">
              <p className="text-lg font-semibold text-white">
                {program.name}
                {program.episodeTitle ? <span className="font-normal text-neutral-300"> · {program.episodeTitle}</span> : null}
              </p>
              <p className="text-sm text-neutral-300">
                {formatClock(program.startMs)} – {formatClock(program.endMs)}
              </p>
              <ReadProgress percent={programProgress(program, now) * 100} />
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <button type="button" className="btn" aria-label={t('Previous channel')} title={t('Previous channel')} disabled={!canChange} onClick={() => goTo(-1)}>
              <ChevronLeftIcon />
            </button>
            <button type="button" className="btn" aria-label={t('Next channel')} title={t('Next channel')} disabled={!canChange} onClick={() => goTo(1)}>
              <ChevronRightIcon />
            </button>
            <button type="button" className="btn" aria-label={paused ? t('Play') : t('Pause')} onClick={togglePause}>
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              type="button"
              className="btn"
              aria-label={muted ? t('Unmute') : t('Mute')}
              onClick={() => {
                if (video.current) video.current.muted = !video.current.muted
              }}
            >
              {muted ? <MuteIcon /> : <VolumeIcon />}
            </button>
            <label htmlFor="live-quality" className="sr-only">
              {t('Quality')}
            </label>
            <select
              id="live-quality"
              className="select ml-auto max-w-40"
              value={quality}
              onChange={(e) => {
                const mbps = Number(e.target.value)
                writePlayerPrefs({ maxBitrateMbps: mbps })
                setState({ status: 'loading' })
                setQuality(mbps)
              }}
            >
              {QUALITY_CHOICES.map((mbps) => (
                <option key={mbps} value={mbps}>
                  {mbps === 0 ? t('Original quality') : t('Up to {mbps} Mbps', { mbps })}
                </option>
              ))}
            </select>
            <button type="button" className="btn" aria-label={fullscreen ? t('Exit fullscreen') : t('Fullscreen')} onClick={toggleFullscreen}>
              {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
