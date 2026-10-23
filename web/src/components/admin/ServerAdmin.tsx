import { useCallback, useState } from 'react'
import { ACTIVITY_PAGE, getActivity, getServerSummary, getTasks, startTask, stopTask, type ActivityLine, type ServerTask, type Session } from '../../core'
import { t, tr } from '../../i18n'
import { Card } from '../SettingsParts'
import { StateMessage } from '../StateMessage'
import { showToast } from '../toast'
import { useAsync } from '../useAsync'
import { adminErrorText, when } from './parts'

const RESULT_LABEL: Record<string, string> = { Completed: tr('Completed'), Failed: tr('Failed'), Cancelled: tr('Cancelled'), Aborted: tr('Aborted') }
const SEVERITY_LABEL: Record<string, string> = { Trace: tr('Trace'), Debug: tr('Debug'), Warning: tr('Warning'), Error: tr('Error'), Critical: tr('Critical') }

/** The server at a glance, its scheduled tasks, and what happened lately. */
export function ServerAdmin({ session }: { session: Session }) {
  return (
    <div className="space-y-5">
      <Health session={session} />
      <Tasks session={session} />
      <Activity session={session} />
    </div>
  )
}

function Fact({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' | 'ok' }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-200' : 'text-white'}`}>{value}</dd>
    </div>
  )
}

function Health({ session }: { session: Session }) {
  const load = useCallback(() => getServerSummary(session), [session])
  const { state, retry } = useAsync(load)
  return (
    <Card title={t('The server')} description={t('A look at how the server is doing right now.')}>
      {state.status === 'loading' && <p className="text-sm text-neutral-400">{t('Loading…')}</p>}
      {state.status === 'error' && <StateMessage kind="error" size="section" message={state.message}><button type="button" className="btn" onClick={retry}>{t('Try again')}</button></StateMessage>}
      {state.status === 'ready' && (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label={t('Server')} value={state.data.name} />
            <Fact label={t('Version')} value={state.data.version} />
            <Fact label={t('System')} value={state.data.os || '–'} />
            <Fact label={t('Connected devices')} value={state.data.sessions} />
            <Fact label={t('Playing now')} value={state.data.playing} />
            <Fact label={t('Being converted')} value={state.data.converting} tone={state.data.converting > 0 ? 'warn' : undefined} />
            <Fact label={t('Tasks running')} value={state.data.tasksRunning} />
            <Fact label={t('Tasks that failed last time')} value={state.data.tasksFailed} tone={state.data.tasksFailed > 0 ? 'warn' : 'ok'} />
          </dl>
          <ul aria-label={t('Notices')} className="space-y-1.5 text-sm">
            {state.data.hasUpdate && <li className="alert-info">{t('A newer version of the server is available. Update it from the server itself (this app does not install updates).')}</li>}
            {state.data.pendingRestart && <li className="alert-info">{t('The server is waiting for a restart to finish a change.')}</li>}
            {state.data.shuttingDown && <li className="alert-error">{t('The server is shutting down.')}</li>}
            {!state.data.hasUpdate && !state.data.pendingRestart && !state.data.shuttingDown && <li className="text-neutral-400">{t('Nothing needs your attention.')}</li>}
          </ul>
          <div>
            <button type="button" className="btn" onClick={retry}>
              {t('Refresh')}
            </button>
          </div>
        </>
      )}
    </Card>
  )
}

function Tasks({ session }: { session: Session }) {
  const load = useCallback(() => getTasks(session), [session])
  const { state, retry } = useAsync(load)
  const [error, setError] = useState<string | null>(null)

  async function act(task: ServerTask) {
    setError(null)
    try {
      if (task.running) await stopTask(session, task.id)
      else await startTask(session, task.id)
      showToast({ message: task.running ? t('Asked “{name}” to stop.', { name: task.name }) : t('Started “{name}”.', { name: task.name }) })
      window.setTimeout(retry, 600)
    } catch (e) {
      setError(adminErrorText(e))
    }
  }

  const categories = state.status === 'ready' ? [...new Set(state.data.map((x) => x.category || t('Other')))].sort() : []
  return (
    <Card title={t('Scheduled tasks')} description={t('Work the server does by itself. You can start one now, or stop one that is running.')}>
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {state.status === 'loading' && <p className="text-sm text-neutral-400">{t('Loading…')}</p>}
      {state.status === 'error' && <StateMessage kind="error" size="section" message={state.message}><button type="button" className="btn" onClick={retry}>{t('Try again')}</button></StateMessage>}
      {state.status === 'ready' &&
        categories.map((category) => (
          <section key={category} aria-label={category}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{category}</h3>
            <ul className="space-y-2">
              {state.data
                .filter((x) => (x.category || t('Other')) === category)
                .map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white">{task.name}</p>
                      <p className="text-xs text-neutral-500">
                        {task.running
                          ? task.progress != null
                            ? t('Running… {percent}%', { percent: Math.round(task.progress) })
                            : t('Running…')
                          : task.lastResult
                            ? `${t('Last run: {result}', { result: t(RESULT_LABEL[task.lastResult] ?? task.lastResult) })}${task.lastEnd ? ` · ${when(task.lastEnd.getTime())}` : ''}`
                            : t('Never ran')}
                      </p>
                    </div>
                    <button type="button" className="btn" aria-label={task.running ? t('Stop {name}', { name: task.name }) : t('Run now: {name}', { name: task.name })} disabled={task.cancelling} onClick={() => void act(task)}>
                      {task.running ? t('Stop') : t('Run now')}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </Card>
  )
}

function Activity({ session }: { session: Session }) {
  const load = useCallback(() => getActivity(session, 0), [session])
  const first = useAsync(load)
  const [more, setMore] = useState<ActivityLine[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lines = first.state.status === 'ready' ? [...first.state.data.lines, ...more] : []
  const total = first.state.status === 'ready' ? first.state.data.total : 0

  async function showMore() {
    setLoading(true)
    setError(null)
    try {
      const page = await getActivity(session, lines.length)
      setMore((m) => [...m, ...page.lines])
    } catch (e) {
      setError(adminErrorText(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title={t('Activity')} description={t('Sign-ins, playback and tasks, newest first.')}>
      {first.state.status === 'loading' && <p className="text-sm text-neutral-400">{t('Loading…')}</p>}
      {first.state.status === 'error' && <StateMessage kind="error" size="section" message={first.state.message}><button type="button" className="btn" onClick={first.retry}>{t('Try again')}</button></StateMessage>}
      {first.state.status === 'ready' && lines.length === 0 && <p className="text-sm text-neutral-400">{t('Nothing has happened yet.')}</p>}
      {lines.length > 0 && (
        <ol aria-label={t('Activity')} className="divide-y divide-white/5 rounded-2xl border border-white/10">
          {lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
              <p className="min-w-0 text-sm text-neutral-100">
                {line.severity !== 'Information' && <span className="mr-2 chip-accent">{t(SEVERITY_LABEL[line.severity] ?? line.severity)}</span>}
                {line.name}
                {line.detail && <span className="text-neutral-500"> · {line.detail}</span>}
              </p>
              <time className="shrink-0 text-xs text-neutral-500" dateTime={line.date.toISOString()}>
                {when(line.date.getTime())}
              </time>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {lines.length > 0 && lines.length < total && (
        <button type="button" className="btn" disabled={loading} onClick={() => void showMore()}>
          {loading ? t('Loading…') : t('Show {count} more', { count: Math.min(ACTIVITY_PAGE, total - lines.length) })}
        </button>
      )}
    </Card>
  )
}
