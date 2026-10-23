import { useRef, type ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'
import { t } from '../i18n'

const arrow =
  'absolute inset-y-4 hidden w-[var(--gutter)] items-center justify-center text-white opacity-0 transition duration-200 hover:text-[var(--color-accent)] focus-visible:opacity-100 group-hover/row:opacity-100 lg:flex'

/**
 * A titled, horizontally scrolling row with snap points. On hover-capable screens the page gutters
 * on either side become arrow buttons. The row bleeds into the gutters so cards scroll edge to edge
 * but rest aligned with the page content.
 */
export function Row({ title, action, children }: { title: string; /** Something on the right of the title, e.g. a "See all" button. */ action?: ReactNode; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)
  const scrollBy = (direction: -1 | 1) => {
    const el = scroller.current
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <section aria-label={title} className="group/row relative">
      <h2 className="mb-1 flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white sm:text-xl">
        <span aria-hidden="true" className="h-5 w-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_14px_var(--glow)]" />
        {title}
        {action && (
          <span className="ml-auto text-sm font-medium [&_button]:pointer-coarse:-my-3 [&_button]:pointer-coarse:px-2 [&_button]:pointer-coarse:py-3">
            {action}
          </span>
        )}
      </h2>
      <div className="relative">
        <div
          ref={scroller}
          className="no-scrollbar bleed gutter-x -my-1 flex snap-x scroll-px-[var(--gutter)] gap-3 overflow-x-auto scroll-smooth py-5 sm:gap-4"
        >
          {children}
        </div>
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label={t('Scroll {title} left', { title })}
          className={`${arrow} -left-[var(--gutter)] bg-gradient-to-r from-[var(--color-bg)]/90 to-transparent`}
        >
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label={t('Scroll {title} right', { title })}
          className={`${arrow} -right-[var(--gutter)] bg-gradient-to-l from-[var(--color-bg)]/90 to-transparent`}
        >
          <ChevronRightIcon />
        </button>
      </div>
    </section>
  )
}
