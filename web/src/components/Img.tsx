import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '../core'

/** Where an image is in its loading attempts (see {@link Img}). */
type Step = 'plain' | 'jpeg' | 'authorized' | 'failed'

function withJpeg(src: string): string {
  return /[?&]format=/i.test(src) ? src : `${src}${src.includes('?') ? '&' : '?'}format=jpg`
}

/**
 * An image that fades in. Jellyfin normally serves images without authentication, so a plain
 * <img> works. If that fails it tries, in order:
 *  1. the same image as JPEG (some servers return an empty body when asked to encode WebP, which
 *     browsers prefer), then
 *  2. a fetch that carries the Authorization header, shown as a blob.
 * If all of that fails, `fallback` is shown and `onFail` is called once.
 */
export function Img({
  session,
  src,
  className = '',
  fallback,
  eager = false,
  onFail,
}: {
  session: Session
  src: string | null
  className?: string
  fallback: ReactNode
  eager?: boolean
  onFail?: () => void
}) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<{ forSrc: string; step: Step; blob?: string }>({ forSrc: '', step: 'plain' })

  const step: Step = src && attempt.forSrc === src ? attempt.step : 'plain'
  const blob = src && attempt.forSrc === src ? attempt.blob : undefined

  useEffect(() => {
    return () => {
      if (attempt.blob) URL.revokeObjectURL(attempt.blob)
    }
  }, [attempt.blob])

  useEffect(() => {
    if (step === 'failed') onFail?.()
    // `onFail` is a notification; it must not retrigger when its identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, src])

  if (!src || step === 'failed') return <>{fallback}</>

  const shown = step === 'plain' ? src : step === 'jpeg' ? withJpeg(src) : (blob as string)

  return (
    <img
      src={shown}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      className={`img-fade ${className}`}
      data-loaded={loaded === shown}
      onLoad={() => setLoaded(shown)}
      onError={() => {
        if (step === 'plain') {
          setAttempt({ forSrc: src, step: 'jpeg' })
        } else if (step === 'jpeg') {
          fetch(withJpeg(src), { headers: { Authorization: session.api.authorizationHeader } })
            .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('image'))))
            .then((data) => {
              if (data.size === 0) throw new Error('empty image')
              setAttempt({ forSrc: src, step: 'authorized', blob: URL.createObjectURL(data) })
            })
            .catch(() => setAttempt({ forSrc: src, step: 'failed' }))
        } else {
          setAttempt({ forSrc: src, step: 'failed' })
        }
      }}
    />
  )
}
