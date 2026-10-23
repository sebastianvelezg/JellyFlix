import { t } from '../i18n'
import { useCallback, useEffect, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

export function errorText(e: unknown): string {
  return t(e instanceof Error && e.message ? e.message : 'Something went wrong.')
}

/**
 * Runs `load` on mount and whenever its identity changes (wrap it in `useCallback`), exposing a
 * simple loading / error / ready state with `retry` and a local `update` for optimistic edits.
 * Render the consumer with a `key` to start a clean load for a different subject.
 */
export function useAsync<T>(load: () => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    load()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorText(e) })
      })
    return () => {
      cancelled = true
    }
  }, [load, attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  const update = useCallback((fn: (data: T) => T) => {
    setState((s) => (s.status === 'ready' ? { status: 'ready', data: fn(s.data) } : s))
  }, [])

  return { state, retry, update }
}
