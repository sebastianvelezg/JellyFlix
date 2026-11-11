import { useCallback, useState } from 'react'
import { autoChannels, channelSuggestions } from '../../../core/modules'
import { t } from '../../../i18n'
import { errorText, useAsync } from '../../useAsync'
import { StateMessage } from '../../StateMessage'
import { useModulesClient } from '../ModulesProvider'

/** One channel per genre or collection, made in one go. Each can be edited afterwards. */
export function QuickChannels({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { client } = useModulesClient()
  const load = useCallback(() => channelSuggestions(client), [client])
  const { state, retry } = useAsync(load)
  const [genres, setGenres] = useState<string[]>([])
  const [boxes, setBoxes] = useState<string[]>([])
  const [episodes, setEpisodes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (list: string[], set: (next: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  async function make() {
    setBusy(true)
    setError(null)
    try {
      // One at a time: each is a long read of the library, and a failure half way leaves the ones already made out of the selection
      // (asking again would otherwise make them twice).
      const types: Array<'Movie' | 'Episode'> = episodes ? ['Movie', 'Episode'] : ['Movie']
      for (const genre of genres) {
        await autoChannels(client, { genres: [genre], collectionIds: [], types })
        setGenres((now) => now.filter((g) => g !== genre))
      }
      for (const box of boxes) {
        await autoChannels(client, { genres: [], collectionIds: [box], types })
        setBoxes((now) => now.filter((b) => b !== box))
      }
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold tracking-tight text-white">{t('Quick channels')}</h2>
        <p className="mt-1 text-sm text-neutral-400">{t('Pick the genres and collections you want a channel for. Each one becomes a channel that plays that part of your library, one title after another.')}</p>
      </header>
      {state.status === 'loading' && <p role="status" className="text-neutral-400">{t('Loading…')}</p>}
      {state.status === 'error' && (
        <StateMessage kind="error" message={state.message} size="section">
          <button type="button" className="btn" onClick={retry}>
            {t('Try again')}
          </button>
        </StateMessage>
      )}
      {state.status === 'ready' && (
        <>
          <fieldset className="glass rounded-2xl p-4">
            <legend className="px-1 text-sm font-semibold text-white">{t('Genres')}</legend>
            <div className="flex flex-wrap gap-2">
              {state.data.genres.map((g) => (
                <label key={g} className={`chip cursor-pointer ${genres.includes(g) ? 'chip-accent' : ''}`}>
                  <input type="checkbox" className="sr-only" checked={genres.includes(g)} onChange={() => toggle(genres, setGenres, g)} />
                  {g}
                </label>
              ))}
              {state.data.genres.length === 0 && <p className="text-sm text-neutral-500">{t('Jellyfin did not list any genres.')}</p>}
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-neutral-300">
              <input type="checkbox" checked={episodes} onChange={(e) => setEpisodes(e.target.checked)} />
              {t('Include series episodes in the genre channels')}
            </label>
          </fieldset>
          <fieldset className="glass rounded-2xl p-4">
            <legend className="px-1 text-sm font-semibold text-white">{t('Collections')}</legend>
            <div className="flex flex-wrap gap-2">
              {state.data.collections.map((c) => (
                <label key={c.id} className={`chip cursor-pointer ${boxes.includes(c.id) ? 'chip-accent' : ''}`}>
                  <input type="checkbox" className="sr-only" checked={boxes.includes(c.id)} onChange={() => toggle(boxes, setBoxes, c.id)} />
                  {c.name}
                </label>
              ))}
              {state.data.collections.length === 0 && <p className="text-sm text-neutral-500">{t('There are no collections.')}</p>}
            </div>
          </fieldset>
        </>
      )}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={busy || (genres.length === 0 && boxes.length === 0)} onClick={() => void make()}>
          {busy ? t('Making channels…') : t('Make {count} channels', { count: genres.length + boxes.length })}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}
