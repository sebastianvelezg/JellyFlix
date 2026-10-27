import type { ReactNode } from 'react'
import { t } from '../../i18n'

/**
 * A music video left with Back goes on playing in a bar at the bottom of the page, in the same place as the music's bar, while you
 * look for another one. The player keeps the same <video>: only its clothes change (see `mini` in the stage).
 */
export const DOCK_BAR_CLASS =
  'fixed inset-x-0 bottom-[var(--nav-h)] z-40 flex items-center gap-3 border-t border-white/10 bg-[var(--color-bg)]/85 pt-2.5 pb-[calc(0.625rem+var(--bottom-inset))] backdrop-blur-2xl gutter-x sm:gap-5'

/** The round buttons of the bar (the same look as the music bar's). */
export const DOCK_BUTTON =
  'inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-300 transition hover:bg-white/10 hover:text-white pointer-coarse:h-11 pointer-coarse:w-11 disabled:cursor-not-allowed disabled:opacity-35'

/** The picture's place in the bar. */
export const DOCK_THUMB_CLASS = 'aspect-video h-12 shrink-0 rounded-lg bg-black object-cover'

/** The bar while the video is being prepared, or could not be: it has no picture yet, but it does not cover the page. */
export function DockNotice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <section aria-label={t('Video mini player: {title}', { title })} className={DOCK_BAR_CLASS}>
      <div className={DOCK_THUMB_CLASS} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{title}</p>
        <p role="status" className="truncate text-xs text-neutral-400">
          {text}
        </p>
      </div>
      {children}
    </section>
  )
}
