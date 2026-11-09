import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { probeModules, type ModulesClient, type ModulesGate } from '../../core/modules'
import { acceptModulesUrl, declineModulesUrl, pendingModulesUrl, readModulesUrl } from '../../platform/web/modules'
import { t } from '../../i18n'

/** What the app knows about the modules container: not asked yet, not there, too new or too old, or ready. */
export type ModulesState = ModulesGate | { status: 'checking' }

interface Value {
  state: ModulesState
  /** Ask again (after the person started the container, say). */
  recheck: () => void
}

const ModulesContext = createContext<Value>({ state: { status: 'absent' }, recheck: () => undefined })

/**
 * Finds out, once after signing in, whether a modules container is there. When no address is configured nothing happens at all: no
 * request, no timer, and the state is "absent" from the first render, so the app is exactly what it is without modules.
 */
export function ModulesProvider({ token, children }: { token: string; children: ReactNode }) {
  const [state, setState] = useState<ModulesState>(() => (readModulesUrl() ? { status: 'checking' } : { status: 'absent' }))
  const [round, setRound] = useState(0)

  useEffect(() => {
    const url = readModulesUrl()
    if (!url) return
    let cancelled = false
    void probeModules(url, token).then((found) => {
      if (!cancelled) setState(found)
    })
    return () => {
      cancelled = true
    }
  }, [token, round])

  const recheck = useCallback(() => {
    setState(readModulesUrl() ? { status: 'checking' } : { status: 'absent' })
    setRound((n) => n + 1)
  }, [])

  // A link that names another address of the local network: the session token only goes there once the person says yes.
  const [pending, setPending] = useState(() => pendingModulesUrl())
  const answer = (yes: boolean) => {
    if (!pending) return
    if (yes) acceptModulesUrl(pending)
    else declineModulesUrl(pending)
    setPending(null)
    if (yes) recheck()
  }

  const value = useMemo(() => ({ state, recheck }), [state, recheck])
  return (
    <ModulesContext.Provider value={value}>
      {children}
      {pending && <ModulesLinkPrompt address={pending} onAnswer={answer} />}
    </ModulesContext.Provider>
  )
}

/** Asks before using a modules address that came in a link (see `pendingModulesUrl`). */
function ModulesLinkPrompt({ address, onAnswer }: { address: string; onAnswer: (yes: boolean) => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="modules-link-title"
        aria-describedby="modules-link-text"
        className="w-[min(30rem,100%)] rounded-3xl border border-white/10 bg-[var(--color-surface-2)] p-5 text-neutral-100 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] sm:p-6"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onAnswer(false)
        }}
      >
        <h2 id="modules-link-title" className="text-lg font-semibold">
          {t('Connect to the modules at this address?')}
        </h2>
        <p className="mt-2 break-all font-mono text-sm text-neutral-200">{address}</p>
        <p id="modules-link-text" className="mt-3 text-sm text-neutral-400">
          {t('A link asked to use the modules container at this address of your network. Jellyflix would send it your session. Connect only if you know it is yours or your household’s.')}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {/* The safe answer has the focus. */}
          <button type="button" className="btn" autoFocus onClick={() => onAnswer(false)}>
            {t('Not now')}
          </button>
          <button type="button" className="btn-primary" onClick={() => onAnswer(true)}>
            {t('Connect')}
          </button>
        </div>
      </div>
    </div>
  )
}

export const useModules = (): Value => useContext(ModulesContext)

/** The client of a container that is ready; the screens of a module are only drawn when it is, so this always has one. */
export function useModulesClient(): { client: ModulesClient; skew: number; isAdmin: boolean } {
  const { state } = useModules()
  if (state.status !== 'ready') throw new Error('The modules container is not ready.')
  return { client: state.client, skew: state.skew, isAdmin: state.manifest.user.isAdmin }
}
