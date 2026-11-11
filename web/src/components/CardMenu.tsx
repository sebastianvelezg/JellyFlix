import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { addToWatchLater, isEpisode, type Movie, type Session } from '../core'
import { t } from '../i18n'
import { openAddToPlaylist } from './AddToPlaylistDialog'
import { openItemEditor, useIsAdmin } from './admin/editorEvents'
import { CheckIcon, EyeOffIcon, HeartIcon, InfoIcon, PencilIcon, PlusIcon } from './icons'
import { hideFromContinue, hideSeriesFromNextUp } from './hiddenActions'
import { notifyPlaylistsChanged } from './playlistEvents'
import { showToast } from './toast'
import { useToggles } from './useToggles'

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  )
}

/** The space kept between the menu and the edge of the window, and between the menu and its button (pixels). */
const EDGE = 8
const GAP = 6

/**
 * Where the menu goes: under its button (or over it when there is no room under), lined up with the button's corner, and always
 * inside the window. The menu is drawn outside the row it belongs to (a row scrolls, and would cut the menu off), so it is placed
 * in the window's own coordinates.
 */
export function placeMenu(button: DOMRect, size: { width: number; height: number }, corner: 'left' | 'right', view: { width: number; height: number }) {
  const left = Math.max(EDGE, Math.min(corner === 'left' ? button.left : button.right - size.width, view.width - size.width - EDGE))
  const below = view.height - button.bottom - GAP - EDGE
  const above = button.top - GAP - EDGE
  const under = size.height <= below || below >= above
  const room = under ? below : above
  const height = Math.min(size.height, Math.max(room, 96))
  const top = under ? button.bottom + GAP : button.top - GAP - height
  return { top, left, maxHeight: Math.max(room, 96) }
}

const item =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-100 outline-none transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] pointer-coarse:py-3'

/**
 * The "⋯" button of a poster card and its menu: open the page, mark as watched, add to favorites. It sits next to the card's own
 * button (a button cannot hold another button), appears when the card is hovered or focused, and is always there on a touchscreen.
 */
export function CardMenu({
  session,
  movie,
  onOpen,
  onChange,
  rowKind,
  corner = 'right',
}: {
  session: Session
  movie: Movie
  onOpen: (movie: Movie) => void
  onChange: (next: Movie) => void
  /** The card is in "Continue watching" or in "Next up": the menu then offers to hide it from that row. */
  rowKind?: 'continue' | 'nextUp'
  /** Which top corner the button sits in (the right one may be taken by the card's own button). */
  corner?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const { toggle, actionError } = useToggles(session, movie, onChange)
  const admin = useIsAdmin(session)

  // Opens with the first entry focused; a press or focus outside closes it.
  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      const target = e.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    // The menu is placed in the window, so it follows its button when something scrolls or the window changes size, and closes once
    // the button is out of view.
    const leave = (e: Event) => {
      if (menu.current?.contains(e.target as Node)) return
      const box = menu.current
      const button = trigger.current?.getBoundingClientRect()
      if (!box || !button) return
      if (button.bottom < 0 || button.top > window.innerHeight || button.right < 0 || button.left > window.innerWidth) {
        setOpen(false)
        return
      }
      setPlace(placeMenu(button, { width: box.offsetWidth, height: box.scrollHeight }, corner, { width: window.innerWidth, height: window.innerHeight }))
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('focusin', away)
    window.addEventListener('scroll', leave, true)
    window.addEventListener('resize', leave)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('focusin', away)
      window.removeEventListener('scroll', leave, true)
      window.removeEventListener('resize', leave)
    }
  }, [open, corner])

  // Placed once it is on the page (its size is known then) and before it is painted, so it never shows in the wrong place.
  useLayoutEffect(() => {
    const box = menu.current
    const button = trigger.current
    if (!open || !box || !button) return
    setPlace(placeMenu(button.getBoundingClientRect(), { width: box.offsetWidth, height: box.scrollHeight }, corner, { width: window.innerWidth, height: window.innerHeight }))
  }, [open, corner])

  // Opens with the first entry focused (it is in its place by then, so focusing it never moves the page).
  useEffect(() => {
    if (open && place) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [open, place])

  const close = (focusTrigger: boolean) => {
    setOpen(false)
    if (focusTrigger) trigger.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = entries.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : (at + step + entries.length) % entries.length
    entries[next]?.focus()
  }

  return (
    <div ref={root} className={`absolute top-2 z-20 ${corner === 'left' ? 'left-2' : 'right-2'}`}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('More options for {name}', { name: movie.name })}
        title={t('More options')}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-neutral-100 opacity-0 backdrop-blur transition hover:bg-black/85 hover:text-white focus-visible:opacity-100 group-focus-within/card:opacity-100 group-hover/card:opacity-100 aria-expanded:opacity-100 pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:opacity-100"
      >
        <DotsIcon />
      </button>
      {open &&
        createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label={t('Options for {name}', { name: movie.name })}
          onKeyDown={onKeyDown}
          style={place ? { top: place.top, left: place.left, maxHeight: place.maxHeight } : { top: 0, left: 0, visibility: 'hidden' }}
          className="fixed z-[60] w-max min-w-[10rem] max-w-[min(15rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-surface-2)]/95 p-1 shadow-[0_18px_50px_-10px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              close(false)
              onOpen(movie)
            }}
          >
            <InfoIcon /> {t('Details')}
          </button>
          {rowKind === 'continue' && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                close(false)
                hideFromContinue(movie)
              }}
            >
              <EyeOffIcon /> {t('Hide from Continue watching')}
            </button>
          )}
          {rowKind === 'nextUp' && isEpisode(movie) && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                close(false)
                hideSeriesFromNextUp(movie)
              }}
            >
              <EyeOffIcon /> {t('Hide series from Next up')}
            </button>
          )}
          {!movie.isSeries && (
            <>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close(true)
                  addToWatchLater(session, movie.id, t('Watch later'))
                    .then((result) => {
                      notifyPlaylistsChanged()
                      showToast({ message: result.already ? t('{title} is already in Watch later.', { title: movie.name }) : t('Added {title} to Watch later.', { title: movie.name }) })
                    })
                    .catch(() => showToast({ message: t('Could not add it to Watch later. Check your connection and try again.') }))
                }}
              >
                <ClockIcon /> {t('Watch later')}
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  close(false)
                  openAddToPlaylist(movie)
                }}
              >
                <PlusIcon /> {t('Add to a playlist…')}
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              close(true)
              void toggle('watched')
            }}
          >
            <CheckIcon /> {movie.played ? t('Mark as unwatched') : t('Mark as watched')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              close(true)
              void toggle('favorite')
            }}
          >
            <HeartIcon filled={movie.favorite} /> {movie.favorite ? t('Remove from favorites') : t('Add to favorites')}
          </button>
          {admin && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                close(false)
                openItemEditor({ id: movie.id, name: movie.name, type: movie.isSeries ? 'Series' : 'Movie' })
              }}
            >
              <PencilIcon /> {t('Edit…')}
            </button>
          )}
        </div>,
        document.body,
        )}
      {actionError && (
        <p
          role="alert"
          className={`absolute ${corner === 'left' ? 'left-0' : 'right-0'} top-full mt-1.5 w-max max-w-[min(15rem,calc(100vw-2rem))] rounded-lg border border-red-500/30 bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs text-red-200 shadow-lg`}
        >
          {actionError}
        </p>
      )}
    </div>
  )
}
