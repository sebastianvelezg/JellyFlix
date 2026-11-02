import { useCallback, useEffect, useRef, useState } from 'react'

const HIDE_CONTROLS_MS = 3000
/** In cinema mode the controls get out of the way sooner. */
const HIDE_CONTROLS_CINEMA_MS = 1800

/**
 * Whether the controls were used a moment ago. `poke` (the mouse moved, a key was pressed) shows them and starts the countdown to hide
 * them again. `pokeRef` always holds the latest `poke`, for the video's own event handlers, which are set up once.
 */
export function useControlsVisibility(cinema: boolean) {
  const [awake, setAwake] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pokeRef = useRef<() => void>(() => undefined)

  const poke = useCallback(() => {
    setAwake(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setAwake(false), cinema ? HIDE_CONTROLS_CINEMA_MS : HIDE_CONTROLS_MS)
  }, [cinema])
  useEffect(() => {
    pokeRef.current = poke
  }, [poke])
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    },
    [],
  )

  return { awake, poke, pokeRef }
}
