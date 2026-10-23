import { useEffect, useState } from 'react'

/** A short message at the bottom of the screen, with an optional button ("Undo"). It goes away by itself. */
export interface Toast {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
  /** Milliseconds on screen. */
  duration: number
}

const EVENT = 'jellyflix:toast'
let counter = 0

export function showToast(toast: { message: string; actionLabel?: string; onAction?: () => void; duration?: number }): void {
  counter += 1
  window.dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: { duration: 6000, ...toast, id: counter } }))
}

/** Shows the toasts. One of them lives in the app. */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const onToast = (e: Event) => {
      const toast = (e as CustomEvent<Toast>).detail
      setToasts((list) => [...list.slice(-2), toast])
      window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== toast.id)), toast.duration)
    }
    window.addEventListener(EVENT, onToast)
    return () => window.removeEventListener(EVENT, onToast)
  }, [])

  if (toasts.length === 0) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+var(--nav-h)+var(--bottom-inset))] z-[55] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex max-w-md items-center gap-3 rounded-full border border-white/10 bg-[var(--color-surface-3)] py-2 pl-4 pr-2 text-sm text-neutral-100 shadow-[0_18px_50px_-10px_rgba(0,0,0,0.85)]"
        >
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              className="rounded-full px-3 py-1 text-sm font-semibold text-[var(--color-accent)] hover:bg-white/10"
              onClick={() => {
                toast.onAction?.()
                setToasts((list) => list.filter((x) => x.id !== toast.id))
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
