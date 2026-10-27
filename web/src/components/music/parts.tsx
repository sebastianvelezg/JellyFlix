import { useState, type ReactNode } from 'react'
import {
  coverUrl,
  currentTrack,
  formatRuntime,
  formatTime,
  getAlbumTracks,
  getSongRadio,
  setFavorite,
  ticksToSeconds,
  type Album,
  type Artist,
  type Playlist,
  type Session,
  type Track,
} from '../../core'
import { HeartIcon, MusicIcon, PlayIcon, PlusIcon, RadioIcon } from '../icons'
import { Img } from '../Img'
import { Subtext } from '../Subtext'
import { useMusic, useMusicState } from './MusicProvider'
import { t } from '../../i18n'

/** A heart that flips at once and is put back (with `failed` set) if the server refuses. */
export function useFavorite(session: Session, id: string, initial: boolean) {
  const [favorite, setFav] = useState(initial)
  const [failed, setFailed] = useState(false)
  function toggle() {
    const next = !favorite
    setFav(next)
    setFailed(false)
    setFavorite(session, id, next).catch(() => {
      setFav(!next)
      setFailed(true)
    })
  }
  return { favorite, failed, toggle }
}

/** "3:45" for a song length given in ticks. */
export function songLength(ticks?: number): string {
  return ticks ? formatTime(ticksToSeconds(ticks)) : ''
}

/** "42 min" / "1h 5m" for an album or playlist. */
export function totalLength(ticks?: number): string {
  return ticks ? formatRuntime(ticksToSeconds(ticks)) : ''
}

/** A square cover; a tile with a music note when there is no picture. */
export function Cover({
  session,
  item,
  width = 300,
  round = false,
  className = '',
  eager = false,
}: {
  session: Session
  item: { id: string; imageTag?: string; albumId?: string; albumImageTag?: string }
  width?: number
  round?: boolean
  className?: string
  eager?: boolean
}) {
  return (
    <div
      className={`relative aspect-square overflow-hidden bg-[var(--color-surface-2)] ring-1 ring-white/[.08] ${round ? 'rounded-full' : 'rounded-xl'} ${className}`}
    >
      <Img
        session={session}
        src={coverUrl(session.serverUrl, item, width)}
        eager={eager}
        className="h-full w-full object-cover"
        fallback={
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-surface-3)] to-[var(--color-surface)] text-neutral-600">
            <MusicIcon />
          </div>
        }
      />
    </div>
  )
}

/** Three little bars that dance while a song plays. */
export function PlayingBars({ playing }: { playing: boolean }) {
  return (
    <span aria-hidden="true" className="flex h-4 items-end gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-[3px] origin-bottom rounded-full bg-[var(--color-accent)] ${playing ? 'eq-bar' : 'h-1.5'}`}
          style={playing ? { animationDelay: `${i * 0.18}s` } : undefined}
        />
      ))}
    </span>
  )
}

export const cardFrame =
  'relative transition duration-300 ease-out group-hover:scale-[1.03] group-hover:shadow-[0_14px_44px_-10px_var(--glow)] group-hover:ring-[var(--color-accent)]/70 group-focus-within:ring-[var(--color-accent)]/70'

/** An album: click opens it, the round button plays it. */
export function AlbumCard({
  session,
  album,
  onOpen,
  onOpenArtist,
}: {
  session: Session
  album: Pick<Album, 'id' | 'name' | 'artist' | 'artistId' | 'year' | 'imageTag'>
  onOpen: (album: { id: string }) => void
  onOpenArtist?: (artistId: string) => void
}) {
  const music = useMusic()
  const [busy, setBusy] = useState(false)
  async function play(shuffle: boolean) {
    setBusy(true)
    try {
      const tracks = await getAlbumTracks(session, album.id)
      music.play(tracks, 0, { shuffle })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="group relative w-full">
      <button type="button" onClick={() => onOpen(album)} aria-label={t('Open album {name}', { name: album.name })} className="block w-full text-left outline-none">
        <Cover session={session} item={album} className={cardFrame} />
        <p className="mt-2.5 truncate text-sm font-medium text-neutral-100">{album.name}</p>
      </button>
      <p className="truncate text-xs text-neutral-500">
        {onOpenArtist && album.artistId ? (
          <button type="button" className="hover:text-white hover:underline" onClick={() => onOpenArtist(album.artistId as string)}>
            {album.artist}
          </button>
        ) : (
          album.artist
        )}
        {album.year ? ` · ${album.year}` : ''}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void play(false)}
        aria-label={t('Play album {name}', { name: album.name })}
        title={t('Play')}
        className="absolute bottom-[3.6rem] right-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-[var(--color-accent-strong)] pl-0.5 text-white opacity-0 shadow-[0_0_26px_var(--glow)] ring-1 ring-white/30 transition duration-200 hover:scale-110 focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 disabled:opacity-60"
      >
        <PlayIcon />
      </button>
    </div>
  )
}

export function ArtistCard({ session, artist, onOpen }: { session: Session; artist: Artist; onOpen: (artist: { id: string }) => void }) {
  return (
    <button type="button" onClick={() => onOpen(artist)} aria-label={t('Open artist {name}', { name: artist.name })} className="group block w-full text-center outline-none">
      <Cover session={session} item={artist} round className={`mx-auto w-full ${cardFrame}`} />
      <p className="mt-3 truncate text-sm font-medium text-neutral-100">{artist.name}</p>
      <Subtext as="p" className="block text-xs text-neutral-500" text={t('Artist')} />
    </button>
  )
}

export function PlaylistCard({ session, playlist, onOpen }: { session: Session; playlist: Playlist; onOpen: (playlist: { id: string }) => void }) {
  return (
    <button type="button" onClick={() => onOpen(playlist)} aria-label={t('Open playlist {name}', { name: playlist.name })} className="group block w-full text-left outline-none">
      <Cover session={session} item={playlist} className={cardFrame} />
      <p className="mt-2.5 truncate text-sm font-medium text-neutral-100">{playlist.name}</p>
      <Subtext
        as="p"
        className="block text-xs text-neutral-500"
        text={playlist.trackCount == null ? t('Playlist') : playlist.trackCount === 1 ? t('Playlist · 1 song') : t('Playlist · {count} songs', { count: playlist.trackCount })}
      />
    </button>
  )
}

export function AlbumCardSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton aspect-square w-full" />
      <div className="skeleton mt-2.5 h-3.5 w-3/4 !rounded-md" />
      <div className="skeleton mt-1.5 h-3 w-1/2 !rounded-md" />
    </div>
  )
}

/** A card sized for a horizontal row. */
export function RowItem({ children }: { children: ReactNode }) {
  return <div className="w-[var(--poster-w)] shrink-0 snap-start">{children}</div>
}

// ---- songs ----------------------------------------------------------------------------------------------------------

/**
 * One song in a list. Pressing it plays it (`onPlay` decides what is queued after it); the row can also add the
 * song after the current one ("play next"), to the end of the queue, or mark it as a favourite.
 */
export function TrackItem({
  session,
  track,
  number,
  showCover = true,
  showAlbum = true,
  onPlay,
  onOpenAlbum,
}: {
  session: Session
  track: Track
  /** Show this number instead of a cover (album pages). */
  number?: number
  showCover?: boolean
  showAlbum?: boolean
  onPlay: () => void
  onOpenAlbum?: (albumId: string) => void
}) {
  const music = useMusic()
  const { queue, status } = useMusicState()
  const playingId = queue ? currentTrack(queue)?.id : undefined
  return (
    <TrackRow
      session={session}
      track={track}
      number={number}
      showCover={showCover && number == null}
      showAlbum={showAlbum}
      isCurrent={playingId === track.id}
      isPlaying={playingId === track.id && status === 'playing'}
      onPlay={onPlay}
      onPlayNext={() => music.playNext([track])}
      onEnqueue={() => music.enqueue([track])}
      onRadio={() => {
        // This song first, then songs that go with it.
        getSongRadio(session, track.id)
          .then((more) => music.play([track, ...more.filter((m) => m.id !== track.id)], 0))
          .catch(() => undefined)
      }}
      onOpenAlbum={onOpenAlbum}
    />
  )
}

/** A list of songs; pressing one plays it and queues the rest of the list after it. */
export function TrackList({
  session,
  tracks,
  showAlbum = true,
  showCover = true,
  numbered = false,
  onOpenAlbum,
}: {
  session: Session
  tracks: Track[]
  showAlbum?: boolean
  showCover?: boolean
  /** Show the track number instead of a cover (album pages). */
  numbered?: boolean
  onOpenAlbum?: (albumId: string) => void
}) {
  const music = useMusic()
  return (
    <ul className="divide-y divide-white/[.05]">
      {tracks.map((track, i) => (
        <li key={`${track.id}-${i}`}>
          <TrackItem
            session={session}
            track={track}
            number={numbered ? (track.trackNumber ?? i + 1) : undefined}
            showCover={showCover}
            showAlbum={showAlbum}
            onPlay={() => music.play(tracks, i)}
            onOpenAlbum={onOpenAlbum}
          />
        </li>
      ))}
    </ul>
  )
}

function TrackRow({
  session,
  track,
  number,
  showCover,
  showAlbum,
  isCurrent,
  isPlaying,
  onPlay,
  onPlayNext,
  onEnqueue,
  onRadio,
  onOpenAlbum,
}: {
  session: Session
  track: Track
  number?: number
  showCover: boolean
  showAlbum: boolean
  isCurrent: boolean
  isPlaying: boolean
  onPlay: () => void
  onPlayNext: () => void
  onEnqueue: () => void
  onRadio: () => void
  onOpenAlbum?: (albumId: string) => void
}) {
  const { favorite, failed, toggle: toggleFavorite } = useFavorite(session, track.id, track.favorite)
  const label = t('{title} by {artist}', { title: track.name, artist: track.artist })
  return (
    <div
      className={`group flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-white/[.05] focus-within:bg-white/[.05] ${isCurrent ? 'bg-[var(--color-accent)]/[.08]' : ''}`}
      data-current={isCurrent ? 'true' : undefined}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={t('Play {label}', { label })}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] pointer-coarse:py-1.5"
      >
        <span className="flex w-8 shrink-0 items-center justify-center text-sm tabular-nums text-neutral-500">
          {isCurrent ? (
            <PlayingBars playing={isPlaying} />
          ) : (
            <>
              <Subtext className={number != null ? 'group-hover:hidden group-focus-within:hidden' : 'hidden'} text={number} />
              <span
                className={`${number != null ? 'hidden group-hover:inline group-focus-within:inline' : 'hidden'} text-white`}
              >
                <PlayIcon />
              </span>
            </>
          )}
        </span>
        {showCover && <Cover session={session} item={track} width={96} className="w-11 shrink-0 !rounded-lg" />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${isCurrent ? 'text-[var(--color-accent)]' : 'text-neutral-100'}`}>{track.name}</span>
          <Subtext className="block truncate text-xs text-neutral-500" text={track.artist} />
        </span>
      </button>
      {showAlbum && track.album && (
        <span className="hidden w-1/4 min-w-0 truncate text-sm text-neutral-400 md:block">
          {onOpenAlbum && track.albumId ? (
            <button type="button" className="max-w-full truncate hover:text-white hover:underline" onClick={() => onOpenAlbum(track.albumId as string)}>
              {track.album}
            </button>
          ) : (
            track.album
          )}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <IconAction label={t('Play {name} next', { name: track.name })} onClick={onPlayNext}>
          <PlayNextIcon />
        </IconAction>
        <IconAction label={t('Add {name} to the queue', { name: track.name })} onClick={onEnqueue}>
          <PlusIcon />
        </IconAction>
        <IconAction label={t('Start a radio from {name}', { name: track.name })} onClick={onRadio}>
          <RadioIcon />
        </IconAction>
      </span>
      <button
        type="button"
        onClick={toggleFavorite}
        aria-pressed={favorite}
        aria-label={t(favorite ? 'Remove from favorites: {title}' : 'Add to favorites: {title}', { title: track.name })}
        title={failed ? t('Could not update this favorite') : favorite ? t('Favorite') : t('Add to favorites')}
        className={`shrink-0 rounded-full p-1.5 transition pointer-coarse:p-3 ${favorite ? 'text-rose-400' : 'text-neutral-500 hover:text-white'} ${favorite ? '' : 'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'}`}
      >
        <HeartIcon filled={favorite} />
      </button>
      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-neutral-500">{songLength(track.runtimeTicks)}</span>
    </div>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-full p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white pointer-coarse:p-3"
    >
      {children}
    </button>
  )
}

function PlayNextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 6h10M3 12h7M3 18h7" />
      <path d="m14 11 7 4-7 4z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SongsSkeleton() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 px-2 py-1.5">
      <div className="skeleton h-11 w-11 !rounded-lg" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3.5 w-1/3 !rounded-md" />
        <div className="skeleton h-3 w-1/5 !rounded-md" />
      </div>
    </div>
  )
}
