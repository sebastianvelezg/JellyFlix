import { useEffect, useRef } from 'react'
import {
  bookKindLabel,
  episodeCode,
  formatTime,
  getMovieDetails,
  isEpisode,
  posterUrl,
  ticksToSeconds,
  wideImageUrl,
  type Movie,
  type Session,
} from '../core'
import { CardMenu } from './CardMenu'
import { useCardActions, usePlayVideo } from './cardActions'
import type { PlayQueueRef } from './route'
import { CheckIcon, HeartIcon, InfoIcon, PlayIcon } from './icons'
import { Img } from './Img'
import { Subtext } from './Subtext'
import { detailsKey, prefetchSwr } from './useSwr'
import { t } from '../i18n'

function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-surface-3)] to-[var(--color-surface)] p-3 text-center text-sm font-medium text-neutral-500">
      {name}
    </div>
  )
}

function progressPercent(movie: Movie): number {
  return movie.resumeTicks > 0 && movie.runtimeTicks
    ? Math.min(100, (movie.resumeTicks / movie.runtimeTicks) * 100)
    : 0
}

// (`group-hover/card` is the whole card of MovieCard, with its play button over the picture: hovering that button keeps the picture lifted.)
export const frame =
  'relative overflow-hidden rounded-xl bg-[var(--color-surface-2)] ring-1 ring-white/[.08] transition duration-300 ease-out group-hover:z-10 group-hover:scale-[1.04] group-hover:shadow-[0_14px_44px_-10px_var(--glow)] group-hover:ring-[var(--color-accent)]/70 group-hover/card:z-10 group-hover/card:scale-[1.04] group-hover/card:shadow-[0_14px_44px_-10px_var(--glow)] group-hover/card:ring-[var(--color-accent)]/70 group-focus-visible:scale-[1.04] group-focus-visible:ring-2 group-focus-visible:ring-[var(--color-accent)]'

/** "1h 52m" or "48m". */
export function formatRuntime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
}

const PLAY_BUTTON =
  'flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-accent-strong)] pl-0.5 text-[var(--color-accent-ink)] shadow-[0_0_30px_var(--glow)] ring-1 ring-white/30'

/**
 * The round play button that fades in over a hovered card, and (when given) how long the title is. With `real` the button is a real one
 * (drawn by the card, outside this picture) and only the shade and the length are drawn here.
 */
function HoverPlay({ runtime, real = false }: { runtime?: string; real?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 transition duration-300 group-hover:opacity-100 group-hover/card:opacity-100 group-focus-visible:opacity-100">
      {!real && (
        <span className={PLAY_BUTTON}>
          <PlayIcon />
        </span>
      )}
      {runtime && <Subtext as="span" className="absolute bottom-2 left-2.5 text-xs font-medium text-neutral-100" text={runtime} />}
    </div>
  )
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 bg-black/70" role="presentation">
      <div className="h-full rounded-r-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--glow)]" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** How long a mouse must rest on a card before its page is read ahead (a quick sweep over many cards reads none). */
const PREFETCH_DELAY_MS = 150

/**
 * Reads a title's page ahead of time when the mouse rests on its card or the card gets keyboard focus, so that
 * opening it shows the page at once. Touch has no hover, so it is left out.
 */
function usePrefetchOnHover(session: Session, id: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])
  const prefetch = () => prefetchSwr(detailsKey(session, id), () => getMovieDetails(session, id), 60_000)
  return {
    onPointerEnter: (e: { pointerType: string }) => {
      if (e.pointerType !== 'mouse') return
      cancel()
      timer.current = setTimeout(prefetch, PREFETCH_DELAY_MS)
    },
    onPointerLeave: cancel,
    onFocus: prefetch,
    onBlur: cancel,
  }
}

/**
 * Poster card used in grids and rows. Click opens the movie page. A music video's card also has a play button in the middle of its
 * picture that plays it at once; `list` (the videos of the row or grid, in order) or `queue` (a folder, a library) say what follows it.
 */
export function MovieCard({
  session,
  movie,
  onOpen,
  list,
  queue,
}: {
  session: Session
  movie: Movie
  onOpen: (movie: Movie) => void
  list?: readonly Movie[]
  queue?: PlayQueueRef
}) {
  const playVideo = usePlayVideo()
  const progress = progressPercent(movie)
  const title = movie.musicVideo && movie.artist ? t('{name} by {artist}', { name: movie.name, artist: movie.artist }) : movie.name
  // A book's card says what kind it is (EPUB, PDF, Audiobook...) and a music video's, who it is by.
  const kindLabel = movie.book ? t(bookKindLabel(movie)) : undefined
  const label = `${title}${movie.year || kindLabel ? ` (${[kindLabel, movie.year].filter(Boolean).join(', ')})` : ''}`
  const hover = usePrefetchOnHover(session, movie.id)
  const remember = useCardActions()
  const runtime = movie.runtimeTicks ? formatRuntime(ticksToSeconds(movie.runtimeTicks)) : undefined
  // A music video's picture is a wide frame, not a poster; the artist goes under the title.
  const wide = !!movie.musicVideo
  const subtext = wide ? [movie.artist, movie.year].filter(Boolean).join(' · ') : movie.book ? [kindLabel, movie.year].filter(Boolean).join(' · ') : movie.year
  const canPlay = wide && !!playVideo

  return (
    <div className="group/card relative">
    <button
      type="button"
      onClick={() => onOpen(movie)}
      className="group block w-full text-left outline-none"
      aria-label={t('Open {label}', { label })}
      {...hover}
    >
      <div className={`${wide ? 'aspect-video' : 'aspect-[2/3]'} ${frame}`}>
        <Img
          session={session}
          src={wide ? wideImageUrl(session.serverUrl, { ...movie, backdropTag: undefined }) : posterUrl(session.serverUrl, movie)}
          className="h-full w-full object-cover"
          fallback={<Placeholder name={movie.name} />}
        />
        <HoverPlay runtime={runtime} real={canPlay} />
        {movie.favorite && (
          <span className="absolute left-2 top-2 rounded-full bg-black/60 p-1 text-rose-400 backdrop-blur" title={t('Favorite')}>
            <HeartIcon filled />
          </span>
        )}
        {!movie.played && movie.unwatchedCount != null && movie.unwatchedCount > 0 && (
          <span
            className="absolute right-2 top-2 min-w-6 rounded-full bg-[var(--color-accent-strong)] px-2 py-0.5 text-center text-xs font-semibold text-[var(--color-accent-ink)] shadow-[0_0_14px_var(--glow)] transition group-focus-within/card:opacity-0 group-hover/card:opacity-0 pointer-coarse:opacity-100"
            title={movie.unwatchedCount === 1 ? t('1 episode to watch') : t('{count} episodes to watch', { count: movie.unwatchedCount })}
          >
            <Subtext text={movie.unwatchedCount} />
          </span>
        )}
        {movie.played && (
          <span
            className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-200 backdrop-blur transition group-focus-within/card:opacity-0 group-hover/card:opacity-0"
            title={t('Watched')}
          >
            <span className="text-[var(--color-accent)]" aria-hidden="true">
              <CheckIcon />
            </span>
            <Subtext text={t('Watched')} />
          </span>
        )}
        {progress > 0 && <ProgressBar percent={progress} />}
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-neutral-100 transition group-hover:text-white">{movie.name}</p>
      <Subtext as="p" className="block min-h-4 truncate text-xs text-neutral-500" text={subtext} />
    </button>
    {canPlay && (
      // Over the middle of the picture (not of the whole card, which has its title under it). The card around it opens the title.
      <div className="pointer-events-none absolute inset-x-0 top-0 flex aspect-video items-center justify-center">
        <button
          type="button"
          onClick={() => playVideo(movie, { list, queue })}
          aria-label={t('Play {title}', { title })}
          title={t('Play')}
          className={`${PLAY_BUTTON} pointer-events-auto z-20 opacity-0 transition duration-200 hover:scale-110 focus-visible:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100`}
        >
          <PlayIcon />
        </button>
      </div>
    )}
    {remember && <CardMenu session={session} movie={movie} onOpen={onOpen} onChange={remember} />}
    </div>
  )
}

/** A poster card sized for horizontal rows. */
export function RowCard(props: { session: Session; movie: Movie; onOpen: (movie: Movie) => void; list?: readonly Movie[]; queue?: PlayQueueRef }) {
  return (
    <div className={`shrink-0 snap-start ${props.movie.musicVideo ? 'w-[calc(var(--poster-w)*1.75)]' : 'w-[var(--poster-w)]'}`}>
      <MovieCard {...props} />
    </div>
  )
}

/** Wide card for "Continue watching": click resumes playback, the info button opens the movie page. */
export function ContinueCard({
  session,
  movie,
  onPlay,
  onOpen,
}: {
  session: Session
  movie: Movie
  onPlay: (movie: Movie) => void
  onOpen: (movie: Movie) => void
}) {
  const progress = progressPercent(movie)
  const left = movie.runtimeTicks ? ticksToSeconds(movie.runtimeTicks - movie.resumeTicks) : 0
  const resuming = movie.resumeTicks > 0
  // An episode card is headed by its series; the line below says which episode, and how much is left.
  const heading = isEpisode(movie) ? movie.seriesName : movie.name
  const detail = isEpisode(movie) ? [episodeCode(movie), movie.name].filter(Boolean).join(' · ') : null
  const status = resuming ? (left > 0 ? t('{time} left', { time: formatTime(left) }) : t('Resume')) : t('Up next')

  return (
    <div className="group relative w-64 shrink-0 snap-start sm:w-72 lg:w-80">
      <button
        type="button"
        onClick={() => onPlay(movie)}
        className="group block w-full text-left outline-none"
        aria-label={t(resuming ? 'Resume {title}' : 'Play {title}', { title: isEpisode(movie) ? `${movie.seriesName} ${episodeCode(movie)}` : movie.name })}
      >
        <div className={`aspect-video ${frame}`}>
          <Img
            session={session}
            src={wideImageUrl(session.serverUrl, movie)}
            className="h-full w-full object-cover"
            fallback={<Placeholder name={movie.name} />}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
          <HoverPlay />
          {progress > 0 && <ProgressBar percent={progress} />}
        </div>
        <p className="mt-2.5 truncate text-sm font-medium text-neutral-100 group-hover:text-white">{heading}</p>
        <p className="truncate text-xs text-neutral-500">
          {detail ? `${detail} · ${status}` : status}
        </p>
      </button>
      <button
        type="button"
        onClick={() => onOpen(movie)}
        className="absolute right-2 top-2 z-20 rounded-full bg-black/60 p-1.5 text-neutral-200 opacity-0 backdrop-blur transition hover:bg-black/85 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
        aria-label={t('Details for {name}', { name: movie.name })}
        title={t('Details')}
      >
        <InfoIcon />
      </button>
    </div>
  )
}

export function CardSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div aria-hidden="true">
      <div className={`skeleton w-full ${wide ? 'aspect-video' : 'aspect-[2/3]'}`} />
      <div className="skeleton mt-2.5 h-3.5 w-3/4 !rounded-md" />
      <div className="skeleton mt-1.5 h-3 w-1/4 !rounded-md" />
    </div>
  )
}
