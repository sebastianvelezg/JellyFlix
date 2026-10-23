import { useCallback, useEffect, useState } from 'react'
import {
  addToPlaylist,
  createVideoPlaylist,
  deletePlaylist,
  episodeCode,
  getPlaylistEntries,
  getVideoPlaylist,
  getVideoPlaylists,
  isEpisode,
  isWatchLater,
  moveInPlaylist,
  posterUrl,
  removeFromPlaylist,
  renamePlaylist,
  reorder,
  targetIndex,
  wideImageUrl,
  type Movie,
  type PlaylistEntry,
  type Session,
  type VideoPlaylist,
} from '../core'
import { t } from '../i18n'
import { BackIcon, PlayIcon, PlusIcon } from './icons'
import { Img } from './Img'
import { frame } from './MovieCard'
import { StateMessage } from './StateMessage'
import { Subtext } from './Subtext'
import { notifyPlaylistsChanged } from './playlistEvents'
import { showToast } from './toast'
import { errorText, useAsync } from './useAsync'

const countText = (n: number | undefined) => (n == null ? '' : n === 1 ? t('1 title') : t('{count} titles', { count: n }))
const shownName = (list: Pick<VideoPlaylist, 'name'>) => (isWatchLater(list) ? t('Watch later') : list.name)

/** A poster for a playlist (the server makes one from its first titles), or its name on a plain tile. */
export function ListCard({ session, list, onOpen }: { session: Session; list: VideoPlaylist; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(list.id)}
      className="group block w-full text-left outline-none"
      aria-label={t('Open playlist {name}', { name: shownName(list) })}
    >
      <div className={`aspect-[2/3] ${frame}`}>
        <Img
          session={session}
          src={posterUrl(session.serverUrl, list)}
          className="h-full w-full object-cover"
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-surface-3)] to-[var(--color-surface)] p-3 text-center text-sm font-medium text-neutral-500">
              {shownName(list)}
            </div>
          }
        />
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-neutral-100 transition group-hover:text-white">{shownName(list)}</p>
      <Subtext as="p" className="block min-h-4 text-xs text-neutral-500" text={countText(list.itemCount)} />
    </button>
  )
}

/** All your playlists of movies and episodes, and a box to make a new one. */
export function ListsPage({ session, onOpen, onBack }: { session: Session; onOpen: (id: string) => void; onBack: () => void }) {
  const load = useCallback(() => getVideoPlaylists(session), [session])
  const { state, retry } = useAsync(load)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const id = await createVideoPlaylist(session, name)
      notifyPlaylistsChanged()
      setName('')
      onOpen(id)
    } catch (e) {
      setError(t(e instanceof Error ? e.message : 'Something went wrong.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-8">
      <button type="button" className="btn mb-5" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      <h1 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">{t('Playlists')}</h1>

      <form
        className="mb-8 flex max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void create()
        }}
      >
        <label htmlFor="new-list" className="sr-only">
          {t('New playlist name')}
        </label>
        <input id="new-list" className="field" placeholder={t('New playlist')} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn-primary shrink-0" disabled={busy || !name.trim()}>
          <PlusIcon /> {t('Create')}
        </button>
      </form>
      {error && (
        <p role="alert" className="alert-error mb-6 max-w-lg">
          {error}
        </p>
      )}

      {state.status === 'loading' && <p role="status" className="text-neutral-400">{t('Loading your playlists…')}</p>}
      {state.status === 'error' && (
        <StateMessage kind="error" size="section" message={t('Could not load your playlists: {message}', { message: state.message })}>
          <button type="button" className="btn" onClick={retry}>
            {t('Try again')}
          </button>
        </StateMessage>
      )}
      {state.status === 'ready' && state.data.length === 0 && (
        <StateMessage kind="empty" size="section" message={t('You have no playlists yet. Make the first one above, or use the ⋯ menu of any movie.')} />
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul aria-label={t('Playlists')} className="poster-grid">
          {[...state.data].sort((a, b) => Number(isWatchLater(b)) - Number(isWatchLater(a))).map((list) => (
            <li key={list.id}>
              <ListCard session={session} list={list} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; list: VideoPlaylist; entries: PlaylistEntry[] }

/** One playlist: its titles in order, with play, details, move and remove, and rename and delete for the playlist. */
export function ListPage({
  session,
  id,
  overrides,
  onPlay,
  onOpenMovie,
  onOpenSeries,
  onBack,
}: {
  session: Session
  id: string
  overrides: Record<string, Movie>
  onPlay: (item: Movie) => void
  onOpenMovie: (movie: Movie) => void
  onOpenSeries: (seriesId: string) => void
  onBack: () => void
}) {
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getVideoPlaylist(session, id), getPlaylistEntries(session, id)])
      .then(([list, entries]) => !cancelled && setState({ status: 'ready', list, entries }))
      .catch((e: unknown) => !cancelled && setState({ status: 'error', message: errorText(e) }))
    return () => {
      cancelled = true
    }
  }, [session, id, attempt])

  if (state.status === 'loading') return <p role="status" className="py-24 text-center text-neutral-400">{t('Loading your playlists…')}</p>
  if (state.status === 'error') {
    return (
      <StateMessage kind="error" message={t('Could not load this playlist: {message}', { message: state.message })}>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
          {t('Try again')}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          {t('Back')}
        </button>
      </StateMessage>
    )
  }

  const { list, entries } = state
  const setEntries = (next: PlaylistEntry[]) => setState({ ...state, entries: next })

  /** Runs a change on the server; if it fails the list goes back to what the server has. */
  async function change(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
      notifyPlaylistsChanged()
    } catch (e) {
      setError(t(e instanceof Error ? e.message : 'Something went wrong.'))
      setAttempt((n) => n + 1)
    }
  }

  const move = (index: number, direction: -1 | 1) => {
    const to = targetIndex(index, direction, entries.length)
    const entry = entries[index]
    if (to === null || !entry) return
    setEntries(reorder(entries, index, to))
    void change(() => moveInPlaylist(session, id, entry.entryId, to))
  }

  const remove = (index: number) => {
    const entry = entries[index]
    if (!entry) return
    setEntries(entries.filter((_, i) => i !== index))
    void change(async () => {
      await removeFromPlaylist(session, id, [entry.entryId])
      showToast({
        message: t('Removed {title} from {list}.', { title: entry.item.name, list: shownName(list) }),
        actionLabel: t('Undo'),
        onAction: () => {
          void addToPlaylist(session, id, [entry.item.id], index)
            .then(() => setAttempt((n) => n + 1))
            .catch((e: unknown) => setError(errorText(e)))
        },
      })
    })
  }

  const open = (item: Movie) => (isEpisode(item) ? onOpenSeries(item.seriesId) : onOpenMovie(item))
  const first = entries[0]

  return (
    <div className="pt-8">
      <button type="button" className="btn mb-5" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>

      <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
        {renaming === null ? (
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{shownName(list)}</h1>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const next = renaming
              void change(async () => {
                await renamePlaylist(session, id, next)
                setState((s) => (s.status === 'ready' ? { ...s, list: { ...s.list, name: next.trim() } } : s))
                setRenaming(null)
              })
            }}
          >
            <label htmlFor="rename-list" className="sr-only">
              {t('Playlist name')}
            </label>
            <input id="rename-list" className="field" maxLength={80} autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={!renaming.trim()}>
              {t('Save')}
            </button>
            <button type="button" className="btn" onClick={() => setRenaming(null)}>
              {t('Cancel')}
            </button>
          </form>
        )}
        <p className="text-sm text-neutral-400">{countText(entries.length)}</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {first && (
          <button type="button" className="btn-primary" onClick={() => onPlay(overrides[first.item.id] ?? first.item)}>
            <PlayIcon /> {t('Play all')}
          </button>
        )}
        {renaming === null && (
          <button type="button" className="btn" onClick={() => setRenaming(list.name)}>
            {t('Rename')}
          </button>
        )}
        {!confirmDelete ? (
          <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>
            {t('Delete playlist')}
          </button>
        ) : (
          <span className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 py-1 pl-4 pr-1 text-sm text-red-200">
            {t('Delete this playlist? The titles stay in your library.')}
            <button
              type="button"
              className="btn border-red-400/40"
              onClick={() =>
                void change(async () => {
                  await deletePlaylist(session, id)
                  showToast({ message: t('Deleted {list}.', { list: shownName(list) }) })
                  onBack()
                })
              }
            >
              {t('Delete')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>
              {t('Cancel')}
            </button>
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="alert-error mb-4 max-w-xl">
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <StateMessage kind="empty" size="section" message={t('Nothing here yet. Use the ⋯ menu of a movie to add it.')} />
      ) : (
        <ol aria-label={t('Titles in this playlist')} className="space-y-2">
          {entries.map((entry, index) => {
            const item = overrides[entry.item.id] ?? entry.item
            const episode = isEpisode(item)
            const title = episode ? item.seriesName : item.name
            const detail = episode ? [episodeCode(item), item.name].filter(Boolean).join(' · ') : item.year ? String(item.year) : ''
            return (
              <li key={entry.entryId} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-2">
                <button type="button" onClick={() => open(item)} className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none" aria-label={t('Open {label}', { label: title })}>
                  <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface-2)] ring-1 ring-white/10 transition group-hover:ring-[var(--color-accent)]/70 group-focus-visible:ring-2 group-focus-visible:ring-[var(--color-accent)] sm:w-36">
                    <Img session={session} src={wideImageUrl(session.serverUrl, item, 320)} className="h-full w-full object-cover" fallback={null} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{title}</span>
                    {detail && <Subtext as="span" className="block truncate text-xs text-neutral-400" text={detail} />}
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" className="btn-icon" aria-label={t('Play {title}', { title })} title={t('Play')} onClick={() => onPlay(item)}>
                    <PlayIcon />
                  </button>
                  <button type="button" className="btn-icon" aria-label={t('Move {row} up', { row: title })} disabled={index === 0} onClick={() => move(index, -1)}>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="m6 15 6-6 6 6" />
                    </svg>
                  </button>
                  <button type="button" className="btn-icon" aria-label={t('Move {row} down', { row: title })} disabled={index === entries.length - 1} onClick={() => move(index, 1)}>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  <button type="button" className="btn-icon" aria-label={t('Remove {title} from the playlist', { title })} title={t('Remove')} onClick={() => remove(index)}>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
