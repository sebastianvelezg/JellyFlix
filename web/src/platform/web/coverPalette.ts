import { useEffect, useState } from 'react'
import { coverPalette, type CoverPalette } from '../../theme/coverColors'

/** The picture is shrunk to this many pixels on a side before it is read: plenty to tell its colours, and cheap. */
const SAMPLE = 32
const CACHE_LIMIT = 60

const cache = new Map<string, Promise<CoverPalette | null>>()

/**
 * The colours of the picture at `url`, read in the browser. The picture has to be readable by the page (served with CORS, as Jellyfin
 * does); when it is not, or it will not load, the answer is null and the page carries on with its own colours. Answers are remembered.
 */
export function loadCoverPalette(url: string): Promise<CoverPalette | null> {
  const known = cache.get(url)
  if (known) return known
  const made = new Promise<CoverPalette | null>((resolve) => {
    if (typeof document === 'undefined') return resolve(null)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE
        canvas.height = SAMPLE
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return resolve(null)
        context.drawImage(image, 0, 0, SAMPLE, SAMPLE)
        resolve(coverPalette(context.getImageData(0, 0, SAMPLE, SAMPLE).data))
      } catch {
        // A picture the browser will not let the page read (no CORS).
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = url
  })
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(url, made)
  return made
}

/**
 * The colours of the cover at `url` (null while they are being worked out, when there is no cover, or when it has none). The colours of
 * the song before stay until the next ones are ready, so a change of song is a change of colour and not a flash.
 */
export function useCoverPalette(url: string | null): CoverPalette | null {
  const [state, setState] = useState<{ url: string | null; palette: CoverPalette | null }>({ url: null, palette: null })
  useEffect(() => {
    if (!url) return
    let current = true
    void loadCoverPalette(url).then((palette) => {
      if (current) setState({ url, palette })
    })
    return () => {
      current = false
    }
  }, [url])
  return url ? state.palette : null
}
