import { useCallback, useEffect, useRef, useState } from 'react'
import { openPdf, type PdfDocument, type PdfOutlineEntry } from '../../platform/web/pdf'
import {
  READER_THEMES,
  readReaderPrefs,
  readResumePlace,
  writeBookProgress,
  writeReaderPrefs,
  type ReaderTheme,
} from '../../platform/web/prefs'
import { saveFile } from '../../platform/web/saveFile'
import { t, tr } from '../../i18n'
import { ChevronLeftIcon, ChevronRightIcon } from '../icons'
import { ReadProgress, ReaderShell } from './ReaderShell'

type Opened = { status: 'loading' } | { status: 'ready'; doc: PdfDocument; ratio: number } | { status: 'browser' }

/**
 * A PDF is drawn here, page after page, in the colours of the reader (dark, light or sepia) instead of the grey box of the browser's own
 * viewer. When that cannot be done (a file it cannot open, a password) the browser's viewer takes over; so does choosing it, which brings
 * back selecting text, searching and printing. Browsers that cannot show a PDF inside a page (most phones) are offered the file.
 */
export function PdfReader({ data, bookId, title, onExit }: { data: ArrayBuffer; bookId: string; title: string; onExit: () => void }) {
  const [opened, setOpened] = useState<Opened>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    let doc: PdfDocument | null = null
    openPdf(data)
      .then(async (made) => {
        // Closed before it finished opening: nothing is going to use it.
        if (cancelled) return made.destroy()
        doc = made
        const ratio = await made.ratio(1)
        if (cancelled) return
        setOpened({ status: 'ready', doc: made, ratio })
      })
      .catch(() => !cancelled && setOpened({ status: 'browser' }))
    return () => {
      cancelled = true
      doc?.destroy()
    }
  }, [data])

  if (opened.status === 'loading') {
    return (
      <ReaderShell title={title} onExit={onExit}>
        <p role="status" className="m-6 text-neutral-300">
          {t('Opening…')}
        </p>
      </ReaderShell>
    )
  }
  if (opened.status === 'browser') return <BrowserPdf data={data} title={title} onExit={onExit} />
  return <PdfView doc={opened.doc} ratio={opened.ratio} bookId={bookId} title={title} onExit={onExit} onBrowser={() => setOpened({ status: 'browser' })} />
}

/** The browser's own viewer in a frame, or the file itself where the browser cannot show one. */
function BrowserPdf({ data, title, onExit }: { data: ArrayBuffer; title: string; onExit: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const made = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
    // Set on the next frame: if this effect is undone at once (the page is closed, or React checks it twice), the address never shows.
    const frame = requestAnimationFrame(() => setUrl(made))
    return () => {
      cancelAnimationFrame(frame)
      URL.revokeObjectURL(made)
    }
  }, [data])
  const canShow = typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false

  return (
    <ReaderShell title={title} onExit={onExit}>
      {canShow ? (
        url && <iframe title={title} src={url} className="h-full w-full border-0 bg-white" />
      ) : (
        <div className="m-6 max-w-xl space-y-4">
          <p className="text-neutral-200">{t('This browser cannot show a PDF inside a page. Save it and open it with your PDF viewer.')}</p>
          <button type="button" className="btn-primary" onClick={() => saveFile(new Blob([data], { type: 'application/pdf' }), `${title}.pdf`)}>
            {t('Download')}
          </button>
        </div>
      )}
    </ReaderShell>
  )
}

/** What each colour scheme looks like: the table the pages lie on, and how a page (white, in the file) is turned into it. */
const LOOKS: Record<ReaderTheme, { table: string; filter: string; shadow: string }> = {
  dark: { table: '#0c0c0d', filter: 'invert(0.9) hue-rotate(180deg)', shadow: '0 0 0 1px rgba(255,255,255,0.06)' },
  light: { table: '#f2f0eb', filter: 'none', shadow: '0 1px 8px rgba(0,0,0,0.18)' },
  sepia: { table: '#e6d9bb', filter: 'sepia(0.45) contrast(0.95) brightness(0.96)', shadow: '0 1px 8px rgba(59,47,30,0.28)' },
}
const THEME_LABELS: Record<ReaderTheme, string> = { dark: tr('Dark'), light: tr('Light'), sepia: tr('Sepia') }

const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
/** A page is never wider than this at 100%, so lines stay a comfortable length on a big screen. */
const PAGE_MAX_WIDTH = 920
const PAGE_SIDE_MARGIN = 24

function PdfView({
  doc,
  ratio,
  bookId,
  title,
  onExit,
  onBrowser,
}: {
  doc: PdfDocument
  ratio: number
  bookId: string
  title: string
  onExit: () => void
  onBrowser: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const settled = useRef(false)
  // The page being read, for the code that watches the screen (it must not run again for every page turn).
  const current = useRef(0)
  const [available, setAvailable] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [theme, setTheme] = useState(() => readReaderPrefs().theme)
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([])
  const [page, setPage] = useState(() => {
    const saved = Number(readResumePlace(bookId))
    return Number.isInteger(saved) && saved >= 1 && saved <= doc.pages ? saved : 1
  })
  const look = LOOKS[theme]
  const width = Math.max(200, Math.round(Math.min(available - PAGE_SIDE_MARGIN * 2, PAGE_MAX_WIDTH) * zoom))

  useEffect(() => {
    let cancelled = false
    doc
      .outline()
      .then((entries) => !cancelled && setOutline(entries))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [doc])

  // How much room there is for a page.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scrollToPage = useCallback((n: number, smooth = false) => {
    scroller.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Open where you stopped, once the pages are laid out. Until then the page being read is not worked out from what is on screen
  // (that would be page 1).
  const [startPage] = useState(page)
  const laidOut = available > 0
  useEffect(() => {
    if (!laidOut) return
    const frame = requestAnimationFrame(() => {
      current.current = startPage
      scrollToPage(startPage)
      settled.current = true
    })
    scroller.current?.focus({ preventScroll: true })
    return () => cancelAnimationFrame(frame)
  }, [laidOut, startPage, scrollToPage])

  // The page that most of the screen shows is the one being read; it is remembered at once (a single small write).
  const pick = useCallback(
    (n: number) => {
      current.current = n
      setPage(n)
      writeBookProgress(bookId, { percent: (n / doc.pages) * 100, place: String(n) })
    },
    [bookId, doc.pages],
  )
  useEffect(() => {
    const root = scroller.current
    if (!root || width === 0) return
    const shown = new Map<number, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) shown.set(Number((entry.target as HTMLElement).dataset.page), entry.intersectionRatio * entry.boundingClientRect.height)
        if (!settled.current) return
        let best = 0
        let most = 0
        for (const [n, visible] of shown) {
          if (visible > most) {
            most = visible
            best = n
          }
        }
        if (best > 0 && best !== current.current) pick(best)
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    root.querySelectorAll('[data-page]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [width, doc.pages, pick])

  const zoomTo = (next: number) => {
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)))
    // The pages change size: stay on the one being read.
    requestAnimationFrame(() => scrollToPage(page))
  }

  const slots = Array.from({ length: doc.pages }, (_, i) => i + 1)
  const percent = (page / doc.pages) * 100
  return (
    <ReaderShell
      title={title}
      onExit={onExit}
      controls={
        <>
          {outline.length > 0 && (
            <select
              className="select max-w-48"
              aria-label={t('Contents')}
              value=""
              onChange={(e) => {
                const entry = outline[Number(e.target.value)]
                if (entry) scrollToPage(entry.page)
              }}
            >
              <option value="" disabled>
                {t('Contents')}
              </option>
              {outline.map((entry, i) => (
                <option key={i} value={i}>
                  {'  '.repeat(entry.depth)}
                  {entry.title}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn" aria-label={t('Zoom out')} title={t('Zoom out')} disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom - ZOOM_STEP)}>
            −
          </button>
          <button type="button" className="btn tabular-nums max-sm:hidden" aria-label={t('Fit the width')} title={t('Fit the width')} onClick={() => zoomTo(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="btn" aria-label={t('Zoom in')} title={t('Zoom in')} disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom + ZOOM_STEP)}>
            +
          </button>
          <select
            className="select"
            aria-label={t('Page colours')}
            value={theme}
            onChange={(e) => {
              const next = e.target.value as ReaderTheme
              writeReaderPrefs({ theme: next })
              setTheme(next)
            }}
          >
            {READER_THEMES.map((name) => (
              <option key={name} value={name}>
                {t(THEME_LABELS[name])}
              </option>
            ))}
          </select>
          <button type="button" className="btn max-sm:hidden" title={t('Open in the browser’s own viewer: select text, search and print')} onClick={onBrowser}>
            {t('Browser viewer')}
          </button>
        </>
      }
      footer={
        <div className="space-y-2">
          <ReadProgress percent={percent} />
          <div className="flex items-center justify-between gap-2 text-sm text-neutral-300">
            <button type="button" className="btn" aria-label={t('Previous page')} disabled={page <= 1} onClick={() => scrollToPage(page - 1, true)}>
              <ChevronLeftIcon />
              <span className="max-sm:hidden">{t('Previous page')}</span>
            </button>
            <label className="flex items-center gap-2" aria-live="polite">
              <span className="sr-only">{t('Go to page')}</span>
              <input
                key={page}
                type="number"
                min={1}
                max={doc.pages}
                defaultValue={page}
                aria-label={t('Go to page')}
                className="field w-20 py-1 text-center tabular-nums"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  const n = Math.round(Number(e.currentTarget.value))
                  if (n >= 1 && n <= doc.pages) {
                    scrollToPage(n)
                    scroller.current?.focus({ preventScroll: true })
                  }
                }}
              />
              <span>{t('of {total}', { total: doc.pages })}</span>
            </label>
            <button type="button" className="btn" aria-label={t('Next page')} disabled={page >= doc.pages} onClick={() => scrollToPage(page + 1, true)}>
              <span className="max-sm:hidden">{t('Next page')}</span>
              <ChevronRightIcon />
            </button>
          </div>
        </div>
      }
    >
      <div
        ref={scroller}
        tabIndex={0}
        aria-label={t('Pages')}
        className="h-full overflow-auto outline-none"
        style={{ background: look.table, colorScheme: theme === 'dark' ? 'dark' : 'light' }}
      >
        <div className="flex flex-col items-center gap-4 py-4">
          {available > 0 &&
            slots.map((n) => <PageSlot key={n} doc={doc} n={n} width={width} ratio={ratio} filter={look.filter} shadow={look.shadow} />)}
        </div>
      </div>
    </ReaderShell>
  )
}

/**
 * One page: an empty frame of the right size until it comes near the screen, then drawn on a canvas; far from the screen it is let go
 * of again, so a book of hundreds of pages never has more than a few in memory.
 */
function PageSlot({ doc, n, width, ratio, filter, shadow }: { doc: PdfDocument; n: number; width: number; ratio: number; filter: string; shadow: string }) {
  const frame = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [own, setOwn] = useState<number>()

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: '150% 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    if (!near) {
      el.width = 0
      el.height = 0
      return
    }
    const drawing = doc.draw(n, el, width)
    drawing.done.then((r) => r && setOwn(r)).catch(() => undefined)
    return () => drawing.cancel()
  }, [doc, n, width, near])

  return (
    <div
      ref={frame}
      data-page={n}
      aria-label={t('Page {n} of {total}', { n, total: doc.pages })}
      role="img"
      className="relative shrink-0"
      style={{ width, height: Math.round(width * (own ?? ratio)), boxShadow: shadow }}
    >
      {/* The paper and the drawing on it change colour together, so a page that is still being drawn is not a white flash. */}
      <div className="h-full w-full overflow-hidden bg-white" style={{ filter }}>
        <canvas ref={canvas} className="block" />
      </div>
    </div>
  )
}
