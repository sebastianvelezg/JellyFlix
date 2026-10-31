import { StateMessage } from './StateMessage'
import { useCallback, useEffect, useState } from 'react'
import {
  backdropImageUrl,
  defaultVersion,
  formatRuntime,
  formatTime,
  getMovieDetails,
  getSimilarMovies,
  posterUrl,
  setPlayChoice,
  ticksToSeconds,
  type Movie,
  type MovieDetails,
  type Person,
  type PlayChoice,
  type Session,
} from '../core'
import { EditButton } from './admin/EditButton'
import { useReloadOnEdit } from './admin/editorEvents'
import { PlayOnButton } from './remote/PlayOnButton'
import { CheckIcon, HeartIcon, PlayIcon, RestartIcon, StarIcon } from './icons'
import { RowCard } from './MovieCard'
import { Row } from './Row'
import { CastCard, DetailsSkeleton, Facts, PlayOptions, TitleHero, type PlayPick } from './TitleParts'
import { readVersionPref, writeVersionPref } from '../platform/web/prefs'
import { detailsKey, swrKey, swrScope, useSwr } from './useSwr'
import { useToggles } from './useToggles'
import { t } from '../i18n'

export function DetailsPage({
  session,
  id,
  onPlay,
  onOpen,
  onPerson,
  onBack,
  onChanged,
}: {
  session: Session
  id: string
  onPlay: (movie: Movie, startOver: boolean) => void
  onOpen: (movie: Movie) => void
  /** A cast member was chosen: show their other movies. */
  onPerson: (person: Person) => void
  onBack: () => void
  /** Called after watched/favorite changes so lists elsewhere update. */
  onChanged: (movie: Movie) => void
}) {
  const load = useCallback(() => getMovieDetails(session, id), [session, id])
  // Shown at once from a copy if the card was hovered or the page was seen before; always read again behind it, because
  // the resume position and watched state change as you watch.
  const { state, retry, update } = useSwr(detailsKey(session, id), load, { fresh: 0 })
  // An administrator changed this title in the editor: read it again.
  useReloadOnEdit(retry)

  if (state.status === 'loading') return <DetailsSkeleton onBack={onBack} />

  if (state.status === 'error') {
    return (
      <StateMessage kind="error" message={t('Could not load this movie: {message}', { message: state.message })}>
        <button type="button" className="btn" onClick={retry}>
          {t('Try again')}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          {t('Back')}
        </button>
      </StateMessage>
    )
  }

  return (
    <DetailsContent
      session={session}
      movie={state.data}
      onPlay={onPlay}
      onOpen={onOpen}
      onPerson={onPerson}
      onBack={onBack}
      onChange={(next) => {
        update(() => next)
        onChanged(next)
      }}
    />
  )
}

function DetailsContent({
  session,
  movie,
  onPlay,
  onOpen,
  onPerson,
  onBack,
  onChange,
}: {
  session: Session
  movie: MovieDetails
  onPlay: (movie: Movie, startOver: boolean) => void
  onOpen: (movie: Movie) => void
  onPerson: (person: Person) => void
  onBack: () => void
  onChange: (movie: MovieDetails) => void
}) {
  const { toggle, actionError } = useToggles(session, movie, onChange)

  // What the viewer picked under the Play button (the version of the file, the audio, the subtitle).
  const [pick, setPick] = useState<PlayPick>(() => ({
    versionId: defaultVersion(
      movie.versions.map((v) => ({ id: v.id, resolution: v.media.resolution })),
      readVersionPref(),
    ),
    audio: 'auto',
    subtitle: 'auto',
  }))
  const choose = (next: PlayPick) => {
    setPick(next)
    if (next.versionId !== pick.versionId) writeVersionPref(movie.versions.find((v) => v.id === next.versionId)?.media.resolution ?? null)
  }
  const play = (startOver: boolean) => {
    const choice: PlayChoice = {}
    if (movie.versions.length > 1 && pick.versionId) choice.mediaSourceId = pick.versionId
    if (pick.audio !== 'auto') choice.audioIndex = pick.audio
    if (pick.subtitle !== 'auto') choice.subtitleIndex = pick.subtitle
    if (Object.keys(choice).length > 0) setPlayChoice(movie.id, choice)
    onPlay(movie, startOver)
  }

  useEffect(() => {
    const previous = document.title
    document.title = `${movie.name} · Jellyflix`
    return () => {
      document.title = previous
    }
  }, [movie.name])

  const resumeSeconds = ticksToSeconds(movie.resumeTicks)
  const runtime = formatRuntime(ticksToSeconds(movie.runtimeTicks))
  // A music video's picture is wide: it fills the back of the page and there is no poster.
  const backdrop = backdropImageUrl(session.serverUrl, movie) ?? (movie.musicVideo ? posterUrl(session.serverUrl, movie, 1600) : null)

  const similar = useCallback(() => getSimilarMovies(session, movie.id), [session, movie.id])
  const similarState = useSwr(swrKey(swrScope(session), 'similar-movies', movie.id), similar, { fresh: 10 * 60_000 }).state

  return (
    <article className="pb-16" aria-label={movie.name}>
      <TitleHero
        session={session}
        backdrop={backdrop}
        poster={posterUrl(session.serverUrl, movie, 450)}
        name={movie.name}
        onBack={onBack}
        noPoster={movie.musicVideo}
      >
          <h1 className="rise text-balance text-4xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.8)] sm:text-6xl">
            {movie.name}
          </h1>
          {movie.artist && <p className="rise rise-2 mt-2 text-lg font-medium text-neutral-200">{movie.artist}</p>}
          {movie.tagline && <p className="rise rise-2 mt-2 text-base italic text-neutral-300">{movie.tagline}</p>}

          <div className="rise rise-2 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-200">
            {movie.communityRating != null && (
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent)]" title={t('Community rating')}>
                <StarIcon /> {movie.communityRating.toFixed(1)}
              </span>
            )}
            {movie.year && <span>{movie.year}</span>}
            {movie.officialRating && <span className="chip">{movie.officialRating}</span>}
            {runtime && <span>{runtime}</span>}
            {movie.media?.resolution && <span className="chip-accent">{movie.media.resolution}</span>}
            {movie.played && <span className="chip">{t('Watched')}</span>}
          </div>

          {movie.genres.length > 0 && (
            <ul className="rise rise-3 mt-3 flex flex-wrap gap-1.5" aria-label={t('Genres')}>
              {movie.genres.map((g) => (
                <li key={g} className="chip">
                  {g}
                </li>
              ))}
            </ul>
          )}

          <div className="rise rise-3 relative z-20 mt-6 flex flex-wrap items-center gap-2.5">
            <button type="button" className="btn-primary px-6 py-3 text-base" onClick={() => play(false)}>
              <PlayIcon />
              {resumeSeconds > 0 ? t('Resume from {time}', { time: formatTime(resumeSeconds) }) : t('Play')}
            </button>
            {resumeSeconds > 0 && (
              <button type="button" className="btn py-3" onClick={() => play(true)}>
                <RestartIcon /> {t('Start over')}
              </button>
            )}
            <PlayOnButton itemId={movie.id} />
            <button
              type="button"
              className={`btn py-3 ${movie.played ? 'border-[var(--color-accent)]/50 text-[var(--color-accent)]' : ''}`}
              aria-pressed={movie.played}
              onClick={() => void toggle('watched')}
              title={movie.played ? t('Mark as unwatched') : t('Mark as watched')}
            >
              <CheckIcon /> {movie.played ? t('Watched') : t('Mark watched')}
            </button>
            <button
              type="button"
              className={`btn py-3 ${movie.favorite ? 'border-rose-400/40 text-rose-400' : ''}`}
              aria-pressed={movie.favorite}
              onClick={() => void toggle('favorite')}
              title={movie.favorite ? t('Remove from favorites') : t('Add to favorites')}
            >
              <HeartIcon filled={movie.favorite} /> {movie.favorite ? t('Favorite') : t('Add to favorites')}
            </button>
            <EditButton session={session} target={{ id: movie.id, name: movie.name, type: 'Movie' }} />
          </div>
          <PlayOptions movie={movie} pick={pick} onChange={choose} />
          {actionError && (
            <p role="alert" className="alert-error mt-3 max-w-xl">
              {actionError}
            </p>
          )}

          {movie.overview ? (
            <p className="rise rise-4 mt-6 max-w-2xl text-pretty text-base leading-relaxed text-neutral-300">{movie.overview}</p>
          ) : (
            <p className="mt-6 text-sm text-neutral-500">{t('No description available.')}</p>
          )}
      </TitleHero>

      <Facts movie={movie} />

      {movie.cast.length > 0 && (
        <div className="mt-10">
          <Row title={t('Cast')}>
            {movie.cast.map((p) => (
              <CastCard key={p.id} session={session} person={p} onSelect={onPerson} />
            ))}
          </Row>
        </div>
      )}

      {similarState.status === 'ready' && similarState.data.length > 0 && (
        <div className="mt-10">
          <Row title={t('More like this')}>
            {similarState.data.map((m) => (
              <RowCard key={m.id} session={session} movie={m} onOpen={onOpen} list={similarState.data} />
            ))}
          </Row>
        </div>
      )}
    </article>
  )
}
