import { useEffect, useState } from 'react'
import type { Program } from '../../../core/modules'
import { t } from '../../../i18n'
import { programTitle } from './programText'

const SHOW_MS = 6000
/** Longer when there is a button to press. */
const SHOW_WITH_BUTTON_MS = 10_000

const clock = (seconds: number): string => new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * What a television shows for a moment when the program changes (and when you tune in): what is on now and what comes next. When the
 * viewer joined a program that was already well under way, it also says so and offers to start it from the beginning. It leaves by
 * itself; the parent draws a new one (with a new `key`) for each program.
 */
export function ChannelOsd({ now, next, joinedMinute, onStartOver }: { now: Program; next: Program | undefined; joinedMinute: number | null; onStartOver: () => void }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), joinedMinute !== null ? SHOW_WITH_BUTTON_MS : SHOW_MS)
    return () => window.clearTimeout(timer)
  }, [joinedMinute])
  if (!visible) return null

  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-5 z-[60] flex justify-center px-16 sm:px-24">
      <div className="pointer-events-auto min-w-0 max-w-xl rounded-2xl border border-white/12 bg-black/55 px-4 py-3 shadow-2xl backdrop-blur-md">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{t('Now')}</span>
          <span className="truncate text-base font-semibold text-white">{programTitle(now)}</span>
          {now.subtitle && <span className="hidden shrink-0 text-xs text-white/60 sm:inline">{now.subtitle}</span>}
        </p>
        {next && (
          <p className="mt-1 flex min-w-0 items-baseline gap-2 text-sm text-white/70">
            <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/80">{t('Next')}</span>
            <span className="shrink-0 tabular-nums">{clock(next.start)}</span>
            <span className="truncate">{programTitle(next)}</span>
          </p>
        )}
        {joinedMinute !== null && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/10 pt-2">
            <span className="text-sm text-white/80">{t('You tuned in at minute {minute}.', { minute: joinedMinute })}</span>
            <button
              type="button"
              className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              onClick={() => {
                setVisible(false)
                onStartOver()
              }}
            >
              {t('Start from the beginning')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
