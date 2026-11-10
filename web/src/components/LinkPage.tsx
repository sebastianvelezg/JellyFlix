import { useState } from 'react'
import { authorizeQuickConnect, type Session } from '../core'
import { t } from '../i18n'
import { ApproveCode } from './ApproveCode'

/**
 * The page a TV's QR code opens (`#/link?code=123456`). The TV is showing a Quick Connect code and asks to sign in as this account; nothing
 * happens until the person says so here, with the code in front of them to compare with the screen. The code is the only thing the link
 * carries: no password and no session, and it only works while this signed-in account approves it. With no code in the link (or a damaged
 * one) the person types it, as in Settings.
 */
export function LinkPage({ session, code, onDone }: { session: Session; code?: string; onDone: () => void }) {
  const [state, setState] = useState<{ kind: 'ask' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; message: string }>({ kind: 'ask' })

  async function allow() {
    if (!code) return
    setState({ kind: 'busy' })
    try {
      await authorizeQuickConnect(session, code)
      setState({ kind: 'done' })
    } catch (e) {
      setState({ kind: 'error', message: t(e instanceof Error ? e.message : 'Something went wrong.') })
    }
  }

  const shown = code ? `${code.slice(0, 3)} ${code.slice(3)}` : ''
  return (
    <div className="mx-auto max-w-lg pt-10">
      <h1 className="mb-3 text-3xl font-bold tracking-tight">{t('Sign in your TV')}</h1>
      {!code ? (
        <div className="glass space-y-3 rounded-2xl p-5">
          <p className="text-sm text-neutral-300">{t('Type the code your TV is showing, and this account will sign in there.')}</p>
          <ApproveCode session={session} />
        </div>
      ) : state.kind === 'done' ? (
        <div className="glass space-y-4 rounded-2xl p-5">
          <p role="status" className="alert-info">
            {t('Done. Your TV is signing in as {name}.', { name: session.userName })}
          </p>
          <button type="button" className="btn btn-primary" onClick={onDone}>
            {t('Go to the home page')}
          </button>
        </div>
      ) : (
        <div className="glass space-y-4 rounded-2xl p-5">
          <p className="text-sm text-neutral-200">{t('Your TV is showing the code {code}. Let it sign in as {name}?', { code: shown, name: session.userName })}</p>
          <p aria-hidden="true" className="text-center font-mono text-4xl font-bold tracking-[0.25em] text-white">
            {shown}
          </p>
          <p className="text-xs leading-relaxed text-neutral-400">{t('Only go on if you see this same code on your TV right now. Whoever is allowed in can watch as you.')}</p>
          {state.kind === 'error' && (
            <p role="alert" className="alert-error">
              {state.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={state.kind === 'busy'} onClick={() => void allow()}>
              {t('Let it sign in')}
            </button>
            <button type="button" className="btn" onClick={onDone}>
              {t('Not now')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
