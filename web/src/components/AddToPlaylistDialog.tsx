import { useCallback, useEffect, useRef, useState } from 'react'
import { addToPlaylist, createVideoPlaylist, getPlaylistEntries, getVideoPlaylists, type Movie, type Session, type VideoPlaylist } from '../core'
import { t } from '../i18n'
import { errorText } from './useAsync'
import { notifyPlaylistsChanged } from './playlistEvents'
import { showToast } from './toast'

const OPEN_EVENT = 'jellyflix:add-to-playlist'

/** Asks to put a title in a playlist: opens the picker (one of them lives in the app). */
export function openAddToPlaylist(item: Movie): void {
  window.dispatchEvent(new CustomEvent<Movie>(OPEN_EVENT, { detail: item }))
}

/** The picker: your playlists to choose from, or a new one. */
export function AddToPlaylistDialog({ session }: { session: Session }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [item, setItem] = useState<Movie | null>(null)
  const [lists, setLists] = useState<VideoPlaylist[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const open = (e: Event) => {
      setItem((e as CustomEvent<Movie>).detail)
      setLists(null)
      setName('')
      setError(null)
      dialog.current?.showModal()
    }
    window.addEventListener(OPEN_EVENT, open)
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [])

  const load = useCallback(() => {
    getVideoPlaylists(session)
      .then(setLists)
      .catch((e: unknown) => setError(errorText(e)))
  }, [session])
  useEffect(() => {
    if (item) load()
  }, [item, load])

  const close = () => dialog.current?.close()

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setError(null)
    try {
      const message = await action()
      notifyPlaylistsChanged()
      close()
      showToast({ message })
    } catch (e) {
      setError(t(e instanceof Error ? e.message : 'Something went wrong.'))
    } finally {
      setBusy(false)
    }
  }

  const addTo = (list: VideoPlaylist) =>
    run(async () => {
      if (!item) return ''
      const entries = await getPlaylistEntries(session, list.id)
      if (entries.some((e) => e.item.id === item.id)) return t('{title} is already in {list}.', { title: item.name, list: list.name })
      await addToPlaylist(session, list.id, [item.id])
      return t('Added {title} to {list}.', { title: item.name, list: list.name })
    })

  const create = () =>
    run(async () => {
      if (!item) return ''
      await createVideoPlaylist(session, name, [item.id])
      return t('Created {list} with {title}.', { list: name.trim(), title: item.name })
    })

  return (
    <dialog
      ref={dialog}
      aria-label={t('Add to a playlist')}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-white/10 bg-[var(--color-surface-2)] p-0 text-neutral-100 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === dialog.current) close()
      }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-white">{t('Add to a playlist')}</h2>
            {item && <p className="truncate text-sm text-neutral-400">{item.name}</p>}
          </div>
          <button type="button" className="btn" onClick={close}>
            {t('Close')}
          </button>
        </div>

        {error && (
          <p role="alert" className="alert-error mt-4">
            {error}
          </p>
        )}

        <div className="mt-4">
          {lists === null && !error && <p className="text-sm text-neutral-400">{t('Loading your playlists…')}</p>}
          {lists && lists.length === 0 && <p className="text-sm text-neutral-400">{t('You have no playlists yet. Make the first one below.')}</p>}
          {lists && lists.length > 0 && (
            <ul className="max-h-60 space-y-1 overflow-y-auto">
              {lists.map((list) => (
                <li key={list.id}>
                  <button
                    type="button"
                    disabled={busy}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-white/10 focus-visible:bg-white/10 disabled:opacity-60 pointer-coarse:py-3.5"
                    onClick={() => void addTo(list)}
                  >
                    <span className="truncate">{list.name}</span>
                    {list.itemCount !== undefined && <span className="shrink-0 text-xs text-neutral-500">{list.itemCount}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          className="mt-4 flex gap-2 border-t border-white/10 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void create()
          }}
        >
          <label htmlFor="new-playlist" className="sr-only">
            {t('New playlist name')}
          </label>
          <input id="new-playlist" className="field" placeholder={t('New playlist')} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn-primary shrink-0" disabled={busy || !name.trim()}>
            {t('Create')}
          </button>
        </form>
      </div>
    </dialog>
  )
}
