import { StateMessage } from './StateMessage'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { errorText } from './useAsync'
import { t } from '../i18n'

export interface PageOf<T> {
  items: T[]
  total: number
}

type State<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: T[]; total: number; loadingMore: boolean; moreError?: string }

/**
 * A list that loads one page at a time and fetches the next page when you scroll near the end. What each
 * item looks like (`renderItem`) and how the list is laid out (`className`) are up to the caller, so it serves
 * poster grids, album grids and song lists alike. Render it with a `key` that changes whenever `load` means
 * something different (library, sort, filter, search term) to get a clean first load.
 */
export function PagedView<T extends { id: string }>({
  load,
  renderItem,
  className,
  placeholder,
  placeholderCount = 12,
  noun,
  emptyMessage,
  onTotal,
  summary,
  itemClassName,
}: {
  /** Fetches items starting at `startIndex`. Wrap it in `useCallback`. */
  load: (startIndex: number) => Promise<PageOf<T>>
  /** `items` is everything loaded so far, e.g. to queue the rest of a song list. */
  renderItem: (item: T, index: number, items: T[]) => ReactNode
  /** Classes of the `<ul>` (a grid or a plain list). */
  className: string
  /** One loading placeholder (shown several times while loading). */
  placeholder: ReactNode
  placeholderCount?: number
  /** What is being listed, for messages: "movies", "albums"... */
  noun: string
  /** Shown when there is nothing; the list renders nothing at all when this is omitted. */
  emptyMessage?: string
  /** Told the total once the first page has loaded (or after it fails: 0), e.g. to hide an empty search section. */
  onTotal?: (total: number) => void
  /** Optional line above the list, e.g. "60 of 402 movies". */
  summary?: (shown: number, total: number) => string
  /** Classes of each list item (e.g. `cv-card`, which makes a long grid cheap to scroll). */
  itemClassName?: string
}) {
  const [state, setState] = useState<State<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const sentinel = useRef<HTMLDivElement>(null)
  const canObserve = typeof IntersectionObserver !== 'undefined'

  useEffect(() => {
    let cancelled = false
    load(0)
      .then((page) => {
        if (!cancelled) setState({ status: 'ready', ...page, loadingMore: false })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorText(e) })
      })
    return () => {
      cancelled = true
    }
  }, [load, attempt])

  const firstTotal = state.status === 'ready' ? state.total : state.status === 'error' ? 0 : null
  useEffect(() => {
    if (firstTotal !== null) onTotal?.(firstTotal)
  }, [firstTotal, onTotal])

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || state.loadingMore) return
    setState({ ...state, loadingMore: true, moreError: undefined })
    load(state.items.length)
      .then((page) =>
        setState((s) =>
          s.status === 'ready'
            ? {
                ...s,
                items: [...s.items, ...page.items],
                // A later page may come without a count (it is the slow part): the first number stays, grows if the
                // server says so, and ends the list when a page comes back empty.
                total: page.items.length === 0 ? s.items.length : Math.max(s.total, page.total, s.items.length + page.items.length),
                loadingMore: false,
              }
            : s,
        ),
      )
      .catch((e: unknown) =>
        setState((s) => (s.status === 'ready' ? { ...s, loadingMore: false, moreError: errorText(e) } : s)),
      )
  }, [state, load])

  const hasMore = state.status === 'ready' && state.items.length < state.total
  const autoLoad = canObserve && hasMore && state.status === 'ready' && !state.moreError

  // Load the next page when the sentinel below the list comes within a screen of the viewport.
  useEffect(() => {
    const el = sentinel.current
    if (!autoLoad || !el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore()
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [autoLoad, loadMore])

  if (state.status === 'loading') {
    return (
      <div role="status" aria-label={t('Loading {noun}', { noun: t(noun) })} className={className}>
        {Array.from({ length: placeholderCount }, (_, i) => (
          <div key={i}>{placeholder}</div>
        ))}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <StateMessage kind="error" size="section" message={t('Could not load {noun}: {message}', { noun: t(noun), message: state.message })}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setState({ status: 'loading' })
            setAttempt((n) => n + 1)
          }}
        >
          {t('Try again')}
        </button>
      </StateMessage>
    )
  }

  if (state.items.length === 0) {
    return emptyMessage ? <StateMessage kind="empty" size="section" message={emptyMessage} /> : null
  }

  return (
    <>
      {summary && (
        <p className="mb-4 text-xs font-medium uppercase tracking-wider text-neutral-500">
          {summary(state.items.length, state.total)}
        </p>
      )}
      <ul className={className}>
        {state.items.map((item, i) => (
          <li key={item.id} className={itemClassName}>
            {renderItem(item, i, state.items)}
          </li>
        ))}
        {state.loadingMore &&
          Array.from({ length: 6 }, (_, i) => (
            <li key={`more-${i}`}>{placeholder}</li>
          ))}
      </ul>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      {state.moreError && (
        <p role="alert" className="mt-4 text-center text-sm text-red-300">
          {t('Could not load more: {message}', { message: state.moreError })}
        </p>
      )}
      {hasMore && (!canObserve || state.moreError) && (
        <div className="mt-8 text-center">
          <button type="button" className="btn" onClick={loadMore} disabled={state.loadingMore}>
            {state.loadingMore ? t('Loading…') : t('Load more')}
          </button>
        </div>
      )}
    </>
  )
}
