import { useEffect, useState } from 'react'
import type { PlaybackPlan, Session } from '../../core'
import { loadSubtitleBlobUrl } from '../../platform/web/browser'

type Loaded = { key: string; url: string | null; failed: boolean }

/**
 * Loads the selected text subtitle as a blob URL. Result is keyed by (session, index),
 * so a stale result is never shown for a newer selection.
 */
export function useSubtitleTrack(session: Session, plan: PlaybackPlan, index: number | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = index === null ? '' : `${plan.playSessionId}:${index}`

  useEffect(() => {
    if (index === null) return
    let cancelled = false
    let created: string | null = null
    loadSubtitleBlobUrl(session, plan, index)
      .then((url) => {
        created = url
        if (cancelled) URL.revokeObjectURL(url)
        else setLoaded({ key, url, failed: false })
      })
      .catch((e: unknown) => {
        console.warn('Could not load subtitles:', e instanceof Error ? e.message : e)
        if (!cancelled) setLoaded({ key, url: null, failed: true })
      })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [session, plan, index, key, attempt])

  const current = loaded?.key === key ? loaded : null
  return {
    url: current?.url ?? null,
    failed: current?.failed ?? false,
    loading: index !== null && current === null,
    retry: () => {
      setLoaded(null)
      setAttempt((n) => n + 1)
    },
  }
}
