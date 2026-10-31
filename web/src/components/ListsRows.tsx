import { useCallback } from 'react'
import { findWatchLater, getPlaylistEntries, getVideoPlaylists, isEpisode, isWatchLater, type Movie, type Session } from '../core'
import { t } from '../i18n'
import { ListCard } from './ListCard'
import { RowCard } from './MovieCard'
import { usePlaylistsVersion } from './playlistEvents'
import { Row } from './Row'
import { swrKey, swrScope, useSwr } from './useSwr'

/** What you put aside to watch later, as a row (nothing at all while it is empty). */
export function WatchLaterRow({
  session,
  overrides,
  onOpenMovie,
  onOpenSeries,
  onSeeAll,
}: {
  session: Session
  overrides: Record<string, Movie>
  onOpenMovie: (movie: Movie) => void
  onOpenSeries: (seriesId: string) => void
  onSeeAll: (id: string) => void
}) {
  const version = usePlaylistsVersion()
  // `version` is part of the callback so the row is read again after a change (what is held is shown at once, but never trusted).
  const load = useCallback(async () => {
    const list = findWatchLater(await getVideoPlaylists(session))
    return { version, list: list ?? null, entries: list ? await getPlaylistEntries(session, list.id) : [] }
  }, [session, version])
  const { state } = useSwr(swrKey(swrScope(session), 'home', 'watch-later'), load, { fresh: 0 })
  if (state.status !== 'ready' || !state.data.list || state.data.entries.length === 0) return null
  const { list, entries } = state.data
  return (
    <Row
      title={t('Watch later')}
      action={
        <button type="button" className="text-[var(--color-accent)] hover:underline" onClick={() => onSeeAll(list.id)} aria-label={t('See all in {label}', { label: t('Watch later') })}>
          {t('See all')}
        </button>
      }
    >
      {entries.slice(0, 24).map((entry) => {
        const item = overrides[entry.item.id] ?? entry.item
        return <RowCard key={entry.entryId} session={session} movie={item} onOpen={(m) => (isEpisode(m) ? onOpenSeries(m.seriesId) : onOpenMovie(m))} />
      })}
    </Row>
  )
}

/** Your playlists, as a row; with none, a prompt to make the first. */
export function PlaylistsRow({
  session,
  onOpen,
  onSeeAll,
}: {
  session: Session
  onOpen: (id: string) => void
  onSeeAll: () => void
}) {
  const version = usePlaylistsVersion()
  const load = useCallback(async () => ({ version, lists: await getVideoPlaylists(session) }), [session, version])
  const { state } = useSwr(swrKey(swrScope(session), 'home', 'playlists'), load, { fresh: 0 })
  if (state.status !== 'ready') return null
  // "Watch later" has its own row.
  const lists = state.data.lists.filter((l) => !isWatchLater(l))
  const all = (
    <button type="button" className="text-[var(--color-accent)] hover:underline" onClick={onSeeAll} aria-label={t('See all in {label}', { label: t('Playlists') })}>
      {t('See all')}
    </button>
  )
  if (lists.length === 0) {
    return (
      <section aria-label={t('Your playlists')} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-dashed border-white/15 px-5 py-4">
        <h2 className="text-base font-semibold text-white">{t('Your playlists')}</h2>
        <p className="text-sm text-neutral-400">{t('Keep movies together: weekend picks, a saga, what to watch with friends.')}</p>
        <button type="button" className="btn ml-auto" onClick={onSeeAll}>
          {t('Make a playlist')}
        </button>
      </section>
    )
  }
  return (
    <Row title={t('Your playlists')} action={all}>
      {lists.slice(0, 16).map((list) => (
        <div key={list.id} className="w-[var(--poster-w)] shrink-0 snap-start">
          <ListCard session={session} list={list} onOpen={onOpen} />
        </div>
      ))}
    </Row>
  )
}
