import { useCallback, useEffect, useRef, useState } from 'react'
import { getTrickplay, trickplaySheetUrl, trickplayTile, type Session, type TrickplayInfo } from '../../core'

/** What the seek bar needs to show a small picture of the moment you point at. */
export interface TrickplayPreview {
  info: TrickplayInfo
  /** The picture for this moment: a sheet's address (a blob in this page) and where the picture is on it; null while the sheet loads. */
  at: (seconds: number) => { url: string; column: number; row: number } | null
}

/**
 * Reads whether the server has trickplay pictures for this title, and loads their sheets as they are pointed at (each once).
 * Nothing at all happens on a server without them, and a sheet that fails to load just means no picture.
 */
export function useTrickplay(session: Session, itemId: string, mediaSourceId: string): TrickplayPreview | null {
  const [info, setInfo] = useState<TrickplayInfo | null>(null)
  const [sheets, setSheets] = useState<Record<number, string>>({})
  const asked = useRef(new Set<number>())
  const urls = useRef<string[]>([])

  useEffect(() => {
    let cancelled = false
    getTrickplay(session, itemId, mediaSourceId)
      .then((found) => !cancelled && setInfo(found))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [session, itemId, mediaSourceId])

  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url)
    },
    [],
  )

  const load = useCallback(
    (sheet: number) => {
      if (!info || asked.current.has(sheet)) return
      asked.current.add(sheet)
      fetch(trickplaySheetUrl(session.serverUrl, itemId, info.width, sheet, mediaSourceId), { headers: { Authorization: session.api.authorizationHeader } })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('sheet'))))
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          urls.current.push(url)
          setSheets((all) => ({ ...all, [sheet]: url }))
        })
        .catch(() => undefined)
    },
    [info, session, itemId, mediaSourceId],
  )

  const at = useCallback(
    (seconds: number) => {
      if (!info) return null
      const tile = trickplayTile(info, seconds)
      load(tile.sheet)
      const url = sheets[tile.sheet]
      return url ? { url, column: tile.column, row: tile.row } : null
    },
    [info, load, sheets],
  )

  return info ? { info, at } : null
}
