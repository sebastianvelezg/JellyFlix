import { useRef, type ReactNode } from 'react'
import { t } from '../../i18n'
import { ChevronLeftIcon, ChevronRightIcon } from '../icons'

const arrow =
  'hidden h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[.05] text-neutral-300 transition hover:border-white/25 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:flex pointer-coarse:hidden'

/**
 * A titled shelf of cards for the music page: the title, a link to the whole list on the right, small arrows, and a row that scrolls
 * sideways with snap points. The row has room around it for a card's hover glow, so nothing is cut off.
 */
export function Shelf({ title, action, children }: { title: string; /** A link to the whole list ("See library"). */ action?: { label: string; onClick: () => void }; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)
  const scrollBy = (direction: -1 | 1) => {
    const el = scroller.current
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' })
  }
  return (
    <section aria-label={title}>
      <div className="mb-1 flex items-center gap-3">
        <h2 className="min-w-0 truncate text-xl font-bold tracking-tight text-white sm:text-[1.35rem]">{title}</h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {action && (
            <button type="button" onClick={action.onClick} className="rounded-full px-2 py-1 text-xs font-semibold text-[var(--color-accent)] hover:underline pointer-coarse:py-3">
              {action.label}
            </button>
          )}
          <button type="button" onClick={() => scrollBy(-1)} aria-label={t('Scroll {title} left', { title })} className={arrow}>
            <ChevronLeftIcon />
          </button>
          <button type="button" onClick={() => scrollBy(1)} aria-label={t('Scroll {title} right', { title })} className={arrow}>
            <ChevronRightIcon />
          </button>
        </div>
      </div>
      <div ref={scroller} className="no-scrollbar -mx-3 flex snap-x scroll-px-3 gap-4 overflow-x-auto scroll-smooth px-3 pb-4 pt-3 sm:gap-5">
        {children}
      </div>
    </section>
  )
}

/** A card sized for a shelf of the music page: a little larger than a poster, growing with the window. */
export function ShelfItem({ children }: { children: ReactNode }) {
  return <div className="w-36 shrink-0 snap-start sm:w-40 xl:w-44 2xl:w-52">{children}</div>
}
