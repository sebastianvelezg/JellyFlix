import { useEffect, useState, useSyncExternalStore } from 'react'
import { t } from '../i18n'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** Whether the browser thinks it has a network connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/**
 * A thin notice under the header while the connection is down, and a short "back online" when it returns.
 * Requests that fail meanwhile are retried automatically (reads) or show their own retry buttons.
 */
export function OfflineBanner() {
  const online = useOnline()
  const [justBack, setJustBack] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onBack = () => {
      setJustBack(true)
      timer = setTimeout(() => setJustBack(false), 3000)
    }
    const onGone = () => {
      if (timer) clearTimeout(timer)
      setJustBack(false)
    }
    window.addEventListener('online', onBack)
    window.addEventListener('offline', onGone)
    return () => {
      window.removeEventListener('online', onBack)
      window.removeEventListener('offline', onGone)
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (online && !justBack) return null
  return (
    <div
      role="status"
      className={`fixed inset-x-0 top-[var(--header-h)] z-20 px-4 py-1.5 text-center text-sm font-medium backdrop-blur-md ${
        online ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/20 text-amber-100'
      }`}
    >
      {online ? t('Back online.') : t('You are offline. Things will pick up again when your connection returns.')}
    </div>
  )
}
