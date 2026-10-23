import type { ReactNode } from 'react'

/** What a page says when there is nothing to show (`empty`) or something went wrong (`error`): an icon, one sentence and, for an error, the way out. */
export function StateMessage({
  kind,
  message,
  children,
  size = 'page',
}: {
  kind: 'empty' | 'error'
  message: string
  /** Buttons under the message ("Try again", "Back"). */
  children?: ReactNode
  /** `page` fills a page; `section` is for a part of one. */
  size?: 'page' | 'section'
}) {
  const error = kind === 'error'
  return (
    <div role={error ? 'alert' : undefined} className={`mx-auto flex max-w-lg flex-col items-center gap-3 text-center ${size === 'page' ? 'py-24' : 'py-16'}`}>
      <span
        aria-hidden="true"
        className={`flex h-12 w-12 items-center justify-center rounded-full border ${
          error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-white/10 bg-white/[.04] text-neutral-400'
        }`}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
          {error ? (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5.5M12 16.5h.01" />
            </>
          ) : (
            <>
              <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
              <path d="m3.5 15 4.5-4 4 3.5 3-2.5 5.5 4.5" />
            </>
          )}
        </svg>
      </span>
      <p className={error ? 'text-red-300' : 'text-neutral-400'}>{message}</p>
      {children && <div className="flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}
