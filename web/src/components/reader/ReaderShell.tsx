import { useEffect, type ReactNode } from 'react'
import { BackIcon } from '../icons'
import { t } from '../../i18n'

/**
 * The frame of the reader: a full-screen layer with a top bar (Back, the title, and whatever controls the reader brings) and a
 * place for what is read. Escape leaves it.
 */
export function ReaderShell({
  title,
  controls,
  footer,
  onExit,
  children,
}: {
  title: string
  controls?: ReactNode
  footer?: ReactNode
  onExit: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  return (
    <div role="region" aria-label={t('Reading {title}', { title })} className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)] pt-[var(--safe-top)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 sm:gap-3 sm:px-4">
        <button type="button" className="btn shrink-0" onClick={onExit}>
          <BackIcon /> <span className="max-sm:sr-only">{t('Back')}</span>
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-100 sm:text-base">{title}</h1>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">{controls}</div>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
      {footer && <div className="border-t border-white/10 px-3 pb-[max(0.5rem,var(--safe-bottom))] pt-2 sm:px-4">{footer}</div>}
    </div>
  )
}

/** A thin bar showing how far through the book you are. */
export function ReadProgress({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-label={t('Progress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-1 overflow-hidden rounded-full bg-white/10"
    >
      <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  )
}
