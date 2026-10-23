import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  controlDevice,
  formatTime,
  getRemoteDevices,
  playOnDevice,
  resolvePlayTarget,
  seekDevice,
  type RemoteCommand,
  type RemoteDevice,
  type RemoteMessage,
  type Session,
} from '../../core'
import { RemoteSocket } from '../../platform/web/remoteSocket'
import { useMusicIfAny } from '../music/MusicProvider'
import { DeviceIcon, PauseIcon, PlayIcon } from '../icons'
import type { Navigate } from '../route'
import type { PlaybackController, PlaybackKind } from './controller'
import { t } from '../../i18n'

/**
 * "Play on…": the other devices of the account that can be told what to play (the TV app, this web app on a phone or another computer), a
 * small remote for the one being controlled, and the other way round: this browser listens for what other devices tell it to do, so a
 * song or a movie can be started here, paused, moved, from any of them.
 */
export interface RemoteApi {
  devices: RemoteDevice[] | null
  /** Asks the server which devices can be controlled right now. */
  refresh: () => Promise<void>
  /** Starts a title on a device and shows its remote. Throws a readable error when the device cannot be reached. */
  playOn: (device: RemoteDevice, itemId: string) => Promise<void>
  /** Hands what is playing on this device over to another one (same place, same song) and stops it here. */
  sendCurrent: (device: RemoteDevice) => Promise<void>
  /** Lets a player offer itself to be driven by commands from other devices. Pass null when it goes away. */
  register: (kind: PlaybackKind, controller: PlaybackController | null) => void
}

const RemoteContext = createContext<RemoteApi | null>(null)

/** Null where there is no provider (tests, pages shown on their own): the "Play on" button then simply does not appear. */
export function useRemote(): RemoteApi | null {
  return useContext(RemoteContext)
}

/** Registers a player with the remote-control layer for as long as it is mounted. Does nothing where there is no provider. */
export function useRegisterPlayback(kind: PlaybackKind, controller: PlaybackController | null): void {
  const remote = useRemote()
  const register = remote?.register
  useEffect(() => {
    if (!register || !controller) return
    register(kind, controller)
    return () => register(kind, null)
  }, [register, kind, controller])
}

const FOLLOW_MS = 3000
/** How often to look for a device that started playing while nothing is being followed. */
const WATCH_MS = 15_000
const NOTICE_MS = 7000

export function RemoteProvider({ session, go, children }: { session: Session; go: Navigate; children: ReactNode }) {
  const music = useMusicIfAny()
  const [devices, setDevices] = useState<RemoteDevice[] | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // ---- the players that can be driven from other devices ------------------------------------------------------------

  const controllers = useRef<{ video: PlaybackController | null; audio: PlaybackController | null }>({ video: null, audio: null })
  const register = useCallback((kind: PlaybackKind, controller: PlaybackController | null) => {
    controllers.current[kind] = controller
  }, [])

  useEffect(() => {
    if (!music) return
    const audio: PlaybackController = {
      pause: () => music.pause(),
      resume: () => music.resume(),
      toggle: () => music.toggle(),
      stop: () => music.clear(),
      seek: (seconds) => music.seek(seconds),
      skip: (delta) => music.seek(music.getPosition() + delta),
      next: () => music.next(),
      previous: () => music.previous(),
      setVolume: (level) => music.setVolume(level),
      setMuted: (muted) => (muted === 'toggle' ? music.toggleMute() : music.setMuted(muted)),
      snapshot: () => {
        const queue = music.getState().queue
        if (!queue || !music.current) return null
        return { itemIds: queue.items.slice(queue.index).map((item) => item.track.id), startIndex: 0, positionSeconds: music.getPosition() }
      },
    }
    const held = controllers.current
    held.audio = audio
    return () => {
      if (held.audio === audio) held.audio = null
    }
  }, [music])

  /** The player that is doing something now: the video if there is one (it pauses the music), else the music when a song is loaded. */
  const active = useCallback((): PlaybackController | null => {
    const { video, audio } = controllers.current
    return video ?? (audio?.snapshot() ? audio : null)
  }, [])

  // ---- following another device -------------------------------------------------------------------------------------

  // The device being controlled, kept in a ref too so a refresh can notice that it has gone away.
  const targetRef = useRef<string | null>(null)
  const follow = useCallback((id: string | null) => {
    targetRef.current = id
    setTargetId(id)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const list = await getRemoteDevices(session)
      if (!alive.current) return
      setDevices(list)
      if (targetRef.current && !list.some((d) => d.id === targetRef.current)) {
        follow(null)
        setNotice(t('The device went away.'))
      }
    } catch {
      if (alive.current) setDevices([])
    }
  }, [session, follow])

  const playOn = useCallback(
    async (device: RemoteDevice, itemId: string) => {
      try {
        await playOnDevice(session, device.id, itemId)
      } catch {
        throw new Error(t('Could not reach {device}.', { device: device.name }))
      }
      setNotice(null)
      follow(device.id)
      void refresh()
    },
    [session, refresh, follow],
  )

  const sendCurrent = useCallback(
    async (device: RemoteDevice) => {
      const player = active()
      const snapshot = player?.snapshot()
      if (!player || !snapshot) throw new Error(t('Nothing is playing here.'))
      try {
        await playOnDevice(session, device.id, snapshot.itemIds, snapshot.positionSeconds, snapshot.startIndex)
      } catch {
        throw new Error(t('Could not reach {device}.', { device: device.name }))
      }
      // It plays over there now; here it stops (a video closes its page).
      await player.stop()
      setNotice(null)
      follow(device.id)
      void refresh()
    },
    [session, active, refresh, follow],
  )

  // ---- being controlled ---------------------------------------------------------------------------------------------

  /** Starts what another device (or "play here") asked for: a movie opens the player, songs go to the music player. */
  const startHere = useCallback(
    async (itemIds: string[], startIndex: number, startSeconds: number, mode: 'now' | 'next' | 'last') => {
      const target = await resolvePlayTarget(session, itemIds)
      if (target.kind === 'video') {
        music?.pause()
        go({ page: 'play', id: target.itemId, startOver: false, ...(startSeconds > 0 ? { startAt: startSeconds } : {}) })
        return
      }
      if (target.kind === 'audio' && music) {
        if (mode === 'next') {
          music.playNext(target.tracks)
        } else if (mode === 'last') {
          music.enqueue(target.tracks)
        } else {
          // Songs replace a movie that is playing here.
          if (controllers.current.video) await controllers.current.video.stop()
          const wanted = itemIds[startIndex]
          music.play(target.tracks, Math.max(0, target.tracks.findIndex((track) => track.id === wanted)), { startSeconds })
        }
        return
      }
      throw new Error('unsupported')
    },
    [session, music, go],
  )

  const handleMessage = useCallback(
    async (message: RemoteMessage) => {
      switch (message.kind) {
        case 'play':
          try {
            await startHere(message.itemIds, message.startIndex, message.startSeconds, message.mode)
          } catch {
            setNotice(t('This device could not play what was sent.'))
          }
          return
        case 'playstate': {
          const player = active()
          if (!player) return
          switch (message.command) {
            case 'pause':
              return player.pause()
            case 'resume':
              return player.resume()
            case 'toggle':
              return player.toggle()
            case 'stop':
              return void player.stop()
            case 'next':
              return player.next()
            case 'previous':
              return player.previous()
            case 'seek':
              return player.seek(message.seekSeconds)
            case 'rewind':
              return player.skip(-10)
            case 'forward':
              return player.skip(30)
          }
          return
        }
        case 'volume':
          return active()?.setVolume(message.level) ?? music?.setVolume(message.level)
        case 'mute':
          return active()?.setMuted(message.mute) ?? (message.mute === 'toggle' ? music?.toggleMute() : music?.setMuted(message.mute))
        case 'message':
          setNotice(message.header ? `${message.header}: ${message.text}` : message.text)
          return
        case 'keepAlive':
          return
      }
    },
    [startHere, active, music],
  )
  const handleRef = useRef(handleMessage)
  useEffect(() => {
    handleRef.current = handleMessage
  }, [handleMessage])

  // Listen for what other devices tell this one to do, for as long as this session is open.
  useEffect(() => {
    const socket = new RemoteSocket(session, (message) => void handleRef.current(message))
    socket.start()
    const wake = () => {
      if (document.visibilityState === 'visible') socket.nudge()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      socket.stop()
    }
  }, [session])

  // Pulls what another device is playing over to this one, and stops it there.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const playHere = useCallback(
    async (device: RemoteDevice) => {
      const playing = device.nowPlaying
      if (!playing) return
      await startHere([playing.itemId], 0, playing.positionSeconds, 'now')
      try {
        await controlDevice(session, device.id, 'stop')
      } catch {
        // It is already playing here; a device that cannot be stopped is not worth an error.
      }
      setDismissed(`${device.id}:${playing.itemId}`)
      follow(null)
    },
    [session, startHere, follow],
  )

  // While a device is being controlled, follow what it is doing; otherwise look now and then for one that started playing.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (targetId || document.visibilityState === 'visible') void refresh()
    }, targetId ? FOLLOW_MS : WATCH_MS)
    return () => window.clearInterval(timer)
  }, [targetId, refresh])
  const target = devices?.find((d) => d.id === targetId) ?? null

  // Look once when the page opens and again whenever the tab comes back, so a device that is already playing can be picked up.
  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(first)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  // A title the user closed the remote for is not offered again until something else plays.
  const busyDevice = target
    ? null
    : (devices?.find((d) => d.nowPlaying && `${d.id}:${d.nowPlaying.itemId}` !== dismissed) ?? null)
  const close = () => {
    const current = devices?.find((d) => d.id === targetRef.current)
    if (current?.nowPlaying) setDismissed(`${current.id}:${current.nowPlaying.itemId}`)
    follow(null)
  }

  const value = useMemo<RemoteApi>(() => ({ devices, refresh, playOn, sendCurrent, register }), [devices, refresh, playOn, sendCurrent, register])

  return (
    <RemoteContext.Provider value={value}>
      {children}
      {target && <RemoteBar session={session} device={target} onClose={close} onChanged={refresh} onPlayHere={playHere} />}
      {busyDevice?.nowPlaying && (
        <button
          type="button"
          className="btn fixed bottom-[calc(1rem+var(--nav-h)+var(--bottom-inset))] right-[max(1rem,var(--safe-x))] z-40 max-w-[min(22rem,calc(100vw-2rem))] bg-neutral-950/95 backdrop-blur-xl"
          onClick={() => follow(busyDevice.id)}
        >
          <DeviceIcon kind={busyDevice.kind} />
          <span className="truncate">{t('On {device}: {title}', { device: busyDevice.name, title: busyDevice.nowPlaying.title })}</span>
        </button>
      )}
      {notice && !target && (
        <p role="status" className="alert-info fixed bottom-[calc(1rem+var(--nav-h)+var(--bottom-inset))] right-[max(1rem,var(--safe-x))] z-40 max-w-xs sm:bottom-auto sm:top-[calc(var(--header-h)+0.5rem)]">
          {notice}
        </p>
      )}
    </RemoteContext.Provider>
  )
}

/** The small remote that floats while a title is playing on another device. */
function RemoteBar({
  session,
  device,
  onClose,
  onChanged,
  onPlayHere,
}: {
  session: Session
  device: RemoteDevice
  onClose: () => void
  onChanged: () => Promise<void>
  onPlayHere: (device: RemoteDevice) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const playing = device.nowPlaying
  const music = playing?.mediaType === 'Audio'

  async function send(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
      await onChanged()
    } catch {
      setError(t('Could not reach {device}.', { device: device.name }))
    }
  }
  const command = (name: RemoteCommand) => send(() => controlDevice(session, device.id, name))

  return (
    <section
      aria-label={t('Playing on {device}', { device: device.name })}
      className="fixed inset-x-[max(1rem,var(--safe-x))] bottom-[calc(1rem+var(--nav-h)+var(--bottom-inset))] z-40 rounded-2xl border border-white/10 bg-neutral-950/95 p-4 backdrop-blur-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] sm:inset-x-auto sm:bottom-auto sm:right-[max(1rem,var(--safe-x))] sm:top-[calc(var(--header-h)+0.5rem)] sm:w-[22rem]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[var(--color-accent)]">
          <DeviceIcon kind={device.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">{t('Playing on {device}', { device: device.name })}</p>
          <p className="truncate text-sm font-semibold text-white" aria-live="polite">
            {playing ? playing.title : t('Starting…')}
          </p>
          {playing && playing.durationSeconds > 0 && (
            <p className="text-xs text-neutral-400">
              {formatTime(playing.positionSeconds)} / {formatTime(playing.durationSeconds)}
            </p>
          )}
        </div>
        <button type="button" className="btn-ghost -mr-2 -mt-1 px-2" aria-label={t('Close')} onClick={onClose}>
          ✕
        </button>
      </div>
      {playing && playing.durationSeconds > 0 && (
        <SeekSlider
          key={playing.itemId}
          position={playing.positionSeconds}
          duration={playing.durationSeconds}
          onSeek={(seconds) => void send(() => seekDevice(session, device.id, seconds))}
        />
      )}
      {playing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {music && (
            <button type="button" className="btn" aria-label={t('Previous song')} title={t('Previous song')} onClick={() => void command('previous')}>
              ⏮
            </button>
          )}
          <button
            type="button"
            className="btn"
            aria-label={t('Back 30 seconds')}
            onClick={() => void send(() => seekDevice(session, device.id, playing.positionSeconds - 30))}
          >
            −30
          </button>
          <button type="button" className="btn-primary px-4" onClick={() => void command(playing.paused ? 'resume' : 'pause')}>
            {playing.paused ? <PlayIcon /> : <PauseIcon />} {playing.paused ? t('Resume') : t('Pause')}
          </button>
          <button
            type="button"
            className="btn"
            aria-label={t('Forward 30 seconds')}
            onClick={() => void send(() => seekDevice(session, device.id, playing.positionSeconds + 30))}
          >
            +30
          </button>
          <button
            type="button"
            className="btn"
            aria-label={music ? t('Next song') : t('Next episode')}
            title={music ? t('Next song') : t('Next episode')}
            onClick={() => void command('next')}
          >
            ⏭
          </button>
        </div>
      )}
      {playing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setError(null)
              void onPlayHere(device).catch(() => setError(t('This device could not play what was sent.')))
            }}
          >
            {t('Play here')}
          </button>
          <button type="button" className="btn ml-auto" onClick={() => void command('stop')}>
            {t('Stop')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="alert-error mt-3">
          {error}
        </p>
      )}
    </section>
  )
}

/** A bar that follows the playing position and, once let go, asks the device to jump there. */
function SeekSlider({ position, duration, onSeek }: { position: number; duration: number; onSeek: (seconds: number) => void }) {
  // While the thumb is held the bar shows where it is, not where the other device is.
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? Math.min(position, duration)
  return (
    <input
      type="range"
      aria-label={t('Position')}
      aria-valuetext={`${formatTime(shown)} / ${formatTime(duration)}`}
      className="mt-3 h-1.5 w-full cursor-pointer accent-[var(--color-accent)]"
      min={0}
      max={Math.floor(duration)}
      step={5}
      value={Math.floor(shown)}
      onChange={(e) => setDragging(Number(e.target.value))}
      onPointerUp={() => {
        if (dragging !== null) onSeek(dragging)
        setDragging(null)
      }}
      onKeyUp={() => {
        if (dragging !== null) onSeek(dragging)
        setDragging(null)
      }}
    />
  )
}
