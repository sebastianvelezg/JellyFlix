import { useCallback, useRef, useState } from 'react'
import {
  BATCH_LIMIT,
  batchProblem,
  confirmsName,
  deleteTitle,
  describeBatch,
  findTitles,
  getLibraries,
  performFor,
  refreshItem,
  runBatch,
  scanAllLibraries,
  TITLE_PAGE,
  type BatchAction,
  type BatchProgress,
  type BatchResult,
  type Session,
  type TitleQuery,
  type TitleRow,
} from '../../core'
import { t, tr } from '../../i18n'
import { Card } from '../SettingsParts'
import { StateMessage } from '../StateMessage'
import { showToast } from '../toast'
import { useAsync } from '../useAsync'
import { openItemEditor, useReloadOnEdit } from './editorEvents'
import { adminErrorText, ConfirmBox } from './parts'

/** Libraries: scan them, find titles the server did not recognise, change many titles at once, delete one. */
export function LibraryAdmin({ session }: { session: Session }) {
  return (
    <div className="space-y-5">
      <Libraries session={session} />
      <TitleFinder session={session} />
    </div>
  )
}

function Libraries({ session }: { session: Session }) {
  const load = useCallback(() => getLibraries(session), [session])
  const { state, retry } = useAsync(load)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function scan(id: string | null, name: string) {
    setBusy(id ?? 'all')
    setError(null)
    try {
      if (id) await refreshItem(session, id, 'scan')
      else await scanAllLibraries(session)
      showToast({ message: id ? t('The server is scanning {name}.', { name }) : t('The server is scanning every library.') })
      window.setTimeout(retry, 1500)
    } catch (e) {
      setError(adminErrorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title={t('Libraries')} description={t('The folders your server watches. A scan looks for new, changed and removed files; the server does it in the background.')}>
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {state.status === 'loading' && <p className="text-sm text-neutral-400">{t('Loading…')}</p>}
      {state.status === 'error' && <StateMessage kind="error" size="section" message={state.message}><button type="button" className="btn" onClick={retry}>{t('Try again')}</button></StateMessage>}
      {state.status === 'ready' && (
        <>
          <ul aria-label={t('Libraries')} className="space-y-2">
            {state.data.map((lib) => (
              <li key={lib.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">{lib.name}</p>
                  <p className="break-all text-xs text-neutral-500">{lib.locations.join(' · ') || t('No folders')}</p>
                  {lib.refreshing && <p className="text-xs text-[var(--color-accent)]">{lib.progress != null ? t('Scanning… {percent}%', { percent: Math.round(lib.progress) }) : t('Scanning…')}</p>}
                </div>
                <button type="button" className="btn" disabled={busy !== null || lib.refreshing} aria-label={t('Scan {name}', { name: lib.name })} onClick={() => void scan(lib.id, lib.name)}>
                  {t('Scan')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void scan(null, '')}>
            {t('Scan all libraries')}
          </button>
        </>
      )}
    </Card>
  )
}

// ---- finding titles and changing many at once ----------------------------------------------------------

type Kind = 'Movie' | 'Series'
type ActionChoice = 'watched' | 'unwatched' | 'scan' | 'missing' | 'all' | 'lock' | 'unlock' | 'tag' | 'untag'

const ACTION_LABEL: Record<ActionChoice, string> = {
  watched: tr('Mark as watched (for you)'),
  unwatched: tr('Mark as not watched (for you)'),
  scan: tr('Look for changed files'),
  missing: tr('Look for missing details'),
  all: tr('Replace the details from the providers'),
  lock: tr('Keep everything as it is (lock)'),
  unlock: tr('Allow the server to replace details (unlock)'),
  tag: tr('Add a tag'),
  untag: tr('Remove a tag'),
}

function toAction(choice: ActionChoice, tag: string): BatchAction {
  switch (choice) {
    case 'watched':
    case 'unwatched':
      return { kind: 'watched', value: choice === 'watched' }
    case 'scan':
    case 'missing':
    case 'all':
      return { kind: 'refresh', mode: choice }
    case 'lock':
    case 'unlock':
      return { kind: 'lock', value: choice === 'lock' }
    case 'tag':
    case 'untag':
      return { kind: 'tag', tag, add: choice === 'tag' }
  }
}

function TitleFinder({ session }: { session: Session }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<Kind>('Movie')
  const [unidentified, setUnidentified] = useState(false)
  const [applied, setApplied] = useState({ text: '', kind: 'Movie' as Kind, unidentified: false, nonce: 0 })
  const [selected, setSelected] = useState<Map<string, string>>(new Map())
  const apply = (next: Partial<typeof applied>) => setApplied((a) => ({ ...a, ...next }))

  const toggle = (row: Pick<TitleRow, 'id' | 'name'>) =>
    setSelected((s) => {
      const next = new Map(s)
      if (next.has(row.id)) next.delete(row.id)
      else next.set(row.id, row.name)
      return next
    })

  return (
    <Card title={t('Titles')} description={t('Find titles, see the ones the server could not recognise, and change several at once.')}>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
        role="search"
        aria-label={t('Find titles')}
        onSubmit={(e) => {
          e.preventDefault()
          apply({ text })
        }}
      >
        <div>
          <label htmlFor="titles-q" className="mb-1 block text-sm font-medium text-neutral-100">
            {t('Name')}
          </label>
          <input id="titles-q" className="field" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary">
          {t('Find')}
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <fieldset className="flex items-center gap-3">
          <legend className="sr-only">{t('Kind of title')}</legend>
          {(['Movie', 'Series'] as const).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-200">
              <input
                type="radio"
                name="titles-kind"
                className="accent-[var(--color-accent)]"
                checked={kind === k}
                onChange={() => {
                  setKind(k)
                  apply({ kind: k, text })
                }}
              />
              {k === 'Movie' ? t('Movies') : t('Series')}
            </label>
          ))}
        </fieldset>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-accent)]"
            checked={unidentified}
            onChange={(e) => {
              setUnidentified(e.target.checked)
              apply({ unidentified: e.target.checked, text })
            }}
          />
          {t('Only titles the server could not recognise')}
        </label>
      </div>

      <TitleList key={`${applied.text}|${applied.kind}|${applied.unidentified}|${applied.nonce}`} session={session} query={applied} selected={selected} onToggle={toggle} onSelectMany={(rows) => setSelected((s) => new Map([...s, ...rows.map((r) => [r.id, r.name] as const)]))} onChanged={() => apply({ nonce: applied.nonce + 1 })} />

      {selected.size > 0 && (
        <BatchBar
          session={session}
          selected={selected}
          onClear={() => setSelected(new Map())}
          onDone={() => {
            setSelected(new Map())
            apply({ nonce: applied.nonce + 1 })
          }}
        />
      )}
    </Card>
  )
}

function TitleList({
  session,
  query,
  selected,
  onToggle,
  onSelectMany,
  onChanged,
}: {
  session: Session
  query: { text: string; kind: Kind; unidentified: boolean }
  selected: Map<string, string>
  onToggle: (row: TitleRow) => void
  onSelectMany: (rows: TitleRow[]) => void
  onChanged: () => void
}) {
  const make = (start: number): TitleQuery => ({ text: query.text, type: query.kind, unidentified: query.unidentified, start, limit: TITLE_PAGE })
  const load = useCallback(() => findTitles(session, make(0)), [session, query.text, query.kind, query.unidentified]) // eslint-disable-line react-hooks/exhaustive-deps
  const first = useAsync(load)
  useReloadOnEdit(first.retry)
  const [more, setMore] = useState<TitleRow[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TitleRow | null>(null)

  if (first.state.status === 'loading') return <p role="status" className="text-sm text-neutral-400">{t('Loading…')}</p>
  if (first.state.status === 'error') return <StateMessage kind="error" size="section" message={first.state.message}><button type="button" className="btn" onClick={first.retry}>{t('Try again')}</button></StateMessage>
  const { rows: firstRows, total } = first.state.data
  const rows = [...firstRows, ...more]

  async function showMore() {
    setLoadingMore(true)
    setError(null)
    try {
      const page = await findTitles(session, make(rows.length))
      setMore((m) => [...m, ...page.rows.filter((r) => !rows.some((x) => x.id === r.id))])
    } catch (e) {
      setError(adminErrorText(e))
    } finally {
      setLoadingMore(false)
    }
  }

  if (rows.length === 0) return <StateMessage kind="empty" size="section" message={query.unidentified ? t('Every title was recognised.') : t('No titles match.')} />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-400">
        <span aria-live="polite">{t('Showing {shown} of {total} titles', { shown: rows.length, total })}</span>
        <button type="button" className="btn-ghost" onClick={() => onSelectMany(rows.slice(0, BATCH_LIMIT))}>
          {t('Select the ones shown')}
        </button>
      </div>
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      <ul aria-label={t('Titles')} className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                aria-label={t('Select {name}', { name: row.name })}
                checked={selected.has(row.id)}
                onChange={() => onToggle(row)}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">
                  {row.name} {row.year ? <span className="font-normal text-neutral-400">({row.year})</span> : null}
                </p>
                {row.path && <p className="break-all text-xs text-neutral-500">{row.path}</p>}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="chip">{row.type === 'Movie' ? t('Movie') : t('Series')}</span>
                  {!row.identified && <span className="chip-accent">{t('Not recognised')}</span>}
                  {row.tags.map((tag) => (
                    <span key={tag} className="chip">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <button type="button" className="btn" aria-label={t('Edit {name}', { name: row.name })} onClick={() => openItemEditor({ id: row.id, name: row.name, type: row.type })}>
                  {t('Edit')}
                </button>
                <button type="button" className="btn text-red-300" aria-label={t('Delete {name}', { name: row.name })} onClick={() => setDeleting(deleting?.id === row.id ? null : row)}>
                  {t('Delete…')}
                </button>
              </div>
            </div>
            {deleting?.id === row.id && <DeleteBox session={session} row={row} onCancel={() => setDeleting(null)} onDeleted={() => { setDeleting(null); onChanged() }} />}
          </li>
        ))}
      </ul>
      {rows.length < total && (
        <button type="button" className="btn" disabled={loadingMore} onClick={() => void showMore()}>
          {loadingMore ? t('Loading…') : t('Show more')}
        </button>
      )}
    </div>
  )
}

function DeleteBox({ session, row, onCancel, onDeleted }: { session: Session; row: TitleRow; onCancel: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = confirmsName(typed, row.name)
  const id = `del-${row.id}`
  return (
    <div className="mt-3">
      <ConfirmBox
        danger
        busy={busy}
        confirmLabel={ok ? t('Delete for good') : t('Type the name first')}
        onCancel={onCancel}
        onConfirm={() => {
          if (!ok) return
          setBusy(true)
          setError(null)
          deleteTitle(session, row.id)
            .then(() => {
              showToast({ message: t('Deleted {name} from the server.', { name: row.name }) })
              onDeleted()
            })
            .catch((e: unknown) => setError(adminErrorText(e)))
            .finally(() => setBusy(false))
        }}
      >
        <p>
          {t('Delete “{name}” from the server? It disappears for everybody, and the server may also delete its files from the disk. This cannot be undone.', { name: row.name })}
        </p>
        {row.path && <p className="mt-1 break-all text-xs text-neutral-400">{row.path}</p>}
        <label htmlFor={id} className="mt-3 block text-sm font-medium">
          {t('Type the name of the title to confirm')}
        </label>
        <input id={id} className="field mt-1" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        {error && (
          <p role="alert" className="alert-error mt-2">
            {error}
          </p>
        )}
      </ConfirmBox>
    </div>
  )
}

type Phase = { name: 'choose' } | { name: 'preview' } | { name: 'running'; progress: BatchProgress } | { name: 'done'; results: BatchResult[] }

function BatchBar({ session, selected, onClear, onDone }: { session: Session; selected: Map<string, string>; onClear: () => void; onDone: () => void }) {
  const [choice, setChoice] = useState<ActionChoice>('missing')
  const [tag, setTag] = useState('')
  const [phase, setPhase] = useState<Phase>({ name: 'choose' })
  const stop = useRef<AbortController | null>(null)
  const action = toAction(choice, tag)
  const rows = [...selected].map(([id, name]) => ({ id, name }))
  const problem = batchProblem(action, rows.length)
  const sentence = (a: BatchAction) => t(describeBatch(a), { tag: a.kind === 'tag' ? a.tag.trim() : '' })

  async function start() {
    const controller = new AbortController()
    stop.current = controller
    setPhase({ name: 'running', progress: { done: 0, total: rows.length, results: [] } })
    const results = await runBatch(rows, performFor(session, action), { signal: controller.signal, onProgress: (progress) => setPhase({ name: 'running', progress }) })
    setPhase({ name: 'done', results })
    const failed = results.filter((r) => r.outcome === 'failed').length
    showToast({ message: failed ? t('Done, but {count} titles failed.', { count: failed }) : t('Done: {count} titles.', { count: results.length }) })
  }

  return (
    <section aria-label={t('Change the chosen titles')} className="rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white" aria-live="polite">
          {t('{count} titles chosen', { count: selected.size })}
        </h3>
        {phase.name !== 'running' && (
          <button type="button" className="btn-ghost" onClick={onClear}>
            {t('Clear the choice')}
          </button>
        )}
      </div>

      {phase.name === 'choose' && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="batch-action" className="mb-1 block text-sm font-medium text-neutral-100">
              {t('What to do')}
            </label>
            <select id="batch-action" className="select" value={choice} onChange={(e) => setChoice(e.target.value as ActionChoice)}>
              {(Object.keys(ACTION_LABEL) as ActionChoice[]).map((c) => (
                <option key={c} value={c}>
                  {t(ACTION_LABEL[c])}
                </option>
              ))}
            </select>
          </div>
          {(choice === 'tag' || choice === 'untag') && (
            <div>
              <label htmlFor="batch-tag" className="mb-1 block text-sm font-medium text-neutral-100">
                {t('Tag')}
              </label>
              <input id="batch-tag" className="field" value={tag} maxLength={80} onChange={(e) => setTag(e.target.value)} />
            </div>
          )}
          <button type="button" className="btn-primary" disabled={problem !== null} onClick={() => setPhase({ name: 'preview' })}>
            {t('Preview')}
          </button>
          {problem && <p className="w-full text-xs text-neutral-400">{t(problem)}</p>}
        </div>
      )}

      {phase.name === 'preview' && (
        <div className="mt-3">
          <ConfirmBox confirmLabel={t('Start')} onConfirm={() => void start()} onCancel={() => setPhase({ name: 'choose' })}>
            <p className="font-medium">{t('{what} for {count} titles:', { what: sentence(action), count: rows.length })}</p>
            <ul aria-label={t('Titles that will change')} className="mt-2 list-disc space-y-0.5 pl-5 text-neutral-200">
              {rows.slice(0, 8).map((r) => (
                <li key={r.id}>{r.name}</li>
              ))}
            </ul>
            {rows.length > 8 && <p className="mt-1 text-neutral-400">{t('…and {count} more.', { count: rows.length - 8 })}</p>}
            {action.kind === 'refresh' && action.mode === 'all' && <p className="mt-2 text-amber-200">{t('This writes over the details of every one of them (what you kept as it is stays).')}</p>}
            {action.kind === 'watched' && <p className="mt-2 text-neutral-400">{t('This changes only your own watched marks.')}</p>}
          </ConfirmBox>
        </div>
      )}

      {phase.name === 'running' && (
        <div className="mt-3 space-y-2">
          <progress className="h-2 w-full accent-[var(--color-accent)]" max={phase.progress.total} value={phase.progress.done} aria-label={t('Progress')} />
          <p role="status" className="text-sm text-neutral-200">
            {t('Done {done} of {total}', { done: phase.progress.done, total: phase.progress.total })}
          </p>
          <button type="button" className="btn" onClick={() => stop.current?.abort()}>
            {t('Stop')}
          </button>
        </div>
      )}

      {phase.name === 'done' && <BatchReport results={phase.results} onClose={onDone} />}
    </section>
  )
}

function BatchReport({ results, onClose }: { results: BatchResult[]; onClose: () => void }) {
  const count = (o: BatchResult['outcome']) => results.filter((r) => r.outcome === o).length
  const problems = results.filter((r) => r.outcome !== 'done')
  return (
    <div className="mt-3 space-y-2">
      <p role="status" className="text-sm font-medium text-white">
        {t('{done} done, {skipped} left as they were, {failed} failed.', { done: count('done'), skipped: count('skipped'), failed: count('failed') })}
      </p>
      {problems.length > 0 && (
        <ul aria-label={t('Titles that were not changed')} className="space-y-0.5 text-sm text-neutral-300">
          {problems.map((r) => (
            <li key={r.id}>
              {r.name}: <span className="text-neutral-400">{r.reason ? t(r.reason) : t('Already as asked.')}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" onClick={onClose}>
        {t('Close')}
      </button>
    </div>
  )
}
