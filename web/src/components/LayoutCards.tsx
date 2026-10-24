import type { ReactNode } from 'react'
import type { BannerSize, Density, NavStyle, UiSize } from '../platform/web/appearance'
import { t } from '../i18n'

const ring =
  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-accent)]'

/**
 * A choice of one thing, drawn: each option is a card with a small picture of what it does and its name, like the poster sizes.
 * Radio buttons underneath (so the keyboard and screen readers work as for any group); the chosen card takes the accent.
 */
export function PickCards<T extends string>({
  name,
  legend,
  hint,
  options,
  labels,
  value,
  onChange,
  draw,
}: {
  name: string
  legend: string
  hint?: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (value: T) => void
  draw: (option: T) => ReactNode
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-neutral-100">{legend}</legend>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      <div className={`mt-2 grid gap-3 ${options.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {options.map((option) => (
          <label key={option} className="cursor-pointer">
            <input type="radio" name={name} className="peer sr-only" checked={value === option} onChange={() => onChange(option)} />
            <span
              className={`flex h-full flex-col items-center gap-2 rounded-2xl border-2 border-white/10 px-2 py-3 transition hover:border-white/25 peer-checked:border-[var(--color-accent)] peer-checked:bg-[var(--color-accent)]/10 ${ring}`}
            >
              <span aria-hidden="true" className="flex h-12 items-center justify-center">
                {draw(option)}
              </span>
              <span className="text-center text-sm text-neutral-200">{t(labels[option])}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const block = 'rounded-[3px] bg-[var(--color-surface-3)] ring-1 ring-white/15'
const accent = 'rounded-[3px] bg-[var(--color-accent)]'

/** A title, a line under it and a button, at the size the interface will have. */
export function UiSizeDrawing({ size }: { size: UiSize }) {
  const scale = size === 'small' ? 0.8 : size === 'large' ? 1.3 : 1
  return (
    <span className="flex flex-col items-start gap-1" style={{ transform: `scale(${scale})` }}>
      <span className="h-1.5 w-12 rounded-full bg-neutral-200" />
      <span className="h-1 w-9 rounded-full bg-neutral-500" />
      <span className="mt-0.5 h-3 w-8 rounded-full bg-[var(--color-accent)]" />
    </span>
  )
}

/** Rows of posters, with the gap between them. */
export function DensityDrawing({ density }: { density: Density }) {
  const gap = density === 'compact' ? 'gap-0.5' : 'gap-2'
  return (
    <span className={`flex flex-col ${gap}`}>
      {[0, 1, 2].map((row) => (
        <span key={row} className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`${block} h-2 w-4`} />
          ))}
        </span>
      ))}
    </span>
  )
}

/** A screen with the featured banner at the top, tall or short, and a row under it. */
export function BannerDrawing({ size }: { size: BannerSize }) {
  return (
    <span className="flex h-12 w-20 flex-col gap-1 overflow-hidden rounded-md border border-white/15 p-1">
      <span className={`${accent} w-full opacity-70 ${size === 'large' ? 'h-6' : 'h-3'}`} />
      <span className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`${block} h-3 flex-1`} />
        ))}
      </span>
    </span>
  )
}

/** The menu at the top: each button as a picture and a name, only the picture, or only the name. */
export function NavDrawing({ style }: { style: NavStyle }) {
  return (
    <span className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`flex items-center gap-1 rounded-full px-1.5 py-1 ${i === 0 ? 'bg-[var(--color-accent)]/25' : 'bg-white/[.06]'}`}>
          {style !== 'text' && <span className={`h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-[var(--color-accent)]' : 'bg-neutral-400'}`} />}
          {style !== 'icons' && <span className={`h-1 w-4 rounded-full ${i === 0 ? 'bg-neutral-100' : 'bg-neutral-500'}`} />}
        </span>
      ))}
    </span>
  )
}
