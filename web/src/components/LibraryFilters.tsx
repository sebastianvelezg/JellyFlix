import {
  MIN_RATINGS,
  QUALITIES,
  countActiveFilters,
  decadeLabel,
  type AdvancedFilters,
  type FilterFacets,
  type Quality,
} from '../core'
import { t } from '../i18n'
import type { AsyncState } from './useAsync'

const QUALITY_LABEL: Record<Quality, string> = { uhd: '4K', hd: 'HD' }

/** The "More filters" button of a library's toolbar, with how many are on. */
export function FiltersButton({ filters, open, onToggle }: { filters: AdvancedFilters; open: boolean; onToggle: () => void }) {
  const active = countActiveFilters(filters)
  return (
    <button
      type="button"
      className={`btn whitespace-nowrap ${active > 0 ? 'border-[var(--color-accent)]/50' : ''}`}
      aria-expanded={open}
      aria-controls="library-filters"
      onClick={onToggle}
    >
      {t('More filters')}
      {active > 0 && (
        <span className="rounded-full bg-[var(--color-accent-strong)] px-1.5 text-xs font-semibold text-[var(--color-accent-ink)]" title={t('{count} filters on', { count: active })}>
          {active}
        </span>
      )}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-neutral-400">
      {label}
      {children}
    </label>
  )
}

/** Decade, rating, age rating, tag and quality: what a library can be narrowed by besides watched state and genre. */
export function FiltersPanel({
  facets,
  filters,
  onChange,
}: {
  facets: AsyncState<FilterFacets>
  filters: AdvancedFilters
  onChange: (next: AdvancedFilters) => void
}) {
  const offered = facets.status === 'ready' ? facets.data : { decades: [], officialRatings: [], tags: [] }
  const set = <K extends keyof AdvancedFilters>(key: K, value: AdvancedFilters[K] | '') => {
    const next = { ...filters }
    if (value === '' || value === undefined) delete next[key]
    else next[key] = value as AdvancedFilters[K]
    onChange(next)
  }
  const active = countActiveFilters(filters)
  return (
    <div id="library-filters" role="group" aria-label={t('More filters')} className="mb-5 rounded-2xl border border-white/10 bg-white/[.03] p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {offered.decades.length > 0 && (
          <Field label={t('Decade')}>
            <select className="select w-full" value={filters.decade ?? ''} onChange={(e) => set('decade', e.target.value ? Number(e.target.value) : '')}>
              <option value="">{t('Any decade')}</option>
              {offered.decades.map((d) => (
                <option key={d} value={d}>
                  {decadeLabel(d)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('Rating')}>
          <select className="select w-full" value={filters.minRating ?? ''} onChange={(e) => set('minRating', e.target.value ? Number(e.target.value) : '')}>
            <option value="">{t('Any rating')}</option>
            {MIN_RATINGS.map((r) => (
              <option key={r} value={r}>
                {t('{rating} or higher', { rating: r })}
              </option>
            ))}
          </select>
        </Field>
        {offered.officialRatings.length > 0 && (
          <Field label={t('Age rating')}>
            <select className="select w-full" value={filters.officialRating ?? ''} onChange={(e) => set('officialRating', e.target.value)}>
              <option value="">{t('Any age rating')}</option>
              {offered.officialRatings.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        )}
        {offered.tags.length > 0 && (
          <Field label={t('Tag')}>
            <select className="select w-full" value={filters.tag ?? ''} onChange={(e) => set('tag', e.target.value)}>
              <option value="">{t('Any tag')}</option>
              {offered.tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('Quality')}>
          <select className="select w-full" value={filters.quality ?? ''} onChange={(e) => set('quality', e.target.value as Quality | '')}>
            <option value="">{t('Any quality')}</option>
            {QUALITIES.map((q) => (
              <option key={q} value={q}>
                {QUALITY_LABEL[q]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {active > 0 && (
        <button type="button" className="btn-ghost mt-3" onClick={() => onChange({})}>
          {t('Clear filters')}
        </button>
      )}
    </div>
  )
}
