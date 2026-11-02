import { useCallback, useEffect, useRef, useState } from 'react'
import { readSubtitleOffset, writeSubtitleOffset } from '../../platform/web/prefs'
import { t } from '../../i18n'
import { offsetLabel } from '../offsetLabel'

/**
 * How far the subtitles are moved from the picture, remembered under `syncKey` (per movie, and per series for episodes: its episodes
 * usually share one release). Moving them shows a note for a moment.
 */
export function useSubtitleSync(syncKey: string) {
  const [subtitleOffset, setSubtitleOffsetState] = useState(() => readSubtitleOffset(syncKey))
  // Keys can arrive faster than the screen updates (holding one down), so the next step starts from this, not from the last render.
  const offsetNow = useRef(subtitleOffset)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const syncNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setSubtitleOffset = useCallback(
    (seconds: number) => {
      offsetNow.current = seconds
      setSubtitleOffsetState(seconds)
      writeSubtitleOffset(syncKey, seconds)
      setSyncNote(t('Subtitles: {offset}', { offset: offsetLabel(seconds) }))
      if (syncNoteTimer.current) clearTimeout(syncNoteTimer.current)
      syncNoteTimer.current = setTimeout(() => setSyncNote(null), 1800)
    },
    [syncKey],
  )
  useEffect(
    () => () => {
      if (syncNoteTimer.current) clearTimeout(syncNoteTimer.current)
    },
    [],
  )

  return { subtitleOffset, offsetNow, syncNote, setSubtitleOffset }
}
