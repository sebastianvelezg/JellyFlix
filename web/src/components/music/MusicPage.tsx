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
  type TrackSort,
} from '../../core'
import { ShuffleIcon } from '../icons'
import { PagedView } from '../PagedView'
import { Row } from '../Row'
import { MadeForYou } from './MadeForYou'
import { useAsync } from '../useAsync'
import { swrKey, swrScope, useSwr } from '../useSwr'
import type { MusicTab } from '../route'
import { useMusic } from './MusicProvider'
import {
  AlbumCard,
  AlbumCardSkeleton,
  ArtistCard,
  PlaylistCard,
  RowItem,
  SongsSkeleton,
  TrackItem,
  TrackList,
} from './parts'
import { t, tr } from '../../i18n'

const TABS: Array<[MusicTab, string]> = [
  ['home', tr('Home')],
  ['albums', tr('Albums')],
  ['artists', tr('Artists')],
  ['songs', tr('Songs')],
]

const GRID = 'poster-grid'

interface Navigation {
  onOpenAlbum: (id: string) => void
  onOpenArtist: (id: string) => void
  onOpenPlaylist: (id: string) => void
}

/** The Music section: a home with rows, and tabs for all albums, artists, songs and playlists. */
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

  return (
    <div className="pt-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight sm:text-2xl">
          <span aria-hidden="true" className="h-6 w-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_14px_var(--glow)]" />
          {t('Music')}
        </h1>
        <button
          type="button"
          className="btn-primary ml-auto"
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
      </div>

      <nav aria-label={t('Music sections')} className="no-scrollbar -mx-1 mb-7 flex gap-1 overflow-x-auto px-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={id === tab ? 'page' : undefined}
            onClick={() => onTab(id)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition pointer-coarse:py-3 ${
              id === tab
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white shadow-[0_0_18px_-6px_var(--glow)]'
                : 'border-white/10 bg-white/[.04] text-neutral-300 hover:border-white/25 hover:text-white'
            }`}
          >
            {t(label)}
          </button>
        ))}
      </nav>

      {tab === 'home' && <Home session={session} libraryId={libraryId} visit={visit} {...nav} />}
      {tab === 'albums' && <Albums session={session} libraryId={libraryId} {...nav} />}
      {tab === 'artists' && <Artists session={session} libraryId={libraryId} {...nav} />}
      {tab === 'songs' && <Songs session={session} libraryId={libraryId} {...nav} />}
    </div>
  )
}

// ---- home --------------------------------------------------------------------------------------------------------

function Home({
  session,
  libraryId,
  visit,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: { session: Session; libraryId?: string; visit: number } & Navigation) {
  // What was seen last time is shown at once; `visit` is part of the loaders so "recently played" is read again each time.
  const scope = swrScope(session)
  const recentlyPlayed = useSwr(
    swrKey(scope, 'music', 'played', libraryId),
    useCallback(() => getRecentlyPlayedTracks(session, libraryId).then((t) => ({ t, visit })), [session, libraryId, visit]),
    { fresh: 0 },
  ).state
  const added = useSwr(swrKey(scope, 'music', 'added', libraryId), useCallback(() => getRecentAlbums(session, libraryId), [session, libraryId])).state
  const discover = useSwr(swrKey(scope, 'music', 'discover', libraryId), useCallback(() => getRandomAlbums(session, libraryId), [session, libraryId])).state
  const popular = useSwr(
    swrKey(scope, 'music', 'popular', libraryId),
    useCallback(() => getPopularTracks(session, { libraryId, limit: 8 }).then((t) => ({ t, visit })), [session, libraryId, visit]),
    { fresh: 0 },
  ).state
  const favorites = useSwr(
    swrKey(scope, 'music', 'favorites', libraryId),
    useCallback(() => getFavoriteTracks(session, libraryId, 8).then((t) => ({ t, visit })), [session, libraryId, visit]),
    { fresh: 0 },
  ).state
  const playlists = useSwr(swrKey(scope, 'music', 'playlists'), useCallback(() => getPlaylists(session), [session])).state

  const jumpBack = recentlyPlayed.status === 'ready' ? albumsOfTracks(recentlyPlayed.data.t).slice(0, 16) : []
  const played = popular.status === 'ready' ? popular.data.t.filter((t) => t.playCount > 0) : []
  const loading = [added, discover].some((s) => s.status === 'loading')
  const empty = added.status === 'ready' && added.data.length === 0

  if (empty) {
    return (
      <StateMessage kind="empty" message={t('No music here yet. If Jellyfin is still scanning your music library, albums will appear as soon as it finds them.')} />
    )
  }

  return (
    <div className="space-y-9">
      <MadeForYou
        session={session}
        libraryId={libraryId}
        favorites={favorites.status === 'ready' ? favorites.data.t : []}
        recent={recentlyPlayed.status === 'ready' ? recentlyPlayed.data.t : []}
      />
      {jumpBack.length > 0 && (
        <Row title={t('Jump back in')}>
          {jumpBack.map((album) => (
            <RowItem key={album.id}>
              <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
            </RowItem>
          ))}
        </Row>
      )}
      {added.status === 'ready' && added.data.length > 0 && (
        <Row title={t('Recently added')}>
          {added.data.map((album) => (
            <RowItem key={album.id}>
              <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
            </RowItem>
          ))}
        </Row>
      )}
      {playlists.status === 'ready' && playlists.data.length > 0 && (
        <Row title={t('Your playlists')}>
          {playlists.data.map((playlist) => (
            <RowItem key={playlist.id}>
              <PlaylistCard session={session} playlist={playlist} onOpen={() => onOpenPlaylist(playlist.id)} />
            </RowItem>
          ))}
        </Row>
      )}
      {discover.status === 'ready' && discover.data.length > 0 && (
        <Row title={t('Discover')}>
          {discover.data.map((album) => (
            <RowItem key={album.id}>
              <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
            </RowItem>
          ))}
        </Row>
      )}
      {played.length > 0 && (
        <SongSection title={t('Most played')}>
          <TrackList session={session} tracks={played} onOpenAlbum={onOpenAlbum} />
        </SongSection>
      )}
      {favorites.status === 'ready' && favorites.data.t.length > 0 && (
        <SongSection title={t('Your favorite songs')}>
          <TrackList session={session} tracks={favorites.data.t} onOpenAlbum={onOpenAlbum} />
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

function SongSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white sm:text-xl">
        <span aria-hidden="true" className="h-5 w-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_14px_var(--glow)]" />
        {title}
      </h2>
      {children}
    </section>
  )
}

// ---- toolbars --------------------------------------------------------------------------------------------------------

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-400">
      <span className="sr-only">{label}</span>
      <select className="select w-full sm:w-auto" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
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
      className="field w-full rounded-full sm:w-64"
    />
  )
}

const Toolbar = ({ children }: { children: ReactNode }) => (
  <div className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">{children}</div>
)

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
      <Toolbar>
        <Select label={t('Show')} value={filter} options={FILTERS} onChange={setFilter} />
        {genres.status === 'ready' && genres.data.length > 0 && (
          <Select
            label={t('Genre')}
            value={genre}
            options={[['', t('All genres')], ...genres.data.map((g): [string, string] => [g, g])]}
            onChange={setGenre}
          />
        )}
        <Select label={t('Sort by')} value={sort} options={Object.entries(ALBUM_SORT_LABELS) as Array<[AlbumSort, string]>} onChange={setSort} />
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
      <Toolbar>
        <SearchField label={t('Search artists')} value={search} onChange={setSearch} />
        <Select label={t('Show')} value={filter} options={FILTERS} onChange={setFilter} />
        <Select label={t('Sort by')} value={sort} options={Object.entries(ARTIST_SORT_LABELS) as Array<[ArtistSort, string]>} onChange={setSort} />
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
      <Toolbar>
        <SearchField label={t('Search songs')} value={search} onChange={setSearch} />
        <Select label={t('Show')} value={filter} options={FILTERS} onChange={setFilter} />
        <Select label={t('Sort by')} value={sort} options={Object.entries(TRACK_SORT_LABELS) as Array<[TrackSort, string]>} onChange={setSort} />
      </Toolbar>
      <PagedView
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
            onOpenAlbum={onOpenAlbum}
            // The song plays, and the songs loaded below it follow.
            onPlay={() => music.play(loaded, index)}
          />
        )}
      />
    </section>
  )
}

