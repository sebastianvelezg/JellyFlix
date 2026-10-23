import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Shows nothing (just a placeholder that holds the space) until it is about to scroll into view, and only then
 * renders `children`, which is when a row starts reading its own data. Rows far down a page therefore cost nothing
 * until you get near them, and the rows you can see are not held up by the ones you cannot.
 * Without IntersectionObserver (old browsers, tests) the children are rendered straight away.
 */
export function LazyMount({
  children,
  height = 280,
  margin = '700px 0px',
}: {
  children: ReactNode
  /** Space to hold while waiting, in px, so the page does not jump much when the row appears. */
  height?: number
  /** How early to start, as a CSS margin around the screen. */
  margin?: string
}) {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const holder = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = holder.current
    if (near || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near, margin])

  if (near) return <>{children}</>
  return <div ref={holder} aria-hidden="true" data-lazy="waiting" style={{ minHeight: height }} />
}
