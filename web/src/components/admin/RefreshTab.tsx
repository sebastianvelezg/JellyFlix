import { useState } from 'react'
import { refreshItem, type EditableItem, type RefreshMode, type Session } from '../../core'
import { t, tr } from '../../i18n'
import { recordActivity } from '../../platform/web/adminActivity'
import { showToast } from '../toast'
import { notifyItemEdited } from './editorEvents'
import { adminErrorText, ConfirmBox } from './parts'

const MODES: Array<{ mode: RefreshMode; title: string; text: string }> = [
  { mode: 'scan', title: tr('Look for changed files'), text: tr('Only checks the files on disk. Details are not looked up again.') },
  { mode: 'missing', title: tr('Fill in what is missing'), text: tr('Looks for details and pictures the title does not have yet. What it has stays as it is.') },
  { mode: 'all', title: tr('Replace everything'), text: tr('Asks the providers again and replaces the details. What you kept as it is stays.') },
]

/** Asks the server to look at a title again. The server does the work in the background, so this answers at once. */
export function RefreshTab({ session, item }: { session: Session; item: EditableItem }) {
  const [mode, setMode] = useState<RefreshMode>('missing')
  const [replaceImages, setReplaceImages] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const id = item.dto.Id ?? ''
  const series = item.dto.Type === 'Series' || item.dto.Type === 'Season' || item.dto.Type === 'MusicArtist' || item.dto.Type === 'MusicAlbum' || item.dto.Type === 'BoxSet'

  async function run() {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      await refreshItem(session, id, mode, replaceImages)
      const chosen = MODES.find((m) => m.mode === mode)
      recordActivity({ itemId: id, itemName: item.fields.name, kind: 'refresh', summary: t('Asked the server: {what}', { what: t(chosen?.title ?? '').toLowerCase() }) })
      setConfirming(false)
      setDone(true)
      showToast({ message: t('The server is looking at {title} again.', { title: item.fields.name }) })
      // The work goes on in the server: read the title again a little later.
      window.setTimeout(notifyItemEdited, 4000)
    } catch (e) {
      setError(adminErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400">{t('Ask the server to look at this title again.')}</p>
      <fieldset className="space-y-2">
        <legend className="sr-only">{t('What should the server do?')}</legend>
        {MODES.map((m) => (
          <label key={m.mode} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${mode === m.mode ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10' : 'border-white/10 hover:border-white/25'}`}>
            <input
              type="radio"
              name="refresh-mode"
              className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
              checked={mode === m.mode}
              onChange={() => {
                setMode(m.mode)
                setConfirming(false)
                setDone(false)
              }}
            />
            <span>
              <span className="block text-sm font-medium text-white">{t(m.title)}</span>
              <span className="block text-xs text-neutral-400">{t(m.text)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === 'all' && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={replaceImages} onChange={(e) => setReplaceImages(e.target.checked)} />
          {t('Also replace its pictures')}
        </label>
      )}
      {series && <p className="text-xs text-neutral-500">{t('The server may also look at what is inside it (seasons, episodes, songs).')}</p>}
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="alert-info">
          {t('Asked. The server works on it in the background; this page reads the title again in a few seconds.')}
        </p>
      )}
      {confirming ? (
        <ConfirmBox danger confirmLabel={t('Replace everything')} onConfirm={() => void run()} onCancel={() => setConfirming(false)} busy={busy}>
          {t('The server will ask the providers again and write over the details it has for “{title}”. Fields you kept as they are stay; everything else can change.', { title: item.fields.name })}
        </ConfirmBox>
      ) : (
        <button type="button" className="btn-primary" disabled={busy} onClick={() => (mode === 'all' ? setConfirming(true) : void run())}>
          {t('Refresh')}
        </button>
      )}
    </div>
  )
}
