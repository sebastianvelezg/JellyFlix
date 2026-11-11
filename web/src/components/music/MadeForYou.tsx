import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildLibraryMixes,
  buildMixOfTheDay,
  dayKey,
  DAY_MIX_SIZE,
  favouriteArtists,
  favoritesMix,
  getArtistRadio,
  getFavoriteTracks,
  getTracksByIds,
  type MixSpec,
  type Session,
  type Track,
} from '../../core'
import { clearDayMix, readDayMix, writeDayMix } from '../../platform/web/dayMix'
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from '../icons'
import { useAsync } from '../useAsync'
import { useMusic } from './MusicProvider'
import { Cover, cardFrame } from './parts'
import { Shelf, ShelfItem } from '../Shelf'
import { t } from '../../i18n'

/** How long each mix stays up in the big card before it moves on. */
const ROTATE_SECONDS = 6
/** How many artists get a radio. */
const RADIO_ARTISTS = 4

/** One cover per album, so four songs of one album do not make four of the same picture. */
function uniqueCovers(tracks: Track[]): Track[] {
  const seen = new Set<string>()
  return tracks.filter((track) => {
    const key = track.albumId ?? track.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A mix made for the person: some songs to show its covers (all of them for the mix of the day) and how to get the songs to play. */
export interface Mix {
  key: string
  kind: 'day' | 'favorites' | 'artist' | MixSpec['kind']
  /** The artist, genre or decade it is made from (empty for the others). */
  label: string
  tracks: Track[]
  play: () => Promise<Track[]> | Track[]
}

export interface Mixes {
  /** The mix of the day first, then the others. */
  list: Mix[]
  /** A mix is being got to play. */
  making: boolean
  play: (mix: Mix) => void
  /** Make the mix of the day again. */
  remake: () => void
}

/** The short name of a mix (the side column, the shelf). */
export function mixTitle(mix: Mix): string {
  switch (mix.kind) {
    case 'day':
      return t('Mix of the day')
    case 'favorites':
      return t('Favorites mix')
    case 'artist':
      return t('{artist} radio', { artist: mix.label })
    case 'surprise':
      return t('Surprise mix')
    case 'genre':
      return t('{genre} mix', { genre: mix.label })
    case 'decade':
      return t('{decade} mix', { decade: mix.label })
  }
}

/** What kind of mix it is, in a few words. */
export function mixCaption(mix: Mix): string {
  switch (mix.kind) {
    case 'day':
      return t('From your library')
    case 'favorites':
      return t('Mixed up every day')
    case 'artist':
      return t('Artist mix')
    case 'surprise':
      return t('Something new')
    case 'genre':
      return t('Genre mix')
    case 'decade':
      return t('Decade mix')
  }
}

/**
 * The mixes made for the person, ten or more: the mix of the day (the same all day, made from what you favour and play, with songs
 * that go with them), your favourites in a new order each day, the radio of the artists you come back to most, a surprise, a few
 * genres and the decades the library has. `null` until there is a mix of the day. One place makes them, and the big card, the side
 * column and the shelf on a small screen all show them.
 */
export function useMadeForYou(session: Session, libraryId: string | undefined, favorites: Track[], recent: Track[]): Mixes | null {
  const music = useMusic()
  const day = dayKey(new Date())
  const owner = session.userId
  const seed = `${day}:${owner}`
  const [making, setMaking] = useState(false)

  const load = useCallback(async () => {
    const remembered = readDayMix(day, owner)
    if (remembered) {
      const tracks = await getTracksByIds(session, remembered)
      // Songs may have been removed since this morning; a mix that has lost most of itself is made again.
      if (tracks.length >= Math.min(10, remembered.length)) return tracks
    }
    const tracks = await buildMixOfTheDay(session, libraryId, seed)
    if (tracks.length > 0) writeDayMix({ day, owner, ids: tracks.map((track) => track.id) })
    return tracks
  }, [session, libraryId, day, owner, seed])
  const { state, retry } = useAsync(load)
  const library = useAsync(useCallback(() => buildLibraryMixes(session, libraryId, seed), [session, libraryId, seed])).state

  const radios = useMemo(() => {
    const names = new Map<string, string>()
    for (const track of [...recent, ...favorites]) if (track.artistId && !names.has(track.artistId)) names.set(track.artistId, track.artist)
    return favouriteArtists(favorites, recent, RADIO_ARTISTS, seed)
      .map((id) => ({ id, name: names.get(id) ?? '', tracks: [...recent, ...favorites].filter((track) => track.artistId === id) }))
      .filter((a) => a.name)
  }, [favorites, recent, seed])

  if (state.status !== 'ready' || state.data.length === 0) return null
  const mix = state.data
  const list: Mix[] = [
    { key: 'day', kind: 'day', label: '', tracks: mix, play: () => mix },
    ...(favorites.length >= 3
      ? [{ key: 'favorites', kind: 'favorites' as const, label: '', tracks: favorites, play: () => getFavoriteTracks(session, libraryId, 100).then((all) => favoritesMix(all, seed)) }]
      : []),
    ...radios.map((radio) => ({ key: `artist:${radio.id}`, kind: 'artist' as const, label: radio.name, tracks: radio.tracks, play: () => getArtistRadio(session, radio.id) })),
    ...(library.status === 'ready' ? library.data.map((spec) => ({ key: `${spec.kind}:${spec.label}`, ...spec })) : []),
  ]
  return {
    list,
    making,
    play: (picked) => {
      setMaking(true)
      Promise.resolve(picked.play())
        .then((tracks) => tracks.length > 0 && music.play(tracks, 0))
        .catch(() => undefined)
        .finally(() => setMaking(false))
    },
    remake: () => {
      clearDayMix()
      retry()
    },
  }
}

const mixCount = (mix: Track[]) => (mix.length === 1 ? t('1 song') : t('{count} songs', { count: Math.min(mix.length, DAY_MIX_SIZE) }))

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The big card at the top of the music home. It shows the mixes one after another (the mix of the day first), each with a few of its
 * covers laid out like a pile of records, moving on every few seconds; it stays while you hover or focus it (or the tab is hidden),
 * and the dots go to a mix directly. With reduced motion it stays put.
 */
export function MixHero({ session, mixes }: { session: Session; mixes: Mixes }) {
  const [chosen, setChosen] = useState(0)
  const [hovering, setHovering] = useState(false)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [reduced] = useState(prefersReducedMotion)
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const count = mixes.list.length
  const index = Math.min(chosen, count - 1)
  const mix = mixes.list[index] as Mix
  const go = (to: number) => setChosen(((to % count) + count) % count)
  const moving = !reduced && count > 1
  const paused = hovering || hidden

  const isDay = mix.kind === 'day'
  const covers = uniqueCovers(mix.tracks).slice(0, 4)
  const names = [...new Set(mix.tracks.map((track) => track.artist).filter(Boolean))].slice(0, 3).join(', ')
  const spots = ['left-0 top-9 w-32 -rotate-6', 'left-24 top-0 z-10 w-36 rotate-3', 'left-3 top-32 w-28 rotate-6', 'left-28 top-28 z-20 w-32 -rotate-3']
  return (
    <section
      aria-label={t('Your mixes')}
      aria-roledescription="carousel"
      className="@container relative isolate overflow-hidden rounded-3xl border border-white/10"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(90% 150% at 100% 0%, color-mix(in srgb, var(--color-accent) 34%, transparent), transparent 62%), linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 22%, #0b0b11), #0b0b11 70%)',
        }}
      />
      <div
        key={mix.key}
        role="group"
        aria-roledescription="slide"
        aria-label={count > 1 ? t('{number} of {count}', { number: index + 1, count }) : undefined}
        className="hero-slide flex min-h-[17rem] items-center justify-between gap-6 p-6 pb-12 sm:p-8 sm:pb-12"
      >
        <div className="min-w-0 max-w-[22rem]">
          <h2 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl">{isDay ? t('Your mix of the day') : mixTitle(mix)}</h2>
          {names && <p className="mt-4 text-sm leading-relaxed text-neutral-300">{t('{artists} and more from your library.', { artists: names })}</p>}
          <p className="mt-1 text-xs text-neutral-400">{isDay ? mixCount(mix.tracks) : mixCaption(mix)}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary px-6 py-2.5" disabled={mixes.making} onClick={() => mixes.play(mix)}>
              <PlayIcon /> {t('Play mix')}
            </button>
            {isDay && (
              <button
                type="button"
                className="rounded-full px-3 py-2 text-sm font-medium text-neutral-300 transition hover:bg-white/10 hover:text-white pointer-coarse:py-3 lg:hidden"
                onClick={mixes.remake}
              >
                {t('Make another mix')}
              </button>
            )}
          </div>
        </div>
        <div aria-hidden="true" className="relative hidden h-64 w-64 shrink-0 @2xl:block">
          {covers.map((track, i) => (
            <div key={track.id} className={`absolute ${spots[i]}`}>
              <Cover session={session} item={track} width={300} className="!rounded-lg shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)]" />
            </div>
          ))}
        </div>
      </div>

      {count > 1 && (
        <>
          <div role="group" aria-label={t('Choose a mix')} className="absolute bottom-3 left-6 z-10 flex max-w-[calc(100%-8rem)] flex-wrap items-center gap-x-1.5 sm:left-8">
            {mixes.list.map((item, i) => (
              <button
                key={item.key}
                type="button"
                aria-label={t('Show {name}', { name: mixTitle(item) })}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => go(i)}
                className="group/dot flex h-6 items-center pointer-coarse:h-11 pointer-coarse:px-1"
              >
                <span className={`relative block h-1 overflow-hidden rounded-full bg-white/25 transition-all duration-300 group-hover/dot:bg-white/45 ${i === index ? 'w-10' : 'w-4'}`}>
                  {i === index && (
                    <span
                      key={mix.key}
                      className={`absolute inset-y-0 left-0 block rounded-full bg-[var(--color-accent)] ${moving ? 'hero-progress' : 'w-full'}`}
                      style={moving ? { animationDuration: `${ROTATE_SECONDS}s`, animationPlayState: paused ? 'paused' : 'running' } : undefined}
                      onAnimationEnd={moving ? () => go(index + 1) : undefined}
                    />
                  )}
                </span>
              </button>
            ))}
          </div>
          <div className="absolute bottom-2.5 right-4 z-10 hidden gap-1.5 sm:flex">
            <button
              type="button"
              aria-label={t('Previous mix')}
              onClick={() => go(index - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/30 text-neutral-300 transition hover:bg-white/15 hover:text-white"
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              aria-label={t('Next mix')}
              onClick={() => go(index + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/30 text-neutral-300 transition hover:bg-white/15 hover:text-white"
            >
              <ChevronRightIcon />
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** A short list of what was played last, each one a button that plays it (and what comes after it). */
export function ContinuePanel({ session, tracks }: { session: Session; tracks: Track[] }) {
  const music = useMusic()
  const list = useMemo(() => {
    const seen = new Set<string>()
    return tracks.filter((track) => (seen.has(track.id) ? false : (seen.add(track.id), true))).slice(0, 4)
  }, [tracks])
  if (list.length === 0) return null
  return (
    <section aria-label={t('Pick up where you left off')} className="min-w-0">
      <h2 className="mb-3 text-lg font-bold tracking-tight text-white">{t('Pick up where you left off')}</h2>
      <ul className="space-y-1">
        {list.map((track, i) => (
          <li key={track.id}>
            <button
              type="button"
              onClick={() => music.play(list, i)}
              aria-label={t('Play {label}', { label: t('{title} by {artist}', { title: track.name, artist: track.artist }) })}
              className="group flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-white/[.06] focus-visible:bg-white/[.06] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            >
              <Cover session={session} item={track} width={96} className="w-12 shrink-0 !rounded-lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-neutral-100">{track.name}</span>
                <span className="block truncate text-xs text-neutral-400">{track.artist}</span>
              </span>
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition group-hover:bg-white group-hover:text-black">
                <PlayIcon />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** "Your mixes" in the side column: each mix with a small cover; pressing one plays it. */
export function MixList({ session, mixes }: { session: Session; mixes: Mixes }) {
  return (
    <section aria-label={t('Made for you')} className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center gap-2 px-3">
        <h2 className="text-xs font-semibold text-neutral-400">{t('Your mixes')}</h2>
        <button type="button" onClick={mixes.remake} className="ml-auto text-[11px] font-medium text-[var(--color-accent)] hover:underline">
          {t('Make another mix')}
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
        {mixes.list.map((mix) => {
          const cover = uniqueCovers(mix.tracks)[0]
          return (
            <li key={mix.key}>
              <button
                type="button"
                disabled={mixes.making}
                onClick={() => mixes.play(mix)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/[.06] focus-visible:bg-white/[.06] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-60"
              >
                <span className="sr-only">{t('Play')} </span>
                {cover ? <Cover session={session} item={cover} width={96} className="w-9 shrink-0 !rounded-md" /> : <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-md bg-white/10" />}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-neutral-100">{mixTitle(mix)}</span>
                  <span className="block truncate text-[11px] text-neutral-500">{mixCaption(mix)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A square of up to four covers, with a title over it (the mixes of a small screen, where there is no side column). */
function MixTile({ session, tracks, title, caption, busy, onPlay }: { session: Session; tracks: Track[]; title: string; caption: string; busy?: boolean; onPlay: () => void }) {
  const shown = useMemo(() => uniqueCovers(tracks).slice(0, 4), [tracks])
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
    </div>
  )
}

/** The mixes as a shelf, for a window too narrow for the side column. */
export function MixesShelf({ session, mixes }: { session: Session; mixes: Mixes }) {
  const others = mixes.list.slice(1)
  if (others.length === 0) return null
  return (
    <div className="lg:hidden">
      <Shelf title={t('Made for you')}>
        {others.map((mix) => (
          <ShelfItem key={mix.key}>
            <MixTile session={session} tracks={mix.tracks} title={mixTitle(mix)} caption={mixCaption(mix)} busy={mixes.making} onPlay={() => mixes.play(mix)} />
          </ShelfItem>
        ))}
      </Shelf>
    </div>
  )
}
