import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { probeModules, type ModulesClient, type ModulesGate } from '../../core/modules'
import { readModulesUrl } from '../../platform/web/modules'

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

  const value = useMemo(() => ({ state, recheck }), [state, recheck])
  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>
}

export const useModules = (): Value => useContext(ModulesContext)

/** The client of a container that is ready; the screens of a module are only drawn when it is, so this always has one. */
export function useModulesClient(): { client: ModulesClient; skew: number; isAdmin: boolean } {
  const { state } = useModules()
  if (state.status !== 'ready') throw new Error('The modules container is not ready.')
  return { client: state.client, skew: state.skew, isAdmin: state.manifest.user.isAdmin }
}
