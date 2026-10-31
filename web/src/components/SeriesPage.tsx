import { StateMessage } from './StateMessage'
import { EditButton } from './admin/EditButton'
import { useReloadOnEdit } from './admin/editorEvents'
import { PlayOnButton } from './remote/PlayOnButton'
import { useCallback, useEffect, useState } from 'react'
import {
  backdropImageUrl,
  episodeCode,
  formatRuntime,
  formatTime,
  getEpisodes,
  getScanStatus,
  getSeasons,
  getSeriesPlayTarget,
  getShowDetails,
  getSimilarShows,
  posterUrl,
  scanSeason,
  setWatched,
  ticksToSeconds,
  wideImageUrl,
  type Episode,
  type Movie,
  type MovieDetails,
  type Person,
  type Season,
  type Session,
} from '../core'
import { CheckIcon, HeartIcon, PlayIcon, StarIcon } from './icons'
import { Img } from './Img'
import { useIntroSkipper } from './useIntroSkipper'
import { RowCard } from './MovieCard'
import { Row } from './Row'
import { CastCard, DetailsSkeleton, Facts, TitleHero } from './TitleParts'
import { useAsync } from './useAsync'
import { detailsKey, swrKey, swrScope, useSwr } from './useSwr'
import { useToggles } from './useToggles'
import { t } from '../i18n'

export function SeriesPage({
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
  onPlay: (episode: Episode) => void
  onOpen: (show: Movie) => void
  onPerson: (person: Person) => void
  onBack: () => void
  /** Called after watched/favorite changes so lists elsewhere update. */
  onChanged: (show: Movie) => void
}) {
  const load = useCallback(() => getShowDetails(session, id), [session, id])
  const { state, retry, update } = useSwr(detailsKey(session, id), load, { fresh: 0 })
  // An administrator changed this series in the editor: read it again.
  useReloadOnEdit(retry)

  if (state.status === 'loading') return <DetailsSkeleton onBack={onBack} />
  if (state.status === 'error') {
    return (
      <StateMessage kind="error" message={t('Could not load this series: {message}', { message: state.message })}>
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
    <SeriesContent
      session={session}
      show={state.data}
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

function SeriesContent({
  session,
  show,
  onPlay,
  onOpen,
  onPerson,
  onBack,
  onChange,
}: {
  session: Session
  show: MovieDetails
  onPlay: (episode: Episode) => void
  onOpen: (show: Movie) => void
  onPerson: (person: Person) => void
  onBack: () => void
  onChange: (show: MovieDetails) => void
}) {
  const { toggle, actionError } = useToggles(session, show, onChange)
  // Bumped when watched states change in bulk, so seasons, episodes and the play button are re-read.
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  useEffect(() => {
    const previous = document.title
    document.title = `${show.name} · Jellyflix`
    return () => {
      document.title = previous
    }
  }, [show.name])

  const loadTarget = useCallback(() => getSeriesPlayTarget(session, show.id).then((t) => ({ t, version })), [session, show.id, version])
  const target = useAsync(loadTarget).state
  const loadSimilar = useCallback(() => getSimilarShows(session, show.id), [session, show.id])
  const similar = useSwr(swrKey(swrScope(session), 'similar-shows', show.id), loadSimilar, { fresh: 10 * 60_000 }).state

  const next = target.status === 'ready' ? target.data.t : undefined
  const runtime = formatRuntime(ticksToSeconds(show.runtimeTicks))

  return (
    <article className="pb-16" aria-label={show.name}>
      <TitleHero
        session={session}
        backdrop={backdropImageUrl(session.serverUrl, show)}
        poster={posterUrl(session.serverUrl, show, 450)}
        name={show.name}
        onBack={onBack}
      >
        <h1 className="rise text-balance text-4xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.8)] sm:text-6xl">
          {show.name}
        </h1>
        {show.tagline && <p className="rise rise-2 mt-2 text-base italic text-neutral-300">{show.tagline}</p>}

        <div className="rise rise-2 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-200">
          {show.communityRating != null && (
            <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent)]" title={t('Community rating')}>
              <StarIcon /> {show.communityRating.toFixed(1)}
            </span>
          )}
          {show.year && <span>{show.year}</span>}
          {show.officialRating && <span className="chip">{show.officialRating}</span>}
          {show.seasonCount != null && (
            <span>
              {show.seasonCount} {show.seasonCount === 1 ? t('season') : t('seasons')}
            </span>
          )}
          {runtime && <span>{t('{runtime} per episode', { runtime })}</span>}
          {show.status && <span className="chip-accent">{show.status}</span>}
          {show.played && <span className="chip">{t('Watched')}</span>}
        </div>

        {show.genres.length > 0 && (
          <ul className="rise rise-3 mt-3 flex flex-wrap gap-1.5" aria-label={t('Genres')}>
            {show.genres.map((g) => (
              <li key={g} className="chip">
                {g}
              </li>
            ))}
          </ul>
        )}

        <div className="rise rise-3 relative z-20 mt-6 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className="btn-primary px-6 py-3 text-base"
            disabled={!next}
            onClick={() => next && onPlay(next)}
          >
            <PlayIcon />
            {target.status === 'loading' ? t('Play') : next ? t(next.resumeTicks > 0 ? 'Resume {code}' : 'Play {code}', { code: episodeCode(next) }).trim() : t('No episodes yet')}
          </button>
          {next && <PlayOnButton itemId={next.id} />}
          <button
            type="button"
            className={`btn py-3 ${show.played ? 'border-[var(--color-accent)]/50 text-[var(--color-accent)]' : ''}`}
            aria-pressed={show.played}
            onClick={() => void toggle('watched').then(bump)}
            title={show.played ? t('Mark the whole series as unwatched') : t('Mark the whole series as watched')}
          >
            <CheckIcon /> {show.played ? t('Watched') : t('Mark watched')}
          </button>
          <button
            type="button"
            className={`btn py-3 ${show.favorite ? 'border-rose-400/40 text-rose-400' : ''}`}
            aria-pressed={show.favorite}
            onClick={() => void toggle('favorite')}
            title={show.favorite ? t('Remove from favorites') : t('Add to favorites')}
          >
            <HeartIcon filled={show.favorite} /> {show.favorite ? t('Favorite') : t('Add to favorites')}
          </button>
          <EditButton session={session} target={{ id: show.id, name: show.name, type: 'Series' }} />
        </div>
        {actionError && (
          <p role="alert" className="alert-error mt-3 max-w-xl">
            {actionError}
          </p>
        )}

        {show.overview ? (
          <p className="rise rise-4 mt-6 max-w-2xl text-pretty text-base leading-relaxed text-neutral-300">{show.overview}</p>
        ) : (
          <p className="mt-6 text-sm text-neutral-500">{t('No description available.')}</p>
        )}
      </TitleHero>

      <Episodes
        session={session}
        version={version}
        seriesId={show.id}
        startSeasonId={next?.seasonId}
        onPlay={onPlay}
        onChanged={bump}
      />

      <div className="mt-10">
        <Facts movie={show} />
      </div>

      {show.cast.length > 0 && (
        <div className="mt-10">
          <Row title={t('Cast')}>
            {show.cast.map((p) => (
              <CastCard key={p.id} session={session} person={p} onSelect={onPerson} />
            ))}
          </Row>
        </div>
      )}

      {similar.status === 'ready' && similar.data.length > 0 && (
        <div className="mt-10">
          <Row title={t('More like this')}>
            {similar.data.map((m) => (
              <RowCard key={m.id} session={session} movie={m} onOpen={onOpen} />
            ))}
          </Row>
        </div>
      )}
    </article>
  )
}

// ---- seasons and episodes -----------------------------------------------------------------------

function Episodes({
  session,
  seriesId,
  version,
  startSeasonId,
  onPlay,
  onChanged,
}: {
  session: Session
  seriesId: string
  /** Changes when watched states changed in bulk: everything is read again. */
  version: number
  /** The season of the episode the Play button would start; shown first. */
  startSeasonId?: string
  onPlay: (episode: Episode) => void
  /** Watched states changed in bulk (a whole season). */
  onChanged: () => void
}) {
  // `version` is part of the callback identity so the seasons are read again after bulk changes.
  const loadSeasons = useCallback(
    () => getSeasons(session, seriesId).then((list) => ({ list, version })),
    [session, seriesId, version],
  )
  const seasonsLoad = useAsync(loadSeasons)
  const seasons = seasonsLoad.state
  useReloadOnEdit(seasonsLoad.retry)
  const [chosen, setChosen] = useState<string | null>(null)

  if (seasons.status === 'loading') {
    return (
      <section aria-label={t('Episodes')} className="mt-8" role="status">
        <div className="skeleton h-8 w-48" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24 w-full" />
          ))}
        </div>
      </section>
    )
  }
  if (seasons.status === 'error') {
    return (
      <p role="alert" className="alert-error mt-8">
        {t('Could not load the seasons: {message}', { message: seasons.message })}
      </p>
    )
  }
  if (seasons.data.list.length === 0) {
    return (
      <p className="mt-8 text-sm text-neutral-400">
        {t('No episodes yet. If Jellyfin is still scanning this library, they will appear here once it finds them.')}
      </p>
    )
  }

  const list = seasons.data.list
  const season =
    list.find((s) => s.id === chosen) ??
    list.find((s) => s.id === startSeasonId) ??
    list.find((s) => s.number !== 0) ??
    (list[0] as Season)

  return (
    <section aria-label={t('Episodes')} className="mt-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-3 flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white sm:text-xl">
          <span aria-hidden="true" className="h-5 w-1 rounded-full bg-[var(--color-accent)]" />
          {t('Episodes')}
        </h2>
        {list.length > 1 && (
          <div role="tablist" aria-label={t('Seasons')} className="no-scrollbar flex min-w-0 max-w-full gap-1.5 overflow-x-auto">
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === season.id}
                onClick={() => setChosen(s.id)}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition pointer-coarse:py-3 ${
                  s.id === season.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white'
                    : 'border-white/10 bg-white/[.04] text-neutral-300 hover:border-white/25 hover:text-white'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <EditButton session={session} target={{ id: season.id, name: season.name, type: 'Season' }} className="btn" />
          <SeasonIntrosButton key={season.id} session={session} seriesId={seriesId} season={season} />
          <SeasonWatchedButton session={session} season={season} onChanged={onChanged} />
        </div>
      </div>
      <EpisodeList key={`${season.id}-${version}`} session={session} seriesId={seriesId} season={season} onPlay={onPlay} />
    </section>
  )
}

/** "Find intros": asks the server's Intro Skipper plugin to look for the intro and credits of this season (administrators, where the plugin is installed). */
function SeasonIntrosButton({ session, seriesId, season }: { session: Session; seriesId: string; season: Season }) {
  const available = useIntroSkipper(session)
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle')
  useEffect(() => {
    if (state !== 'working') return
    let alive = true
    // Asked again every few seconds until the server says it is finished with the season.
    const timer = window.setInterval(() => {
      getScanStatus(session, season.id)
        .then((s) => {
          if (alive && !s.running && !s.queued) setState(s.failed ? 'failed' : 'done')
        })
        .catch(() => alive && setState('failed'))
    }, 5000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [state, session, season.id])
  if (!available) return null
  return (
    <button
      type="button"
      className="btn-ghost"
      disabled={state === 'working'}
      title={t('Asks Intro Skipper on your server to look for the intro and credits of this season.')}
      onClick={() => {
        setState('working')
        scanSeason(session, seriesId, season.id).catch(() => setState('failed'))
      }}
    >
      {state === 'working' ? t('Looking for intros…') : state === 'done' ? t('Search finished. Look again') : state === 'failed' ? t('Could not look for intros. Try again') : t('Find intros')}
    </button>
  )
}

function SeasonWatchedButton({ session, season, onChanged }: { session: Session; season: Season; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const allWatched = season.unwatchedCount === 0
  return (
    <>
      <button
        type="button"
        className="btn-ghost"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setFailed(false)
          setWatched(session, season.id, !allWatched)
            .then(onChanged)
            .catch(() => setFailed(true))
            .finally(() => setBusy(false))
        }}
      >
        <CheckIcon /> {allWatched ? t('Mark season unwatched') : t('Mark season watched')}
      </button>
      {failed && (
        <p role="alert" className="alert-error w-full">
          {t('Could not update the season. Check your connection and try again.')}
        </p>
      )}
    </>
  )
}

function EpisodeList({
  session,
  seriesId,
  season,
  onPlay,
}: {
  session: Session
  seriesId: string
  season: Season
  onPlay: (episode: Episode) => void
}) {
  const load = useCallback(() => getEpisodes(session, seriesId, { seasonId: season.id }), [session, seriesId, season.id])
  const { state, retry, update } = useAsync(load)
  useReloadOnEdit(retry)

  if (state.status === 'loading') {
    return (
      <div role="status" aria-label={t('Loading episodes')} className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 w-full" />
        ))}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="py-8 text-center">
        <p className="mb-3 text-red-300">{t('Could not load the episodes: {message}', { message: state.message })}</p>
        <button type="button" className="btn" onClick={retry}>
          {t('Try again')}
        </button>
      </div>
    )
  }
  if (state.data.length === 0) return <p className="text-sm text-neutral-400">{t('This season has no episodes yet.')}</p>

  return (
    <ul className="space-y-2">
      {state.data.map((episode) => (
        <li key={episode.id}>
          <EpisodeRow
            session={session}
            episode={episode}
            onPlay={onPlay}
            onChange={(next) => update((list) => list.map((e) => (e.id === next.id ? next : e)))}
          />
        </li>
      ))}
    </ul>
  )
}

export function EpisodeRow({
  session,
  episode,
  onPlay,
  onChange,
}: {
  session: Session
  episode: Episode
  onPlay: (episode: Episode) => void
  onChange: (episode: Episode) => void
}) {
  const [error, setError] = useState(false)
  const progress =
    episode.resumeTicks > 0 && episode.runtimeTicks ? Math.min(100, (episode.resumeTicks / episode.runtimeTicks) * 100) : 0
  const runtime = formatRuntime(ticksToSeconds(episode.runtimeTicks ?? 0))
  const code = episodeCode(episode)
  const label = `${code} ${episode.name}`.trim()

  function toggleWatched() {
    const target = !episode.played
    setError(false)
    onChange({ ...episode, played: target, resumeTicks: target ? 0 : episode.resumeTicks })
    setWatched(session, episode.id, target)
      .then((state) => onChange({ ...episode, played: state.played, resumeTicks: state.resumeTicks }))
      .catch(() => {
        onChange(episode)
        setError(true)
      })
  }

  return (
    <div className="group flex gap-3 rounded-2xl border border-transparent p-2 transition hover:border-white/10 hover:bg-white/[.04] sm:gap-4">
      <button
        type="button"
        onClick={() => onPlay(episode)}
        aria-label={t(episode.resumeTicks > 0 ? 'Resume {label}' : 'Play {label}', { label })}
        className="group/still relative aspect-video w-36 shrink-0 overflow-hidden rounded-xl bg-[var(--color-surface-2)] ring-1 ring-white/10 outline-none transition hover:ring-[var(--color-accent)]/70 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] sm:w-52"
      >
        <Img
          session={session}
          src={wideImageUrl(session.serverUrl, episode, 480)}
          className="h-full w-full object-cover"
          fallback={
            <div className="flex h-full items-center justify-center text-lg font-semibold text-neutral-500">{episode.episodeNumber ?? ''}</div>
          }
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover/still:bg-black/40 group-hover/still:opacity-100 group-focus-visible/still:opacity-100">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white pl-0.5 text-black shadow-[0_6px_20px_-4px_rgba(0,0,0,0.6)]">
            <PlayIcon />
          </span>
        </span>
        {progress > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/70" role="presentation">
            <span className="block h-full rounded-r-full bg-[var(--color-accent)]" style={{ width: `${progress}%` }} />
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1 py-0.5">
        <p className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tabular-nums text-[var(--color-accent)]">
            {episode.episodeNumber != null ? `E${episode.episodeNumber}` : ''}
          </span>
          <span className="truncate font-medium text-white">{episode.name}</span>
          {runtime && <span className="ml-auto shrink-0 text-xs text-neutral-500">{runtime}</span>}
        </p>
        {episode.overview && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-neutral-400">{episode.overview}</p>}
        {progress > 0 && episode.runtimeTicks && (
          <p className="mt-1 text-xs text-neutral-500">
            {t('{time} left', { time: formatTime(ticksToSeconds(episode.runtimeTicks - episode.resumeTicks)) })}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-300">
            {t('Could not update this episode.')}
          </p>
        )}
      </div>

      {/* The less used buttons appear when the row is pointed at (always on a touchscreen). */}
      <span className="flex shrink-0 items-start gap-1 self-start transition-opacity duration-150 lg:opacity-0 lg:focus-within:opacity-100 lg:group-hover:opacity-100 pointer-coarse:opacity-100">
        <PlayOnButton itemId={episode.id} compact />
        <EditButton session={session} target={{ id: episode.id, name: label, type: 'Episode' }} compact />
      </span>
      <button
        type="button"
        onClick={toggleWatched}
        aria-pressed={episode.played}
        aria-label={t(episode.played ? 'Mark as unwatched: {label}' : 'Mark as watched: {label}', { label })}
        title={episode.played ? t('Watched (click to mark as unwatched)') : t('Mark as watched')}
        className={`mt-1 h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 shrink-0 self-start rounded-full border transition ${
          episode.played
            ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
            : 'border-white/10 text-neutral-500 hover:border-white/30 hover:text-white'
        }`}
      >
        <span className="flex items-center justify-center">
          <CheckIcon />
        </span>
      </button>
    </div>
  )
}
