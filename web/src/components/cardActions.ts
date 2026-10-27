import { createContext, useContext } from 'react'
import type { Movie } from '../core'
import type { PlayQueueRef } from './route'

/**
 * What a card's "⋯" menu needs from the app: where to keep the new state of a title once it was changed (watched, favorite),
 * so every card of that title follows. Without a provider the menu is simply not shown.
 */
const CardActionsContext = createContext<((next: Movie) => void) | null>(null)

export const CardActionsProvider = CardActionsContext.Provider

export function useCardActions(): ((next: Movie) => void) | null {
  return useContext(CardActionsContext)
}

/**
 * Plays a video straight from its card (the round button in the middle of a music video's picture). What follows it is what it was played
 * from: `queue` (a folder or a library, read from the server) or `list` (the videos of the row or grid, in the order shown); with neither
 * it goes on with the others of its folder. Without a provider the cards have no play button.
 */
export type PlayVideo = (video: Movie, from?: { list?: readonly Movie[]; queue?: PlayQueueRef }) => void

const PlayVideoContext = createContext<PlayVideo | null>(null)

export const PlayVideoProvider = PlayVideoContext.Provider

export function usePlayVideo(): PlayVideo | null {
  return useContext(PlayVideoContext)
}
