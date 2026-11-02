import { useCallback, useEffect, useRef, useState } from 'react'
import type { Movie } from '../../core'
import { leaveFullscreen, pageInFullscreen } from '../player/fullscreen'
import { playKey } from '../PlayerRoute'
import type { PlayRoute, Route } from '../route'

/**
 * Which video the player shows, and whether it is full screen or the bar at the bottom of the page.
 *
 * A music video left with Back goes on playing in the bar (like the music) while you look for another one. The bar is the same player,
 * not a new one: it is told to be small, so the video never stops. It is kept whenever the player is left, however that happens: the
 * Back button, Esc, or the browser's own Back (a back gesture, a mouse button). Which video is a music video is only known once it has
 * loaded (`rememberLoaded`); one that was closed on purpose (a failed one, the bar's close button) is not kept.
 */
export function useDockedVideo(route: Route, musicPlaying: boolean) {
  const [docked, setDocked] = useState<PlayRoute | null>(null)
  // Opening another video full screen takes the place of the one in the bar.
  if (route.page === 'play' && docked && playKey(docked) !== playKey(route)) setDocked(null)
  const [lastPlay, setLastPlay] = useState<PlayRoute | null>(null)
  const [loadedMusicVideo, setLoadedMusicVideo] = useState<string | null>(null)
  const [notKept, setNotKept] = useState<string | null>(null)
  const rememberLoaded = useCallback((item: Movie) => setLoadedMusicVideo(item.musicVideo ? item.id : null), [])
  if (route.page === 'play') {
    if (!lastPlay || playKey(lastPlay) !== playKey(route)) {
      setLastPlay(route)
      setNotKept(null)
    }
  } else if (lastPlay) {
    setLastPlay(null)
    if (loadedMusicVideo === lastPlay.id && notKept !== playKey(lastPlay)) setDocked(lastPlay)
  }
  const video: PlayRoute | null = route.page === 'play' ? route : docked
  const mini = route.page !== 'play'
  const barShown = mini && !!video
  // Full screen belongs to the player: it goes on from one video to the next, and ends when the player does (or becomes the bar).
  const hadVideo = useRef(false)
  useEffect(() => {
    if (hadVideo.current && !video && pageInFullscreen()) leaveFullscreen()
    hadVideo.current = !!video
  }, [video])
  useEffect(() => () => (pageInFullscreen() ? leaveFullscreen() : undefined), [])
  // A song starting while a video waits in the bar takes its place (the music's own bar comes back).
  if (barShown && musicPlaying) setDocked(null)

  return {
    video,
    mini,
    barShown,
    rememberLoaded,
    /** In the bar, the next video takes the place of this one. */
    dock: setDocked,
    /** Stop for good and take the bar away (and do not bring it back when the player is left). */
    closeDock: (closed: PlayRoute) => {
      setDocked(null)
      setNotKept(playKey(closed))
    },
  }
}
