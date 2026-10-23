import { useEffect, useState } from 'react'

/** How long after the banner first shows it may still be replaced by the fuller lineup. */
const SWAP_WINDOW_MS = 4000

/**
 * The titles for a home banner, picked in two steps so the banner is not held up by the slowest list:
 *
 *  1. as soon as the newest titles are known (`quick`, which the server answers fast) the banner shows them;
 *  2. when the random picks from the whole library arrive (`full`, a slower query), the lineup is replaced with the
 *     fuller one, but only if that happens within a few seconds, while the first slide is still on screen. After
 *     that the banner is left alone, so it never changes under your eyes.
 *
 * When everything is already known at the start (a remembered copy), there is just one step. `resetKey` names what the
 * banner is for (a library): another key starts over.
 */
export function useBannerLineup<T>(
  resetKey: string,
  quick: { ready: boolean; build: () => T[] },
  full: { ready: boolean; build: () => T[] },
): { items: T[]; shown: boolean } {
  const [held, setHeld] = useState<{ key: string; items: T[]; stage: 1 | 2 } | null>(null)
  const [open, setOpen] = useState<{ key: string; open: boolean }>({ key: resetKey, open: true })
  const current = held?.key === resetKey ? held : null
  // An empty first banner has nothing to flip, so the fuller lineup may always replace it.

  if (!current && quick.ready) {
    setHeld({ key: resetKey, items: (full.ready ? full : quick).build(), stage: full.ready ? 2 : 1 })
  } else if (current && current.stage === 1 && full.ready && (current.items.length === 0 || (open.key === resetKey ? open.open : true))) {
    setHeld({ key: resetKey, items: full.build(), stage: 2 })
  }

  // The window to swap closes a few seconds after the banner is first shown.
  const started = current !== null
  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => setOpen({ key: resetKey, open: false }), SWAP_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [started, resetKey])

  return { items: current?.items ?? [], shown: current !== null }
}
