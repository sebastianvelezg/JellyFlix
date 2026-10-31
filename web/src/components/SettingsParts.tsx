import type { ReactNode } from 'react'

export function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
      {description && <p className="mt-1 text-sm text-neutral-400">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-neutral-100">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex h-6 w-10 shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-white/20 transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-[0_1px_3px_rgba(0,0,0,0.5)] after:transition-transform after:duration-200 peer-checked:bg-[var(--color-accent-strong)] peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-white/80 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-black motion-reduce:transition-none motion-reduce:after:transition-none"
        />
      </span>
    </label>
  )
}
