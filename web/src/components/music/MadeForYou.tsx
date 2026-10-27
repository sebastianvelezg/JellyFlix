import { useCallback, useMemo, useState } from 'react'
import {
  buildMixOfTheDay,
  dayKey,
  DAY_MIX_SIZE,
  favouriteArtists,
  getArtistRadio,
  getTracksByIds,
  type Session,
  type Track,
} from '../../core'
import { clearDayMix, readDayMix, writeDayMix } from '../../platform/web/dayMix'
import { PlayIcon } from '../icons'
import { Row } from '../Row'
import { useAsync } from '../useAsync'
import { useMusic } from './MusicProvider'
import { Cover, RowItem, cardFrame } from './parts'
import { t } from '../../i18n'

/** A square of up to four covers, with a title over it and a round Play button. */
function MixTile({
  session,
  tracks,
  title,
  caption,
  busy,
  onPlay,
}: {
  session: Session
  tracks: Track[]
  title: string
  caption: string
  busy?: boolean
  onPlay: () => void
}) {
  // One cover per album, so four songs of one album do not make four of the same picture.
  const covers = useMemo(() => {
    const seen = new Set<string>()
    return tracks.filter((track) => {
      const key = track.albumId ?? track.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [tracks])
  const shown = covers.slice(0, 4)
  return (
    <div className="group relative w-full">
      <button type="button" disabled={busy} onClick={onPlay} aria-label={t('Play {name}', { name: title })} className="block w-full text-left outline-none">
        <div className={`relative aspect-square overflow-hidden rounded-xl bg-[var(--color-surface-2)] ring-1 ring-white/[.08] ${cardFrame}`}>
          {shown.length > 0 && (
            <div className={`grid h-full w-full ${shown.length >= 4 ? 'grid-cols-2 grid-rows-2' : ''}`}>
              {(shown.length >= 4 ? shown : shown.slice(0, 1)).map((track) => (
                <Cover key={track.id} session={session} item={track} width={shown.length >= 4 ? 200 : 400} className="!rounded-none !ring-0" />
              ))}
            </div>
          )}
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
          <p className="absolute inset-x-3 bottom-3 line-clamp-2 text-base font-semibold leading-tight text-white">{title}</p>
        </div>
      </button>
      <p className="mt-2.5 truncate text-xs text-neutral-500">{caption}</p>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-2 flex h-9 w-9 translate-y-1 items-center justify-center rounded-full bg-[var(--color-accent-strong)] pl-0.5 text-white opacity-0 shadow-[0_0_26px_var(--glow)] ring-1 ring-white/30 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100"
      >
        <PlayIcon />
      </span>
    </div>
  )
}

/**
 * "Made for you" on the music home: the mix of the day (the same all day, made from what you favour and play, with songs
 * that go with them) and the radio of the artists you come back to most.
 */
export function MadeForYou({ session, libraryId, favorites, recent }: { session: Session; libraryId?: string; favorites: Track[]; recent: Track[] }) {
  const music = useMusic()
  const day = dayKey(new Date())
  const owner = session.userId
  const [making, setMaking] = useState(false)

  const load = useCallback(async () => {
    const remembered = readDayMix(day, owner)
    if (remembered) {
      const tracks = await getTracksByIds(session, remembered)
      // Songs may have been removed since this morning; a mix that has lost most of itself is made again.
      if (tracks.length >= Math.min(10, remembered.length)) return tracks
    }
    const tracks = await buildMixOfTheDay(session, libraryId, `${day}:${owner}`)
    if (tracks.length > 0) writeDayMix({ day, owner, ids: tracks.map((track) => track.id) })
    return tracks
  }, [session, libraryId, day, owner])
  const { state, retry } = useAsync(load)

  const radios = useMemo(() => {
    const names = new Map<string, string>()
    for (const track of [...recent, ...favorites]) if (track.artistId && !names.has(track.artistId)) names.set(track.artistId, track.artist)
    return favouriteArtists(favorites, recent, 2, `${day}:${owner}`).map((id) => ({ id, name: names.get(id) ?? '' })).filter((a) => a.name)
  }, [favorites, recent, day, owner])

  if (state.status !== 'ready' || state.data.length === 0) return null
  const mix = state.data

  const startRadio = (artistId: string) => {
    setMaking(true)
    getArtistRadio(session, artistId)
      .then((tracks) => music.play(tracks, 0))
      .catch(() => undefined)
      .finally(() => setMaking(false))
  }

  return (
    <Row
      title={t('Made for you')}
      action={
        <button
          type="button"
          className="text-[var(--color-accent)] hover:underline"
          onClick={() => {
            clearDayMix()
            retry()
          }}
        >
          {t('Make another mix')}
        </button>
      }
    >
      <RowItem>
        <MixTile
          session={session}
          tracks={mix}
          title={t('Mix of the day')}
          caption={mix.length === 1 ? t('1 song') : t('{count} songs', { count: Math.min(mix.length, DAY_MIX_SIZE) })}
          onPlay={() => music.play(mix, 0)}
        />
      </RowItem>
      {radios.map((artist) => (
        <RowItem key={artist.id}>
          <MixTile
            session={session}
            tracks={[...recent, ...favorites].filter((track) => track.artistId === artist.id)}
            title={t('{artist} radio', { artist: artist.name })}
            caption={t('Songs that go with {artist}', { artist: artist.name })}
            busy={making}
            onPlay={() => startRadio(artist.id)}
          />
        </RowItem>
      ))}
    </Row>
  )
}
