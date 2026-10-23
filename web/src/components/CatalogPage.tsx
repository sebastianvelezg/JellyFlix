import { StateMessage } from './StateMessage'
import { useCallback, useMemo, useState } from 'react'
import {
  FILTER_LABELS,
  getContinueEpisodes,
  getContinueWatching,
  getFeaturedPool,
  getNextUp,
  getRandomTitle,
  getRecentTitles,
  getTitleFilterOptions,
  getTitlePage,
  countActiveFilters,
  type AdvancedFilters,
  type FilterFacets,
  isEpisode,
  buildLineup,
  shuffle,
  SORT_LABELS,
  type Collection,
  type LibrarySections,
  type Movie,
  type MovieLibrary,
  type Section,
  type Session,
  type SortKey,
  type TitleKind,
  type WatchFilter,
} from '../core'
import { readBrowsePrefs, readUiPrefs, writeBrowsePrefs } from '../platform/web/prefs'
import { CollectionsRow } from './CollectionCard'
import { HeroCarousel, HeroSkeleton } from './Hero'
import { FiltersButton, FiltersPanel } from './LibraryFilters'
import { ShuffleIcon } from './icons'
import { ContinueCard, RowCard } from './MovieCard'
import { PagedGrid } from './PagedGrid'
import { Row } from './Row'
import { LazyMount } from './LazyMount'
import { LetterBar } from './LetterBar'
import { useBannerLineup } from './useBannerLineup'
import { type AsyncState } from './useAsync'
import { swrKey, useSwr, swrScope } from './useSwr'
import { t } from '../i18n'

export interface CatalogCommon {
  session: Session
  /** Titles re-read after playback or edits, keyed by id. */
  overrides: Record<string, Movie>
  /** Bumped whenever playback ends, so "Continue watching" refreshes. */
  playbackVersion: number
  /** Open a title's page (a movie page or a series page, depending on the section). */
  onOpen: (title: Movie) => void
  /** Play a movie or an episode. */
  onPlay: (item: Movie) => void
  /** Play a series: its next (or first) episode. */
  onPlayShow: (show: Movie) => void
  onOpenSeries: (seriesId: string) => void
  /** Open a collection's page. */
  onOpenCollection: (collection: Collection) => void
  /** Open the list of all collections. */
  onSeeCollections: () => void
}

/** Wording that differs between movies, series and music videos (built when needed, so it follows the language). */
function copyFor(kind: TitleKind): { all: string; noun: string; surprise: string; nothingToPick: string } {
  if (kind === 'musicvideo') {
    return {
      all: t('All music videos'),
      noun: t('music videos'),
      surprise: t('Open a random music video you have not watched yet'),
      nothingToPick: t('There are no music videos to pick from.'),
    }
  }
  if (kind === 'movie') {
    return {
      all: t('All movies'),
      noun: t('movies'),
      surprise: t('Open a random movie you have not watched yet'),
      nothingToPick: t('There are no movies to pick from.'),
    }
  }
  return {
    all: t('All series'),
    noun: t('series'),
    surprise: t('Open a random series you have not finished yet'),
    nothingToPick: t('There is nothing to pick from yet.'),
  }
}

function noLibrariesText(kind: TitleKind, section: Section): string {
  if (kind === 'movie') return t('This account has no movie libraries. Ask the server admin to give it access to one.')
  if (kind === 'musicvideo') return t('This account has no music video libraries. Add one in Jellyfin (a library of type Music videos) and it will appear here.')
  return section === 'anime'
    ? t('This account has no anime libraries. Add one in Jellyfin (a TV library with “Anime” in its name) and it will appear here.')
    : t('This account has no series libraries. Add one in Jellyfin (a TV library) and it will appear here.')
}

function emptyLibraryText(kind: TitleKind, library: string): string {
  return kind === 'movie' || kind === 'musicvideo'
    ? kind === 'movie'
      ? t('No movies in “{library}” yet.', { library })
      : t('No music videos in “{library}” yet.', { library })
    : t('Nothing in “{library}” yet. If Jellyfin is still scanning this library, titles will appear here as soon as it finds them.', { library })
}

const kindOf = (section: Section): TitleKind => (section === 'movies' ? 'movie' : section === 'musicvideos' ? 'musicvideo' : 'series')

/**
 * The home page of one section (movies, series, anime or music videos): a featured banner, rows, and the full
 * library with sort/filter controls. Its libraries come from the app (they are needed for the header too).
 */
export function CatalogPage({
  section,
  sections,
  retrySections,
  ...common
}: CatalogCommon & { section: Section; sections: AsyncState<LibrarySections>; retrySections: () => void }) {
  if (sections.status === 'loading') {
    return (
      <p role="status" className="py-24 text-center text-neutral-400">
        {t('Loading your libraries…')}
      </p>
    )
  }
  if (sections.status === 'error') {
    return (
      <StateMessage kind="error" message={t('Could not load your libraries: {message}', { message: sections.message })}>
        <button type="button" className="btn" onClick={retrySections}>
          {t('Try again')}
        </button>
      </StateMessage>
    )
  }
  const libraries = sections.data[section]
  if (libraries.length === 0) {
    return <StateMessage kind="empty" message={noLibrariesText(kindOf(section), section)} />
  }
  return <LibraryView section={section} libraries={libraries} {...common} />
}

function LibraryView({
  section,
  libraries,
  session,
  overrides,
  playbackVersion,
  onOpen,
  onPlay,
  onPlayShow,
  onOpenSeries,
  onOpenCollection,
  onSeeCollections,
}: CatalogCommon & { section: Section; libraries: MovieLibrary[] }) {
  const kind = kindOf(section)
  const copy = copyFor(kind)
  const [prefs] = useState(() => readBrowsePrefs(section))
  const [libraryId, setLibraryId] = useState(() =>
    libraries.some((l) => l.id === prefs.libraryId) ? (prefs.libraryId as string) : (libraries[0]?.id as string),
  )
  const [sort, setSort] = useState<SortKey>(prefs.sort)
  const [filter, setFilter] = useState<WatchFilter>(prefs.filter)
  const [genre, setGenre] = useState('')
  const [advanced, setAdvanced] = useState<AdvancedFilters>(() => prefs.advanced ?? {})
  const [showAdvanced, setShowAdvanced] = useState(() => countActiveFilters(prefs.advanced ?? {}) > 0)
  const advancedCount = countActiveFilters(advanced)
  // The A-Z jump: the list starts at this letter (only in title order).
  const [fromLetter, setFromLetter] = useState('')
  const [surprise, setSurprise] = useState<'idle' | 'busy' | 'none' | 'error'>('idle')

  const library = libraries.find((l) => l.id === libraryId) ?? (libraries[0] as MovieLibrary)
  // Genres, decades, ratings and tags come from one request (the server scans the whole library to answer it: 5 s on 3,800 movies).
  // They change rarely, so a copy from earlier is fine.
  const loadFilterOptions = useCallback(() => getTitleFilterOptions(session, kind, library.id), [session, kind, library.id])
  const filterOptions = useSwr(swrKey(swrScope(session), 'filter-options', kind, library.id), loadFilterOptions, { fresh: 10 * 60_000 }).state
  const genres: AsyncState<string[]> = filterOptions.status === 'ready' ? { status: 'ready', data: filterOptions.data.genres } : filterOptions
  const facets: AsyncState<FilterFacets> = filterOptions.status === 'ready' ? { status: 'ready', data: filterOptions.data.facets } : filterOptions
  const isDefault = sort === 'title' && filter === 'all' && !genre && advancedCount === 0
  const showRows = filter === 'all' && !genre && advancedCount === 0
  const changeAdvanced = (next: AdvancedFilters) => {
    setAdvanced(next)
    writeBrowsePrefs({ advanced: next }, section)
  }

  const update =
    <T,>(setter: (v: T) => void, patch: (v: T) => Parameters<typeof writeBrowsePrefs>[0]) =>
    (value: T) => {
      setter(value)
      writeBrowsePrefs(patch(value), section)
    }

  const loadPage = useCallback(
    (startIndex: number) =>
      getTitlePage(session, kind, {
        libraryId: library.id,
        startIndex,
        sort,
        filter,
        genre: genre || undefined,
        advanced,
        fromLetter: sort === 'title' ? fromLetter : undefined,
        withTotal: startIndex === 0, // the first page tells how many there are; the next ones keep that number
      }),
    [session, kind, library.id, sort, filter, genre, advanced, fromLetter],
  )

  // The newest titles feed both the banner at the top and the "Recently added" row.
  const loadRecent = useCallback(() => getRecentTitles(session, kind, library.id), [session, kind, library.id])
  const recent = useSwr(swrKey(swrScope(session), 'recent', kind, library.id), loadRecent).state
  // The banner features the newest title plus a few random recent ones. The picks are made once per load (not
  // on every render), and a title whose backdrop will not load is dropped from the lineup.
  const [failed, setFailed] = useState<{ libraryId: string; ids: string[] }>({ libraryId: library.id, ids: [] })
  const failedIds = failed.libraryId === library.id ? failed.ids : []
  const loadPool = useCallback(() => getFeaturedPool(session, kind, library.id), [session, kind, library.id])
  const pool = useSwr(swrKey(swrScope(session), 'pool', kind, library.id), loadPool).state
  // The newest titles are shown as soon as they are known, and the random picks join them if they arrive within a few
  // seconds (a slower query); then the banner is left alone. A pool that could not be read just means newest titles.
  const poolList = pool.status === 'ready' ? pool.data : []
  const banner = useBannerLineup<Movie>(
    library.id,
    { ready: recent.status === 'ready', build: () => buildLineup(recent.status === 'ready' ? recent.data : [], []) },
    { ready: recent.status === 'ready' && pool.status !== 'loading', build: () => buildLineup(recent.status === 'ready' ? recent.data : [], poolList) },
  )
  const lineup = banner.items
  const featured = lineup.filter((m) => !failedIds.includes(m.id)).map((m) => overrides[m.id] ?? m)
  const bannerPending = showRows && recent.status === 'loading'

  return (
    <div>
      {showRows && bannerPending && <HeroSkeleton />}
      {showRows && featured.length > 0 && (
        <HeroCarousel
          key={library.id}
          session={session}
          items={featured}
          rotate={readUiPrefs().autoRotateBanner}
          onPlay={kind === 'series' ? onPlayShow : onPlay}
          onOpen={onOpen}
          onBackdropFail={(title) => setFailed({ libraryId: library.id, ids: [...failedIds, title.id] })}
        />
      )}
      <div className={`space-y-9 ${showRows && (bannerPending || featured.length > 0) ? 'relative -mt-14' : 'pt-6'}`}>
        {showRows && (
          <>
            {kind !== 'series' ? (
              <ContinueRow
                kind={kind}
                session={session}
                playbackVersion={playbackVersion}
                overrides={overrides}
                onPlay={onPlay}
                onOpen={onOpen}
              />
            ) : (
              <EpisodeRows
                key={`episodes-${library.id}`}
                session={session}
                libraryId={library.id}
                playbackVersion={playbackVersion}
                overrides={overrides}
                onPlay={onPlay}
                onOpenSeries={onOpenSeries}
              />
            )}
            {recent.status === 'ready' && recent.data.length > 0 && (
              <Row title={t('Recently added')}>
                {recent.data.map((m) => (
                  <RowCard key={m.id} session={session} movie={overrides[m.id] ?? m} onOpen={onOpen} />
                ))}
              </Row>
            )}
            {kind === 'movie' && (
              <LazyMount height={300}>
                <CollectionsRow session={session} onOpen={onOpenCollection} onSeeAll={onSeeCollections} />
              </LazyMount>
            )}
            {genres.status === 'ready' && (
              <LazyMount key={`genres-${library.id}`} height={300}>
                <GenreRows
                  session={session}
                  kind={kind}
                  libraryId={library.id}
                  genres={genres.data}
                  overrides={overrides}
                  onOpen={onOpen}
                  onSeeAll={(name) => {
                    setGenre(name)
                    window.scrollTo({ top: 0 })
                  }}
                />
              </LazyMount>
            )}
            <LazyMount key={`fav-${library.id}`} height={200}>
              <FavoritesRow
                session={session}
                kind={kind}
                libraryId={library.id}
                overrides={overrides}
                onOpen={onOpen}
              />
            </LazyMount>
          </>
        )}

        <section aria-label={copy.all}>
          <div className="mb-5 flex flex-wrap items-center gap-2.5">
            <h1 className="flex w-full items-center gap-2.5 text-xl font-bold tracking-tight sm:mr-auto sm:w-auto sm:text-2xl">
              <span
                aria-hidden="true"
                className="h-6 w-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_14px_var(--glow)]"
              />
              {library.name}
            </h1>
            <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:items-center">
              {libraries.length > 1 && (
                <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <span className="sr-only">{t('Library')}</span>
                  <select
                    className="select w-full sm:w-auto"
                    value={library.id}
                    onChange={(e) => {
                      setGenre('')
                      setFromLetter('')
                      update(setLibraryId, (v: string) => ({ libraryId: v }))(e.target.value)
                    }}
                  >
                    {libraries.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                <span className="sr-only">{t('Show')}</span>
                <select
                  className="select w-full sm:w-auto"
                  aria-label={t('Show')}
                  value={filter}
                  onChange={(e) =>
                    update(setFilter, (v: WatchFilter) => ({ filter: v }))(e.target.value as WatchFilter)
                  }
                >
                  {(Object.keys(FILTER_LABELS) as WatchFilter[]).map((k) => (
                    <option key={k} value={k}>
                      {k === 'all' ? copy.all : t(FILTER_LABELS[k])}
                    </option>
                  ))}
                </select>
              </label>
              <GenreSelect state={genres} value={genre} onChange={setGenre} />
              <FiltersButton filters={advanced} open={showAdvanced} onToggle={() => setShowAdvanced((v) => !v)} />
              <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                <span className="sr-only">{t('Sort by')}</span>
                <select
                  className="select w-full sm:w-auto"
                  aria-label={t('Sort by')}
                  value={sort}
                  onChange={(e) => update(setSort, (v: SortKey) => ({ sort: v }))(e.target.value as SortKey)}
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>
                      {t(SORT_LABELS[k])}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn col-span-3 whitespace-nowrap sm:col-span-1"
                disabled={surprise === 'busy'}
                onClick={() => {
                  setSurprise('busy')
                  getRandomTitle(session, kind, library.id)
                    .then((title) => {
                      setSurprise(title ? 'idle' : 'none')
                      if (title) onOpen(title)
                    })
                    .catch(() => setSurprise('error'))
                }}
                title={copy.surprise}
              >
                <ShuffleIcon /> {t('Surprise me')}
              </button>
              {!isDefault && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setSort('title')
                    setFilter('all')
                    setGenre('')
                    setFromLetter('')
                    setAdvanced({})
                    writeBrowsePrefs({ sort: 'title', filter: 'all', advanced: {} }, section)
                  }}
                >
                  {t('Reset')}
                </button>
              )}
            </div>
          </div>

          {showAdvanced && <FiltersPanel facets={facets} filters={advanced} onChange={changeAdvanced} />}

          {(surprise === 'none' || surprise === 'error') && (
            <p role="alert" className="alert-error mb-4">
              {surprise === 'none' ? copy.nothingToPick : t('Could not pick a title. Check your connection and try again.')}
            </p>
          )}
          {sort === 'title' && <LetterBar value={fromLetter} onChange={setFromLetter} />}
          <PagedGrid
            key={`${library.id}|${sort}|${filter}|${genre}|${JSON.stringify(advanced)}|${sort === 'title' ? fromLetter : ''}`}
            session={session}
            load={loadPage}
            overrides={overrides}
            onOpen={onOpen}
            wide={kind === 'musicvideo'}
            emptyMessage={isDefault ? emptyLibraryText(kind, library.name) : t('Nothing matches these filters. Try resetting them.')}
            summary={(shown, total) => t('{shown} of {total} {noun}', { shown, total, noun: copy.noun })}
          />
        </section>
      </div>
    </div>
  )
}

function GenreSelect({
  state,
  value,
  onChange,
}: {
  state: AsyncState<string[]>
  value: string
  onChange: (genre: string) => void
}) {
  // Genres are a nicety: if the request fails (or there are none) the control is not shown. While it loads,
  // a disabled placeholder holds its place so the toolbar does not jump (this scan is slow on big libraries).
  if (state.status === 'loading') {
    return (
      <select className="select w-full sm:w-auto" aria-label={t('Genre')} disabled>
        <option>{t('Genres…')}</option>
      </select>
    )
  }
  if (state.status !== 'ready' || state.data.length === 0) return null
  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-400">
      <span className="sr-only">{t('Genre')}</span>
      <select
        className="select w-full sm:w-auto"
        aria-label={t('Genre')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('All genres')}</option>
        {state.data.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </label>
  )
}

/** How many "Top rated in ..." rows a home page shows, and the fewest titles a genre needs to get one. */
const GENRE_ROWS = 3
const MIN_IN_GENRE_ROW = 5

/** A few "Top rated in <genre>" rows; which genres are picked changes each time the page is loaded. */
function GenreRows({
  genres,
  onSeeAll,
  ...rest
}: Pick<CatalogCommon, 'session' | 'overrides' | 'onOpen'> & {
  kind: TitleKind
  libraryId: string
  genres: string[]
  onSeeAll: (genre: string) => void
}) {
  // Chosen once per list of genres, not on every render. Extra genres are loaded in case some are too small to show.
  const picked = useMemo(() => shuffle(genres).slice(0, GENRE_ROWS + 3), [genres])
  return (
    <>
      {picked.map((genre, i) => (
        <GenreRow key={genre} genre={genre} rank={i} onSeeAll={onSeeAll} {...rest} />
      ))}
    </>
  )
}

function GenreRow({
  session,
  kind,
  libraryId,
  genre,
  rank,
  overrides,
  onOpen,
  onSeeAll,
}: Pick<CatalogCommon, 'session' | 'overrides' | 'onOpen'> & {
  kind: TitleKind
  libraryId: string
  genre: string
  /** Position in the shuffled list; only the first few that have enough titles are shown. */
  rank: number
  onSeeAll: (genre: string) => void
}) {
  const load = useCallback(
    () =>
      getTitlePage(session, kind, { libraryId, startIndex: 0, limit: 16, genre, sort: 'rating', withTotal: false }).then((p) => p.movies),
    [session, kind, libraryId, genre],
  )
  const { state } = useSwr(swrKey(swrScope(session), 'genre-row', kind, libraryId, genre), load, { fresh: 5 * 60_000 })
  if (state.status !== 'ready' || state.data.length < MIN_IN_GENRE_ROW || rank >= GENRE_ROWS + 3) return null
  return (
    <Row
      title={t('Top rated in {genre}', { genre })}
      action={
        <button type="button" className="text-[var(--color-accent)] hover:underline" onClick={() => onSeeAll(genre)}>
          {t('See all')}
        </button>
      }
    >
      {state.data.map((m) => (
        <RowCard key={m.id} session={session} movie={overrides[m.id] ?? m} onOpen={onOpen} />
      ))}
    </Row>
  )
}

function ContinueRow({
  kind,
  session,
  playbackVersion,
  overrides,
  onPlay,
  onOpen,
}: Pick<CatalogCommon, 'session' | 'playbackVersion' | 'overrides' | 'onPlay' | 'onOpen'> & { kind: 'movie' | 'musicvideo' }) {
  // `playbackVersion` is part of the callback identity so the row reloads after playback ends.
  const load = useCallback(
    () => getContinueWatching(session, undefined, kind).then((rows) => ({ rows, playbackVersion })),
    [session, kind, playbackVersion],
  )
  const { state } = useSwr(swrKey(swrScope(session), kind === 'movie' ? 'continue-movies' : 'continue-musicvideos'), load, { fresh: 0 })
  if (state.status !== 'ready') return null
  const movies = state.data.rows.map((m) => overrides[m.id] ?? m).filter((m) => m.resumeTicks > 0)
  if (movies.length === 0) return null
  return (
    <Row title={t('Continue watching')}>
      {movies.map((m) => (
        <ContinueCard key={m.id} session={session} movie={m} onPlay={onPlay} onOpen={onOpen} />
      ))}
    </Row>
  )
}

/** "Continue watching" (half-watched episodes) and "Next up" (the next episode of each series you are following). */
function EpisodeRows({
  session,
  libraryId,
  playbackVersion,
  overrides,
  onPlay,
  onOpenSeries,
}: Pick<CatalogCommon, 'session' | 'playbackVersion' | 'overrides' | 'onPlay' | 'onOpenSeries'> & { libraryId: string }) {
  const load = useCallback(
    () =>
      Promise.all([getContinueEpisodes(session, { libraryId }), getNextUp(session, { libraryId })]).then(
        ([resume, next]) => ({ resume, next, playbackVersion }),
      ),
    [session, libraryId, playbackVersion],
  )
  const { state } = useSwr(swrKey(swrScope(session), 'continue-episodes', libraryId), load, { fresh: 0 })
  if (state.status !== 'ready') return null
  const resume = state.data.resume.map((e) => overrides[e.id] ?? e).filter((e) => e.resumeTicks > 0)
  // An episode you finished since this list was read is no longer "up next".
  const next = state.data.next.map((e) => overrides[e.id] ?? e).filter((e) => !e.played && e.resumeTicks === 0)
  const open = (episode: Movie) => {
    if (isEpisode(episode)) onOpenSeries(episode.seriesId)
  }
  return (
    <>
      {resume.length > 0 && (
        <Row title={t('Continue watching')}>
          {resume.map((e) => (
            <ContinueCard key={e.id} session={session} movie={e} onPlay={onPlay} onOpen={open} />
          ))}
        </Row>
      )}
      {next.length > 0 && (
        <Row title={t('Next up')}>
          {next.map((e) => (
            <ContinueCard key={e.id} session={session} movie={e} onPlay={onPlay} onOpen={open} />
          ))}
        </Row>
      )}
    </>
  )
}

function FavoritesRow({
  session,
  kind,
  libraryId,
  overrides,
  onOpen,
}: Pick<CatalogCommon, 'session' | 'overrides' | 'onOpen'> & { kind: TitleKind; libraryId: string }) {
  const load = useCallback(
    () =>
      getTitlePage(session, kind, { libraryId, startIndex: 0, limit: 20, filter: 'favorites', sort: 'added', withTotal: false }).then(
        (p) => p.movies,
      ),
    [session, kind, libraryId],
  )
  const { state } = useSwr(swrKey(swrScope(session), 'favorites-row', kind, libraryId), load, { fresh: 0 })
  if (state.status !== 'ready') return null
  // Favorites toggled on a title page show up here (and removed ones disappear) without reloading.
  const known = new Set(state.data.map((m) => m.id))
  const wantedKind = (m: Movie) => !isEpisode(m) && !!m.isSeries === (kind === 'series') && !!m.musicVideo === (kind === 'musicvideo')
  const added = Object.values(overrides).filter((m) => m.favorite && !known.has(m.id) && wantedKind(m))
  const movies = [...added, ...state.data.map((m) => overrides[m.id] ?? m)].filter((m) => m.favorite)
  if (movies.length === 0) return null
  return (
    <Row title={t('Your favorites')}>
      {movies.map((m) => (
        <RowCard key={m.id} session={session} movie={m} onOpen={onOpen} />
      ))}
    </Row>
  )
}
