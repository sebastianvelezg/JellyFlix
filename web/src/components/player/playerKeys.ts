import type { KeyboardEvent } from 'react'

const SKIP_SECONDS = 10

/** What the keys of the player do; the player supplies each one. */
export interface PlayerKeyActions {
  duration: number
  seek: (seconds: number) => void
  skip: (delta: number) => void
  togglePlay: () => void
  /** The volume now, 0 to 1. */
  volume: () => number
  changeVolume: (next: number) => void
  toggleMute: () => void
  toggleFullscreen: () => void
  toggleSubtitles: () => void
  /** Whether subtitles are on (sync keys do nothing otherwise). */
  showingSubtitles: boolean
  /** Moves the subtitles earlier (-1) or later (1), by a bigger step for `large`. */
  nudgeSubtitles: (direction: -1 | 1, large: boolean) => void
  hasNext: boolean
  goNext: () => void
  skipSegment: () => void
  canPip: boolean
  togglePip: () => void
  back: () => void
}

/**
 * The keyboard of the full-screen player. Space or K play and pause, J and L (or the arrows) jump ten seconds, up and down change the
 * volume, 0 to 9 jump to a tenth of the video, M mute, F full screen, C subtitles, Z and X move the subtitles earlier and later, N the
 * next title, S skip the intro or credits, P picture in picture, Escape leaves.
 */
export function handlePlayerKey(event: KeyboardEvent<HTMLDivElement>, a: PlayerKeyActions): void {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as HTMLElement
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
  const onButton = target.tagName === 'BUTTON'
  const key = event.key
  if (/^[0-9]$/.test(key) && a.duration > 0) {
    event.preventDefault()
    a.seek((Number(key) / 10) * a.duration)
    return
  }
  switch (key) {
    case ' ':
    case 'k':
      if (onButton) return
      event.preventDefault()
      a.togglePlay()
      break
    case 'ArrowLeft':
    case 'j':
      event.preventDefault()
      a.skip(-SKIP_SECONDS)
      break
    case 'ArrowRight':
    case 'l':
      event.preventDefault()
      a.skip(SKIP_SECONDS)
      break
    case 'ArrowUp':
      event.preventDefault()
      a.changeVolume(a.volume() + 0.1)
      break
    case 'ArrowDown':
      event.preventDefault()
      a.changeVolume(a.volume() - 0.1)
      break
    case 'Home':
      event.preventDefault()
      a.seek(0)
      break
    case 'End':
      event.preventDefault()
      a.seek(a.duration - 1)
      break
    case 'm':
      a.toggleMute()
      break
    case 'f':
      a.toggleFullscreen()
      break
    case 'c':
      a.toggleSubtitles()
      break
    case 'z':
    case 'Z':
    case 'x':
    case 'X':
      // Z shows the subtitles earlier, X later; Shift takes bigger steps.
      if (a.showingSubtitles) {
        event.preventDefault()
        a.nudgeSubtitles(key.toLowerCase() === 'z' ? -1 : 1, event.shiftKey)
      }
      break
    case 'n':
      if (a.hasNext) a.goNext()
      break
    case 's':
      a.skipSegment()
      break
    case 'p':
      if (a.canPip) a.togglePip()
      break
    case 'Escape':
      if (!document.fullscreenElement) a.back()
      break
  }
}
