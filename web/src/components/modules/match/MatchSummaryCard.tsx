import type { MatchSummary } from '../../../core/modules'
import { t } from '../../../i18n'

/** How the Match went: how much the people agreed in the first round, how many each liked and what each chose as favourite. */
export function MatchSummaryCard({ summary, chance }: { summary: MatchSummary; chance: boolean }) {
  const first = summary.firstRound
  return (
    <section aria-label={t('How it went')} className="glass space-y-4 rounded-2xl p-5 text-left">
      <h2 className="text-base font-semibold text-white">{t('How it went')}</h2>
      {first && (
        <div>
          <p className="text-sm text-neutral-200">
            {t('You agreed on {both} of {total} films ({percent}%).', { both: first.both, total: first.total, percent: first.percent })}
          </p>
          <div role="img" aria-label={t('{percent}% in agreement', { percent: first.percent })} className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${first.percent}%` }} />
          </div>
          <ul className="mt-3 space-y-1 text-sm text-neutral-300">
            {first.liked.map((m) => (
              <li key={m.id} className="flex justify-between gap-3">
                <span className="truncate">{m.name}</span>
                <span className="shrink-0 tabular-nums text-neutral-400">{t('liked {count} of {total}', { count: m.count, total: first.total })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.picks.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">{t('Favourites')}</h3>
          <ul className="mt-1 space-y-1 text-sm text-neutral-300">
            {summary.picks.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span className="shrink-0">{p.name}</span>
                <span className="truncate text-right text-neutral-100">{p.card}</span>
              </li>
            ))}
          </ul>
          {chance && <p className="mt-2 text-xs text-neutral-400">{t('You chose different ones, so chance decided.')}</p>}
        </div>
      )}
      <p className="text-xs text-neutral-500">{t('{count} rounds', { count: summary.rounds })}</p>
    </section>
  )
}
