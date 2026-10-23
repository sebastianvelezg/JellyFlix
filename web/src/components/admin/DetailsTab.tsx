import { useMemo, useState } from 'react'
import { applyFields, diffFields, FIELD_LIMITS, LOCKABLE_FIELDS, saveItem, validateFields, type EditableItem, type LockableField, type MetadataFields, type Session } from '../../core'
import { t, tr } from '../../i18n'
import { recordActivity } from '../../platform/web/adminActivity'
import { Toggle } from '../SettingsParts'
import { showToast } from '../toast'
import { adminErrorText, ConfirmBox, Field, ListInput } from './parts'

const LOCK_LABEL: Record<LockableField, string> = {
  Name: tr('Title'),
  Overview: tr('Description'),
  Genres: tr('Genres'),
  Studios: tr('Studios'),
  Tags: tr('Tags'),
  OfficialRating: tr('Parental rating'),
  Cast: tr('Cast and crew'),
  Runtime: tr('Running time'),
}

/** The details of a title: a form, then a list of exactly what will change, then a confirmation. */
export function DetailsTab({
  session,
  itemId,
  item,
  draft,
  setDraft,
  resetKey,
  onSaved,
}: {
  session: Session
  itemId: string
  item: EditableItem
  draft: MetadataFields
  setDraft: (next: MetadataFields) => void
  /** Changes when the draft was replaced from outside (undo, reload). */
  resetKey: number
  /** The server now holds the new details: read them again. */
  onSaved: () => Promise<void>
}) {
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changes = useMemo(() => diffFields(item.fields, draft), [item.fields, draft])
  const errors = useMemo(() => validateFields(draft), [draft])
  const problems = Object.keys(errors).length
  const set = <K extends keyof MetadataFields>(key: K, value: MetadataFields[K]) => {
    setReviewing(false)
    setDraft({ ...draft, [key]: value })
  }
  const err = (key: keyof MetadataFields) => (errors[key] ? t(errors[key]) : undefined)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveItem(session, itemId, applyFields(item.dto, draft))
      recordActivity({
        itemId,
        itemName: draft.name.trim(),
        kind: 'edit',
        summary: t('Changed {fields}', { fields: changes.map((c) => t(c.label).toLowerCase()).join(', ') }),
        changes,
        before: item.fields,
        after: draft,
      })
      setReviewing(false)
      await onSaved()
      showToast({ message: t('Saved the details of {title}.', { title: draft.name.trim() }) })
    } catch (e) {
      setError(adminErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleLock = (field: LockableField, on: boolean) =>
    set('lockedFields', on ? LOCKABLE_FIELDS.filter((f) => f === field || draft.lockedFields.includes(f)) : draft.lockedFields.filter((f) => f !== field))

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (changes.length > 0 && problems === 0) setReviewing(true)
      }}
    >
      <Field id="ed-name" label={t('Title')} error={err('name')}>
        {(p) => <input {...p} className="field" value={draft.name} maxLength={FIELD_LIMITS.name + 20} onChange={(e) => set('name', e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ed-original" label={t('Original title')} error={err('originalTitle')}>
          {(p) => <input {...p} className="field" value={draft.originalTitle} onChange={(e) => set('originalTitle', e.target.value)} />}
        </Field>
        <Field id="ed-sort" label={t('Sort title')} hint={t('How it is ordered in lists. Leave empty to use the title.')} error={err('sortName')}>
          {(p) => <input {...p} className="field" value={draft.sortName} onChange={(e) => set('sortName', e.target.value)} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="ed-year" label={t('Year')} error={err('year')}>
          {(p) => <input {...p} className="field" inputMode="numeric" value={draft.year} onChange={(e) => set('year', e.target.value)} />}
        </Field>
        <Field id="ed-rating" label={t('Community rating')} hint={t('From 0 to 10.')} error={err('communityRating')}>
          {(p) => <input {...p} className="field" inputMode="decimal" value={draft.communityRating} onChange={(e) => set('communityRating', e.target.value)} />}
        </Field>
        <Field id="ed-official" label={t('Parental rating')} error={err('officialRating')}>
          {(p) => (
            <>
              <input {...p} className="field" list="ed-official-list" value={draft.officialRating} onChange={(e) => set('officialRating', e.target.value)} />
              <datalist id="ed-official-list">
                {item.parentalRatings.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      </div>
      <Field id="ed-overview" label={t('Description')} error={err('overview')}>
        {(p) => <textarea {...p} className="field min-h-32 resize-y" value={draft.overview} onChange={(e) => set('overview', e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="ed-genres" label={t('Genres')} hint={t('Separate with commas.')} error={err('genres')}>
          {(p) => <ListInput key={`g${resetKey}`} {...p} value={draft.genres} onChange={(list) => set('genres', list)} />}
        </Field>
        <Field id="ed-studios" label={t('Studios')} hint={t('Separate with commas.')} error={err('studios')}>
          {(p) => <ListInput key={`s${resetKey}`} {...p} value={draft.studios} onChange={(list) => set('studios', list)} />}
        </Field>
        <Field id="ed-tags" label={t('Tags')} hint={t('Separate with commas.')} error={err('tags')}>
          {(p) => <ListInput key={`t${resetKey}`} {...p} value={draft.tags} onChange={(list) => set('tags', list)} />}
        </Field>
      </div>

      <fieldset className="rounded-2xl border border-white/10 p-4">
        <legend className="px-2 text-sm font-medium text-neutral-100">{t('Keep my changes')}</legend>
        <p className="mb-3 text-xs text-neutral-400">
          {t('When the server looks for details again (a refresh, or a library scan), it can replace what you typed. Keep a field as it is to stop that.')}
        </p>
        <Toggle label={t('Keep everything about this title as it is')} hint={t('Nothing is replaced by a refresh, whatever the fields below say.')} checked={draft.lockedAll} onChange={(on) => set('lockedAll', on)} />
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          {LOCKABLE_FIELDS.map((field) => (
            <label key={field} className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-neutral-200 pointer-coarse:py-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-accent)]"
                checked={draft.lockedAll || draft.lockedFields.includes(field)}
                disabled={draft.lockedAll}
                onChange={(e) => toggleLock(field, e.target.checked)}
              />
              {t(LOCK_LABEL[field])}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      {reviewing ? (
        <ConfirmBox confirmLabel={t('Save these changes')} onConfirm={() => void save()} onCancel={() => setReviewing(false)} busy={busy}>
          <p className="mb-2 font-medium">{t('This will change:')}</p>
          <ul aria-label={t('Changes to save')} className="space-y-1.5">
            {changes.map((c) => (
              <li key={c.key} className="grid gap-x-3 sm:grid-cols-[9rem_1fr]">
                <span className="text-neutral-400">{t(c.label)}</span>
                <span className="min-w-0 break-words">
                  <span className="text-neutral-500 line-through">{c.before ? (c.before.length > 120 ? `${c.before.slice(0, 120)}…` : c.before) : t('(empty)')}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> {t('now')} </span>
                  <span className="font-medium text-white">{c.after ? (c.after.length > 120 ? `${c.after.slice(0, 120)}…` : c.after) : t('(empty)')}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-400">{t('The server saves this for everyone who uses it. This browser keeps a note, so you can put the old details back.')}</p>
        </ConfirmBox>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={changes.length === 0 || problems > 0}>
            {t('Review changes')}
          </button>
          <button type="button" className="btn" disabled={changes.length === 0} onClick={() => setDraft(item.fields)}>
            {t('Undo my typing')}
          </button>
          <span className="text-xs text-neutral-500" aria-live="polite">
            {problems > 0 ? t('Fix the marked fields first.') : changes.length === 0 ? t('Nothing changed yet.') : t('{count} changes ready to review.', { count: changes.length })}
          </span>
        </div>
      )}
    </form>
  )
}
