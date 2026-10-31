import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getParentalRatingOptions, isValidPin, PIN_MAX, PIN_MIN, type Session } from '../core'
import { enableKids, exitKids, useKids, type EnableResult } from '../platform/web/kids'
import { Card } from './SettingsParts'
import { clearSwr } from './useSwr'
import { t } from '../i18n'

const PROBLEM: Record<Exclude<EnableResult, { ok: true }>['reason'], string> = {
  'bad-pin': 'The PIN is four to eight digits.',
  'unknown-rating': 'The server does not know that rating.',
  'nothing-to-show': 'Nothing in your libraries is rated that low, so Kids mode would show nothing.',
  'no-ratings-reported': 'The server does not say the age rating of its titles, so Kids mode could not tell what to hide.',
  failed: 'Could not set it up. Check your connection and try again.',
}

/** Settings → General: turn Kids mode on for this device, with the highest age rating it may show and a PIN to leave it. */
export function KidsCard({ session }: { session: Session }) {
  const kids = useKids()
  const [ratings, setRatings] = useState<Array<{ name: string; value: number }> | null>(null)
  const [max, setMax] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getParentalRatingOptions(session)
      .then((found) => {
        if (cancelled) return
        setRatings(found)
        // A children's rating to start from: PG when the server has it.
        setMax((now) => now || (found.find((r) => r.name === 'PG') ?? found[Math.min(2, found.length - 1)])?.name || '')
      })
      .catch(() => {
        if (!cancelled) setRatings([])
      })
    return () => {
      cancelled = true
    }
  }, [session])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setProblem(null)
    if (!isValidPin(pin)) return setProblem(t(PROBLEM['bad-pin']))
    if (pin !== again) return setProblem(t('The two PINs are not the same.'))
    setBusy(true)
    const result = await enableKids(session, max, pin)
    setBusy(false)
    if (!result.ok) setProblem(t(PROBLEM[result.reason]))
    else {
      setPin('')
      setAgain('')
      applyAtOnce()
    }
  }

  return (
    <Card title={t('Kids mode')} description={t('Shows only titles up to an age rating, and takes away Settings, Administration and Live TV until the PIN is typed.')}>
      {kids.enabled ? (
        <p role="status" className="text-sm text-neutral-300">
          {t('Kids mode is on, up to {rating}.', { rating: kids.maxName })}
        </p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="kids-rating" className="text-sm font-medium text-neutral-100">
              {t('Highest rating to show')}
            </label>
            <select id="kids-rating" className="select" value={max} disabled={!ratings || ratings.length === 0} onChange={(e) => setMax(e.target.value)}>
              {(ratings ?? []).map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="kids-pin" className="text-sm font-medium text-neutral-100">
              {t('PIN to leave it')}
            </label>
            <input
              id="kids-pin"
              className="field w-40 text-center font-mono tracking-[0.3em]"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_MAX}
              placeholder={'•'.repeat(PIN_MIN)}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="kids-pin-again" className="text-sm font-medium text-neutral-100">
              {t('The same PIN again')}
            </label>
            <input
              id="kids-pin-again"
              className="field w-40 text-center font-mono tracking-[0.3em]"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_MAX}
              placeholder={'•'.repeat(PIN_MIN)}
              value={again}
              onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !max}>
            {busy ? t('Setting it up…') : t('Turn on Kids mode')}
          </button>
          {problem && (
            <p role="alert" className="alert-error">
              {problem}
            </p>
          )}
          <p className="text-xs leading-relaxed text-neutral-500">
            {t('The PIN guards this app on this device. For a limit nobody can get round, also set the highest rating for this account in Administration.')}
          </p>
        </form>
      )}
    </Card>
  )
}

/**
 * Everything on screen was read before Kids mode changed (the lists, the rows, the page that is open): the lists that were
 * remembered are dropped and the app starts again, so that nothing from the other mode is left in view.
 */
function applyAtOnce(): void {
  clearSwr()
  window.location.reload()
}

/** Asks for the PIN to leave Kids mode. Native `<dialog>`: it traps the focus, closes with Esc and gives the focus back. */
export function KidsExitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [pin, setPin] = useState('')
  const [wait, setWait] = useState(0)
  const [wrong, setWrong] = useState(false)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) {
      setPin('')
      setWrong(false)
      el.showModal()
    }
    if (!open && el.open) el.close()
  }, [open])

  // A wait counts down on its own.
  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((n) => Math.max(0, n - 1)), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = exitKids(pin)
    if (result.ok) {
      onClose()
      applyAtOnce()
      return
    }
    setPin('')
    setWrong(result.waitSeconds === 0 || wait === 0)
    setWait(result.waitSeconds)
  }

  return (
    <dialog
      ref={dialog}
      aria-label={t('Leave Kids mode')}
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-3xl border border-white/10 bg-[var(--color-surface-2)] p-0 text-neutral-100 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close()
      }}
    >
      <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight text-white">{t('Leave Kids mode')}</h2>
        <label htmlFor="kids-exit-pin" className="block text-sm text-neutral-300">
          {t('Type the PIN')}
        </label>
        <input
          id="kids-exit-pin"
          className="field text-center font-mono tracking-[0.4em]"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_MAX}
          autoFocus
          value={pin}
          disabled={wait > 0}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        {wait > 0 ? (
          <p role="alert" className="alert-error">
            {t('Too many wrong tries. Wait {seconds} seconds.', { seconds: wait })}
          </p>
        ) : (
          wrong && (
            <p role="alert" className="alert-error">
              {t('That is not the PIN.')}
            </p>
          )
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={wait > 0 || !isValidPin(pin)}>
            {t('Leave')}
          </button>
        </div>
      </form>
    </dialog>
  )
}
