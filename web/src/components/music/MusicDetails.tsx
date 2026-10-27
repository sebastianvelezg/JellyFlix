import { StateMessage } from '../StateMessage'
import { useCallback, useState, type ReactNode } from 'react'
import {
  getAlbum,
  getAlbumPage,
  getAlbumRadio,
  getAlbumTracks,
  getArtist,
  getArtistRadio,
  getPlaylist,
  getPlaylistTracks,
  getPopularTracks,
  getTrackPage,
  totalTicks,
  UNKNOWN_ARTIST,
  type Session,
  type Track,
} from '../../core'
import { PlayOnButton } from '../remote/PlayOnButton'
import { BackIcon, HeartIcon, PlayIcon, PlusIcon, RadioIcon, ShuffleIcon } from '../icons'
import { Row } from '../Row'
import { EditButton } from '../admin/EditButton'
import { useReloadOnEdit } from '../admin/editorEvents'
import { swrKey, swrScope, useSwr } from '../useSwr'
import { useMusic } from './MusicProvider'
import { AlbumCard, Cover, RowItem, TrackList, totalLength, useFavorite } from './parts'
import { t, tr } from '../../i18n'

interface Nav {
  session: Session
  onBack: () => void
  onOpenAlbum: (id: string) => void
  onOpenArtist: (id: string) => void
}

function Loading({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div role="status" aria-label={label} className="pt-8">
      <button type="button" className="btn mb-6" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="skeleton aspect-square w-56 shrink-0" />
        <div className="w-full space-y-3 pt-4">
          <div className="skeleton h-10 w-2/3" />
          <div className="skeleton h-4 w-1/3" />
        </div>
      </div>
    </div>
  )
}

function Failed({ what, message, retry, onBack }: { what: string; message: string; retry: () => void; onBack: () => void }) {
  return (
    <StateMessage
      kind="error"
      message={t(what === 'album' ? 'Could not load this album: {message}' : what === 'artist' ? 'Could not load this artist: {message}' : 'Could not load this playlist: {message}', { message })}
    >
      <button type="button" className="btn" onClick={retry}>
        {t('Try again')}
      </button>
      <button type="button" className="btn" onClick={onBack}>
        {t('Back')}
      </button>
    </StateMessage>
  )
}

/** Play, shuffle and add-to-queue for a set of songs that may still be loading. */
function PlayButtons({
  tracks,
  playOnId,
  favorite,
  radio,
  edit,
}: {
  tracks: Track[]
  playOnId?: string
  /** Songs that go with this artist or album (the server's instant mix): starts a radio from them. */
  radio?: () => Promise<Track[]>
  favorite?: { on: boolean; failed: boolean; toggle: () => void; label: string }
  /** The administrator's pencil, at the end of the same row (nothing for anyone else). */
  edit?: ReactNode
}) {
  const music = useMusic()
  const none = tracks.length === 0
  const [radioBusy, setRadioBusy] = useState(false)
  return (
    <div className="relative z-20 mt-6 flex flex-wrap items-center gap-2.5">
      <button type="button" className="btn-primary px-6 py-3 text-base" disabled={none} onClick={() => music.play(tracks, 0)}>
        <PlayIcon /> {t('Play')}
      </button>
      <button type="button" className="btn py-3" disabled={none} onClick={() => music.play(tracks, 0, { shuffle: true })}>
        <ShuffleIcon /> {t('Shuffle')}
      </button>
      <button type="button" className="btn py-3" disabled={none} onClick={() => music.enqueue(tracks)}>
        <PlusIcon /> {t('Add to queue')}
      </button>
      {radio && (
        <button
          type="button"
          className="btn py-3"
          disabled={radioBusy}
          onClick={() => {
            setRadioBusy(true)
            radio()
              .then((songs) => songs.length > 0 && music.play(songs, 0))
              .catch(() => undefined)
              .finally(() => setRadioBusy(false))
          }}
        >
          <RadioIcon /> {t('Radio')}
        </button>
      )}
      {playOnId && <PlayOnButton itemId={playOnId} />}
      {favorite && (
        <button
          type="button"
          className={`btn py-3 ${favorite.on ? 'border-rose-400/40 text-rose-400' : ''}`}
          aria-pressed={favorite.on}
          title={favorite.failed ? t('Could not update this favorite') : undefined}
          onClick={favorite.toggle}
        >
          <HeartIcon filled={favorite.on} /> {favorite.on ? t('Favorite') : t('Add {label} to favorites', { label: favorite.label })}
        </button>
      )}
      {edit}
    </div>
  )
}

/** The pencil is a round-cornered button of the same height as the ones it sits among. */
const PENCIL = 'btn px-3.5 py-3'

function Heading({ kind, title, children }: { kind: string; title: string; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="chip-accent">{t(kind)}</p>
      <h1 className="mt-3 text-balance text-3xl font-extrabold tracking-tight text-white sm:text-5xl">{title}</h1>
      {children}
    </div>
  )
}

// ---- album ----------------------------------------------------------------------------------------------------------

export function AlbumPage({ session, id, onBack, onOpenAlbum, onOpenArtist }: Nav & { id: string }) {
  const album = useSwr(swrKey(swrScope(session), 'album', id), useCallback(() => getAlbum(session, id), [session, id]), { fresh: 0 })
  const tracks = useSwr(swrKey(swrScope(session), 'album-tracks', id), useCallback(() => getAlbumTracks(session, id), [session, id]), { fresh: 0 }).state
  useReloadOnEdit(album.retry)
  if (album.state.status === 'loading') return <Loading onBack={onBack} label={t('Loading album')} />
  if (album.state.status === 'error') return <Failed what="album" message={album.state.message} retry={album.retry} onBack={onBack} />
  const a = album.state.data
  // Songs without tags take their artist and album from the album they are in.
  const songs = (tracks.status === 'ready' ? tracks.data : []).map((t) =>
    t.artist === UNKNOWN_ARTIST ? { ...t, artist: a.artist, album: t.album || a.name, albumId: t.albumId ?? a.id } : t,
  )
  return <AlbumContent session={session} album={a} songs={songs} loadingSongs={tracks.status === 'loading'} onBack={onBack} onOpenAlbum={onOpenAlbum} onOpenArtist={onOpenArtist} />
}

function AlbumContent({
  session,
  album,
  songs,
  loadingSongs,
  onBack,
  onOpenArtist,
}: Nav & { album: Awaited<ReturnType<typeof getAlbum>>; songs: Track[]; loadingSongs: boolean }) {
  const favorite = useFavorite(session, album.id, album.favorite)
  const discs = [...new Set(songs.map((t) => t.discNumber ?? 1))]
  const length = totalLength(album.runtimeTicks ?? totalTicks(songs))
  return (
    <article aria-label={album.name} className="pb-10 pt-8">
      <button type="button" className="btn mb-6" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
        <Cover session={session} item={album} width={500} eager className="w-56 shrink-0 shadow-[0_24px_70px_-12px_var(--glow)] sm:w-64" />
        <Heading kind={tr('Album')} title={album.name}>
          <p className="mt-3 text-neutral-300">
            {album.artistId ? (
              <button type="button" className="font-medium text-white hover:underline" onClick={() => onOpenArtist(album.artistId as string)}>
                {album.artist}
              </button>
            ) : (
              album.artist
            )}
            {album.year ? ` · ${album.year}` : ''}
            {songs.length > 0 ? ` · ${songs.length === 1 ? t('1 song') : t('{count} songs', { count: songs.length })}` : ''}
            {length ? ` · ${length}` : ''}
          </p>
          {album.genres.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('Genres')}>
              {album.genres.map((g) => (
                <li key={g} className="chip">
                  {g}
                </li>
              ))}
            </ul>
          )}
          <PlayButtons
            tracks={songs}
            playOnId={album.id}
            radio={() => getAlbumRadio(session, album.id)}
            favorite={{ on: favorite.favorite, failed: favorite.failed, toggle: favorite.toggle, label: 'album' }}
            edit={<EditButton session={session} compact className={PENCIL} target={{ id: album.id, name: album.name, type: 'MusicAlbum' }} />}
          />
        </Heading>
      </div>

      <section aria-label={t('Songs')} className="mt-10">
        {loadingSongs && <p role="status" className="text-neutral-400">{t('Loading songs…')}</p>}
        {discs.length > 1
          ? discs.map((disc) => (
              <div key={disc} className="mb-6">
                <h2 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Disc {number}', { number: disc })}</h2>
                <TrackList
                  session={session}
                  tracks={songs.filter((t) => (t.discNumber ?? 1) === disc)}
                  numbered
                  showAlbum={false}
                />
              </div>
            ))
          : songs.length > 0 && <TrackList session={session} tracks={songs} numbered showAlbum={false} />}
      </section>
    </article>
  )
}

// ---- artist -----------------------------------------------------------------------------------------------------------

export function ArtistPage({ session, id, onBack, onOpenAlbum, onOpenArtist }: Nav & { id: string }) {
  const scope = swrScope(session)
  const artist = useSwr(swrKey(scope, 'artist', id), useCallback(() => getArtist(session, id), [session, id]), { fresh: 0 })
  const albums = useSwr(
    swrKey(scope, 'artist-albums', id),
    useCallback(() => getAlbumPage(session, { startIndex: 0, limit: 100, artistId: id, sort: 'year', withTotal: false }), [session, id]),
    { fresh: 0 },
  ).state
  const popular = useSwr(
    swrKey(scope, 'artist-popular', id),
    useCallback(() => getPopularTracks(session, { artistId: id, limit: 5 }), [session, id]),
    { fresh: 0 },
  ).state
  const all = useSwr(
    swrKey(scope, 'artist-tracks', id),
    useCallback(() => getTrackPage(session, { startIndex: 0, limit: 500, artistId: id, sort: 'album', withTotal: false }).then((p) => p.items), [session, id]),
    { fresh: 0 },
  ).state
  useReloadOnEdit(artist.retry)
  if (artist.state.status === 'loading') return <Loading onBack={onBack} label={t('Loading artist')} />
  if (artist.state.status === 'error') return <Failed what="artist" message={artist.state.message} retry={artist.retry} onBack={onBack} />
  return (
    <ArtistContent
      session={session}
      artist={artist.state.data}
      albums={albums.status === 'ready' ? albums.data.items : []}
      popular={popular.status === 'ready' ? popular.data : []}
      songs={all.status === 'ready' ? all.data : []}
      onBack={onBack}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  )
}

function ArtistContent({
  session,
  artist,
  albums,
  popular,
  songs,
  onBack,
  onOpenAlbum,
  onOpenArtist,
}: Nav & {
  artist: Awaited<ReturnType<typeof getArtist>>
  albums: Awaited<ReturnType<typeof getAlbumPage>>['items']
  popular: Track[]
  songs: Track[]
}) {
  const favorite = useFavorite(session, artist.id, artist.favorite)
  const [more, setMore] = useState(false)
  const played = popular.filter((t) => t.playCount > 0)
  const overview = artist.overview ?? ''
  return (
    <article aria-label={artist.name} className="pb-10 pt-8">
      <button type="button" className="btn mb-6" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
        <Cover session={session} item={artist} width={500} round eager className="w-44 shrink-0 shadow-[0_24px_70px_-12px_var(--glow)] sm:w-56" />
        <Heading kind={tr('Artist')} title={artist.name}>
          {artist.genres.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('Genres')}>
              {artist.genres.map((g) => (
                <li key={g} className="chip">
                  {g}
                </li>
              ))}
            </ul>
          )}
          {overview && (
            <p className={`mt-4 max-w-2xl text-sm leading-relaxed text-neutral-300 ${more ? '' : 'line-clamp-3'}`}>{overview}</p>
          )}
          {overview.length > 220 && (
            <button type="button" className="mt-1 text-sm text-[var(--color-accent)] hover:underline" onClick={() => setMore(!more)}>
              {more ? t('Show less') : t('Show more')}
            </button>
          )}
          <PlayButtons
            tracks={songs}
            radio={() => getArtistRadio(session, artist.id)}
            favorite={{ on: favorite.favorite, failed: favorite.failed, toggle: favorite.toggle, label: 'artist' }}
            edit={<EditButton session={session} compact className={PENCIL} target={{ id: artist.id, name: artist.name, type: 'MusicArtist' }} />}
          />
        </Heading>
      </div>

      {played.length > 0 && (
        <section aria-label={t('Popular songs')} className="mt-10">
          <h2 className="mb-2 text-lg font-semibold tracking-tight text-white sm:text-xl">{t('Popular')}</h2>
          <TrackList session={session} tracks={played} onOpenAlbum={onOpenAlbum} />
        </section>
      )}

      {albums.length > 0 && (
        <div className="mt-10">
          <Row title={t('Albums')}>
            {albums.map((album) => (
              <RowItem key={album.id}>
                <AlbumCard session={session} album={album} onOpen={() => onOpenAlbum(album.id)} onOpenArtist={onOpenArtist} />
              </RowItem>
            ))}
          </Row>
        </div>
      )}
    </article>
  )
}

// ---- playlist ---------------------------------------------------------------------------------------------------------

export function PlaylistPage({ session, id, onBack, onOpenAlbum }: Nav & { id: string }) {
  const playlist = useSwr(swrKey(swrScope(session), 'playlist', id), useCallback(() => getPlaylist(session, id), [session, id]), { fresh: 0 })
  const tracks = useSwr(swrKey(swrScope(session), 'playlist-tracks', id), useCallback(() => getPlaylistTracks(session, id), [session, id]), { fresh: 0 }).state
  if (playlist.state.status === 'loading') return <Loading onBack={onBack} label={t('Loading playlist')} />
  if (playlist.state.status === 'error') return <Failed what="playlist" message={playlist.state.message} retry={playlist.retry} onBack={onBack} />
  const p = playlist.state.data
  const songs = tracks.status === 'ready' ? tracks.data : []
  return (
    <article aria-label={p.name} className="pb-10 pt-8">
      <button type="button" className="btn mb-6" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
        <Cover session={session} item={{ id: p.id, imageTag: p.imageTag, albumId: songs[0]?.albumId, albumImageTag: songs[0]?.albumImageTag }} width={500} eager className="w-56 shrink-0 shadow-[0_24px_70px_-12px_var(--glow)] sm:w-64" />
        <Heading kind={tr('Playlist')} title={p.name}>
          <p className="mt-3 text-neutral-300">
            {songs.length} {songs.length === 1 ? t('song') : t('songs')}
            {songs.length > 0 ? ` · ${totalLength(totalTicks(songs))}` : ''}
          </p>
          <PlayButtons tracks={songs} playOnId={p.id} />
        </Heading>
      </div>
      <section aria-label={t('Songs')} className="mt-10">
        {tracks.status === 'loading' && <p role="status" className="text-neutral-400">{t('Loading songs…')}</p>}
        {tracks.status === 'error' && (
          <p role="alert" className="alert-error">
            {t('Could not load the songs: {message}', { message: tracks.message })}
          </p>
        )}
        {songs.length > 0 && <TrackList session={session} tracks={songs} onOpenAlbum={onOpenAlbum} />}
        {tracks.status === 'ready' && songs.length === 0 && <p className="text-neutral-400">{t('This playlist is empty.')}</p>}
      </section>
    </article>
  )
}
