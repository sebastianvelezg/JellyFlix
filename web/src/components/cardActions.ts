import { createContext, useContext } from 'react'
import type { Movie } from '../core'

/**
 * What a card's "⋯" menu needs from the app: where to keep the new state of a title once it was changed (watched, favorite),
 * so every card of that title follows. Without a provider the menu is simply not shown.
 */
const CardActionsContext = createContext<((next: Movie) => void) | null>(null)

export const CardActionsProvider = CardActionsContext.Provider

export function useCardActions(): ((next: Movie) => void) | null {
  return useContext(CardActionsContext)
}
