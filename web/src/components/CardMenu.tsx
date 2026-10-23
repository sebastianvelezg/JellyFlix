import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { addToWatchLater, type Movie, type Session } from '../core'
import { t } from '../i18n'
import { openAddToPlaylist } from './AddToPlaylistDialog'
import { openItemEditor, useIsAdmin } from './admin/editorEvents'
import { CheckIcon, HeartIcon, InfoIcon, PencilIcon, PlusIcon } from './icons'
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
}: {
  session: Session
  movie: Movie
  onOpen: (movie: Movie) => void
  onChange: (next: Movie) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const { toggle, actionError } = useToggles(session, movie, onChange)
  const admin = useIsAdmin(session)

  // Opens with the first entry focused; a press or focus outside closes it.
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('focusin', away)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('focusin', away)
    }
  }, [open])

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
    <div ref={root} className="absolute right-2 top-2 z-20">
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
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={t('Options for {name}', { name: movie.name })}
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full mt-1.5 w-max min-w-[10rem] max-w-[min(15rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-surface-2)]/95 p-1 shadow-[0_18px_50px_-10px_rgba(0,0,0,0.85)] backdrop-blur-xl"
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
        </div>
      )}
      {actionError && (
        <p
          role="alert"
          className="absolute right-0 top-full mt-1.5 w-max max-w-[min(15rem,calc(100vw-2rem))] rounded-lg border border-red-500/30 bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs text-red-200 shadow-lg"
        >
          {actionError}
        </p>
      )}
    </div>
  )
}
