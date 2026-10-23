import { useCallback, useEffect, useMemo, useState } from 'react'
import { openComic, type ComicPage } from '../../core'
import { readReaderPrefs, readResumePlace, writeBookProgress, writeReaderPrefs } from '../../platform/web/prefs'
import { t } from '../../i18n'
import { ReadProgress, ReaderShell } from './ReaderShell'

/** A picture of a page, as an address the browser can load; it is let go of when the page is turned. */
function usePageUrl(pages: ComicPage[], index: number): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const page = pages[index]
    if (!page) return
    const made = URL.createObjectURL(new Blob([page.bytes as BlobPart], { type: page.mime }))
    // Set on the next frame (so an effect that is undone at once never shows it); the page before stays up until then.
    const frame = requestAnimationFrame(() => setUrl(made))
    return () => {
      cancelAnimationFrame(frame)
      // The picture may still be on screen for a moment: let go of it a little later.
      setTimeout(() => URL.revokeObjectURL(made), 1000)
    }
  }, [pages, index])
  return url
}

/** A comic book archive (CBZ): one picture per screen, turned with the arrow keys, a click on either side, or the buttons. */
export function ComicReader({ data, bookId, title, onExit }: { data: ArrayBuffer; bookId: string; title: string; onExit: () => void }) {
  const opened = useMemo<{ pages: ComicPage[] } | { error: string }>(() => {
    try {
      return { pages: openComic(data) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'That file could not be opened.' }
    }
  }, [data])
  if ('error' in opened) {
    return (
      <ReaderShell title={title} onExit={onExit}>
        <p role="alert" className="alert-error m-6 max-w-xl">
          {t(opened.error)}
        </p>
      </ReaderShell>
    )
  }
  return <ComicView pages={opened.pages} bookId={bookId} title={title} onExit={onExit} />
}

function ComicView({ pages, bookId, title, onExit }: { pages: ComicPage[]; bookId: string; title: string; onExit: () => void }) {
  const [index, setIndex] = useState(() => {
    const saved = Number(readResumePlace(bookId))
    return Number.isInteger(saved) && saved >= 0 && saved < pages.length ? saved : 0
  })
  const [rightToLeft, setRightToLeft] = useState(() => readReaderPrefs().rightToLeft)
  const [fit, setFit] = useState<'height' | 'width'>('height')
  const url = usePageUrl(pages, index)

  const go = useCallback((to: number) => setIndex(Math.min(pages.length - 1, Math.max(0, to))), [pages.length])
  const forward = useCallback(() => setIndex((i) => Math.min(pages.length - 1, i + 1)), [pages.length])
  const backward = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (e.key === 'ArrowRight') (rightToLeft ? backward : forward)()
      else if (e.key === 'ArrowLeft') (rightToLeft ? forward : backward)()
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(pages.length - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rightToLeft, forward, backward, go, pages.length])

  // A page turn is remembered at once (it is a single small write), so leaving right away loses nothing.
  useEffect(() => {
    writeBookProgress(bookId, { percent: ((index + 1) / pages.length) * 100, place: String(index) })
  }, [bookId, index, pages.length])

  const percent = ((index + 1) / pages.length) * 100
  return (
    <ReaderShell
      title={title}
      onExit={onExit}
      controls={
        <>
          <button type="button" className="btn" aria-pressed={fit === 'width'} onClick={() => setFit(fit === 'height' ? 'width' : 'height')}>
            {fit === 'height' ? t('Fit width') : t('Fit height')}
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={rightToLeft}
            title={t('Turn pages from right to left, as in manga')}
            onClick={() => {
              writeReaderPrefs({ rightToLeft: !rightToLeft })
              setRightToLeft(!rightToLeft)
            }}
          >
            {t('Right to left')}
          </button>
        </>
      }
      footer={
        <div className="space-y-2">
          <ReadProgress percent={percent} />
          <div className="flex items-center justify-between gap-2 text-sm text-neutral-300">
            <button type="button" className="btn" disabled={index === 0} onClick={backward}>
              {t('Previous page')}
            </button>
            <span aria-live="polite">{t('Page {n} of {total}', { n: index + 1, total: pages.length })}</span>
            <button type="button" className="btn" disabled={index >= pages.length - 1} onClick={forward}>
              {t('Next page')}
            </button>
          </div>
        </div>
      }
    >
      <div className={`flex h-full w-full justify-center bg-black ${fit === 'width' ? 'overflow-auto' : 'overflow-hidden'}`}>
        {url ? (
          <img
            key={index}
            src={url}
            alt={t('Page {n} of {total}', { n: index + 1, total: pages.length })}
            className={fit === 'height' ? 'h-full max-w-full object-contain' : 'h-auto w-full max-w-4xl self-start'}
            draggable={false}
          />
        ) : (
          <p role="status" className="self-center text-neutral-400">
            {t('Loading…')}
          </p>
        )}
        {/* Clicking the left or right part of the page turns it (the buttons below do the same). */}
        <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-y-0 left-0 w-1/4 cursor-w-resize opacity-0" onClick={rightToLeft ? forward : backward} />
        <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-y-0 right-0 w-1/4 cursor-e-resize opacity-0" onClick={rightToLeft ? backward : forward} />
      </div>
    </ReaderShell>
  )
}
