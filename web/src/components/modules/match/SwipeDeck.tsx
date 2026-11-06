import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Session } from '../../../core'
import type { MatchCard, MatchVote } from '../../../core/modules'
import { t } from '../../../i18n'
import { Poster } from './Poster'

/** How far a card must be dragged sideways to count as a vote. */
const THRESHOLD = 90
const FLY_MS = 180

/**
 * A stack of cards to swipe: right to like, left to pass. It works with a finger or a mouse (drag), with the arrow keys and with
 * the two buttons under the cards, so it can be used without dragging. Only the top card moves; the next two are seen behind it.
 */
export function SwipeDeck({ session, cards, total, onVote }: { session: Session; cards: MatchCard[]; total: number; onVote: (card: MatchCard, vote: MatchVote) => void }) {
  const [drag, setDrag] = useState({ x: 0, active: false })
  const [leaving, setLeaving] = useState<MatchVote | null>(null)
  const start = useRef<number | null>(null)
  const top = cards[0]
  const deck = useRef<HTMLDivElement>(null)

  useEffect(() => {
    deck.current?.focus({ preventScroll: true })
  }, [])

  if (!top) return null

  const vote = (value: MatchVote) => {
    if (leaving) return
    setLeaving(value)
    window.setTimeout(() => {
      setLeaving(null)
      setDrag({ x: 0, active: false })
      onVote(top, value)
    }, FLY_MS)
  }

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (leaving) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = e.clientX
    setDrag({ x: 0, active: true })
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return
    setDrag({ x: e.clientX - start.current, active: true })
  }
  const up = () => {
    if (start.current === null) return
    start.current = null
    if (drag.x > THRESHOLD) vote('like')
    else if (drag.x < -THRESHOLD) vote('pass')
    else setDrag({ x: 0, active: false })
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      vote('like')
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      vote('pass')
    }
  }

  const x = leaving === 'like' ? 600 : leaving === 'pass' ? -600 : drag.x
  const like = Math.min(1, Math.max(0, x / THRESHOLD))
  const pass = Math.min(1, Math.max(0, -x / THRESHOLD))
  const done = total - cards.length

  return (
    <div className="space-y-4">
      <p className="sr-only" aria-live="polite">
        {t('{done} of {total}', { done: Math.min(total, done + 1), total })}
      </p>
      <div
        ref={deck}
        tabIndex={0}
        role="group"
        aria-label={t('Cards to swipe. Use the left and right arrow keys, or the buttons below.')}
        onKeyDown={key}
        // As wide as fits: up to 24rem, and never so tall that the buttons below fall off a phone's screen.
        style={{ width: 'min(100%, 24rem, calc(46dvh * 0.6667))' }}
        className="relative mx-auto aspect-[2/3] touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {cards
          .slice(1, 3)
          .reverse()
          .map((card, i, behind) => (
            <div key={card.id} aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-2xl border border-white/10 bg-black" style={{ transform: `scale(${1 - (behind.length - i) * 0.04}) translateY(${(behind.length - i) * 10}px)` }}>
              <Poster session={session} card={card} className="h-full w-full" />
            </div>
          ))}
        <div
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className={`absolute inset-0 cursor-grab overflow-hidden rounded-2xl border border-white/15 bg-black shadow-2xl active:cursor-grabbing ${drag.active ? '' : 'transition-transform duration-200 motion-reduce:transition-none'}`}
          style={{ transform: `translateX(${x}px) rotate(${x / 25}deg)` }}
        >
          <Poster session={session} card={top} className="h-full w-full" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent p-4 pt-16">
            <h3 className="text-xl font-semibold text-white">
              {top.name}
              {top.year ? <span className="ml-2 text-base font-normal text-neutral-300">{top.year}</span> : null}
            </h3>
            <p className="mt-0.5 text-xs text-neutral-300">
              {[top.genres.join(', '), top.runtimeMinutes ? t('{minutes} min', { minutes: top.runtimeMinutes }) : '', top.rating ? `★ ${top.rating}` : '', top.officialRating ?? ''].filter(Boolean).join(' · ')}
            </p>
            {top.overview && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-neutral-200">{top.overview}</p>}
          </div>
          <span aria-hidden="true" className="pointer-events-none absolute left-4 top-4 rotate-[-12deg] rounded-lg border-4 border-emerald-400 px-3 py-1 text-2xl font-black text-emerald-400" style={{ opacity: like }}>
            {t('LIKE')}
          </span>
          <span aria-hidden="true" className="pointer-events-none absolute right-4 top-4 rotate-[12deg] rounded-lg border-4 border-red-400 px-3 py-1 text-2xl font-black text-red-400" style={{ opacity: pass }}>
            {t('NOPE')}
          </span>
        </div>
      </div>
      <div className="flex justify-center gap-10">
        <div className="flex flex-col items-center gap-1">
          <button type="button" className="flex h-16 w-16 items-center justify-center rounded-full border border-red-400/50 text-3xl text-red-300 transition hover:bg-red-500/10 active:scale-90" aria-label={t('Pass on {title}', { title: top.name })} onClick={() => vote('pass')}>
            ✕
          </button>
          <span aria-hidden="true" className="text-[11px] uppercase tracking-wider text-neutral-500">← {t('Pass')}</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button type="button" className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/50 text-3xl text-emerald-300 transition hover:bg-emerald-500/10 active:scale-90" aria-label={t('Like {title}', { title: top.name })} onClick={() => vote('like')}>
            ♥
          </button>
          <span aria-hidden="true" className="text-[11px] uppercase tracking-wider text-neutral-500">{t('Like')} →</span>
        </div>
      </div>
    </div>
  )
}
