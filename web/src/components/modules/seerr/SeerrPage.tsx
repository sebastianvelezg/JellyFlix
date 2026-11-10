import { useCallback, useRef, useState, type FormEvent } from 'react'
import type { Session } from '../../../core'
import {
  canAskForMore,
  seerrMe,
  seerrMyRequests,
  seerrPosterUrl,
  seerrRequest,
  seerrSearch,
  seerrTitle,
  type SeerrDetail,
  type SeerrMe,
  type SeerrMediaType,
  type SeerrQuota,
  type SeerrSearch,
  type SeerrRequestStatus,
  type SeerrRequestView,
  type SeerrStatus,
  type SeerrTitle,
} from '../../../core/modules'
import { getLanguage, t, tr } from '../../../i18n'
import { StateMessage } from '../../StateMessage'
import type { Navigate } from '../../route'
import { showToast } from '../../toast'
import { errorText, useAsync } from '../../useAsync'
import { useModulesClient } from '../ModulesProvider'

const STATUS_TEXT: Record<SeerrStatus, string> = {
  available: tr('In your library'),
  partial: tr('Partly in your library'),
  processing: tr('Being added'),
  pending: tr('Waiting for approval'),
  blocked: tr('Cannot be requested'),
  none: tr('Not in your library'),
}

const STATUS_STYLE: Record<SeerrStatus, string> = {
  available: 'bg-emerald-500/20 text-emerald-200',
  partial: 'bg-sky-500/20 text-sky-200',
  processing: 'bg-sky-500/20 text-sky-200',
  pending: 'bg-amber-500/20 text-amber-200',
  blocked: 'bg-red-500/20 text-red-200',
  none: 'bg-white/10 text-neutral-300',
}

const REQUEST_TEXT: Record<SeerrRequestStatus, string> = {
  pending: tr('Waiting for approval'),
  approved: tr('Approved'),
  declined: tr('Declined'),
  failed: tr('Failed'),
  completed: tr('Completed'),
}

/** Where a title of the library is opened in Jellyflix. */
const libraryRoute = (type: SeerrMediaType, id: string) => (type === 'movie' ? ({ page: 'movie', id } as const) : ({ page: 'show', id } as const))

/**
 * Seerr: look up movies and series that are not in the library yet and ask for them. The container talks to Seerr as this person (their
 * permissions and quota apply); this page only shows what it answers.
 */
export function SeerrPage({ go, initialQuery }: { session: Session; go: Navigate; /** A search handed over from the search results: it starts already searched. */ initialQuery?: string }) {
  const { client } = useModulesClient()
  // Who I am in Seerr and, when a search came with the page, its first answer (a failure of that search is shown on the page, not instead of it).
  const load = useCallback(async () => {
    const me = await seerrMe(client)
    if (!initialQuery) return { me, seed: null as Seed | null }
    try {
      return { me, seed: { query: initialQuery, answer: await seerrSearch(client, initialQuery, 1), error: null } as Seed }
    } catch (e) {
      return { me, seed: { query: initialQuery, answer: null, error: errorText(e) } as Seed }
    }
  }, [client, initialQuery])
  const { state, retry, update } = useAsync(load)
  const [tab, setTab] = useState<'search' | 'mine'>('search')

  if (state.status === 'loading') {
    return (
      <p role="status" className="py-16 text-center text-neutral-400">
        {t('Loading…')}
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <StateMessage kind="error" message={state.message}>
        <button type="button" className="btn" onClick={retry}>
          {t('Try again')}
        </button>
      </StateMessage>
    )
  }
  const { me, seed } = state.data
  const refreshQuota = () => void seerrMe(client).then((fresh) => update((before) => ({ ...before, me: fresh }))).catch(() => undefined)

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={t('Seerr')} className="flex gap-2">
        {(['search', 'mine'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'btn-primary' : 'btn'} onClick={() => setTab(id)}>
            {id === 'search' ? t('Search') : t('My requests')}
          </button>
        ))}
      </div>
      {tab === 'search' ? <Search me={me} go={go} onRequested={refreshQuota} seed={seed} /> : <Mine go={go} />}
    </div>
  )
}

/** A search that came with the page: its text and its first answer (or why it failed). */
interface Seed {
  query: string
  answer: SeerrSearch | null
  error: string | null
}

function Search({ me, go, onRequested, seed }: { me: SeerrMe; go: Navigate; onRequested: () => void; seed: Seed | null }) {
  const { client } = useModulesClient()
  const [text, setText] = useState(seed?.query ?? '')
  const [searched, setSearched] = useState(seed?.answer ? seed.query : '')
  const [results, setResults] = useState<SeerrTitle[]>(seed?.answer?.results ?? [])
  const [page, setPage] = useState({ current: seed?.answer?.page ?? 0, total: seed?.answer?.totalPages ?? 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(seed?.error ?? null)
  const [open, setOpen] = useState<SeerrTitle | null>(null)

  // Only the newest search may change the list: an older answer that arrives late is dropped.
  const latest = useRef(0)

  async function run(query: string, pageNumber: number) {
    const mine = (latest.current += 1)
    setBusy(true)
    setError(null)
    try {
      const answer = await seerrSearch(client, query, pageNumber)
      if (mine !== latest.current) return
      setResults((before) => (pageNumber === 1 ? answer.results : [...before, ...answer.results]))
      setPage({ current: answer.page, total: answer.totalPages })
      setSearched(query)
    } catch (e) {
      if (mine === latest.current) setError(errorText(e))
    } finally {
      if (mine === latest.current) setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const query = text.trim()
    if (query) void run(query, 1)
  }

  if (open) {
    return (
      <Detail
        key={`${open.mediaType}-${open.id}`}
        title={open}
        me={me}
        go={go}
        onBack={() => setOpen(null)}
        onChanged={(next) => {
          setOpen((current) => (current && current.mediaType === next.mediaType && current.id === next.id ? { ...current, status: next.status } : current))
          setResults((list) => list.map((r) => (r.mediaType === next.mediaType && r.id === next.id ? { ...r, status: next.status } : r)))
          onRequested()
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex flex-wrap gap-2" role="search">
        <label className="sr-only" htmlFor="seerr-query">
          {t('Search for a movie or series')}
        </label>
        <input
          id="seerr-query"
          type="search"
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Search for a movie or series')}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[.06] px-4 py-2.5 text-white placeholder:text-neutral-500"
        />
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
          {t('Search')}
        </button>
      </form>
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {searched && !busy && results.length === 0 && !error && <p className="py-10 text-center text-neutral-400">{t('Nothing found for “{query}”.', { query: searched })}</p>}
      {results.length > 0 && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" aria-label={t('Results')}>
          {results.map((r) => (
            <li key={`${r.mediaType}-${r.id}`}>
              <TitleCard title={r} onOpen={() => setOpen(r)} />
            </li>
          ))}
        </ul>
      )}
      {page.current > 0 && page.current < page.total && (
        <div className="text-center">
          <button type="button" className="btn" disabled={busy} onClick={() => void run(searched, page.current + 1)}>
            {busy ? t('Loading…') : t('More results')}
          </button>
        </div>
      )}
      <p className="text-xs text-neutral-500">{t('Posters come from TMDb. Your requests are made with your own Seerr account, so its rules and limits apply.')}</p>
    </div>
  )
}

function Poster({ path, name, className }: { path: string | undefined; name: string; className: string }) {
  const url = seerrPosterUrl(path)
  // A picture that cannot be loaded (TMDb blocked, no internet) leaves the name on a plain tile, like a title with no picture.
  const [failed, setFailed] = useState<string | null>(null)
  return url && failed !== url ? (
    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className={`${className} object-cover`} onError={() => setFailed(url)} />
  ) : (
    <div className={`${className} flex items-center justify-center bg-white/[.06] p-3 text-center text-sm font-semibold text-neutral-300`} aria-hidden="true">
      {name}
    </div>
  )
}

function StatusBadge({ status }: { status: SeerrStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{t(STATUS_TEXT[status])}</span>
}

function TitleCard({ title, onOpen }: { title: SeerrTitle; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group block w-full text-left">
      <Poster path={title.posterPath} name={title.title} className="aspect-[2/3] w-full rounded-xl transition group-hover:brightness-110 group-focus-visible:brightness-110" />
      <span className="mt-2 block truncate text-sm font-medium text-white">{title.title}</span>{' '}
      <span className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
        <span>{title.mediaType === 'movie' ? t('Movie') : t('Series')}</span>{' '}
        {title.year ? <span>{title.year}</span> : null}
      </span>{' '}
      <span className="mt-1 block">
        <StatusBadge status={title.status} />
      </span>
    </button>
  )
}

const quotaLine = (quota: SeerrQuota | undefined): string | null => {
  if (!quota?.limit) return null
  if (quota.restricted) return t('You have used all of your requests for now.')
  return t('Requests left: {left} of {limit} every {days} days.', { left: quota.remaining ?? Math.max(quota.limit - quota.used, 0), limit: quota.limit, days: quota.days ?? 0 })
}

function Detail({
  title,
  me,
  go,
  onBack,
  onChanged,
}: {
  title: SeerrTitle
  me: SeerrMe
  go: Navigate
  onBack: () => void
  onChanged: (next: SeerrTitle) => void
}) {
  const { client } = useModulesClient()
  const load = useCallback(() => seerrTitle(client, title.mediaType, title.id), [client, title.mediaType, title.id])
  const { state, retry, update } = useAsync(load)
  const [chosen, setChosen] = useState<number[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detail: SeerrDetail | null = state.status === 'ready' ? state.data : null
  const missing = detail?.seasons?.filter((s) => canAskForMore(s.status)).map((s) => s.number) ?? []
  // By default every season that is not in the library or on its way is ticked.
  const selected = chosen ?? missing
  const allowed = me.canRequest[title.mediaType]
  const isSeries = title.mediaType === 'tv'
  const hasSeasons = !!detail?.seasons && detail.seasons.length > 0
  const nothingToAsk = detail ? (isSeries && hasSeasons ? missing.length === 0 : detail.status !== 'none') : true
  const quota = quotaLine(me.quota[title.mediaType])

  async function ask() {
    if (!detail) return
    setBusy(true)
    setError(null)
    try {
      await seerrRequest(client, isSeries && hasSeasons ? { mediaType: 'tv', mediaId: title.id, seasons: selected } : { mediaType: title.mediaType, mediaId: title.id })
      showToast({ message: t('Requested. It will show up in your library when it arrives.') })
      const fresh = await seerrTitle(client, title.mediaType, title.id)
      update(() => fresh)
      setChosen(null)
      // The list behind (and the quota) follow what happened here.
      onChanged({ ...title, status: fresh.status })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="seerr-title" className="space-y-4">
      <button type="button" className="btn-ghost !px-3" onClick={onBack}>
        ← {t('Results')}
      </button>
      {state.status === 'loading' && (
        <p role="status" className="py-10 text-center text-neutral-400">
          {t('Loading…')}
        </p>
      )}
      {state.status === 'error' && (
        <StateMessage kind="error" message={state.message}>
          <button type="button" className="btn" onClick={retry}>
            {t('Try again')}
          </button>
        </StateMessage>
      )}
      {detail && (
        <div className="grid gap-5 sm:grid-cols-[12rem_1fr]">
          <Poster path={detail.posterPath} name={detail.title} className="aspect-[2/3] w-48 rounded-xl" />
          <div className="space-y-3">
            <h2 id="seerr-title" className="text-2xl font-semibold tracking-tight text-white">
              {detail.title}
              {detail.year ? <span className="ml-2 text-lg font-normal text-neutral-400">({detail.year})</span> : null}
            </h2>
            <StatusBadge status={detail.status} />
            {detail.tagline && <p className="text-sm italic text-neutral-400">{detail.tagline}</p>}
            {detail.overview && <p className="max-w-prose text-sm leading-relaxed text-neutral-300">{detail.overview}</p>}

            {isSeries && hasSeasons && (
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-sm font-medium text-white">{t('Seasons')}</legend>
                {detail.seasons?.map((s) => {
                  const can = canAskForMore(s.status)
                  return (
                    <label key={s.number} className={`flex items-center gap-3 text-sm ${can ? 'text-neutral-200' : 'text-neutral-500'}`}>
                      <input
                        type="checkbox"
                        disabled={!can || busy || !allowed}
                        checked={can && selected.includes(s.number)}
                        onChange={(e) => setChosen(e.target.checked ? [...selected, s.number].sort((a, b) => a - b) : selected.filter((n) => n !== s.number))}
                      />
                      <span>
                        {s.name}
                        {s.episodes ? ` · ${t('{count} episodes', { count: s.episodes })}` : ''}
                      </span>
                      {!can && <span className="text-xs">{t(STATUS_TEXT[s.status])}</span>}
                    </label>
                  )
                })}
              </fieldset>
            )}

            {error && (
              <p role="alert" className="alert-error">
                {error}
              </p>
            )}
            {quota && <p className="text-xs text-neutral-400">{quota}</p>}

            <div className="flex flex-wrap gap-2">
              {detail.jellyfinId && detail.status !== 'none' && (
                <button type="button" className="btn-primary" onClick={() => go(libraryRoute(detail.mediaType, detail.jellyfinId as string))}>
                  {t('Open in Jellyflix')}
                </button>
              )}
              {!nothingToAsk && detail.status !== 'blocked' && (
                <button
                  type="button"
                  className={detail.jellyfinId ? 'btn' : 'btn-primary'}
                  disabled={busy || !allowed || (isSeries && hasSeasons && selected.length === 0)}
                  onClick={() => void ask()}
                >
                  {busy ? t('Requesting…') : isSeries ? t('Request the chosen seasons') : t('Request this movie')}
                </button>
              )}
            </div>
            {!allowed && <p className="text-xs text-neutral-400">{t('Your Seerr account may not request this kind of title.')}</p>}
            {nothingToAsk && detail.status !== 'available' && detail.status !== 'blocked' && <p className="text-xs text-neutral-400">{t('There is nothing left to ask for: it is in the library or already requested.')}</p>}
          </div>
        </div>
      )}
    </section>
  )
}

function Mine({ go }: { go: Navigate }) {
  const { client } = useModulesClient()
  const loadFirst = useCallback(() => seerrMyRequests(client, 1), [client])
  const first = useAsync(loadFirst)
  // The pages after the first, asked for one at a time with "More results".
  const [later, setLater] = useState<{ rows: SeerrRequestView[]; page: number }>({ rows: [], page: 1 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function more() {
    setBusy(true)
    setError(null)
    try {
      const answer = await seerrMyRequests(client, later.page + 1)
      setLater((before) => ({ rows: [...before.rows, ...answer.results], page: answer.page }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (first.state.status === 'loading') {
    return (
      <p role="status" className="py-10 text-center text-neutral-400">
        {t('Loading…')}
      </p>
    )
  }
  if (first.state.status === 'error') {
    return (
      <StateMessage kind="error" message={first.state.message}>
        <button type="button" className="btn" onClick={first.retry}>
          {t('Try again')}
        </button>
      </StateMessage>
    )
  }
  const rows = [...first.state.data.results, ...later.rows]
  const totalPages = first.state.data.totalPages

  const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(getLanguage(), { dateStyle: 'medium' }) : '')

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {rows.length === 0 && <p className="py-10 text-center text-neutral-400">{t('You have not requested anything yet.')}</p>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="glass flex gap-4 rounded-2xl p-3">
            <Poster path={r.posterPath} name={r.title} className="h-24 w-16 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate font-medium text-white">{r.title}</p>
              <p className="text-xs text-neutral-400">
                {r.mediaType === 'movie' ? t('Movie') : t('Series')}
                {r.seasons?.length ? ` · ${t('Seasons {list}', { list: r.seasons.join(', ') })}` : ''}
                {r.createdAt ? ` · ${when(r.createdAt)}` : ''}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-neutral-200">{t(REQUEST_TEXT[r.status])}</span>
                {/* Where the title stands is only said when it adds something to the state of the request. */}
                {STATUS_TEXT[r.mediaStatus] !== REQUEST_TEXT[r.status] && <StatusBadge status={r.mediaStatus} />}
              </p>
            </div>
            {r.jellyfinId && (r.mediaStatus === 'available' || r.mediaStatus === 'partial') && (
              <div className="self-center">
                <button type="button" className="btn" onClick={() => go(libraryRoute(r.mediaType, r.jellyfinId as string))}>
                  {t('Open in Jellyflix')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {later.page < totalPages && (
        <div className="text-center">
          <button type="button" className="btn" disabled={busy} onClick={() => void more()}>
            {busy ? t('Loading…') : t('More results')}
          </button>
        </div>
      )}
    </div>
  )
}
