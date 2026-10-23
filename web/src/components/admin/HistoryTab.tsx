import { restoreFields, type MetadataFields } from '../../core'
import { t } from '../../i18n'
import { activityOf, clearActivity, useActivity, type ActivityEntry } from '../../platform/web/adminActivity'
import { when } from './parts'

/** What was changed on this title from this browser, with a way to put edited details back (after a review, in Details). */
export function HistoryTab({ itemId, current, onRestore }: { itemId: string; current: MetadataFields; onRestore: (next: MetadataFields) => void }) {
  const entries = activityOf(useActivity(), itemId)

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400">{t('A note of what you changed on this title from this browser. It stays on this device only and is erased when you sign out.')}</p>
      {entries.length === 0 && <p className="text-sm text-neutral-500">{t('Nothing yet.')}</p>}
      {entries.length > 0 && (
        <ol aria-label={t('Changes to this title')} className="space-y-3">
          {entries.map((e) => (
            <Entry key={e.id} entry={e} onRestore={e.changes && e.before ? () => onRestore(restoreFields(current, e.before as MetadataFields, (e.changes ?? []).map((c) => c.key))) : undefined} />
          ))}
        </ol>
      )}
      {entries.length > 0 && (
        <button type="button" className="btn" onClick={clearActivity}>
          {t('Clear the whole history')}
        </button>
      )}
    </div>
  )
}

function Entry({ entry, onRestore }: { entry: ActivityEntry; onRestore?: () => void }) {
  return (
    <li className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
      <p className="text-sm font-medium text-white">{entry.summary}</p>
      <p className="text-xs text-neutral-500">{when(entry.at)}</p>
      {entry.changes && entry.changes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-neutral-300">
          {entry.changes.map((c) => (
            <li key={c.key}>
              <span className="text-neutral-500">{t(c.label)}: </span>
              <span className="text-neutral-500 line-through">{c.before || t('(empty)')}</span> <span aria-hidden="true">→</span> <span>{c.after || t('(empty)')}</span>
            </li>
          ))}
        </ul>
      )}
      {onRestore && (
        <button type="button" className="btn mt-3" onClick={onRestore}>
          {t('Put the old details back…')}
        </button>
      )}
    </li>
  )
}
