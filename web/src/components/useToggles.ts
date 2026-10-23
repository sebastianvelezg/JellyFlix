import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { setFavorite, setWatched, type Movie, type Session } from '../core'

/**
 * Watched / favorite buttons for a title (movie or series). A press flips the state at once and
 * confirms with the server; if the server refuses, the state is rolled back and `actionError` says so.
 * Requests finish out of order, so results are merged into the latest item, not the one captured at click time.
 */
export function useToggles<T extends Movie>(session: Session, item: T, onChange: (next: T) => void) {
  const [actionError, setActionError] = useState<string | null>(null)
  const latest = useRef(item)
  useEffect(() => {
    latest.current = item
  }, [item])
  const pending = useRef(new Set<string>())

  async function toggle(kind: 'watched' | 'favorite') {
    if (pending.current.has(kind)) return
    pending.current.add(kind)
    setActionError(null)
    const before = latest.current
    const target = kind === 'watched' ? !before.played : !before.favorite
    onChange(
      kind === 'watched'
        ? { ...before, played: target, resumeTicks: target ? 0 : before.resumeTicks }
        : { ...before, favorite: target },
    )
    try {
      const next =
        kind === 'watched'
          ? await setWatched(session, item.id, target)
          : await setFavorite(session, item.id, target)
      onChange(
        kind === 'watched'
          ? { ...latest.current, played: next.played, resumeTicks: next.resumeTicks }
          : { ...latest.current, favorite: next.favorite },
      )
    } catch {
      onChange(
        kind === 'watched'
          ? { ...latest.current, played: before.played, resumeTicks: before.resumeTicks }
          : { ...latest.current, favorite: before.favorite },
      )
      setActionError(kind === 'watched' ? t('Could not update “watched”. Check your connection and try again.') : t('Could not update “favorite”. Check your connection and try again.'))
    } finally {
      pending.current.delete(kind)
    }
  }

  return { toggle, actionError }
}
