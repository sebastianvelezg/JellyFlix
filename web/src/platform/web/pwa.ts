import { useEffect, useState } from 'react'

/** Keeps the app's own files so it opens without a network, once the page is served in a way browsers allow (HTTPS, or localhost). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Not a secure address (plain http on the network): the app simply works without it.
    })
  })
}

/** The event Chrome and Edge fire when the app can be installed; it is not in the standard type definitions. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallState =
  | { kind: 'installed' } // already running as an installed app
  | { kind: 'prompt'; install: () => Promise<void> } // the browser can show its install dialog
  | { kind: 'ios' } // Safari on an iPhone or iPad: installed from the Share menu
  | { kind: 'manual' } // another browser: its own menu

let deferred: InstallPromptEvent | null = null
// The event can fire before any page that wants it is on screen, so it is caught as soon as this file loads.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
  })
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhones and iPads (an iPad can say it is a Mac, but a Mac has no touch screen). */
export function isIosSafari(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** How this device can install the app, kept up to date as the browser offers it. */
export function useInstallState(): InstallState {
  const [, refresh] = useState(0)
  useEffect(() => {
    const again = () => refresh((n) => n + 1)
    window.addEventListener('beforeinstallprompt', again)
    window.addEventListener('appinstalled', again)
    return () => {
      window.removeEventListener('beforeinstallprompt', again)
      window.removeEventListener('appinstalled', again)
    }
  }, [])
  if (isStandalone()) return { kind: 'installed' }
  const event = deferred
  if (event) {
    return {
      kind: 'prompt',
      install: async () => {
        await event.prompt()
        await event.userChoice
        deferred = null
      },
    }
  }
  return isIosSafari() ? { kind: 'ios' } : { kind: 'manual' }
}
