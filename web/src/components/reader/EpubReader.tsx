import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chapterPage, openEpub, resolveLink, type EpubBook } from '../../platform/web/epub'
import {
  READER_TEXT_SIZES,
  READER_THEMES,
  readReaderPrefs,
  readResumePlace,
  writeBookProgress,
  writeReaderPrefs,
  type ReaderPrefs,
  type ReaderTheme,
} from '../../platform/web/prefs'
import { t, tr } from '../../i18n'
import { ReadProgress, ReaderShell } from './ReaderShell'

const THEMES: Record<ReaderTheme, { bg: string; fg: string; link: string }> = {
  dark: { bg: '#121212', fg: '#e4e4e4', link: '#8ab8ff' },
  light: { bg: '#fbfaf7', fg: '#1d1d1d', link: '#1d4ed8' },
  sepia: { bg: '#f4ecd8', fg: '#3b2f1e', link: '#8a4b0f' },
}

const THEME_LABELS: Record<ReaderTheme, string> = { dark: tr('Dark'), light: tr('Light'), sepia: tr('Sepia') }

/** The reader's own look, put last in each chapter so it wins over the book's: colours, the text size and a comfortable line. */
function readerCss(prefs: ReaderPrefs): string {
  const c = THEMES[prefs.theme]
  return `
    html { font-size: ${prefs.textSize}%; background: ${c.bg}; color-scheme: ${prefs.theme === 'dark' ? 'dark' : 'light'}; }
    body { margin: 0 auto !important; max-width: 40rem; padding: 1.5rem 1.25rem 4rem !important; background: ${c.bg} !important; color: ${c.fg} !important; line-height: 1.7; overflow-wrap: anywhere; }
    body *:not(img):not(svg):not(image) { color: ${c.fg} !important; background-color: transparent !important; }
    body a, body a * { color: ${c.link} !important; }
    img, svg { max-width: 100%; height: auto; }
    img:not([src]) { display: none; }
    pre { white-space: pre-wrap; }
  `
}

/** "3:0.42" is the third chapter, 42 % of the way down. */
function parsePlace(place: string | undefined): { chapter: number; fraction: number } {
  const [chapter, fraction] = (place ?? '').split(':')
  const c = Number(chapter)
  const f = Number(fraction)
  return { chapter: Number.isInteger(c) && c >= 0 ? c : 0, fraction: Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0 }
}

/** An EPUB: one chapter at a time in a frame that has no scripts and no network, scrolled like a page. */
export function EpubReader({ data, bookId, title, onExit }: { data: ArrayBuffer; bookId: string; title: string; onExit: () => void }) {
  const opened = useMemo<{ book: EpubBook } | { error: string }>(() => {
    try {
      return { book: openEpub(data) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'That file is not a valid EPUB.' }
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
  return <EpubView book={opened.book} bookId={bookId} title={opened.book.title || title} onExit={onExit} />
}

function EpubView({ book, bookId, title, onExit }: { book: EpubBook; bookId: string; title: string; onExit: () => void }) {
  const [start] = useState(() => parsePlace(readResumePlace(bookId)))
  const [chapter, setChapter] = useState(() => Math.min(start.chapter, book.chapters.length - 1))
  const [prefs, setPrefs] = useState(readReaderPrefs)
  const [fraction, setFraction] = useState(start.fraction)
  const frame = useRef<HTMLIFrameElement>(null)
  // Where to put the page when it has loaded: a spot in the chapter (0 to 1), or an anchor in it.
  const pending = useRef<{ fraction: number; fragment?: string }>({ fraction: chapter === start.chapter ? start.fraction : 0 })
  const fractionNow = useRef(start.fraction)
  const chapterNow = useRef(chapter)

  const page = useMemo(() => chapterPage(book, chapter, readerCss(prefs)), [book, chapter, prefs])

  const percent = ((chapter + fraction) / book.chapters.length) * 100

  const save = useCallback(() => {
    const total = book.chapters.length
    const percentNow = ((chapterNow.current + fractionNow.current) / total) * 100
    writeBookProgress(bookId, { percent: percentNow, place: `${chapterNow.current}:${fractionNow.current.toFixed(3)}` })
  }, [book, bookId])
  useEffect(() => {
    chapterNow.current = chapter
    const timer = setTimeout(save, 600)
    return () => clearTimeout(timer)
  }, [chapter, fraction, save])
  useEffect(() => save, [save])

  const go = useCallback(
    (next: number, fragment?: string) => {
      if (next < 0 || next >= book.chapters.length) return
      pending.current = { fraction: 0, fragment }
      fractionNow.current = 0
      setFraction(0)
      setChapter(next)
    },
    [book],
  )

  // Arrow keys change chapter, wherever the focus is (the frame passes its keys on).
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && !e.altKey && !e.metaKey && !e.ctrlKey) go(chapterNow.current + 1)
      else if (e.key === 'ArrowLeft' && !e.altKey && !e.metaKey && !e.ctrlKey) go(chapterNow.current - 1)
    },
    [go],
  )
  useEffect(() => {
    const target = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      onKey(e)
    }
    window.addEventListener('keydown', target)
    return () => window.removeEventListener('keydown', target)
  }, [onKey])

  const onLoad = () => {
    const win = frame.current?.contentWindow
    const doc = frame.current?.contentDocument
    if (!win || !doc) return
    const scrollable = () => Math.max(1, doc.documentElement.scrollHeight - win.innerHeight)
    const { fraction: at, fragment } = pending.current
    pending.current = { fraction: 0 }
    requestAnimationFrame(() => {
      if (fragment) doc.getElementById(fragment)?.scrollIntoView()
      else win.scrollTo(0, at * scrollable())
    })
    win.addEventListener(
      'scroll',
      () => {
        const now = Math.min(1, Math.max(0, win.scrollY / scrollable()))
        fractionNow.current = now
        setFraction(now)
      },
      { passive: true },
    )
    // Keys pressed inside the page do not reach this window: the page passes them on.
    doc.addEventListener('keydown', (e) => (e.key === 'Escape' ? onExit() : onKey(e)))
    doc.addEventListener('click', (e) => {
      const link = (e.target as Element | null)?.closest('a')
      if (!link) return
      e.preventDefault()
      const href = link.getAttribute('href')
      const target = href ? resolveLink(book, chapterNow.current, href) : null
      if (!target) return
      if ('external' in target) window.open(target.external, '_blank', 'noopener,noreferrer')
      else if (target.chapter === chapterNow.current && target.fragment) doc.getElementById(target.fragment)?.scrollIntoView()
      else go(target.chapter, target.fragment)
    })
    win.focus()
  }

  const change = (patch: Partial<ReaderPrefs>) => {
    // The page is drawn again with the new look; it comes back to the same spot.
    pending.current = { fraction: fractionNow.current }
    setPrefs((p) => ({ ...p, ...patch }))
    writeReaderPrefs(patch)
  }
  const { min, max, step } = READER_TEXT_SIZES

  const current = [...book.toc].reverse().find((entry) => entry.chapter <= chapter)
  return (
    <ReaderShell
      title={title}
      onExit={onExit}
      controls={
        <>
          {book.toc.length > 1 && (
            <select
              className="select max-w-40 sm:max-w-64"
              aria-label={t('Chapters')}
              value={current ? book.toc.indexOf(current) : ''}
              onChange={(e) => {
                const entry = book.toc[Number(e.target.value)]
                if (entry) go(entry.chapter, entry.fragment)
              }}
            >
              {book.toc.map((entry, i) => (
                <option key={i} value={i}>
                  {'  '.repeat(Math.min(entry.depth, 3))}
                  {entry.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn" aria-label={t('Smaller text')} title={t('Smaller text')} disabled={prefs.textSize <= min} onClick={() => change({ textSize: prefs.textSize - step })}>
            A−
          </button>
          <button type="button" className="btn" aria-label={t('Larger text')} title={t('Larger text')} disabled={prefs.textSize >= max} onClick={() => change({ textSize: prefs.textSize + step })}>
            A+
          </button>
          <select className="select" aria-label={t('Page colours')} value={prefs.theme} onChange={(e) => change({ theme: e.target.value as ReaderTheme })}>
            {READER_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {t(THEME_LABELS[theme])}
              </option>
            ))}
          </select>
        </>
      }
      footer={
        <div className="space-y-2">
          <ReadProgress percent={percent} />
          <div className="flex items-center justify-between gap-2 text-sm text-neutral-300">
            <button type="button" className="btn" disabled={chapter === 0} onClick={() => go(chapter - 1)}>
              {t('Previous chapter')}
            </button>
            <span aria-live="polite">{t('Chapter {n} of {total} · {percent}%', { n: chapter + 1, total: book.chapters.length, percent: Math.round(percent) })}</span>
            <button type="button" className="btn" disabled={chapter >= book.chapters.length - 1} onClick={() => go(chapter + 1)}>
              {t('Next chapter')}
            </button>
          </div>
        </div>
      }
    >
      <iframe
        ref={frame}
        key={chapter}
        title={t('Chapter {n}', { n: chapter + 1 })}
        // No scripts, no forms, no pop-ups: the book can only be looked at. (Same origin lets this page scroll it and follow its links.)
        sandbox="allow-same-origin"
        srcDoc={page}
        onLoad={onLoad}
        className="h-full w-full border-0"
        style={{ colorScheme: prefs.theme === 'dark' ? 'dark' : 'light' }}
      />
    </ReaderShell>
  )
}
