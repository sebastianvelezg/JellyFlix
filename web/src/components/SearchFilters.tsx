import { t } from '../i18n'

export type SearchKind = 'all' | 'movies' | 'series' | 'music'

/** Narrows the search results to one kind: everything, movies (and their collections), series (and episodes) or music. */
export function SearchFilters({ value, onChange, hasMusic }: { value: SearchKind; onChange: (kind: SearchKind) => void; hasMusic: boolean }) {
  const kinds: Array<[SearchKind, string]> = [
    ['all', t('All')],
    ['movies', t('Movies')],
    ['series', t('Series')],
    ...(hasMusic ? ([['music', t('Music')]] as Array<[SearchKind, string]>) : []),
  ]
  return (
    <div role="group" aria-label={t('Filter the results')} className="mb-6 flex flex-wrap gap-2">
      {kinds.map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          onClick={() => onChange(kind)}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition pointer-coarse:py-3 ${
            value === kind
              ? 'border-transparent bg-white text-black'
              : 'border-white/10 bg-white/[.05] text-neutral-300 hover:border-white/25 hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
