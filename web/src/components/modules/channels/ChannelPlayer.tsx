import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getPlayable, type Movie, type PlaybackPlan, type Session } from '../../../core'
import {
  behindLive,
  channelWindow,
  describeSpan,
  isLive,
  listChannels,
  liveTime,
  locate,
  mergePrograms,
  restoreResumePosition,
  viewerTime,
  type ChannelSummary,
  type ChannelWindow,
  type Program,
} from '../../../core/modules'
import { doneWatching, markWatching, noteWatched, PENDING_SAVE_EVERY_SECONDS, restoreLeftOver } from '../../../platform/web/channelPending'
import { t } from '../../../i18n'
import { ChannelDownIcon, ChannelUpIcon, GuideIcon, NextEpisodeIcon, PreviousProgramIcon, StartOverIcon } from '../../icons'
import { iconButton, type ChannelChrome } from '../../player/Controls'
import { prepareStream } from '../../player/prepareStream'
import { useModulesClient } from '../ModulesProvider'
import { ChannelGuidePanel } from './ChannelGuidePanel'
import { ChannelOsd } from './ChannelOsd'
import { programTitle } from './programText'

const Player = lazy(() => import('../../player/Player').then((m) => ({ default: m.Player })))

/** Where the viewer is: a program of the channel and the second of it they begin at. `nonce` makes "start over" start again. */
interface Place {
  start: number
  seek: number
  nonce: number
}

const SHOW_NUMBER_MS = 3500
/** The programs ahead of the viewer that are kept, and when more are asked for. */
const KEEP_AHEAD = 8
const TOP_UP_AT = 3
/** A program left this long after it stopped is tidied (the player reports its own stop first). */
const TIDY_DELAY_MS = 1500
/** The next program is got ready (its title and how to play it) when this little of the one in view is left. */
const PREPARE_AHEAD_SECONDS = 45
/** Joining a program that is already this far along is worth a word (and an offer to start it over). */
const JOIN_NOTICE_SECONDS = 60

const clock = (seconds: number): string => new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** True when a key press is meant for a text box, not for the player. */
const typing = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/**
 * Watching a retro TV channel: the normal player, opened on the program that is on, at the minute it is at, with the controls of a
 * television (one glass panel at the bottom: what is on, the progress bar, and the buttons to start over, jump to the next or the
 * previous program, go back to "live", change channel, open the guide of this channel, volume, share and settings). The program that
 * follows starts by itself when one ends. The only thing kept is where the viewer is on the channel's timeline; "live" is that place
 * being the clock. Nothing runs on the server for this: it only answers "what is on".
 */
export function ChannelPlayer({
  session,
  channelId,
  onChannel,
  onExit,
}: {
  session: Session
  channelId: string
  onChannel: (id: string) => void
  onExit: () => void
}) {
  const { client, skew } = useModulesClient()
  const [channel, setChannel] = useState<ChannelWindow['channel'] | null>(null)
  const [programs, setPrograms] = useState<Program[]>([])
  const [place, setPlace] = useState<Place | null>(null)
  const [movie, setMovie] = useState<Movie | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'offair' | 'error'>('loading')
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [numberShown, setNumberShown] = useState(true)
  const [liveNow, setLiveNow] = useState(true)
  const [guideOpen, setGuideOpen] = useState(false)
  // How to play the program in view, when it was asked for ahead of time (and for which start: a start over asks again).
  const [prepared, setPrepared] = useState<{ plan: Promise<PlaybackPlan>; nonce: number } | null>(null)
  const [osd, setOsd] = useState<{ key: string; joined: number | null } | null>(null)
  const [tunedIn, setTunedIn] = useState(false)
  const played = useRef(0)
  const lastSaved = useRef(0)
  // The program after the one in view, got ready while the viewer is near the end of this one.
  const ahead = useRef<{ key: string; movie: Promise<Movie>; plan: Promise<PlaybackPlan> } | null>(null)
  const programsRef = useRef<Program[]>([])
  const placeRef = useRef<Place | null>(null)
  const resume = useRef<{ itemId: string; ticks: number; runtime: number } | null>(null)
  // The player is not drawn again for every little thing: it gets one function that always calls the latest exit.
  const exitRef = useRef(onExit)
  useEffect(() => {
    exitRef.current = onExit
  }, [onExit])
  const exitPlayer = useCallback(() => exitRef.current(), [])

  const current = place ? programs.find((p) => p.start === place.start) : undefined
  const currentIndex = current ? programs.indexOf(current) : -1

  useEffect(() => {
    programsRef.current = programs
    placeRef.current = place
  }, [programs, place])

  const take = useCallback((win: ChannelWindow) => {
    setChannel(win.channel)
    setPrograms((before) => mergePrograms(before, win.programs))
  }, [])

  // A title left half way by a page that died (closed tab, crash) gets its place back now.
  useEffect(() => {
    void restoreLeftOver(session)
  }, [session])

  // ---- first look: what is on now, and where in it ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    channelWindow(client, channelId, { before: 2, after: KEEP_AHEAD })
      .then((win) => {
        if (cancelled) return
        take(win)
        const on = win.programs[win.currentIndex]
        if (!on) {
          setStatus('offair')
          return
        }
        setPlace({ start: on.start, seek: Math.max(0, win.serverTime - on.start), nonce: 0 })
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    listChannels(client)
      .then((list) => {
        if (!cancelled) setChannels(list.filter((c) => c.enabled))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client, channelId, take])

  // ---- the title of the program on -----------------------------------------------------------------------------------
  const programKey = current ? `${current.itemId}@${current.start}` : ''
  // What the screen says for a moment when a program starts: now and next, and (when tuning in late) the offer to start it over.
  if (programKey && osd?.key !== programKey) {
    const seek = place?.seek ?? 0
    setOsd({ key: programKey, joined: !tunedIn && seek >= JOIN_NOTICE_SECONDS ? seek : null })
    setTunedIn(true)
  }
  useEffect(() => {
    if (!current) return
    // A program whose title this account may not see (the container sends no id for it): the viewer goes on to the next one.
    if (current.unavailable) {
      skipTo(programsRef.current[programsRef.current.indexOf(current) + 1])
      return
    }
    let cancelled = false
    played.current = 0
    lastSaved.current = 0
    // A program that was got ready ahead of time starts without asking the server again.
    const early = ahead.current?.key === programKey ? ahead.current : null
    ahead.current = null
    const nonce = placeRef.current?.nonce ?? 0
    ;(early ? early.movie : getPlayable(session, current.itemId))
      .then((found) => {
        if (cancelled) return
        resume.current = { itemId: found.id, ticks: found.resumeTicks, runtime: current.runtime }
        markWatching(session.userId, found.id, found.resumeTicks, current.runtime)
        setMovie(found)
        setPrepared(early ? { plan: early.plan, nonce } : null)
      })
      .catch(() => {
        // A title that was deleted, or that this account may not see: the viewer goes on to the next one.
        if (!cancelled) skipTo(programsRef.current[programsRef.current.indexOf(current) + 1])
      })
    return () => {
      cancelled = true
      // Leaving a program: the place the title had before the channel touched it is put back (see restoreResumePosition).
      const left = resume.current
      resume.current = null
      setMovie(null)
      setPrepared(null)
      if (left) {
        const playedNow = played.current
        window.setTimeout(() => void restoreResumePosition(session, left.itemId, left.ticks, playedNow, left.runtime).finally(() => doneWatching(session.userId, left.itemId)), TIDY_DELAY_MS)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, programKey])

  // ---- more programs when the viewer gets near the end of the list ---------------------------------------------------
  useEffect(() => {
    if (currentIndex < 0 || programs.length - currentIndex > TOP_UP_AT) return
    const last = programs[programs.length - 1]
    if (!last) return
    let cancelled = false
    channelWindow(client, channelId, { at: last.start, before: 0, after: KEEP_AHEAD })
      .then((win) => {
        if (!cancelled) take(win)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client, channelId, currentIndex, programs, take])

  // ---- what the player does, seen from here -------------------------------------------------------------------------
  useEffect(() => {
    const onTime = (e: Event) => {
      if (!(e.target instanceof HTMLVideoElement)) return
      played.current = e.target.currentTime
      // Written down now and then: if the page dies, the next visit knows where the channel left the title.
      if (resume.current && Math.abs(played.current - lastSaved.current) >= PENDING_SAVE_EVERY_SECONDS) {
        lastSaved.current = played.current
        noteWatched(session.userId, resume.current.itemId, played.current)
      }
      prepareAhead(e.target)
    }
    const onEnded = (e: Event) => {
      if (!(e.target instanceof HTMLVideoElement)) return
      const list = programsRef.current
      const at = placeRef.current ? list.findIndex((p) => p.start === placeRef.current?.start) : -1
      void advance(at)
    }
    document.addEventListener('timeupdate', onTime, true)
    document.addEventListener('ended', onEnded, true)
    return () => {
      document.removeEventListener('timeupdate', onTime, true)
      document.removeEventListener('ended', onEnded, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Near the end of the program in view, asks for the next one and for how to play it, so it starts without a wait. */
  function prepareAhead(video: HTMLVideoElement) {
    const list = programsRef.current
    const at = list.findIndex((p) => p.start === placeRef.current?.start)
    const here = list[at]
    const next = list[at + 1]
    if (!here || !next || next.unavailable) return
    const left = (Number.isFinite(video.duration) ? video.duration : here.runtime) - video.currentTime
    if (left > PREPARE_AHEAD_SECONDS) return
    const key = `${next.itemId}@${next.start}`
    if (ahead.current?.key === key) return
    const movie = getPlayable(session, next.itemId)
    const plan = prepareStream(session, next.itemId)
    // If getting ready fails nobody is told: the program then starts the usual way.
    movie.catch(() => undefined)
    plan.catch(() => undefined)
    ahead.current = { key, movie, plan }
  }

  // The number of the channel is shown big for a moment when it is tuned in.
  useEffect(() => {
    const timer = window.setTimeout(() => setNumberShown(false), SHOW_NUMBER_MS)
    return () => window.clearTimeout(timer)
  }, [])

  // ---- moving about the timeline --------------------------------------------------------------------------------------
  function skipTo(program: Program | undefined) {
    if (!program) {
      setStatus('offair')
      setPlace(null)
      return
    }
    setPlace((before) => ({ start: program.start, seek: 0, nonce: (before?.nonce ?? 0) + 1 }))
  }

  /** The program after the one at `index`, asking the container for more when the list has run out. */
  async function advance(index: number) {
    const list = programsRef.current
    const after = list[index + 1]
    if (after) return skipTo(after)
    const from = list[index]
    if (!from) return
    try {
      const win = await channelWindow(client, channelId, { at: from.end, before: 0, after: KEEP_AHEAD })
      take(win)
      skipTo(win.programs.find((p) => p.start >= from.end))
    } catch {
      setStatus('error')
    }
  }

  function startOver() {
    setPlace((p) => (p ? { start: p.start, seek: 0, nonce: p.nonce + 1 } : p))
  }

  async function previous() {
    const list = programsRef.current
    const index = list.findIndex((p) => p.start === placeRef.current?.start)
    const before = list[index - 1]
    if (before) return skipTo(before)
    const from = list[index]
    if (!from) return
    try {
      const win = await channelWindow(client, channelId, { at: from.start - 1, before: 3, after: 0 })
      take(win)
      // A channel that was made a moment ago has nothing before this program: "previous" then plays this one from its start.
      const earlier = win.programs.filter((p) => p.start < from.start).at(-1)
      if (earlier) skipTo(earlier)
      else startOver()
    } catch {
      setStatus('error')
    }
  }

  async function goLive() {
    try {
      const win = await channelWindow(client, channelId, { before: 1, after: KEEP_AHEAD })
      take(win)
      const found = locate(win.programs, win.serverTime)
      const on = found ? win.programs[found.index] : undefined
      if (!on || !found) return setStatus('offair')
      setStatus('ready')
      setPlace((p) => ({ start: on.start, seek: found.offset, nonce: (p?.nonce ?? 0) + 1 }))
    } catch {
      setStatus('error')
    }
  }

  function zap(direction: 1 | -1) {
    if (channels.length < 2) return
    const at = channels.findIndex((c) => c.id === channelId)
    const target = channels[(at + direction + channels.length) % channels.length]
    if (target && target.id !== channelId) onChannel(target.id)
  }

  /** A program picked in the guide: the live one takes the viewer back to live, any other starts from its beginning. */
  function pick(program: Program) {
    setGuideOpen(false)
    const live = liveTime(skew, Date.now())
    if (program.start <= live && live < program.end) void goLive()
    else skipTo(program)
  }

  // ---- keys of a television: channel up and down, the guide ------------------------------------------------------------
  const keys = useRef({ zap, guideOpen })
  useEffect(() => {
    keys.current = { zap, guideOpen }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape' && keys.current.guideOpen) {
        // Escape closes the guide first (and does not leave the channel).
        e.preventDefault()
        e.stopPropagation()
        setGuideOpen(false)
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        keys.current.zap(1)
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        keys.current.zap(-1)
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        setGuideOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ---- the controls of the channel ----------------------------------------------------------------------------------------
  const upNext = currentIndex >= 0 ? programs[currentIndex + 1] : undefined
  const behind = useCallback(() => {
    const on = programsRef.current.find((p) => p.start === placeRef.current?.start)
    if (!on) return 0
    return behindLive(viewerTime(on, played.current || (placeRef.current?.seek ?? 0)), liveTime(skew, Date.now()))
  }, [skew])

  const chrome = useMemo<ChannelChrome | undefined>(() => {
    if (!channel || !current) return undefined
    return {
      info: (
        <div className="mb-1 min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <span aria-hidden="true" className="flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm font-black tabular-nums text-white" style={{ background: channel.color }}>
              {channel.number}
            </span>
            <span className="text-sm font-semibold text-white">{channel.name}</span>
            <LiveBadge behind={behind} onLive={setLiveNow} />
            {upNext && (
              <span className="ml-auto hidden min-w-0 truncate text-xs text-white/60 sm:block">
                {t('Next at {time}: {title}', { time: clock(upNext.start), title: programTitle(upNext) })}
              </span>
            )}
          </div>
          <p className="mt-1.5 truncate text-lg font-semibold leading-tight tracking-tight text-white">{programTitle(current)}</p>
          <p className="truncate text-xs text-white/60">{[current.subtitle, `${clock(current.start)} – ${clock(current.end)}`].filter(Boolean).join(' · ')}</p>
        </div>
      ),
      transport: (
        <>
          <ChannelButton label={t('Previous program')} onClick={() => void previous()}>
            <PreviousProgramIcon />
          </ChannelButton>
          <ChannelButton label={t('Start this program over')} onClick={startOver}>
            <StartOverIcon />
          </ChannelButton>
          <ChannelButton label={t('Next program')} onClick={() => void advance(programsRef.current.findIndex((p) => p.start === placeRef.current?.start))}>
            <NextEpisodeIcon />
          </ChannelButton>
          {!liveNow && (
            <button
              type="button"
              className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-red-600/90 px-3 text-xs font-bold text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              onClick={() => void goLive()}
              title={t('Go to the live moment of this channel')}
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white" />
              {t('Go live')}
            </button>
          )}
        </>
      ),
      extras: (
        <>
          <ChannelButton label={t('Channel down')} onClick={() => zap(-1)} disabled={channels.length < 2}>
            <ChannelDownIcon />
          </ChannelButton>
          <ChannelButton label={t('Channel up')} onClick={() => zap(1)} disabled={channels.length < 2}>
            <ChannelUpIcon />
          </ChannelButton>
          <ChannelButton label={t('Guide of this channel')} onClick={() => setGuideOpen((open) => !open)} pressed={guideOpen}>
            <GuideIcon />
          </ChannelButton>
        </>
      ),
    }
    // The functions the buttons call read refs and the latest state through `programsRef` and `placeRef`, so they need not be dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, current, upNext, liveNow, channels, guideOpen, behind])

  // ---- what the screen says ----------------------------------------------------------------------------------------------
  if (status === 'error' || status === 'offair' || (status === 'loading' && !current)) {
    return (
      <div role={status === 'loading' ? 'status' : 'alert'} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-6 text-center">
        <p className="max-w-md text-neutral-100">
          {status === 'loading' ? t('Tuning in…') : status === 'offair' ? t('This channel has nothing on right now.') : t('The channel could not be tuned in. Check that the modules container is running.')}
        </p>
        {status !== 'loading' && (
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => void goLive()}>
              {t('Try again')}
            </button>
            <button type="button" className="btn" onClick={onExit}>
              {t('Back')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {movie && current && place ? (
        <Suspense fallback={null}>
          <Player
            key={`${current.itemId}@${current.start}#${place.nonce}`}
            session={session}
            movie={movie}
            startAt={Math.floor(place.seek)}
            onExit={exitPlayer}
            channelChrome={chrome}
            preparedPlan={prepared && prepared.nonce === place.nonce ? prepared.plan : undefined}
          />
        </Suspense>
      ) : (
        <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-black text-neutral-300">
          {t('Tuning in…')}
        </div>
      )}

      {/* The number of the channel, big, when it is tuned in; afterwards a small one in the corner, like the logo of a TV channel. */}
      <div aria-hidden="true" className="pointer-events-none fixed right-6 top-6 z-[60] text-right font-black tabular-nums text-white [text-shadow:0_2px_12px_rgba(0,0,0,.9)]">
        <span className={numberShown ? 'text-6xl' : 'text-xl opacity-60'}>{channel?.number}</span>
        {numberShown && <span className="block text-base font-semibold">{channel?.name}</span>}
      </div>

      {osd && current && osd.key === programKey && (
        <ChannelOsd key={osd.key} now={current} next={upNext} joinedMinute={osd.joined === null ? null : Math.floor(osd.joined / 60)} onStartOver={startOver} />
      )}

      {guideOpen && channel && (
        <ChannelGuidePanel
          channelId={channelId}
          channel={channel}
          programs={programs}
          viewing={current?.start}
          skew={skew}
          onPick={pick}
          onLoaded={take}
          onAllChannels={onExit}
          onClose={() => setGuideOpen(false)}
        />
      )}
    </>
  )
}

function ChannelButton({ label, onClick, children, pressed, disabled }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`${iconButton} disabled:opacity-40`} aria-label={label} aria-pressed={pressed} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

/** "LIVE", or how far behind or ahead of it the viewer is. It keeps its own clock so the player is not disturbed by it. */
function LiveBadge({ behind, onLive }: { behind: () => number; onLive: (live: boolean) => void }) {
  const [seconds, setSeconds] = useState(0)
  const read = useRef(behind)
  useEffect(() => {
    read.current = behind
  })
  useEffect(() => {
    const tick = window.setInterval(() => setSeconds(read.current()), 1000)
    return () => window.clearInterval(tick)
  }, [])
  const live = isLive(seconds)
  useEffect(() => onLive(live), [live, onLive])
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${live ? 'bg-red-600 text-white' : 'bg-white/15 text-neutral-200'}`}>
      {live ? t('LIVE') : seconds > 0 ? t('{time} behind', { time: describeSpan(seconds) }) : t('{time} ahead', { time: describeSpan(seconds) })}
    </span>
  )
}
