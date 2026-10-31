import { useCallback, useMemo } from 'react'
import { buildStats, getPlayHistory, getWatchedTitles, type PlayHistory, type Session, type WatchStats } from '../core'
import { getLanguage, t } from '../i18n'
import { BackIcon } from './icons'
import { StateMessage } from './StateMessage'
import { useAsync } from './useAsync'

const number = (n: number) => n.toLocaleString(getLanguage())

/** "Oct" for "2026-10". */
function monthName(key: string): string {
  const [year, month] = key.split('-').map(Number)
  return new Date(year as number, (month as number) - 1, 1).toLocaleDateString(getLanguage(), { month: 'short' })
}

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-white sm:text-4xl">
        {value}
        {unit && <span className="ml-1.5 text-base font-medium text-neutral-400">{unit}</span>}
      </p>
    </div>
  )
}

function Months({ stats }: { stats: WatchStats }) {
  const peak = Math.max(1, ...stats.months.map((m) => m.count))
  return (
    <section aria-label={t('Titles by month')} className="glass rounded-2xl p-4 sm:p-5">
      <h2 className="text-base font-semibold text-white">{t('Titles by month')}</h2>
      <p className="mb-3 text-xs text-neutral-500">{t('Counted by the month each title was last played.')}</p>
      <ol className="flex h-36 items-end gap-1.5 sm:gap-2">
        {stats.months.map((month) => (
          <li key={month.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" aria-label={t('{month}: {count} titles', { month: month.key, count: month.count })}>
            <span aria-hidden="true" className="text-[11px] tabular-nums text-neutral-400">
              {month.count > 0 ? month.count : ''}
            </span>
            <span
              aria-hidden="true"
              className="w-full rounded-t-md bg-[var(--color-accent)]"
              style={{ height: `${Math.max(month.count > 0 ? 6 : 2, (month.count / peak) * 100)}%`, opacity: month.count > 0 ? 1 : 0.25 }}
            />
            <span aria-hidden="true" className="text-[11px] text-neutral-500">
              {monthName(month.key)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Genres({ stats }: { stats: WatchStats }) {
  const top = stats.topGenres[0]?.count ?? 1
  return (
    <section aria-label={t('Favorite genres')} className="glass rounded-2xl p-4 sm:p-5">
      <h2 className="mb-3 text-base font-semibold text-white">{t('Favorite genres')}</h2>
      {stats.topGenres.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Nothing to show yet.')}</p>
      ) : (
        <ul className="space-y-2.5">
          {stats.topGenres.map((genre) => (
            <li key={genre.name} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate text-neutral-200">{genre.name}</span>
              <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-white/10">
                <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${(genre.count / top) * 100}%` }} />
              </span>
              <span className="tabular-nums text-neutral-400">{number(genre.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** "45 min" below an hour, "3.5 h" above. */
function played(seconds: number): string {
  if (seconds < 3600) return t('{minutes} min', { minutes: number(Math.round(seconds / 60)) })
  return t('{hours} h', { hours: number(Math.round((seconds / 3600) * 10) / 10) })
}

function weekdayName(day: number): string {
  // 7 January 2024 was a Sunday.
  return new Date(2024, 0, 7 + day).toLocaleDateString(getLanguage(), { weekday: 'short' })
}

/** One row of bars: [values] drawn side by side, each with its own label under it (empty for the ones left unnamed). */
function Bars({ values, labels, describe }: { values: number[]; labels: string[]; describe: (index: number) => string }) {
  const peak = Math.max(1, ...values)
  return (
    <ol className="flex h-28 items-end gap-1">
      {values.map((value, i) => (
        <li key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" aria-label={describe(i)}>
          <span
            aria-hidden="true"
            className="w-full rounded-t-sm bg-[var(--color-accent)]"
            style={{ height: `${Math.max(value > 0 ? 6 : 2, (value / peak) * 100)}%`, opacity: value > 0 ? 1 : 0.25 }}
          />
          <span aria-hidden="true" className="h-3 text-[10px] leading-3 text-neutral-500">
            {labels[i]}
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * What the Playback Reporting plugin of the server has recorded: real time played (not the length of each title), the hours and days
 * you watch at, and on which devices. It only starts from the day the plugin was installed, which the page says.
 */
function Recorded({ history }: { history: PlayHistory }) {
  const language = getLanguage()
  if (history.plays === 0) {
    return (
      <section aria-label={t('Recorded by Playback Reporting')} className="glass rounded-2xl p-4 sm:p-5">
        <h2 className="text-base font-semibold text-white">{t('Recorded by Playback Reporting')}</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {t('Playback Reporting is installed and has only just started recording. After you watch something, the real time played, the hours you watch at and your devices show here.')}
        </p>
      </section>
    )
  }
  const converted = history.converted + history.direct > 0 ? Math.round((history.converted / (history.converted + history.direct)) * 100) : 0
  const topDevice = history.devices[0]?.seconds ?? 1
  return (
    <section aria-label={t('Recorded by Playback Reporting')} className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">{t('Recorded by Playback Reporting')}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {history.since
            ? t('Real time played, noted by the plugin on your server since {date} (the server’s clock). Earlier viewing is not in it.', {
                date: new Date(`${history.since}T12:00:00`).toLocaleDateString(language, { dateStyle: 'medium' }),
              })
            : t('Real time played, noted by the plugin on your server.')}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure label={t('Time played, last 12 months')} value={played(history.seconds)} />
        <Figure label={t('Plays')} value={number(history.plays)} />
        <Figure label={t('Played as they are')} value={`${100 - converted}`} unit="%" />
      </div>
      <section aria-label={t('Time played by month')} className="glass rounded-2xl p-4 sm:p-5">
        <h3 className="mb-3 text-base font-semibold text-white">{t('Time played by month')}</h3>
        <Bars
          values={history.months.map((m) => m.seconds)}
          labels={history.months.map((m) => monthName(m.key))}
          describe={(i) => t('{month}: {time}', { month: history.months[i]?.key ?? '', time: played(history.months[i]?.seconds ?? 0) })}
        />
      </section>
      <div className="grid gap-5 md:grid-cols-2">
        <section aria-label={t('When you watch')} className="glass rounded-2xl p-4 sm:p-5">
          <h3 className="mb-3 text-base font-semibold text-white">{t('When you watch')}</h3>
          <Bars
            values={history.hours}
            labels={history.hours.map((_, h) => (h % 6 === 0 ? String(h).padStart(2, '0') : ''))}
            describe={(h) => t('{hour}:00: {time}', { hour: String(h).padStart(2, '0'), time: played(history.hours[h] ?? 0) })}
          />
          <div className="mt-4">
            <Bars
              values={history.weekdays}
              labels={history.weekdays.map((_, d) => weekdayName(d))}
              describe={(d) => t('{day}: {time}', { day: weekdayName(d), time: played(history.weekdays[d] ?? 0) })}
            />
          </div>
        </section>
        <section aria-label={t('Devices')} className="glass rounded-2xl p-4 sm:p-5">
          <h3 className="mb-3 text-base font-semibold text-white">{t('Devices')}</h3>
          {history.devices.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('Nothing to show yet.')}</p>
          ) : (
            <ul className="space-y-2.5">
              {history.devices.map((device) => (
                <li key={`${device.name}|${device.client}`} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate text-neutral-200" title={device.client}>
                    {device.name || device.client}
                  </span>
                  <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${(device.seconds / topDevice) * 100}%` }} />
                  </span>
                  <span className="tabular-nums text-neutral-400">{played(device.seconds)}</span>
                </li>
              ))}
            </ul>
          )}
          {history.converted > 0 && (
            <p className="mt-4 text-xs text-neutral-500">
              {t('The server converted {percent}% of the time played; the rest was played as it is.', { percent: converted })}
            </p>
          )}
        </section>
      </div>
    </section>
  )
}

/** What you have watched: hours, how many movies and episodes, the months you watched most, your genres and what you came back to. */
export function StatsPage({ session, onBack }: { session: Session; onBack: () => void }) {
  const load = useCallback(() => getWatchedTitles(session), [session])
  const { state, retry } = useAsync(load)
  // The plugin's own record, when the server has it and this account may read it; it never holds the page back.
  const loadHistory = useCallback(() => getPlayHistory(session), [session])
  const reporting = useAsync(loadHistory)
  const stats = useMemo(() => (state.status === 'ready' ? buildStats(state.data.titles) : null), [state])

  return (
    <div className="mx-auto max-w-4xl pt-8">
      <button type="button" className="btn mb-5" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      <h1 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">{t('Your stats')}</h1>
      <p className="mb-6 text-sm text-neutral-400">{t('Worked out here from what your server knows. Nothing is sent anywhere.')}</p>

      {state.status === 'loading' && (
        <p role="status" className="py-16 text-center text-neutral-400">
          {t('Counting what you watched…')}
        </p>
      )}
      {state.status === 'error' && (
        <StateMessage kind="error" size="section" message={t('Could not read your history: {message}', { message: state.message })}>
          <button type="button" className="btn" onClick={retry}>
            {t('Try again')}
          </button>
        </StateMessage>
      )}
      {state.status === 'ready' && stats && state.data.titles.length === 0 && (
        <StateMessage kind="empty" size="section" message={t('You have not watched anything yet. Come back after your first movie.')} />
      )}
      {state.status === 'ready' && stats && state.data.titles.length > 0 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Figure label={t('Time watched')} value={number(stats.hours)} unit={t('hours')} />
            <Figure label={t('Movies')} value={number(stats.movies)} />
            <Figure label={t('Episodes')} value={number(stats.episodes)} />
          </div>
          {state.data.total > state.data.titles.length && (
            <p className="text-xs text-neutral-500">
              {t('Based on your latest {shown} of {total} watched titles.', { shown: number(state.data.titles.length), total: number(state.data.total) })}
            </p>
          )}
          <Months stats={stats} />
          <div className="grid gap-5 md:grid-cols-2">
            <Genres stats={stats} />
            <section aria-label={t('Watched more than once')} className="glass rounded-2xl p-4 sm:p-5">
              <h2 className="mb-3 text-base font-semibold text-white">{t('Watched more than once')}</h2>
              {stats.rewatched.length === 0 ? (
                <p className="text-sm text-neutral-500">{t('Nothing to show yet.')}</p>
              ) : (
                <ol className="space-y-2">
                  {stats.rewatched.map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-neutral-200">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-neutral-400">{t('{count} times', { count: item.plays })}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      )}
      {reporting.state.status === 'ready' && reporting.state.data && (
        <div className="mt-8">
          <Recorded history={reporting.state.data} />
        </div>
      )}
    </div>
  )
}
