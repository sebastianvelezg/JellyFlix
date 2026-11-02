import { useEffect, type RefObject } from 'react'
import { bindMediaSession, keepScreenAwake } from '../../platform/web/mediaSession'
import { leaveFullscreen } from './fullscreen'

/**
 * What the player does to the page around it, apart from playing: the keys of the keyboard and the lock screen (Media Session), and
 * for the full-screen player the screen wake lock and the tab title. The mini bar leaves the page its own, and gives back full screen
 * and the keyboard.
 */
export function useStageEnvironment({
  videoRef,
  containerRef,
  title,
  mini,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  containerRef: RefObject<HTMLDivElement | null>
  title: string
  mini: boolean
}) {
  // OS media keys / now-playing while this stage is open (also in the mini bar, so the keys of the keyboard still work).
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    return bindMediaSession(video, title)
  }, [videoRef, title])

  // The screen wake lock and the tab title are for the full-screen player; the bar leaves the page its own.
  useEffect(() => {
    if (mini) return
    const release = keepScreenAwake()
    const previousTitle = document.title
    document.title = `▶ ${title}`
    return () => {
      release()
      document.title = previousTitle
    }
  }, [title, mini])

  // The mini bar is not a full-screen element, and it does not take the keyboard: it gives both back, and takes them again when opened.
  useEffect(() => {
    if (mini) {
      leaveFullscreen()
      const active = document.activeElement
      if (active instanceof HTMLElement && containerRef.current?.contains(active)) active.blur()
    } else {
      containerRef.current?.focus()
    }
  }, [containerRef, mini])
}
