import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Session } from '../../core'
import { MusicPlayer, type MusicState } from '../../platform/web/musicPlayer'

const MusicContext = createContext<MusicPlayer | null>(null)

/**
 * Owns the one music player for a signed-in session. It sits above every page so the music keeps playing
 * while you browse; signing out (or the session ending) stops it.
 */
export function MusicProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [player] = useState(() => new MusicPlayer(session))
  useEffect(() => {
    player.connect()
    return () => player.disconnect()
  }, [player])
  return <MusicContext.Provider value={player}>{children}</MusicContext.Provider>
}

/** The player if there is one above, otherwise null (components that also work on their own, such as the remote control, use this). */
export function useMusicIfAny(): MusicPlayer | null {
  return useContext(MusicContext)
}

/** The player, for calling its controls (`play`, `next`, `enqueue`...). Does not re-render when playback changes. */
export function useMusic(): MusicPlayer {
  const player = useContext(MusicContext)
  if (!player) throw new Error('useMusic must be used inside a MusicProvider')
  return player
}

/** What is queued and playing. Re-renders when that changes (not on every tick of the song). */
export function useMusicState(): MusicState {
  const player = useMusic()
  return useSyncExternalStore(player.subscribe, player.getState)
}

/** The playing position in seconds. Re-renders about four times a second while music plays. */
export function useMusicPosition(): number {
  const player = useMusic()
  return useSyncExternalStore(player.subscribePosition, player.getPosition)
}
