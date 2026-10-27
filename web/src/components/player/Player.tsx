import { useCallback, useEffect, useRef, useState } from 'react'
import {
  audioChangeRequest,
  getPlaybackExtras,
  isEpisode,
  NO_EXTRAS,
  negotiatePlayback,
  newSubtitleIndex,
  pickAudio,
  pickSubtitle,
  PlaybackError,
  playbackTitle,
  retryRequest,
  ticksToSeconds,
  type Movie,
  type PlaybackExtras,
  type PlaybackPlan,
  type Session,
  type StreamRequest,
} from '../../core'
import { loadSubtitleFile } from '../../platform/web/browser'
import { lockPageScroll } from '../../platform/web/scrollLock'
import { detectCapabilities } from '../../platform/web/capabilities'
import { readPlayerPrefs, readSeriesPrefs, writePlayerPrefs, writeSeriesPrefs } from '../../platform/web/prefs'
import { PlayerStage } from './PlayerStage'
import { t } from '../../i18n'

type Request = Partial<StreamRequest> & { nonce: number }

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; plan: PlaybackPlan; startSeconds: number; fallback: boolean }

/**
 * Full-screen player. Owns the "ask the server how to play this" step; the stage below
 * owns the <video> element. Changing audio track (or falling back to a transcode) means
 * asking again, which swaps the stage for a new stream at the same position. The speed and
 * subtitle choice live here so they survive that swap.
 *
 * For an episode, the audio and subtitle language you chose are remembered per series (an anime keeps its
 * Japanese audio and English subtitles in the next episode), and the next episode can follow on its own.
 */
export function Player({
  session,
  movie,
  startOver = false,
  startAt,
  next = null,
  onNext,
  repeat,
  onExit,
}: {
  session: Session
  /** A fresh copy of the title (its resume position is used to start). An episode gets series features. */
  movie: Movie
  /** Ignore the saved position and start from the beginning. */
  startOver?: boolean
  /** Begin at this many seconds (another device handed its playback over), instead of at the saved position. */
  startAt?: number
  /** What follows this one (the next episode, or the next title of the playlist), once known. */
  next?: Movie | null
  onNext?: () => void
  /** Present when this is part of a queue: the choice to play it again from the start after the last title. */
  repeat?: { enabled: boolean; onChange: (enabled: boolean) => void }
  onExit: () => void
}) {
  const [request, setRequest] = useState<Request>({ nonce: 0 })
  const [state, setState] = useState<State>({ status: 'loading' })
  const [speed, setSpeed] = useState(1)
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null)
  // A subtitle file from the viewer's device lives here (not in the stage) so it survives switching audio track.
  const [localSubtitle, setLocalSubtitle] = useState<{ name: string; url: string } | null>(null)
  const [subtitleFileError, setSubtitleFileError] = useState<string | null>(null)
  const localUrl = useRef<string | null>(null)
  const clearLocalSubtitle = useCallback(() => {
    setSubtitleFileError(null)
    setLocalSubtitle((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
  }, [])
  const chooseSubtitleFile = useCallback(
    (file: File) => {
      setSubtitleFileError(null)
      loadSubtitleFile(file)
        .then((url) => {
          setLocalSubtitle((current) => {
            if (current) URL.revokeObjectURL(current.url)
            return { name: file.name, url }
          })
        })
        .catch((e: unknown) => setSubtitleFileError(t(e instanceof Error ? e.message : 'Could not read that file.')))
    },
    [],
  )
  useEffect(() => {
    localUrl.current = localSubtitle?.url ?? null
  }, [localSubtitle])
  useEffect(
    () => () => {
      if (localUrl.current) URL.revokeObjectURL(localUrl.current)
    },
    [],
  )
  // The tracks the video had when a subtitle was being saved on the server (so the one that appears afterwards is known).
  const pendingSubtitles = useRef<number[] | null>(null)
  const subtitlesInitialised = useRef(false)
  const audioInitialised = useRef(false)
  const currentPlan = useRef<PlaybackPlan | null>(null)
  const seriesId = isEpisode(movie) ? movie.seriesId : null

  // Skippable intro/credits and chapter markers, when the server has them. Read once, so they survive audio switches.
  const [extras, setExtras] = useState<PlaybackExtras>(NO_EXTRAS)
  useEffect(() => {
    let cancelled = false
    void getPlaybackExtras(session, movie.id).then((found) => {
      if (!cancelled) setExtras(found)
    })
    return () => {
      cancelled = true
    }
  }, [session, movie.id])

  // The page behind the player stops scrolling for as long as it is open.
  useEffect(() => lockPageScroll(), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const startSeconds = request.startSeconds ?? startAt ?? (startOver ? 0 : ticksToSeconds(movie.resumeTicks))
        const plan = await negotiatePlayback(session, movie.id, {
          audioStreamIndex: request.audioIndex,
          mediaSourceId: request.mediaSourceId,
          forceTranscode: request.forceTranscode,
          capabilities: detectCapabilities(),
          maxBitrate: readPlayerPrefs().maxBitrateMbps * 1_000_000,
        })
        if (cancelled) return
        const remembered = seriesId ? readSeriesPrefs(seriesId) : {}
        // First stream of this viewing: switch on subtitles in the language chosen last time (for this series, if it is one).
        if (!subtitlesInitialised.current) {
          subtitlesInitialised.current = true
          const language =
            remembered.subtitleLanguage !== undefined ? remembered.subtitleLanguage : readPlayerPrefs().subtitleLanguage
          setSubtitleIndex(pickSubtitle(plan.subtitleTracks, language))
        }
        // ...and the audio language of this series, which may need the server to remux or transcode.
        if (!audioInitialised.current) {
          audioInitialised.current = true
          const wanted = pickAudio(plan.audioTracks, remembered.audioLanguage)
          if (wanted !== undefined && wanted !== plan.audioIndex) {
            setRequest((prev) => ({
              ...audioChangeRequest(plan, wanted, { fallback: false, startSeconds }),
              nonce: prev.nonce + 1,
            }))
            return
          }
        }
        // A subtitle was just saved from the internet: it is the new track, so switch it on.
        if (pendingSubtitles.current) {
          const added = newSubtitleIndex(pendingSubtitles.current, plan.subtitleTracks.map((track) => track.index))
          pendingSubtitles.current = null
          if (added !== null) {
            setSubtitleIndex(added)
            const language = plan.subtitleTracks.find((track) => track.index === added)?.language ?? null
            writePlayerPrefs({ subtitleLanguage: language })
            if (seriesId) writeSeriesPrefs(seriesId, { subtitleLanguage: language })
          }
        }
        currentPlan.current = plan
        setState({ status: 'ready', plan, startSeconds, fallback: request.fallback ?? false })
      } catch (e) {
        if (!cancelled) {
          setState({
            status: 'error',
            message:
              t(e instanceof PlaybackError ? e.message : 'Could not start playback. Check your connection and try again.'),
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session, movie, startOver, startAt, request, seriesId])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setRequest((prev) => ({ ...prev, nonce: prev.nonce + 1 }))
  }, [])

  const requestStream = useCallback(
    (r: StreamRequest) => {
      // Picking another audio track is remembered for the rest of the series.
      const plan = currentPlan.current
      if (seriesId && plan && r.audioIndex !== undefined && r.audioIndex !== plan.audioIndex) {
        writeSeriesPrefs(seriesId, {
          audioLanguage: plan.audioTracks.find((t) => t.index === r.audioIndex)?.language ?? null,
        })
      }
      setState({ status: 'loading' })
      setRequest((prev) => ({ ...r, nonce: prev.nonce + 1 }))
    },
    [seriesId],
  )

  const subtitleSaved = useCallback(
    (startSeconds: number) => {
      const plan = currentPlan.current
      if (!plan) return
      pendingSubtitles.current = plan.subtitleTracks.map((track) => track.index)
      requestStream(retryRequest(plan, { fallback: state.status === 'ready' ? state.fallback : false, startSeconds }))
    },
    [requestStream, state],
  )

  if (state.status === 'ready') {
    return (
      <PlayerStage
        key={state.plan.playSessionId}
        session={session}
        movie={movie}
        plan={state.plan}
        startSeconds={state.startSeconds}
        fallback={state.fallback}
        speed={speed}
        subtitleIndex={subtitleIndex}
        next={next}
        onNext={onNext}
        repeat={repeat}
        extras={extras}
        localSubtitle={localSubtitle}
        subtitleFileError={subtitleFileError}
        onSubtitleFile={chooseSubtitleFile}
        onClearLocalSubtitle={clearLocalSubtitle}
        onSubtitleSaved={subtitleSaved}
        onSpeed={setSpeed}
        onSubtitle={(index) => {
          setSubtitleIndex(index)
          const language =
            index === null ? null : (state.plan.subtitleTracks.find((t) => t.index === index)?.language ?? null)
          writePlayerPrefs({ subtitleLanguage: language })
          if (seriesId) writeSeriesPrefs(seriesId, { subtitleLanguage: language })
        }}
        onRequest={requestStream}
        onExit={onExit}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-6 text-center">
      {state.status === 'loading' ? (
        <>
          <div
            className="h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-[var(--color-accent)] shadow-[0_0_30px_-4px_var(--glow)]"
            aria-hidden="true"
          />
          <p role="status" className="text-neutral-300">
            {t('Preparing “{title}”…', { title: playbackTitle(movie) })}
          </p>
        </>
      ) : (
        <>
          <p role="alert" className="max-w-md text-neutral-100">
            {state.message}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={retry}>
              {t('Try again')}
            </button>
            <button type="button" className="btn" onClick={onExit}>
              {t('Back')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
