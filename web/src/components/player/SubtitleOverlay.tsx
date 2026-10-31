import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type {
  SubtitleBackground,
  SubtitleColor,
  SubtitlePosition,
  SubtitleSize,
} from '../../platform/web/prefs'

const SIZE_CLASS: Record<SubtitleSize, string> = {
  small: 'text-base sm:text-lg',
  medium: 'text-lg sm:text-2xl',
  large: 'text-2xl sm:text-4xl',
}

/** The second line is a step smaller, so the two are told apart at a glance. */
const SMALLER: Record<SubtitleSize, SubtitleSize> = { small: 'small', medium: 'small', large: 'medium' }

const COLOR: Record<SubtitleColor, string> = { white: '#ffffff', yellow: '#ffe14d', cyan: '#7be8ff' }
/** The second line takes another colour than the first. */
const OTHER_COLOR: Record<SubtitleColor, SubtitleColor> = { white: 'yellow', yellow: 'white', cyan: 'yellow' }

const SHADOW = '0 0 4px #000, 0 1px 3px #000, 0 0 8px #000'

export interface SubtitleStyle {
  size: SubtitleSize
  color: SubtitleColor
  background: SubtitleBackground
  position: SubtitlePosition
}

/** Where the lines sit: above the control bar while it shows, otherwise near the bottom edge (or higher up if asked). */
function bottomClass(lifted: boolean, position: SubtitlePosition): string {
  if (position === 'high') return lifted ? 'bottom-40' : 'bottom-24'
  return lifted ? 'bottom-28' : 'bottom-10'
}

/**
 * Draws the active cues of one subtitle track in our own element instead of the browser's built-in renderer,
 * so they can sit above the control bar, be resized and restyled. The <track> stays in "hidden" mode
 * (cues load and fire events, but nothing is drawn natively).
 *
 * `offset` moves every cue in time (seconds, positive = later) by changing the cue's own start and end, which is
 * how the browser decides what is active; the original times are remembered so the offset can be changed again.
 *
 * Cue text goes through the browser's own WebVTT parser (`getCueAsHTML`), which only ever yields
 * a small safe set of nodes (<i>, <b>, <u>, <c>, <v>, <lang>, <ruby>), never scripts.
 */
function useCueBox(videoRef: RefObject<HTMLVideoElement | null>, trackUrl: string | null, slot: string, offset: number) {
  const box = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(offset)
  const applyRef = useRef<(() => void) | null>(null)

  // A new offset applies to the cues already loaded.
  useEffect(() => {
    offsetRef.current = offset
    applyRef.current?.()
  }, [offset])

  useEffect(() => {
    const el = box.current
    const video = videoRef.current
    if (!video || !el || !trackUrl) return
    // The <track> element has just been rendered by the player, tagged with the slot it is for.
    const trackElement = video.querySelector<HTMLTrackElement>(`track[data-slot="${slot}"]`)
    const track = trackElement?.track
    if (!track) return
    track.mode = 'hidden'

    const originals = new WeakMap<TextTrackCue, [number, number]>()
    const render = () => {
      const cues = Array.from(track.activeCues ?? []) as VTTCue[]
      el.replaceChildren(
        ...cues.map((cue) => {
          const line = document.createElement('div')
          line.className = 'subtitle-line'
          line.appendChild(cue.getCueAsHTML())
          return line
        }),
      )
    }
    const apply = () => {
      for (const cue of Array.from(track.cues ?? [])) {
        let original = originals.get(cue)
        if (!original) {
          original = [cue.startTime, cue.endTime]
          originals.set(cue, original)
        }
        const shift = offsetRef.current
        // Set the later bound first when moving later, so a cue never briefly ends before it starts.
        if (shift >= 0) {
          cue.endTime = original[1] + shift
          cue.startTime = original[0] + shift
        } else {
          cue.startTime = Math.max(0, original[0] + shift)
          cue.endTime = Math.max(0.01, original[1] + shift)
        }
      }
      render()
    }
    applyRef.current = apply

    // The cues arrive after the track has loaded, which can be after this effect runs.
    track.addEventListener('cuechange', render)
    trackElement?.addEventListener('load', apply)
    apply()
    return () => {
      track.removeEventListener('cuechange', render)
      trackElement?.removeEventListener('load', apply)
      applyRef.current = null
      el.replaceChildren()
    }
  }, [videoRef, trackUrl, slot])

  return box
}

/**
 * The subtitles over the picture: one track, or two (the second one above the first, a step smaller and in another colour),
 * both in one block that rises above the control bar while it shows.
 */
export function SubtitleOverlay({
  videoRef,
  trackUrl,
  secondUrl = null,
  lifted,
  style,
  offset = 0,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  /** The loaded subtitle blob URL; changes when the selection changes. */
  trackUrl: string | null
  /** The second track's blob URL, when a second subtitle is on. */
  secondUrl?: string | null
  /** True while the control bar is visible, so lines move up out of its way. */
  lifted: boolean
  style: SubtitleStyle
  /** Seconds to show the subtitles later (negative: earlier). */
  offset?: number
}) {
  const main = useCueBox(videoRef, trackUrl, 'main', offset)
  const second = useCueBox(videoRef, secondUrl, 'second', offset)

  const css = (s: SubtitleStyle): CSSProperties => ({
    color: COLOR[s.color],
    textShadow: s.background === 'shadow' ? SHADOW : 'none',
  })
  const secondStyle: SubtitleStyle = { ...style, size: SMALLER[style.size], color: OTHER_COLOR[style.color] }

  return (
    <div
      aria-live="off"
      className={`pointer-events-none absolute inset-x-0 flex flex-col items-center gap-1 px-6 text-center font-medium leading-snug transition-[bottom] duration-200 ${bottomClass(lifted, style.position)}`}
    >
      <div
        ref={second}
        data-testid="subtitles-second"
        data-background={style.background}
        className={`subtitles flex flex-col items-center gap-1 ${SIZE_CLASS[secondStyle.size]}`}
        style={css(secondStyle)}
      />
      <div
        ref={main}
        data-testid="subtitles"
        data-background={style.background}
        className={`subtitles flex flex-col items-center gap-1 ${SIZE_CLASS[style.size]}`}
        style={css(style)}
      />
    </div>
  )
}
