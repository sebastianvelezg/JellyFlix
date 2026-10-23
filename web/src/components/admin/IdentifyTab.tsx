import { useState } from 'react'
import { applyIdentity, describeProviderIds, diffFields, getEditableItem, searchIdentity, type EditableItem, type IdentityCandidate, type Session } from '../../core'
import { t } from '../../i18n'
import { recordActivity } from '../../platform/web/adminActivity'
import { showToast } from '../toast'
import { adminErrorText, ConfirmBox } from './parts'

/**
 * "Which title is this?": the server asks its metadata providers, the person picks the right match and the server fills in
 * the details. Pictures from the providers are only shown if the person asks, because showing one means the browser contacts
 * the provider's own web site.
 */
export function IdentifyTab({
  session,
  item,
  dirty,
  onChanged,
}: {
  session: Session
  item: EditableItem
  /** There are typed changes in the Details tab that this would replace. */
  dirty: boolean
  onChanged: (fresh?: EditableItem) => Promise<void>
}) {
  const [name, setName] = useState(item.fields.name)
  const [year, setYear] = useState(item.fields.year)
  const [results, setResults] = useState<IdentityCandidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pictures, setPictures] = useState(false)
  const [chosen, setChosen] = useState<IdentityCandidate | null>(null)
  const [replaceImages, setReplaceImages] = useState(false)
  const [busy, setBusy] = useState(false)
  const id = item.dto.Id ?? ''

  async function search() {
    setSearching(true)
    setError(null)
    setChosen(null)
    try {
      setResults(await searchIdentity(session, item.dto, { name, year: /^\d{4}$/.test(year.trim()) ? Number(year) : undefined }))
    } catch (e) {
      setResults(null)
      setError(adminErrorText(e))
    } finally {
      setSearching(false)
    }
  }

  async function apply() {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      await applyIdentity(session, id, chosen, replaceImages)
      const fresh = await getEditableItem(session, id)
      const changes = diffFields(item.fields, fresh.fields)
      recordActivity({
        itemId: id,
        itemName: fresh.fields.name,
        kind: 'identify',
        summary: t('Identified as {name}', { name: chosen.name }),
        ...(changes.length > 0 ? { changes, before: item.fields, after: fresh.fields } : {}),
      })
      setChosen(null)
      setResults(null)
      await onChanged(fresh)
      showToast({ message: t('Identified as {name}.', { name: chosen.name }) })
    } catch (e) {
      setError(adminErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400">{t('Wrong title or wrong details? Look it up in the places your server gets its details from, and pick the right one.')}</p>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void search()
        }}
      >
        <div>
          <label htmlFor="id-name" className="mb-1 block text-sm font-medium text-neutral-100">
            {t('Name to look for')}
          </label>
          <input id="id-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="id-year" className="mb-1 block text-sm font-medium text-neutral-100">
            {t('Year')}
          </label>
          <input id="id-year" className="field" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={searching || !name.trim()}>
          {searching ? t('Searching…') : t('Search')}
        </button>
      </form>

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      {results && results.length === 0 && <p className="text-sm text-neutral-400">{t('Nothing found. Try fewer words, or leave the year empty.')}</p>}

      {results && results.length > 0 && (
        <>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" checked={pictures} onChange={(e) => setPictures(e.target.checked)} />
            <span>
              {t('Show their pictures')}
              <span className="block text-xs text-neutral-500">{t('Your browser will then load them from the web sites of those providers.')}</span>
            </span>
          </label>
          <ul aria-label={t('Matches')} className="space-y-2">
            {results.map((candidate, index) => (
              <li key={`${candidate.provider}-${describeProviderIds(candidate.providerIds)}-${index}`} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-3">
                {pictures && candidate.imageUrl && (
                  <img src={candidate.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-24 w-16 shrink-0 rounded-lg bg-[var(--color-surface-3)] object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">
                    {candidate.name} {candidate.year ? <span className="font-normal text-neutral-400">({candidate.year})</span> : null}
                  </p>
                  <p className="text-xs text-neutral-500">{[candidate.provider, describeProviderIds(candidate.providerIds)].filter(Boolean).join(' · ')}</p>
                  {candidate.overview && <p className="mt-1 line-clamp-3 text-sm text-neutral-300">{candidate.overview}</p>}
                </div>
                <button type="button" className="btn shrink-0 self-start" aria-label={t('Use this: {name}', { name: candidate.name })} onClick={() => setChosen(candidate)}>
                  {t('Use this')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {chosen && (
        <ConfirmBox confirmLabel={t('Identify it as this')} onConfirm={() => void apply()} onCancel={() => setChosen(null)} busy={busy}>
          <p>
            {t('Tell the server that “{from}” is really “{to}”? It will fill in the details from there and replace the ones it has now. Anything you kept as it is stays.', {
              from: item.fields.name,
              to: chosen.year ? `${chosen.name} (${chosen.year})` : chosen.name,
            })}
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-neutral-200">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={replaceImages} onChange={(e) => setReplaceImages(e.target.checked)} />
            {t('Also replace its pictures')}
          </label>
          {dirty && <p className="mt-2 text-amber-200">{t('The changes you typed in Details and have not saved will be lost.')}</p>}
        </ConfirmBox>
      )}
    </div>
  )
}
