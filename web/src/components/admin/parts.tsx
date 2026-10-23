import { useState, type ReactNode } from 'react'
import { formatList, parseList } from '../../core'
import { t } from '../../i18n'
import { errorText } from '../useAsync'

/** A labelled text control with its hint and its error tied to it. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
}) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-neutral-100">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-neutral-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * A list typed as "one, two, three": what is typed is kept as typed, and the list follows it. When the list is replaced from
 * outside (an undo), give the input a new `key` so the text is drawn again.
 */
export function ListInput({
  id,
  value,
  onChange,
  ...rest
}: {
  id: string
  value: string[]
  onChange: (list: string[]) => void
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}) {
  const [text, setText] = useState(() => formatList(value))
  return (
    <input
      {...rest}
      id={id}
      className="field"
      value={text}
      autoComplete="off"
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseList(e.target.value))
      }}
      onBlur={() => setText(formatList(value))}
    />
  )
}

/** A yes/no question inside a red-edged box, with its two answers. */
export function ConfirmBox({
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  danger = false,
}: {
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  danger?: boolean
}) {
  return (
    <div role="group" className={`rounded-2xl border p-4 ${danger ? 'border-red-500/30 bg-red-500/10' : 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10'}`}>
      <div className="text-sm text-neutral-100">{children}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={danger ? 'btn border-red-400/40' : 'btn-primary'} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}

/** What a failed administrator action says, in words: a 403 is "you are not an administrator". */
export function adminErrorText(e: unknown): string {
  const status = (e as { response?: { status?: number } } | null)?.response?.status
  if (status === 403) return t('Your account is not an administrator on this server, so the server refused.')
  if (status === 404) return t('The server no longer has this title.')
  return errorText(e)
}

/** Dates in the person's language, short. */
export const when = (at: number): string => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
