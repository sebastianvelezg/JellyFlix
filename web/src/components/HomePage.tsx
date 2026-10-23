import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  buildHomeLineup,
  getBecauseYouWatched,
  getContinueAll,
  getHomePool,
  getLatestTitles,
  getNextUp,
  getRecentAlbums,
  getRecentlyPlayedTracks,
  albumsOfTracks,
  interleave,
  isEpisode,
  visibleRows,
  type Collection,
  type Episode,
  type HomeRowId,
  type LibrarySections,
  type Movie,
  type Section,
  type Session,
} from '../core'
import { useAppearance } from '../platform/web/appearance'
import { readUiPrefs } from '../platform/web/prefs'
import { CollectionsRow } from './CollectionCard'
import { Discover } from './Discover'
import { HeroCarousel, HeroSkeleton } from './Hero'
import { ContinueCard, RowCard } from './MovieCard'
import { AlbumCard, RowItem } from './music/parts'
import { Row } from './Row'
import { LazyMount } from './LazyMount'
import { NewSinceVisitRow, UpcomingRow } from './NewRows'
import { PlaylistsRow, WatchLaterRow } from './ListsRows'
import { useBannerLineup } from './useBannerLineup'
import { type AsyncState } from './useAsync'
import { swrKey, useSwr, swrScope } from './useSwr'
import { t } from '../i18n'

/** Reads from the given libraries, or nothing at all when the account has none of that kind. */
function read<T>(libraries: { id: string }[], load: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  return libraries.length > 0 ? load(libraries.map((l) => l.id)) : Promise.resolve([])
}

/** What a loaded list holds; a list that is still loading or failed counts as empty. */
function listOf<T>(state: AsyncState<T[]>): T[] {
  return state.status === 'ready' ? state.data : []
}

export interface HomeActions {
  onPlay: (item: Movie | Episode) => void
  onPlayShow: (show: Movie) => void
  onOpenMovie: (movie: Movie) => void
  onOpenBook: (book: Movie) => void
  onOpenShow: (show: Movie) => void
  onOpenSeries: (seriesId: string) => void
  onOpenAlbum: (id: string) => void
  onOpenArtist: (id: string) => void
  onOpenCollection: (collection: Collection) => void
  onSeeCollections: () => void
  onOpenList: (id: string) => void
  onSeeLists: () => void
  onSection: (section: Section) => void
}

/**
 * The main page: a banner mixing movies and series, what you were watching, a random pick of something new, and the
 * latest from every library. Rows for a kind of library the account does not have are left out.
 */
export function HomePage({
  session,
  sections,
  overrides,
  playbackVersion,
  ...actions
}: {
  session: Session
  sections: LibrarySections
  overrides: Record<string, Movie>
  /** Bumped whenever playback ends, so "Continue watching" refreshes. */
  playbackVersion: number
} & HomeActions) {
  const movieLibraries = sections.movies
  const seriesLibraries = sections.series
  const animeLibraries = sections.anime
  const musicVideoLibraries = sections.musicvideos
  const bookLibraries = sections.books
  const showLibraries = useMemo(() => [...seriesLibraries, ...animeLibraries], [seriesLibraries, animeLibraries])
  const hasVideo = movieLibraries.length + showLibraries.length > 0
  // Which rows, in what order: chosen in Settings → Appearance. (This page stays open behind Settings, so it follows changes made there.)
  const { home: layout } = useAppearance()

  // The lists come from a remembered copy when there is one (so a reload draws at once) and are refreshed behind it.
  const keyOf = (name: string, libraries: { id: string }[]) => swrKey(swrScope(session), 'home', name, libraries.map((l) => l.id).join(','))
  const recentMovies = useSwr(
    keyOf('recent-movie', movieLibraries),
    useCallback(() => read(movieLibraries, (ids) => getLatestTitles(session, 'movie', ids)), [session, movieLibraries]),
  ).state
  const recentSeries = useSwr(
    keyOf('recent-series', seriesLibraries),
    useCallback(() => read(seriesLibraries, (ids) => getLatestTitles(session, 'series', ids)), [session, seriesLibraries]),
  ).state
  const recentAnime = useSwr(
    keyOf('recent-anime', animeLibraries),
    useCallback(() => read(animeLibraries, (ids) => getLatestTitles(session, 'series', ids)), [session, animeLibraries]),
  ).state
  const recentMusicVideos = useSwr(
    keyOf('recent-musicvideo', musicVideoLibraries),
    useCallback(() => read(musicVideoLibraries, (ids) => getLatestTitles(session, 'musicvideo', ids)), [session, musicVideoLibraries]),
  ).state
  const recentBooks = useSwr(
    keyOf('recent-book', bookLibraries),
    useCallback(() => read(bookLibraries, (ids) => getLatestTitles(session, 'book', ids)), [session, bookLibraries]),
  ).state
  const poolMovies = useSwr(
    keyOf('pool-movie', movieLibraries),
    useCallback(() => read(movieLibraries, (ids) => getHomePool(session, 'movie', ids)), [session, movieLibraries]),
  ).state
  const poolShows = useSwr(
    keyOf('pool-series', showLibraries),
    useCallback(() => read(showLibraries, (ids) => getHomePool(session, 'series', ids)), [session, showLibraries]),
  ).state

  // The banner shows the newest titles as soon as they are known, and the random picks join it if they arrive within a
  // few seconds (they are a slower query). Picked from whatever is first at hand, a remembered copy counts, and then
  // left alone, so the banner never changes under your eyes. A list that could not be read leaves its kind out.
  const recentReady = [recentMovies, recentSeries, recentAnime].every((s) => s.status !== 'loading')
  const poolsReady = [poolMovies, poolShows].every((s) => s.status !== 'loading')
  const bannerPending = layout.banner && !recentReady
  const recents = { recent: listOf(recentMovies) }
  const buildLineup = (withPools: boolean) =>
    buildHomeLineup(
      { recent: recents.recent, pool: withPools ? listOf(poolMovies) : [] },
      { recent: interleave([listOf(recentSeries), listOf(recentAnime)]), pool: withPools ? listOf(poolShows) : [] },
    )
  const banner = useBannerLineup<Movie>(
    'home',
    { ready: recentReady, build: () => buildLineup(false) },
    { ready: recentReady && poolsReady, build: () => buildLineup(true) },
  )
  const lineup = banner.items

  // A title whose backdrop will not load is dropped from the banner.
  const [failedIds, setFailedIds] = useState<string[]>([])
  const featured = lineup.filter((m) => !failedIds.includes(m.id)).map((m) => overrides[m.id] ?? m)

  const { onPlay, onPlayShow, onOpenMovie, onOpenShow, onOpenSeries } = actions
  const openAny = (title: Movie) => (isEpisode(title) ? onOpenSeries(title.seriesId) : title.isSeries ? onOpenShow(title) : onOpenMovie(title))

  if (sections.movies.length + sections.series.length + sections.anime.length + sections.musicvideos.length + sections.books.length + sections.music.length === 0) {
    return (
      <p className="py-24 text-center text-neutral-400">
        {t('This account has no libraries yet. Add one in Jellyfin (movies, series or music) and it will show up here.')}
      </p>
    )
  }

  const showBanner = layout.banner
  const bannerFeatured = showBanner && featured.length > 0
  const bannerShown = bannerFeatured || (showBanner && bannerPending && hasVideo)
  // Row by row, as they are drawn: the order and what is turned off come from Settings → Appearance.
  const rows: Record<HomeRowId, ReactNode> = {
    discover: bannerPending && showBanner ? (
      <div aria-hidden="true" style={{ minHeight: 260 }} />
    ) : (
      <Discover
        session={session}
        movies={movieLibraries}
        shows={showLibraries}
        music={sections.music}
        onPlay={onPlay}
        onOpenMovie={onOpenMovie}
        onOpenShow={onOpenShow}
        onOpenAlbum={actions.onOpenAlbum}
      />
    ),
    continue: (hasVideo || musicVideoLibraries.length > 0) && (
      <ContinueAll
        session={session}
        playbackVersion={playbackVersion}
        withMusicVideos={musicVideoLibraries.length > 0}
        overrides={overrides}
        onPlay={onPlay}
        onOpen={openAny}
      />
    ),
    nextUp:
      showLibraries.length > 0 && (
        <NextUpRow session={session} playbackVersion={playbackVersion} overrides={overrides} onPlay={onPlay} onOpenSeries={onOpenSeries} />
      ),
    upcoming: showLibraries.length > 0 && (
      <LazyMount height={200}>
        <UpcomingRow session={session} onOpenSeries={onOpenSeries} />
      </LazyMount>
    ),
    newSinceVisit: hasVideo && (
      <LazyMount height={200}>
        <NewSinceVisitRow
          session={session}
          libraryIds={[...movieLibraries, ...showLibraries].map((l) => l.id)}
          overrides={overrides}
          onOpenMovie={onOpenMovie}
          onOpenShow={onOpenShow}
        />
      </LazyMount>
    ),
    watchLater: hasVideo && (
      <LazyMount height={200}>
        <WatchLaterRow session={session} overrides={overrides} onOpenMovie={onOpenMovie} onOpenSeries={onOpenSeries} onSeeAll={actions.onOpenList} />
      </LazyMount>
    ),
    because: hasVideo && (
      <LazyMount height={300}>
        <BecauseRow session={session} playbackVersion={playbackVersion} overrides={overrides} onOpenMovie={onOpenMovie} onOpenShow={onOpenShow} />
      </LazyMount>
    ),
    latestMovies: recentMovies.status === 'ready' && recentMovies.data.length > 0 && (
      <Row title={t('Latest movies')} action={<SeeAll onClick={() => actions.onSection('movies')} label={t('Movies')} />}>
        {recentMovies.data.map((m) => (
          <RowCard key={m.id} session={session} movie={overrides[m.id] ?? m} onOpen={onOpenMovie} />
        ))}
      </Row>
    ),
    collections: movieLibraries.length > 0 && (
      <LazyMount height={300}>
        <CollectionsRow session={session} onOpen={actions.onOpenCollection} onSeeAll={actions.onSeeCollections} />
      </LazyMount>
    ),
    playlists: hasVideo && (
      <LazyMount height={200}>
        <PlaylistsRow session={session} onOpen={actions.onOpenList} onSeeAll={actions.onSeeLists} />
      </LazyMount>
    ),
    newSeries: recentSeries.status === 'ready' && recentSeries.data.length > 0 && (
      <Row title={t('New series')} action={<SeeAll onClick={() => actions.onSection('series')} label={t('Series')} />}>
        {recentSeries.data.map((m) => (
          <RowCard key={m.id} session={session} movie={overrides[m.id] ?? m} onOpen={onOpenShow} />
        ))}
      </Row>
    ),
    newAnime: recentAnime.status === 'ready' && recentAnime.data.length > 0 && (
      <Row title={t('New anime')} action={<SeeAll onClick={() => actions.onSection('anime')} label={t('Anime')} />}>
        {recentAnime.data.map((m) => (
          <RowCard key={m.id} session={session} movie={overrides[m.id] ?? m} onOpen={onOpenShow} />
        ))}
      </Row>
    ),
    newMusicVideos: recentMusicVideos.status === 'ready' && recentMusicVideos.data.length > 0 && (
      <Row title={t('New music videos')} action={<SeeAll onClick={() => actions.onSection('musicvideos')} label={t('Music videos')} />}>
        {recentMusicVideos.data.map((m) => (
          <RowCard key={m.id} session={session} movie={overrides[m.id] ?? m} onOpen={onOpenMovie} />
        ))}
      </Row>
    ),
    newBooks: recentBooks.status === 'ready' && recentBooks.data.length > 0 && (
      <Row title={t('New books')} action={<SeeAll onClick={() => actions.onSection('books')} label={t('Books')} />}>
        {recentBooks.data.map((m) => (
          <RowCard key={m.id} session={session} movie={overrides[m.id] ?? m} onOpen={actions.onOpenBook} />
        ))}
      </Row>
    ),
    music: sections.music.length > 0 && (
      <LazyMount height={300}>
        <MusicRows
          session={session}
          libraries={sections.music}
          onOpenAlbum={actions.onOpenAlbum}
          onOpenArtist={actions.onOpenArtist}
          onSeeAll={() => actions.onSection('music')}
        />
      </LazyMount>
    ),
  }

  return (
    <div>
      {showBanner && bannerPending && hasVideo && <HeroSkeleton />}
      {bannerFeatured && (
        <HeroCarousel
          session={session}
          items={featured}
          rotate={readUiPrefs().autoRotateBanner}
          onPlay={(title) => (title.isSeries ? onPlayShow(title) : onPlay(title))}
          onOpen={openAny}
          onBackdropFail={(title) => setFailedIds((ids) => (ids.includes(title.id) ? ids : [...ids, title.id]))}
        />
      )}
      <div className={`space-y-[var(--section-gap)] ${bannerShown ? 'relative -mt-14' : 'pt-6'}`}>
        {/* The banner's lists go first: the server answers a few requests at a time, and the picks are not what you wait for. */}
        {visibleRows(layout).map((id) => (
          <Fragment key={id}>{rows[id]}</Fragment>
        ))}
      </div>
    </div>
  )
}

function SeeAll({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="text-[var(--color-accent)] hover:underline" onClick={onClick} aria-label={t('See all in {label}', { label })}>
      {t('See all')}
    </button>
  )
}

/** Movies and episodes you stopped half-way, in one row. */
function ContinueAll({
  session,
  playbackVersion,
  withMusicVideos,
  overrides,
  onPlay,
  onOpen,
}: {
  session: Session
  playbackVersion: number
  withMusicVideos: boolean
  overrides: Record<string, Movie>
  onPlay: (item: Movie) => void
  onOpen: (item: Movie) => void
}) {
  // `playbackVersion` is part of the callback identity so the row is read again after playback ends (`fresh: 0`:
  // what is remembered is shown at once, but never trusted).
  const load = useCallback(() => getContinueAll(session, undefined, withMusicVideos).then((rows) => ({ rows, playbackVersion })), [session, withMusicVideos, playbackVersion])
  const { state } = useSwr(swrKey(swrScope(session), 'home', 'continue', withMusicVideos ? 'mv' : ''), load, { fresh: 0 })
  if (state.status !== 'ready') return null
  const items = state.data.rows.map((m) => overrides[m.id] ?? m).filter((m) => m.resumeTicks > 0)
  if (items.length === 0) return null
  return (
    <Row title={t('Continue watching')}>
      {items.map((m) => (
        <ContinueCard key={m.id} session={session} movie={m} onPlay={onPlay} onOpen={onOpen} />
      ))}
    </Row>
  )
}

/** The next episode of each series you are following. */
function NextUpRow({
  session,
  playbackVersion,
  overrides,
  onPlay,
  onOpenSeries,
}: {
  session: Session
  playbackVersion: number
  overrides: Record<string, Movie>
  onPlay: (item: Movie) => void
  onOpenSeries: (seriesId: string) => void
}) {
  const load = useCallback(() => getNextUp(session).then((rows) => ({ rows, playbackVersion })), [session, playbackVersion])
  const { state } = useSwr(swrKey(swrScope(session), 'home', 'next-up'), load, { fresh: 0 })
  if (state.status !== 'ready') return null
  // An episode you finished since this list was read is no longer "up next".
  const next = state.data.rows.map((e) => overrides[e.id] ?? e).filter((e) => !e.played && e.resumeTicks === 0)
  if (next.length === 0) return null
  return (
    <Row title={t('Next up')}>
      {next.map((e) => (
        <ContinueCard key={e.id} session={session} movie={e} onPlay={onPlay} onOpen={(m) => isEpisode(m) && onOpenSeries(m.seriesId)} />
      ))}
    </Row>
  )
}

/** "Because you watched X": what the server finds similar to the last thing you finished. */
function BecauseRow({
  session,
  playbackVersion,
  overrides,
  onOpenMovie,
  onOpenShow,
}: {
  session: Session
  playbackVersion: number
  overrides: Record<string, Movie>
  onOpenMovie: (movie: Movie) => void
  onOpenShow: (show: Movie) => void
}) {
  const load = useCallback(() => getBecauseYouWatched(session).then((row) => ({ row, playbackVersion })), [session, playbackVersion])
  const { state } = useSwr(swrKey(swrScope(session), 'home', 'because'), load, { fresh: 5 * 60_000 })
  if (state.status !== 'ready' || !state.data.row) return null
  const { seed, items } = state.data.row
  return (
    <Row title={t('Because you watched {title}', { title: seed.name })}>
      {items.map((m) => (
        <RowCard key={m.id} session={session} movie={overrides[m.id] ?? m} onOpen={m.isSeries ? onOpenShow : onOpenMovie} />
      ))}
    </Row>
  )
}

/** A taste of the music library: what was added lately, and what you were listening to. */
function MusicRows({
  session,
  libraries,
  onOpenAlbum,
  onOpenArtist,
  onSeeAll,
}: {
  session: Session
  libraries: { id: string }[]
  onOpenAlbum: (id: string) => void
  onOpenArtist: (id: string) => void
  onSeeAll: () => void
}) {
  // Several music libraries are read together, as on the music page.
  const libraryId = libraries.length === 1 ? libraries[0]?.id : undefined
  const added = useSwr(
    swrKey(swrScope(session), 'home', 'albums-new', libraryId),
    useCallback(() => getRecentAlbums(session, libraryId), [session, libraryId]),
  ).state
  const played = useSwr(
    swrKey(swrScope(session), 'home', 'songs-played', libraryId),
    useCallback(() => getRecentlyPlayedTracks(session, libraryId), [session, libraryId]),
    { fresh: 0 },
  ).state
  const jumpBack = played.status === 'ready' ? albumsOfTracks(played.data).slice(0, 16) : []
  return (
    <>
      {jumpBack.length > 0 && (
        <Row title={t('Jump back into music')}>
          {jumpBack.map((album) => (
            <RowItem key={album.id}>
              <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
            </RowItem>
          ))}
        </Row>
      )}
      {added.status === 'ready' && added.data.length > 0 && (
        <Row title={t('New in music')} action={<SeeAll onClick={onSeeAll} label={t('Music')} />}>
          {added.data.map((album) => (
            <RowItem key={album.id}>
              <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
            </RowItem>
          ))}
        </Row>
      )}
    </>
  )
}
