import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { canAdminister, type Session } from '../../core'

/** What the editor needs to know about a title to open. */
export interface EditTarget {
  id: string
  name: string
  /** Jellyfin's kind of item ("Movie", "Series", "Season", "Episode", "MusicAlbum"...). */
  type: string
}

const OPEN_EVENT = 'jellyflix:edit-item'

/** A request that came before the editor (which loads on demand) was ready to hear it. */
let waiting: EditTarget | null = null

/** Opens the editor for a title (one editor lives in the app). */
export function openItemEditor(target: EditTarget): void {
  waiting = target
  window.dispatchEvent(new CustomEvent<EditTarget>(OPEN_EVENT, { detail: target }))
}

/** Listens for requests to open the editor; one made just before this was called is handed over at once. */
export function onOpenItemEditor(handler: (target: EditTarget) => void): () => void {
  const listener = (e: Event) => {
    waiting = null
    handler((e as CustomEvent<EditTarget>).detail)
  }
  window.addEventListener(OPEN_EVENT, listener)
  if (waiting) {
    const early = waiting
    waiting = null
    handler(early)
  }
  return () => window.removeEventListener(OPEN_EVENT, listener)
}

// ---- "a title was changed" ------------------------------------------------------------------------------

let version = 0
const listeners = new Set<() => void>()

/** Tells the pages that show a title to read it again. */
export function notifyItemEdited(): void {
  version += 1
  listeners.forEach((l) => l())
}

function useEditedVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
    () => 0,
  )
}

/** Runs `reload` each time an administrator changes a title in this window (not on first show). */
export function useReloadOnEdit(reload: () => void): void {
  const edited = useEditedVersion()
  const seen = useRef(edited)
  const latest = useRef(reload)
  useEffect(() => {
    latest.current = reload
  })
  useEffect(() => {
    if (edited === seen.current) return
    seen.current = edited
    latest.current()
  }, [edited])
}

// ---- who sees the tools ----------------------------------------------------------------------------------

/** Is this account an administrator? "checking" until the server has answered; a failed question counts as "no". */
export function useAdminStatus(session: Session): 'checking' | 'yes' | 'no' {
  const [admin, setAdmin] = useState<boolean | null>(null)
  useEffect(() => {
    let current = true
    void canAdminister(session).then((yes) => {
      if (current) setAdmin(yes)
    })
    return () => {
      current = false
    }
  }, [session])
  return admin === null ? 'checking' : admin ? 'yes' : 'no'
}

/** Whether to show the administrator tools: only after the server has said this account is an administrator. */
export function useIsAdmin(session: Session): boolean {
  return useAdminStatus(session) === 'yes'
}
