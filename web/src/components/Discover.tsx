import { useCallback, useState, type ReactNode } from 'react'
import {
  coverUrl,
  episodeCode,
  getAlbumTracks,
  getFreshSeries,
  getRandomAlbums,
  getRandomMovieAcross,
  getRandomTracks,
  posterUrl,
  backdropImageUrl,
  type Album,
  type Episode,
  type FreshSeries,
  type Movie,
  type MovieLibrary,
  type Session,
} from '../core'
import { InfoIcon, MusicIcon, PlayIcon, RefreshIcon, ShuffleSongsIcon } from './icons'
import { Img } from './Img'
import { useMusic } from './music/MusicProvider'
import { useAsync } from './useAsync'
import { t } from '../i18n'

/**
 * "Discover": one random pick each from movies, series and music, to try something new. A pick is shown (not opened
 * blindly) so you can play it, look at it, or ask for another.
 */
export function Discover({
  session,
  movies,
  shows,
  music,
  onPlay,
  onOpenMovie,
  onOpenShow,
  onOpenAlbum,
}: {
  session: Session
  movies: MovieLibrary[]
  /** Series and anime libraries together. */
  shows: MovieLibrary[]
  music: MovieLibrary[]
  onPlay: (item: Movie | Episode) => void
  onOpenMovie: (movie: Movie) => void
  onOpenShow: (show: Movie) => void
  onOpenAlbum: (id: string) => void
}) {
  const count = [movies, shows, music].filter((l) => l.length > 0).length
  if (count === 0) return null
  return (
    <section aria-label={t('Discover')} className="space-y-3">
      <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white sm:text-xl">
        <span aria-hidden="true" className="h-5 w-1 rounded-full bg-[var(--color-accent)]" />
        {t('Discover something new')}
      </h2>
      <div className={`grid gap-4 ${count === 1 ? '' : count === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3 md:max-xl:[&>:nth-child(3)]:col-span-2'}`}>
        {movies.length > 0 && <MoviePick session={session} libraries={movies} onPlay={onPlay} onOpen={onOpenMovie} />}
        {shows.length > 0 && <SeriesPick session={session} libraries={shows} onPlay={onPlay} onOpen={onOpenShow} />}
        {music.length > 0 && <MusicPick session={session} onOpenAlbum={onOpenAlbum} />}
      </div>
    </section>
  )
}

// ---- the picks ------------------------------------------------------------------------------------------------

function MoviePick({
  session,
  libraries,
  onPlay,
  onOpen,
}: {
  session: Session
  libraries: MovieLibrary[]
  onPlay: (movie: Movie) => void
  onOpen: (movie: Movie) => void
}) {
  const load = useCallback(() => getRandomMovieAcross(session, libraries.map((l) => l.id)), [session, libraries])
  const { state, retry } = useAsync(load)
  const movie = state.status === 'ready' ? state.data : null
  return (
    <Tile
      label={t('Random movie')}
      state={state.status}
      error={state.status === 'error' ? state.message : undefined}
      empty={state.status === 'ready' && !movie ? 'There are no movies to pick from.' : undefined}
      onAnother={retry}
      image={movie ? posterUrl(session.serverUrl, movie, 240) : null}
      backdrop={movie ? backdropImageUrl(session.serverUrl, movie, 800) : null}
      session={session}
      title={movie?.name}
      meta={movie ? [movie.year, movie.played ? t('Watched') : t('Not watched yet')].filter(Boolean).join(' · ') : undefined}
      primary={
        movie && (
          <button type="button" className="btn-primary w-full" onClick={() => onPlay(movie)}>
            <PlayIcon /> {movie.resumeTicks > 0 ? t('Resume') : t('Play')}
          </button>
        )
      }
      secondary={
        movie && (
            <button type="button" className="btn-icon" aria-label={t('Details')} title={t('Details')} onClick={() => onOpen(movie)}>
              <InfoIcon />
            </button>
        )
      }
    />
  )
}

function SeriesPick({
  session,
  libraries,
  onPlay,
  onOpen,
}: {
  session: Session
  libraries: MovieLibrary[]
  onPlay: (episode: Episode) => void
  onOpen: (show: Movie) => void
}) {
  const load = useCallback(() => getFreshSeries(session, libraries.map((l) => l.id)), [session, libraries])
  const { state, retry } = useAsync(load)
  const pick: FreshSeries | null = state.status === 'ready' ? state.data : null
  return (
    <Tile
      label={t('Random series')}
      state={state.status}
      error={state.status === 'error' ? state.message : undefined}
      empty={
        state.status === 'ready' && !pick
          ? t('Nothing to start right now. Every series picked has already been started, or the library is still being scanned.')
          : undefined
      }
      onAnother={retry}
      session={session}
      image={pick ? posterUrl(session.serverUrl, pick.show, 240) : null}
      backdrop={pick ? backdropImageUrl(session.serverUrl, pick.show, 800) : null}
      title={pick?.show.name}
      meta={pick ? [pick.show.year, t('Never watched · starts at {episode}', { episode: episodeCode(pick.episode) || t('episode 1') })].filter(Boolean).join(' · ') : undefined}
      primary={
        pick && (
          <button type="button" className="btn-primary w-full" aria-label={t('Start from the beginning')} onClick={() => onPlay(pick.episode)}>
            <PlayIcon /> {t('Start')}
          </button>
        )
      }
      secondary={
        pick && (
            <button type="button" className="btn-icon" aria-label={t('Details')} title={t('Details')} onClick={() => onOpen(pick.show)}>
              <InfoIcon />
            </button>
        )
      }
    />
  )
}

function MusicPick({ session, onOpenAlbum }: { session: Session; onOpenAlbum: (id: string) => void }) {
  const music = useMusic()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => getRandomAlbums(session, undefined, 1).then((albums) => albums[0] ?? null), [session])
  const { state, retry } = useAsync(load)
  const album: Album | null = state.status === 'ready' ? state.data : null

  function run(action: () => Promise<void>) {
    setBusy(true)
    setFailed(false)
    action()
      .catch(() => setFailed(true))
      .finally(() => setBusy(false))
  }

  return (
    <Tile
      label={t('Random music')}
      state={state.status}
      error={state.status === 'error' ? state.message : undefined}
      empty={state.status === 'ready' && !album ? 'There is no music to pick from yet.' : undefined}
      onAnother={retry}
      session={session}
      square
      image={album ? coverUrl(session.serverUrl, album, 240) : null}
      title={album?.name}
      meta={album ? [album.artist, album.year].filter(Boolean).join(' · ') : undefined}
      note={failed ? t('Could not start the music. Check your connection and try again.') : undefined}
      primary={
        album && (
          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy}
            onClick={() => run(async () => music.play(await getAlbumTracks(session, album.id), 0))}
          >
            <PlayIcon /> {t('Play album')}
          </button>
        )
      }
      secondary={
        album && (
          <>
            <button type="button" className="btn-icon" aria-label={t('Details')} title={t('Details')} onClick={() => onOpenAlbum(album.id)}>
              <InfoIcon />
            </button>
            <button
              type="button"
              className="btn-icon"
              aria-label={t('Shuffle songs')}
              title={t('Shuffle songs')}
              disabled={busy}
              onClick={() => run(async () => music.play(await getRandomTracks(session, undefined), 0))}
            >
              <ShuffleSongsIcon />
            </button>
          </>
        )
      }
    />
  )
}

// ---- the card all picks share ---------------------------------------------------------------------------------------

function Tile({
  label,
  state,
  error,
  empty,
  onAnother,
  session,
  image,
  backdrop,
  square = false,
  title,
  meta,
  note,
  primary,
  secondary,
}: {
  label: string
  state: 'loading' | 'error' | 'ready'
  error?: string
  /** Shown instead of a pick when there is nothing to pick from. */
  empty?: string
  onAnother: () => void
  session: Session
  image: string | null
  backdrop?: string | null
  square?: boolean
  title?: string
  meta?: string
  note?: string
  /** The one main action (full width), and the quieter icon buttons next to "Another" below it. */
  primary?: ReactNode
  secondary?: ReactNode
}) {
  return (
    <article
      aria-label={label}
      className="relative isolate flex min-h-52 transform-gpu overflow-hidden rounded-[var(--radius-panel)] border border-white/10 bg-[var(--color-surface-2)] [-webkit-mask-image:-webkit-radial-gradient(white,black)]"
    >
      {(backdrop || image) && (
        <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
          <Img
            session={session}
            src={backdrop ?? image}
            className="h-full w-full object-cover opacity-30 blur-[2px]"
            fallback={null}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-surface-2)] via-[var(--color-surface-2)]/90 to-[var(--color-surface-2)]/40" />
        </div>
      )}
      <div className="flex w-full gap-4 p-4">
        {state === 'ready' && title ? (
          <>
            <div
              className={`w-24 shrink-0 self-start overflow-hidden rounded-lg bg-[var(--color-surface-3)] shadow-[0_10px_30px_-8px_rgba(0,0,0,0.8)] ring-1 ring-white/15 sm:w-28 ${square ? 'aspect-square' : 'aspect-[2/3]'}`}
            >
              <Img
                session={session}
                src={image}
                className="h-full w-full object-cover"
                fallback={
                  <div className="flex h-full w-full items-center justify-center text-neutral-600">
                    <MusicIcon />
                  </div>
                }
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="chip-accent self-start">{label}</p>
              <h3 className="mt-2 line-clamp-2 text-lg font-semibold leading-snug text-white">{title}</h3>
              {meta && <p className="mt-0.5 text-xs text-neutral-400">{meta}</p>}
              {/* One main action on its own row; the quiet ones below it, "Another" right after Details. */}
              <div className="mt-auto space-y-2 pt-4">
                {primary}
                <div className="flex items-center gap-2">
                  {secondary}
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={onAnother}
                    aria-label={t('Another {kind}', { kind: label.toLowerCase() })}
                    title={t('Pick another')}
                  >
                    <RefreshIcon />
                  </button>
                </div>
              </div>
              {note && (
                <p role="alert" className="mt-2 text-xs text-red-300">
                  {note}
                </p>
              )}
            </div>
          </>
        ) : state === 'loading' ? (
          <div role="status" aria-label={t('Picking {kind}', { kind: label.toLowerCase() })} className="flex w-full gap-4">
            <div className="skeleton aspect-[2/3] w-24 shrink-0 sm:w-28" />
            <div className="flex-1 space-y-3 pt-1">
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-6 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-col items-start justify-center gap-3">
            <p className="chip-accent">{label}</p>
            <p role={state === 'error' ? 'alert' : undefined} className={state === 'error' ? 'text-sm text-red-300' : 'text-sm text-neutral-400'}>
              {state === 'error' ? t('Could not pick one: {error}', { error: error ?? '' }) : empty}
            </p>
            <button type="button" className="btn" onClick={onAnother}>
              <RefreshIcon /> {t('Try again')}
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
