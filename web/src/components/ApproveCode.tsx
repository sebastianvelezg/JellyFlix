import { useState } from 'react'
import { authorizeQuickConnect, type Session } from '../core'
import { t } from '../i18n'

/** The other half of Quick Connect: types the code a TV is showing, so that TV signs in as this user. */
export function ApproveCode({ session }: { session: Session }) {
  const [code, setCode] = useState('')
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  async function approve(event: React.FormEvent) {
    event.preventDefault()
    setState({ kind: 'busy' })
    try {
      await authorizeQuickConnect(session, code)
      setCode('')
      setState({ kind: 'done' })
    } catch (e) {
      setState({ kind: 'error', message: t(e instanceof Error ? e.message : 'Something went wrong.') })
    }
  }
  return (
    <form onSubmit={approve} className="space-y-2">
      <label htmlFor="approve-code" className="block text-sm font-medium text-neutral-100">
        {t('Code shown on the other screen')}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="approve-code"
          className="field w-40 text-center font-mono tracking-[0.3em]"
          inputMode="numeric"
          autoComplete="off"
          maxLength={7}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        />
        <button type="submit" className="btn" disabled={state.kind === 'busy' || code.replace(/\s/g, '').length !== 6}>
          {t('Approve')}
        </button>
      </div>
      {state.kind === 'done' && (
        <p role="status" className="alert-info">
          {t('Done. The other device is signing in.')}
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="alert-error">
          {state.message}
        </p>
      )}
    </form>
  )
}
