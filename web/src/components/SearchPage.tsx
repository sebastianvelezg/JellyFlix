import { StateMessage } from './StateMessage'
import { useCallback, useState } from 'react'
import { SearchFilters, type SearchKind } from './SearchFilters'
import {
  episodeCode,
  isEpisode,
  searchCollections,
  searchEpisodes,
  searchMovies,
  searchMusic,
  searchMusicVideos,
  searchShows,
  wideImageUrl,
  type Collection,
  type Episode,
  type Movie,
  type Session,
} from '../core'
import { CollectionCard } from './CollectionCard'
import { Img } from './Img'
import { PlayIcon } from './icons'
import { AlbumCard, ArtistCard, TrackList } from './music/parts'
import { PagedGrid } from './PagedGrid'
import { useAsync } from './useAsync'
import { t } from '../i18n'

/** Search results for movies, series and episodes. A kind with no matches is left out. */
export function SearchPage({
  term,
  session,
  overrides,
  onOpenMovie,
  hasMusic,
  hasMusicVideos = false,
  onOpenShow,
  onOpenCollection,
  onOpenAlbum,
  onOpenArtist,
  onPlay,
}: {
  term: string
  session: Session
  overrides: Record<string, Movie>
  onOpenMovie: (movie: Movie) => void
  onOpenShow: (show: Movie) => void
  onOpenCollection: (collection: Collection) => void
  /** Whether the account has a music library (otherwise music is not searched). */
  hasMusic: boolean
  /** Whether the account has a music video library (otherwise they are not searched). */
  hasMusicVideos?: boolean
  onOpenAlbum: (id: string) => void
  onOpenArtist: (id: string) => void
  onPlay: (episode: Episode) => void
}) {
  const [totals, setTotals] = useState<{ movies?: number; series?: number; musicVideos?: number }>({})
  const [kind, setKind] = useState<SearchKind>('all')
  const shows = (...kinds: SearchKind[]) => kind === 'all' || kinds.includes(kind)
  const onMovies = useCallback((movies: number) => setTotals((t) => ({ ...t, movies })), [])
  const onSeries = useCallback((series: number) => setTotals((t) => ({ ...t, series })), [])
  const loadMovies = useCallback((startIndex: number) => searchMovies(session, term, { startIndex }), [session, term])
  const onMusicVideos = useCallback((musicVideos: number) => setTotals((t) => ({ ...t, musicVideos })), [])
  const loadMusicVideos = useCallback((startIndex: number) => searchMusicVideos(session, term, { startIndex }), [session, term])
  const loadSeries = useCallback((startIndex: number) => searchShows(session, term, { startIndex }), [session, term])
  const loadEpisodes = useCallback(() => searchEpisodes(session, term), [session, term])
  const episodes = useAsync(loadEpisodes).state
  const loadCollections = useCallback(() => searchCollections(session, term), [session, term])
  const collections = useAsync(loadCollections).state
  const loadMusic = useCallback(
    () => (hasMusic ? searchMusic(session, term) : Promise.resolve({ albums: [], artists: [], tracks: [] })),
    [session, term, hasMusic],
  )
  const music = useAsync(loadMusic).state

  const episodeCount = episodes.status === 'ready' ? episodes.data.length : null
  const noMusic = music.status === 'error' || (music.status === 'ready' && music.data.albums.length + music.data.artists.length + music.data.tracks.length === 0)
  const noCollections = collections.status === 'error' || (collections.status === 'ready' && collections.data.length === 0)
  const nothing =
    totals.movies === 0 && totals.series === 0 && (!hasMusicVideos || totals.musicVideos === 0) && (episodes.status === 'error' || episodeCount === 0) && noMusic && noCollections

  return (
    <div className="pt-6">
      <h1 className="mb-4 text-lg font-semibold">
        {t('Results for “')}<span className="text-[var(--color-accent)]">{term}</span>”
      </h1>

      <SearchFilters value={kind} onChange={setKind} hasMusic={hasMusic} hasMusicVideos={hasMusicVideos} />

      {nothing && (
        <StateMessage
          kind="empty"
          size="section"
          message={t('No movies match “{term}”, and nothing else in your library does either. Check the spelling or try a shorter title.', { term })}
        />
      )}

      {totals.movies !== 0 && (
        <section aria-label={t('Movies')} hidden={!shows('movies')} className="mb-10">
          <h2 className="mb-3 text-base font-semibold text-neutral-100">{t('Movies')}</h2>
          <PagedGrid
            session={session}
            load={loadMovies}
            overrides={overrides}
            onOpen={onOpenMovie}
            onTotal={onMovies}
            summary={(_, total) => (total === 1 ? t('1 movie found') : t('{count} movies found', { count: total }))}
          />
        </section>
      )}

      {totals.series !== 0 && (
        <section aria-label={t('Series')} hidden={!shows('series')} className="mb-10">
          <h2 className="mb-3 text-base font-semibold text-neutral-100">{t('Series')}</h2>
          <PagedGrid
            session={session}
            load={loadSeries}
            overrides={overrides}
            onOpen={onOpenShow}
            onTotal={onSeries}
            summary={(_, total) => t('{count} series found', { count: total })}
          />
        </section>
      )}

      {hasMusicVideos && totals.musicVideos !== 0 && (
        <section aria-label={t('Music videos')} hidden={!shows('musicvideos')} className="mb-10">
          <h2 className="mb-3 text-base font-semibold text-neutral-100">{t('Music videos')}</h2>
          <PagedGrid
            session={session}
            load={loadMusicVideos}
            overrides={overrides}
            onOpen={onOpenMovie}
            onTotal={onMusicVideos}
            wide
            summary={(_, total) => (total === 1 ? t('1 music video found') : t('{count} music videos found', { count: total }))}
          />
        </section>
      )}

      {collections.status === 'ready' && collections.data.length > 0 && (
        <section aria-label={t('Collections')} hidden={!shows('movies')} className="mb-10">
          <h2 className="mb-3 text-base font-semibold text-neutral-100">{t('Collections')}</h2>
          <ul className="poster-grid">
            {collections.data.map((collection) => (
              <li key={collection.id}>
                <CollectionCard session={session} collection={collection} onOpen={onOpenCollection} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {episodes.status === 'ready' && episodes.data.length > 0 && (
        <section aria-label={t('Episodes')} hidden={!shows('series')} className="mb-10">
          <h2 className="mb-3 text-base font-semibold text-neutral-100">{t('Episodes')}</h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {episodes.data.map((episode) => (
              <li key={episode.id}>
                <EpisodeResult session={session} episode={overrides[episode.id] ?? episode} onPlay={onPlay} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {music.status === 'ready' && music.data.albums.length > 0 && (
        <section aria-label={t('Albums')} hidden={!shows('music')} className="mb-10">
          <h2 className="mb-3 text-base font-semibold text-neutral-100">{t('Albums')}</h2>
          <ul className="poster-grid">
            {music.data.albums.map((album) => (
              <li key={album.id}>
                <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {music.status === 'ready' && music.data.artists.length > 0 && (
        <section aria-label={t('Artists')} hidden={!shows('music')} className="mb-10">
          <h2 className="mb-3 text-base font-semibold text-neutral-100">{t('Artists')}</h2>
          <ul className="poster-grid">
            {music.data.artists.map((artist) => (
              <li key={artist.id}>
                <ArtistCard session={session} artist={artist} onOpen={() => onOpenArtist(artist.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {music.status === 'ready' && music.data.tracks.length > 0 && (
        <section aria-label={t('Songs')} hidden={!shows('music')} className="mb-10">
          <h2 className="mb-3 text-base font-semibold text-neutral-100">{t('Songs')}</h2>
          <TrackList session={session} tracks={music.data.tracks} onOpenAlbum={onOpenAlbum} />
        </section>
      )}
    </div>
  )
}

function EpisodeResult({ session, episode, onPlay }: { session: Session; episode: Movie; onPlay: (episode: Episode) => void }) {
  if (!isEpisode(episode)) return null
  const code = episodeCode(episode)
  return (
    <button
      type="button"
      onClick={() => onPlay(episode)}
      aria-label={t('Play {seriesName} {code} {name}', { seriesName: episode.seriesName, code, name: episode.name })}
      className="group flex w-full items-center gap-3 rounded-2xl border border-transparent p-2 text-left transition hover:border-white/10 hover:bg-white/[.04]"
    >
      <span className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface-2)] ring-1 ring-white/10 transition group-hover:ring-[var(--color-accent)]/70">
        <Img
          session={session}
          src={wideImageUrl(session.serverUrl, episode, 320)}
          className="h-full w-full object-cover"
          fallback={null}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
          <PlayIcon />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-white">{episode.name}</span>
        <span className="block truncate text-xs text-neutral-400">
          {episode.seriesName} · {code}
        </span>
      </span>
    </button>
  )
}
