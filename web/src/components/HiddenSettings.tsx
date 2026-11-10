import { hiddenCount, listHidden, restoreAllHidden, restoreHidden } from '../core'
import { t } from '../i18n'
import { updateHidden, useHidden } from '../platform/web/hidden'
import { Card } from './SettingsParts'

/** What this account has hidden from Continue watching and Next up, with a way to bring each thing back. */
export function HiddenSettings() {
  const hidden = useHidden()
  const rows = listHidden(hidden)
  return (
    <Card
      title={t('Hidden from Continue watching and Next up')}
      description={t('Hiding does not change what you have watched. It only leaves the title or series out of those rows, on this device and for this account.')}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Nothing is hidden. Use the “⋯” button on a card of Continue watching or Next up.')}</p>
      ) : (
        <>
          <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">
            {rows.map((row) => (
              <li key={`${row.kind}:${row.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-neutral-100">{row.name || row.id}</span>
                  <span className="block text-xs text-neutral-500">{row.kind === 'resume' ? t('Continue watching') : t('Next up')}</span>
                </span>
                <button
                  type="button"
                  className="btn"
                  aria-label={t('Restore {name}', { name: row.name || row.id })}
                  onClick={() => updateHidden((h) => restoreHidden(h, row.kind, row.id))}
                >
                  {t('Restore')}
                </button>
              </li>
            ))}
          </ul>
          <div>
            <button type="button" className="btn" onClick={() => updateHidden((h) => restoreAllHidden(h))}>
              {t('Restore all ({count})', { count: hiddenCount(hidden) })}
            </button>
          </div>
        </>
      )}
    </Card>
  )
}
