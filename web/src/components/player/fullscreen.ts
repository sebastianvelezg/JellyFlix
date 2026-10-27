/**
 * Full screen for the video player is asked of the whole page, not of the player's own element: a music video that follows another one
 * is a new player (a new element), and the browser leaves full screen when the element that has it goes away. The page stays, so the
 * next video simply goes on in full screen.
 */
export const inFullscreen = (): boolean => typeof document !== 'undefined' && !!document.fullscreenElement

export function enterFullscreen(): void {
  void document.documentElement.requestFullscreen().catch(() => undefined)
}

export function leaveFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
}

/** Whether full screen is the page's (the player's), not another element's such as a live channel's. */
export const pageInFullscreen = (): boolean => typeof document !== 'undefined' && document.fullscreenElement === document.documentElement
