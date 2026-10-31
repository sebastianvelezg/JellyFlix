import type { ReactNode } from 'react'

/**
 * The strip of controls under a page title (what to show, the genre, the order, more filters): one row that wraps on a
 * wide screen and scrolls sideways on a phone, instead of stacking into a grid.
 */
export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="toolbar"
      className={`no-scrollbar -mx-[var(--gutter)] flex items-center gap-2 overflow-x-auto px-[var(--gutter)] pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * A dropdown that says what it is for ("Sort", "Genre") in front of its value, so the closed control reads as a sentence.
 * The label is also the control's accessible name, so it stays complete for a screen reader.
 */
export function ToolbarSelect({
  label,
  prefix,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string
  /** The short word shown before the value; leave it out when the value says it all ("All genres"). */
  prefix?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <label className="relative inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/[.05] text-sm text-neutral-100 transition-colors duration-150 focus-within:border-[var(--color-accent)] hover:border-white/25 hover:bg-white/[.09] has-[:disabled]:opacity-60 pointer-coarse:min-h-11">
      {prefix && (
        <span aria-hidden="true" className="pointer-events-none pl-3.5 text-neutral-400">
          {prefix}
        </span>
      )}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`toolbar-select min-w-0 cursor-pointer appearance-none bg-transparent py-1.5 pr-8 text-sm font-medium text-neutral-100 focus:outline-none ${prefix ? 'pl-1.5' : 'pl-3.5'}`}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-3 text-neutral-400"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  )
}
