import { StateMessage } from '../StateMessage'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  albumsOfTracks,
  ALBUM_SORT_LABELS,
  ARTIST_SORT_LABELS,
  getAlbumPage,
  getArtistPage,
  getFavoriteTracks,
  getMusicGenres,
  getPlaylists,
  getPopularTracks,
  getRandomAlbums,
  getRandomTracks,
  getRecentAlbums,
  getRecentlyPlayedTracks,
  getTrackPage,
  TRACK_SORT_LABELS,
  type AlbumSort,
  type ArtistSort,
  type MovieLibrary,
  type MusicFilter,
  type Session,
  type Track,
  type TrackSort,
} from '../../core'
import { ShuffleIcon } from '../icons'
import { PagedView } from '../PagedView'
import { ContinuePanel, MixesShelf, MixHero, MixList, useMadeForYou, type Mixes } from './MadeForYou'
import { MusicNav } from './MusicNav'
import { Shelf, ShelfItem } from '../Shelf'
import { useAsync } from '../useAsync'
import { swrKey, swrScope, useSwr } from '../useSwr'
import type { MusicTab } from '../route'
import { useMusic } from './MusicProvider'
import {
  AlbumCard,
  AlbumCardSkeleton,
  ArtistCard,
  PlaylistCard,
  SongsSkeleton,
  TrackHeader,
  TrackItem,
  TrackList,
} from './parts'
import { t, tr } from '../../i18n'
import { Toolbar, ToolbarSelect } from '../Toolbar'

const GRID = 'poster-grid'

interface Navigation {
  onOpenAlbum: (id: string) => void
  onOpenArtist: (id: string) => void
  onOpenPlaylist: (id: string) => void
}

const EMPTY: Track[] = []

/**
 * The Music section: a side column with its sections (home, albums, artists, songs) and the mixes made for you, and next to it the
 * page of the section. On a narrow screen the sections are a row of pills above the page.
 */
export function MusicPage({
  session,
  libraries,
  tab,
  visit,
  onTab,
  ...nav
}: {
  session: Session
  libraries: MovieLibrary[]
  tab: MusicTab
  /** Changes each time the page is opened, so "recently played" and similar lists are read again. */
  visit: number
  onTab: (tab: MusicTab) => void
} & Navigation) {
  const music = useMusic()
  // Several music libraries are shown together.
  const libraryId = libraries.length === 1 ? libraries[0]?.id : undefined
  const [shuffling, setShuffling] = useState(false)

  // What the home and the side column both need: what was played last, and what is a favourite (the mixes are made from them).
  // What was seen last time is shown at once; `visit` is part of the loaders so they are read again each time the page is opened.
  const scope = swrScope(session)
  const recentlyPlayed = useSwr(
    swrKey(scope, 'music', 'played', libraryId),
    useCallback(() => getRecentlyPlayedTracks(session, libraryId).then((t) => ({ t, visit })), [session, libraryId, visit]),
    { fresh: 0 },
  ).state
  const favorites = useSwr(
    swrKey(scope, 'music', 'favorites', libraryId),
    useCallback(() => getFavoriteTracks(session, libraryId, 8).then((t) => ({ t, visit })), [session, libraryId, visit]),
    { fresh: 0 },
  ).state
  const recent = recentlyPlayed.status === 'ready' ? recentlyPlayed.data.t : EMPTY
  const favored = favorites.status === 'ready' ? favorites.data.t : EMPTY
  const mixes = useMadeForYou(session, libraryId, favored, recent)

  return (
    <div className="bleed flex flex-col lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <header className="order-1 flex flex-wrap items-center gap-3 px-[var(--gutter)] pb-4 pt-6 lg:col-start-2 lg:row-start-1 lg:px-10 lg:pt-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{t('Music')}</h1>
        <button
          type="button"
          className="btn ml-auto"
          disabled={shuffling}
          onClick={() => {
            setShuffling(true)
            getRandomTracks(session, libraryId)
              .then((tracks) => music.play(tracks, 0))
              .catch(() => undefined)
              .finally(() => setShuffling(false))
          }}
        >
          <ShuffleIcon /> {t('Shuffle all')}
        </button>
      </header>

      <aside className="order-2 px-[var(--gutter)] pb-4 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:border-r lg:border-white/[.06] lg:bg-white/[.015] lg:px-3 lg:pb-0">
        <div className="lg:sticky lg:top-[var(--header-h)] lg:flex lg:max-h-[calc(100dvh-var(--header-h)-6rem)] lg:flex-col lg:gap-6 lg:py-8">
          <h2 className="hidden px-3 text-lg font-bold tracking-tight text-white lg:block">{t('Your music')}</h2>
          <MusicNav tab={tab} onTab={onTab} />
          {mixes && (
            <div className="hidden min-h-0 flex-1 flex-col border-t border-white/[.06] pt-6 lg:flex">
              <MixList session={session} mixes={mixes} />
            </div>
          )}
        </div>
      </aside>

      <div className="order-3 min-w-0 px-[var(--gutter)] pb-6 pt-2 lg:col-start-2 lg:row-start-2 lg:px-10">
        {tab === 'home' && <Home session={session} libraryId={libraryId} visit={visit} recent={recent} favorites={favored} mixes={mixes} onTab={onTab} {...nav} />}
        {tab === 'albums' && <Albums session={session} libraryId={libraryId} {...nav} />}
        {tab === 'artists' && <Artists session={session} libraryId={libraryId} {...nav} />}
        {tab === 'songs' && <Songs session={session} libraryId={libraryId} {...nav} />}
      </div>
    </div>
  )
}

// ---- home --------------------------------------------------------------------------------------------------------

function Home({
  session,
  libraryId,
  visit,
  recent,
  favorites,
  mixes,
  onTab,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: { session: Session; libraryId?: string; visit: number; recent: Track[]; favorites: Track[]; mixes: Mixes | null; onTab: (tab: MusicTab) => void } & Navigation) {
  const scope = swrScope(session)
  const added = useSwr(swrKey(scope, 'music', 'added', libraryId), useCallback(() => getRecentAlbums(session, libraryId), [session, libraryId])).state
  const discover = useSwr(swrKey(scope, 'music', 'discover', libraryId), useCallback(() => getRandomAlbums(session, libraryId), [session, libraryId])).state
  const popular = useSwr(
    swrKey(scope, 'music', 'popular', libraryId),
    useCallback(() => getPopularTracks(session, { libraryId, limit: 8 }).then((t) => ({ t, visit })), [session, libraryId, visit]),
    { fresh: 0 },
  ).state
  const playlists = useSwr(swrKey(scope, 'music', 'playlists'), useCallback(() => getPlaylists(session), [session])).state

  const jumpBack = albumsOfTracks(recent).slice(0, 16)
  const played = popular.status === 'ready' ? popular.data.t.filter((t) => t.playCount > 0) : []
  const loading = [added, discover].some((s) => s.status === 'loading')
  const empty = added.status === 'ready' && added.data.length === 0
  const seeLibrary = { label: t('See library'), onClick: () => onTab('albums') }
  const seeSongs = { label: t('See songs'), onClick: () => onTab('songs') }
  // What to pick up: what was played last, or, for a new account, the favourites.
  const pickUp = recent.length > 0 ? recent : favorites

  if (empty) {
    return (
      <StateMessage kind="empty" message={t('No music here yet. If Jellyfin is still scanning your music library, albums will appear as soon as it finds them.')} />
    )
  }

  return (
    <div className="space-y-10">
      {(mixes || pickUp.length > 0) && (
        <div className={`grid gap-8 ${mixes && pickUp.length > 0 ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : ''}`}>
          {mixes && <MixHero session={session} mixes={mixes} />}
          <ContinuePanel session={session} tracks={pickUp} />
        </div>
      )}
      {mixes && <MixesShelf session={session} mixes={mixes} />}
      {jumpBack.length > 0 && (
        <Shelf title={t('Jump back in')} action={seeLibrary}>
          {jumpBack.map((album) => (
            <ShelfItem key={album.id}>
              <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
            </ShelfItem>
          ))}
        </Shelf>
      )}
      {added.status === 'ready' && added.data.length > 0 && (
        <Shelf title={t('Recently added')} action={seeLibrary}>
          {added.data.map((album) => (
            <ShelfItem key={album.id}>
              <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
            </ShelfItem>
          ))}
        </Shelf>
      )}
      {played.length > 0 && (
        <SongSection title={t('Most played')} action={seeSongs}>
          <TrackList session={session} tracks={played} header onOpenAlbum={onOpenAlbum} />
        </SongSection>
      )}
      {playlists.status === 'ready' && playlists.data.length > 0 && (
        <Shelf title={t('Your playlists')}>
          {playlists.data.map((playlist) => (
            <ShelfItem key={playlist.id}>
              <PlaylistCard session={session} playlist={playlist} onOpen={() => onOpenPlaylist(playlist.id)} />
            </ShelfItem>
          ))}
        </Shelf>
      )}
      {discover.status === 'ready' && discover.data.length > 0 && (
        <Shelf title={t('Discover')} action={seeLibrary}>
          {discover.data.map((album) => (
            <ShelfItem key={album.id}>
              <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
            </ShelfItem>
          ))}
        </Shelf>
      )}
      {favorites.length > 0 && (
        <SongSection title={t('Your favorite songs')} action={seeSongs}>
          <TrackList session={session} tracks={favorites} header onOpenAlbum={onOpenAlbum} />
        </SongSection>
      )}
      {loading && (
        <div role="status" aria-label={t('Loading music')} className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <AlbumCardSkeleton key={i} />
          ))}
        </div>
      )}
    </div>
  )
}

function SongSection({ title, action, children }: { title: string; action?: { label: string; onClick: () => void }; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="min-w-0 truncate text-xl font-bold tracking-tight text-white sm:text-[1.35rem]">{title}</h2>
        {action && (
          <button type="button" onClick={action.onClick} className="ml-auto shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-[var(--color-accent)] hover:underline pointer-coarse:py-3">
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/** The title of a section page (albums, artists, songs), above its controls. */
function PageTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-2xl font-bold tracking-tight text-white">{children}</h2>
}

// ---- toolbars --------------------------------------------------------------------------------------------------------

function Select<T extends string>({
  label,
  prefix,
  value,
  options,
  onChange,
}: {
  label: string
  prefix?: string
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  return (
    <ToolbarSelect label={label} prefix={prefix} value={value} onChange={(v) => onChange(v as T)}>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </ToolbarSelect>
  )
}

const FILTERS: Array<[MusicFilter, string]> = [
  ['all', tr('Everything')],
  ['favorites', tr('Favorites')],
]

/** What you typed, after a short pause, so a search is not sent for every key. */
function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="search"
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="field w-64 max-w-full shrink-0 rounded-full"
    />
  )
}


// ---- albums, artists, songs, playlists -------------------------------------------------------------------------------

function Albums({ session, libraryId, onOpenAlbum, onOpenArtist }: { session: Session; libraryId?: string } & Navigation) {
  const [sort, setSort] = useState<AlbumSort>('name')
  const [filter, setFilter] = useState<MusicFilter>('all')
  const [genre, setGenre] = useState('')
  const genres = useAsync(useCallback(() => getMusicGenres(session, libraryId), [session, libraryId])).state
  const load = useCallback(
    (startIndex: number) => getAlbumPage(session, { libraryId, startIndex, sort, filter, genre: genre || undefined, withTotal: startIndex === 0 }),
    [session, libraryId, sort, filter, genre],
  )
  return (
    <section aria-label={t('All albums')}>
      <PageTitle>{t('Albums')}</PageTitle>
      <Toolbar className="mb-6">
        <Select label={t('Show')} value={filter} options={FILTERS} onChange={setFilter} />
        {genres.status === 'ready' && genres.data.length > 0 && (
          <Select
            label={t('Genre')}
            value={genre}
            options={[['', t('All genres')], ...genres.data.map((g): [string, string] => [g, g])]}
            onChange={setGenre}
          />
        )}
        <Select label={t('Sort by')} prefix={t('Sort')} value={sort} options={Object.entries(ALBUM_SORT_LABELS) as Array<[AlbumSort, string]>} onChange={setSort} />
      </Toolbar>
      <PagedView
        key={`${sort}|${filter}|${genre}`}
        load={load}
        className={GRID}
        placeholder={<AlbumCardSkeleton />}
        noun="albums"
        itemClassName="cv-card"
        emptyMessage={filter === 'favorites' ? t('No favorite albums yet. Tap the heart on an album page.') : t('No albums match.')}
        summary={(shown, total) => t('{shown} of {total} albums', { shown, total })}
        renderItem={(album) => (
          <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
        )}
      />
    </section>
  )
}

function Artists({ session, libraryId, onOpenArtist }: { session: Session; libraryId?: string } & Navigation) {
  const [sort, setSort] = useState<ArtistSort>('name')
  const [filter, setFilter] = useState<MusicFilter>('all')
  const [search, setSearch] = useState('')
  const term = useDebounced(search)
  const load = useCallback(
    (startIndex: number) => getArtistPage(session, { libraryId, startIndex, sort, filter, search: term, withTotal: startIndex === 0 }),
    [session, libraryId, sort, filter, term],
  )
  return (
    <section aria-label={t('All artists')}>
      <PageTitle>{t('Artists')}</PageTitle>
      <Toolbar className="mb-6">
        <SearchField label={t('Search artists')} value={search} onChange={setSearch} />
        <Select label={t('Show')} value={filter} options={FILTERS} onChange={setFilter} />
        <Select label={t('Sort by')} prefix={t('Sort')} value={sort} options={Object.entries(ARTIST_SORT_LABELS) as Array<[ArtistSort, string]>} onChange={setSort} />
      </Toolbar>
      <PagedView
        key={`${sort}|${filter}|${term}`}
        load={load}
        className={GRID}
        placeholder={<AlbumCardSkeleton />}
        noun="artists"
        itemClassName="cv-card"
        emptyMessage={term ? t('No artists match “{term}”.', { term }) : t('No artists yet.')}
        summary={(shown, total) => t('{shown} of {total} artists', { shown, total })}
        renderItem={(artist) => <ArtistCard session={session} artist={artist} onOpen={() => onOpenArtist(artist.id)} />}
      />
    </section>
  )
}

function Songs({ session, libraryId, onOpenAlbum }: { session: Session; libraryId?: string } & Navigation) {
  const music = useMusic()
  const [sort, setSort] = useState<TrackSort>('name')
  const [filter, setFilter] = useState<MusicFilter>('all')
  const [search, setSearch] = useState('')
  const term = useDebounced(search)
  const load = useCallback(
    (startIndex: number) => getTrackPage(session, { libraryId, startIndex, sort, filter, search: term, withTotal: startIndex === 0 }),
    [session, libraryId, sort, filter, term],
  )
  return (
    <section aria-label={t('All songs')}>
      <PageTitle>{t('Songs')}</PageTitle>
      <Toolbar className="mb-6">
        <SearchField label={t('Search songs')} value={search} onChange={setSearch} />
        <Select label={t('Show')} value={filter} options={FILTERS} onChange={setFilter} />
        <Select label={t('Sort by')} prefix={t('Sort')} value={sort} options={Object.entries(TRACK_SORT_LABELS) as Array<[TrackSort, string]>} onChange={setSort} />
      </Toolbar>
      <PagedView
        listHeader={<TrackHeader />}
        key={`${sort}|${filter}|${term}`}
        load={load}
        className="divide-y divide-white/[.05]"
        placeholder={<SongsSkeleton />}
        placeholderCount={10}
        noun="songs"
        emptyMessage={term ? t('No songs match “{term}”.', { term }) : filter === 'favorites' ? t('No favorite songs yet. Tap the heart on a song.') : t('No songs yet.')}
        summary={(shown, total) => t('{shown} of {total} songs', { shown, total })}
        renderItem={(track, index, loaded) => (
          <TrackItem
            session={session}
            track={track}
            number={index + 1}
            onOpenAlbum={onOpenAlbum}
            // The song plays, and the songs loaded below it follow.
            onPlay={() => music.play(loaded, index)}
          />
        )}
      />
    </section>
  )
}

