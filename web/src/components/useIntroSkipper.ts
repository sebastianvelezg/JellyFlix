import { useEffect, useState } from 'react'
import { findPlugin, getPlugins, isAdministrator, type Session } from '../core'

const known = new Map<string, Promise<boolean>>()

/** Whether this account can ask the server's Intro Skipper plugin to analyse a season (it is installed, and the account is an administrator). */
export function useIntroSkipper(session: Session): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    const key = `${session.serverUrl}|${session.userId}`
    let promise = known.get(key)
    if (!promise) {
      // Asked once per sign-in; a server without the plugin, or a plain account, simply gets no button.
      promise = isAdministrator(session)
        .then((admin) => (admin ? getPlugins(session).then((list) => findPlugin('intro-skipper', list)?.status === 'Active') : false))
        .catch(() => false)
      known.set(key, promise)
    }
    let alive = true
    void promise.then((yes) => {
      if (alive) setAvailable(yes)
    })
    return () => {
      alive = false
    }
  }, [session])
  return available
}
