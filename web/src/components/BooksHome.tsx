import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { bookKindLabel, getBooks, posterUrl, type Movie, type Session } from '../core'
import { BOOK_FINISHED_PERCENT, readAllBookProgress } from '../platform/web/prefs'
import { BookIcon, HeadphonesIcon } from './icons'
import { Img } from './Img'
import { swrKey, swrScope, useSwr } from './useSwr'
import { t } from '../i18n'

/**
 * The books you opened in the reader and did not finish, from what this browser remembers (the server keeps no place in a book), newest
 * first. The picture's bar shows how far you are: the percent stands in for a position in a length of 100 000. `playbackVersion` is part
 * of the callback identity so the list is read again after the reader is closed.
 */
export function useReadingBooks(session: Session, playbackVersion: number): Movie[] {
  const load = useCallback(async () => {
    const saved = readAllBookProgress().filter(([, progress]) => progress.percent > 0 && progress.percent < BOOK_FINISHED_PERCENT).slice(0, 12)
    const found = await getBooks(session, saved.map(([id]) => id))
    const books = saved.flatMap(([id, progress]) => {
      const book = found.find((b) => b.id === id)
      return book && book.book === 'book' ? [{ ...book, resumeTicks: progress.percent * 1000, runtimeTicks: 100_000 }] : []
    })
    return { books, playbackVersion }
  }, [session, playbackVersion])
  const { state } = useSwr(swrKey(swrScope(session), 'reading-books'), load, { fresh: 0 })
  return state.status === 'ready' ? state.data.books : NONE
}

const NONE: Movie[] = []

function Cover({ session, book, className, style }: { session: Session; book: Movie; className: string; style?: CSSProperties }) {
  return (
    <div className={`aspect-[2/3] overflow-hidden rounded-lg bg-[var(--color-surface-2)] ring-1 ring-white/15 shadow-[0_22px_44px_-14px_rgba(0,0,0,0.9)] ${className}`} style={style}>
      <Img
        session={session}
        src={posterUrl(session.serverUrl, book)}
        className="h-full w-full object-cover"
        fallback={<div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-surface-3)] to-[var(--color-surface)] p-3 text-center text-sm font-medium text-neutral-500">{book.name}</div>}
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-[5%] w-px bg-white/25" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/[.14] via-transparent to-black/20" />
    </div>
  )
}

/** How long each book stays in the middle before the next one takes its place. */
const ROTATE_SECONDS = 5
/** How many books the card goes through. */
const MAX_SLIDES = 12

/**
 * Where a cover rests, by how far it is from the book in the middle (-1 the one that was before, 1 the next one, and so on): across,
 * down, turned, smaller, how seen, and in front of what. A cover that moves from one place to the next slides there, so the pile moves
 * on by one at each change: the middle one goes to the left, the one on the right to the middle, and a new one comes in on the right.
 */
const PLACES: Record<number, { x: number; y: number; turn: number; scale: number; opacity: number; z: number }> = {
  [-2]: { x: -150, y: 34, turn: -13, scale: 0.66, opacity: 0, z: 1 },
  [-1]: { x: -92, y: 16, turn: -7, scale: 0.82, opacity: 0.95, z: 5 },
  0: { x: 0, y: 0, turn: 0, scale: 1, opacity: 1, z: 10 },
  1: { x: 92, y: 24, turn: 7, scale: 0.82, opacity: 0.95, z: 5 },
  2: { x: 150, y: 36, turn: 13, scale: 0.66, opacity: 0, z: 1 },
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The big card at the top of the books home. It goes through the books you are reading, then the newest ones, one every few seconds: the
 * book in the middle (with how far you are when you are in the middle of it, and a button to go on or to read it) and its neighbours
 * fanned out at its sides like a few books on a shelf. It stays while you hover or focus it (or the tab is hidden); the dots go to a
 * book directly. With reduced motion, or with a single book, it stays put.
 */
export function BooksHero({
  session,
  reading,
  recent,
  onPlay,
  onOpen,
}: {
  session: Session
  reading: Movie[]
  recent: Movie[]
  onPlay: (book: Movie) => void
  onOpen: (book: Movie) => void
}) {
  const [chosen, setChosen] = useState(0)
  const [hovering, setHovering] = useState(false)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [reduced] = useState(prefersReducedMotion)
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // What you are reading first, then the newest books you have not finished, then the rest of the newest.
  const slides = useMemo(
    () => [...reading.slice(0, 3), ...recent.filter((b) => !b.played), ...recent.filter((b) => b.played)].filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i).slice(0, MAX_SLIDES),
    [reading, recent],
  )
  const count = slides.length
  if (count === 0) return null
  const index = Math.min(chosen, count - 1)
  const featured = slides[index] as Movie
  const go = (to: number) => setChosen(((to % count) + count) % count)
  const moving = !reduced && count > 1
  const paused = hovering || hidden

  const going = reading.find((b) => b.id === featured.id)
  const percent = going ? Math.round(going.resumeTicks / 1000) : 0
  const audio = featured.book === 'audiobook'
  const author = featured.author
  // How far each book is from the one in the middle, the shortest way round; only the five nearest are drawn.
  const offset = (i: number) => {
    const raw = (((i - index) % count) + count) % count
    return raw > count / 2 ? raw - count : raw
  }
  return (
    <section
      aria-label={t('Featured book')}
      aria-roledescription="carousel"
      className="@container relative isolate overflow-hidden rounded-3xl border border-white/10"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(90% 150% at 100% 0%, color-mix(in srgb, var(--color-accent) 30%, transparent), transparent 62%), linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 18%, #0b0b11), #0b0b11 70%)',
        }}
      />
      <div
        role="group"
        aria-roledescription="slide"
        aria-label={count > 1 ? t('{number} of {count}', { number: index + 1, count }) : undefined}
        className="flex min-h-[17rem] items-center justify-between gap-6 p-6 pb-12 sm:p-8 sm:pb-12"
      >
        <div key={featured.id} className="hero-slide min-w-0 max-w-[26rem]">
          <p className="chip-accent">{going ? t('Continue reading') : t('New on your shelf')}</p>
          <h2 className="mt-3 line-clamp-3 text-balance text-3xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-4xl">{featured.name}</h2>
          <p className="mt-2 text-sm text-neutral-300">{[author, featured.year, t(bookKindLabel(featured))].filter(Boolean).join(' · ')}</p>
          {going && (
            <div className="mt-4 max-w-xs">
              <div role="presentation" className="h-1.5 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-neutral-400">{t('{percent}% read', { percent })}</p>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary px-6 py-2.5" onClick={() => onPlay(featured)}>
              {audio ? <HeadphonesIcon /> : <BookIcon />}
              {audio ? t('Listen') : going ? t('Continue reading') : t('Read')}
            </button>
            <button type="button" className="btn py-2.5" onClick={() => onOpen(featured)}>
              {t('Details')}
            </button>
          </div>
        </div>
        <div key={`small-${featured.id}`} aria-hidden="true" className="hero-slide relative aspect-[2/3] w-24 shrink-0 @xl:hidden">
          <Cover session={session} book={featured} className="absolute inset-0 rotate-3" />
        </div>
        <div aria-hidden="true" className="relative hidden h-64 w-72 shrink-0 @xl:block">
          {slides.map((book, i) => {
            const o = offset(i)
            const place = PLACES[o]
            if (!place) return null
            return (
              <Cover
                key={book.id}
                session={session}
                book={book}
                className="absolute left-1/2 top-0 w-40 transition-[transform,opacity] duration-700 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none"
                style={{ zIndex: place.z, opacity: place.opacity, transform: `translateX(calc(-50% + ${place.x}px)) translateY(${place.y}px) rotate(${place.turn}deg) scale(${place.scale})` }}
              />
            )
          })}
        </div>
      </div>

      {count > 1 && (
        <div role="group" aria-label={t('Choose a book')} className="absolute bottom-3 left-6 z-10 flex max-w-[calc(100%-3rem)] flex-wrap items-center gap-x-1.5 sm:left-8">
          {slides.map((book, i) => (
            <button
              key={book.id}
              type="button"
              aria-label={t('Show {name}', { name: book.name })}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => go(i)}
              className="group/dot flex h-6 items-center pointer-coarse:h-11 pointer-coarse:px-1"
            >
              <span className={`relative block h-1 overflow-hidden rounded-full bg-white/25 transition-all duration-300 group-hover/dot:bg-white/45 ${i === index ? 'w-10' : 'w-4'}`}>
                {i === index && (
                  <span
                    key={book.id}
                    className={`absolute inset-y-0 left-0 block rounded-full bg-[var(--color-accent)] ${moving ? 'hero-progress' : 'w-full'}`}
                    style={moving ? { animationDuration: `${ROTATE_SECONDS}s`, animationPlayState: paused ? 'paused' : 'running' } : undefined}
                    onAnimationEnd={moving ? () => go(index + 1) : undefined}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/** The top of the books home: reads what you are reading, and shows the big card. */
export function BooksTop({ session, playbackVersion, recent, onPlay, onOpen }: { session: Session; playbackVersion: number; recent: Movie[]; onPlay: (book: Movie) => void; onOpen: (book: Movie) => void }) {
  const reading = useReadingBooks(session, playbackVersion)
  return <BooksHero session={session} reading={reading} recent={recent} onPlay={onPlay} onOpen={onOpen} />
}
