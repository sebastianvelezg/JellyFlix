import { useCallback, useEffect, useRef, useState } from 'react'
import { activeSegment, type Movie, type PlaybackExtras } from '../../core'
import type { PlayerPrefs } from '../../platform/web/prefs'

/** A skip button nobody pressed is taken away after this long. */
const SKIP_BUTTON_MS = 10_000

/**
 * "Skip intro" / "Skip credits" while the playhead is inside such a segment. Each kind can be offered, skipped at once, or ignored
 * (`skipActions`, from Settings). A button left alone goes away after a few seconds (it comes back with the controls).
 */
export function useSegmentSkipping({
  extras,
  currentTime,
  next,
  mini,
  skipActions,
  goNext,
  seek,
}: {
  extras: PlaybackExtras
  currentTime: number
  next: Movie | null
  mini: boolean
  skipActions: PlayerPrefs['skipActions']
  goNext: () => Promise<void>
  seek: (seconds: number) => void
}) {
  const segment = activeSegment(extras.segments, currentTime)
  const skipSegment = useCallback(() => {
    if (!segment) return
    if (segment.kind === 'outro' && next) void goNext()
    else seek(segment.endSeconds)
  }, [segment, next, goNext, seek])
  const segmentKey = segment ? `${segment.kind}:${segment.startSeconds}` : null
  const segmentAction = segment ? skipActions[segment.kind] : 'ask'
  const autoSkipped = useRef(new Set<string>())
  const [staleSegment, setStaleSegment] = useState<string | null>(null)
  useEffect(() => {
    if (!segmentKey || segmentAction !== 'ask') return
    const timer = setTimeout(() => setStaleSegment(segmentKey), SKIP_BUTTON_MS)
    return () => clearTimeout(timer)
  }, [segmentKey, segmentAction])
  useEffect(() => {
    // Once for each stretch, so going back into an intro after skipping it does not throw you out again.
    if (!segment || !segmentKey || segmentAction !== 'auto' || mini || autoSkipped.current.has(segmentKey)) return
    autoSkipped.current.add(segmentKey)
    skipSegment()
  }, [segment, segmentKey, segmentAction, mini, skipSegment])

  return { segment, segmentKey, segmentAction, staleSegment, skipSegment }
}
