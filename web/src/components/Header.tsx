import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { Section, Session } from '../core'
import { AnimeIcon, BookIcon, CloseIcon, FilmIcon, HomeIcon, LiveTvIcon, LogoMark, MusicIcon, MusicVideoIcon, SearchIcon, TvIcon, Wordmark } from './icons'
import { t, tr } from '../i18n'
import { addRecentSearch, clearRecentSearches, readRecentSearches } from '../platform/web/recentSearches'

const SEARCH_DELAY_MS = 300

/**
 * Search box. Typing updates the results after a short pause (and immediately on Enter); the text
 * follows the route, so the browser Back button also restores or clears it. Press "/" to focus.
 */
function SearchBox({ query, onSearch }: { query: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState(query)
  const input = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSent = useRef(query)
  const [sent, setSent] = useState(query)
  const [seenQuery, setSeenQuery] = useState(query)
  // What you searched for before, offered while the box is empty and has the focus.
  const [focused, setFocused] = useState(false)
  const [recents, setRecents] = useState<string[]>([])

  // Handlers (timers, key presses) read the latest sent value from a ref.
  useEffect(() => {
    lastSent.current = sent
  }, [sent])

  // Follow external changes (Back/Forward, clearing from elsewhere) but never overwrite what the
  // user is typing: our own searches come back as `query === sent`.
  if (query !== seenQuery) {
    setSeenQuery(query)
    if (query !== sent) {
      setSent(query)
      setText(query)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const send = (value: string) => {
    if (timer.current) clearTimeout(timer.current)
    if (value.trim() === lastSent.current.trim()) return
    lastSent.current = value
    setSent(value)
    onSearch(value)
  }

  return (
    <form
      role="search"
      className="group/search relative min-w-0 flex-1 transition-[max-width] duration-300 sm:max-w-xs sm:focus-within:max-w-md lg:max-w-sm lg:focus-within:max-w-lg"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) setRecents(addRecentSearch(text))
        send(text)
      }}
      onFocus={() => {
        setRecents(readRecentSearches())
        setFocused(true)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
    >
      <label htmlFor="search" className="sr-only">
        {t('Search')}
      </label>
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500 transition group-focus-within/search:text-[var(--color-accent)]">
        <SearchIcon />
      </span>
      <input
        ref={input}
        id="search"
        type="search"
        className="field rounded-full bg-black/40 py-2 pl-10 pr-12 backdrop-blur-md pointer-coarse:py-3"
        placeholder={t('Search movies, shows, music')}
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const value = e.target.value
          setText(value)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => send(value), value.trim() ? SEARCH_DELAY_MS : 0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText('')
            send('')
            input.current?.blur()
          }
        }}
      />
      {!text && (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/15 px-1.5 text-[11px] leading-5 text-neutral-500 group-focus-within/search:hidden sm:block"
        >
          /
        </kbd>
      )}
      {focused && !text && recents.length > 0 && (
        <div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-surface-2)]/95 p-1.5 shadow-[0_18px_50px_-10px_rgba(0,0,0,0.85)] backdrop-blur-xl sm:min-w-72">
          <div className="flex items-center justify-between px-2.5 py-1">
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">{t('Recent searches')}</span>
            <button type="button" className="rounded px-1 text-xs text-neutral-400 hover:text-white" onClick={() => setRecents(clearRecentSearches())}>
              {t('Clear')}
            </button>
          </div>
          <ul>
            {recents.map((recent) => (
              <li key={recent}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-100 transition hover:bg-white/10 focus-visible:bg-white/10 pointer-coarse:py-3"
                  onClick={() => {
                    setText(recent)
                    setRecents(addRecentSearch(recent))
                    send(recent)
                    input.current?.blur()
                    setFocused(false)
                  }}
                >
                  <span aria-hidden="true" className="text-neutral-500">
                    <SearchIcon />
                  </span>
                  <span className="truncate">{recent}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {text && (
        <button
          type="button"
          aria-label={t('Clear search')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
          onClick={() => {
            setText('')
            send('')
            input.current?.focus()
          }}
        >
          <CloseIcon />
        </button>
      )}
    </form>
  )
}

/** The main page, or one of the sections. */
export type NavTab = 'home' | Section

export const TAB_LABELS: Record<NavTab, string> = {
  home: tr('Home'),
  movies: tr('Movies'),
  series: tr('Series'),
  anime: tr('Anime'),
  musicvideos: tr('Music videos'),
  books: tr('Books'),
  livetv: tr('Live TV'),
  music: tr('Music'),
}

/** Home / Movies / Series / Anime / Music videos / Books / Live TV / Music. Only sections that have a library are offered, and nothing is shown if there is just one. */
export function SectionTabs({
  sections,
  current,
  onSelect,
  className = '',
}: {
  sections: NavTab[]
  current: NavTab | null
  onSelect: (tab: NavTab) => void
  className?: string
}) {
  if (sections.length < 2) return null
  return (
    <nav aria-label={t('Sections')} className={`flex items-center gap-1 ${className}`}>
      {sections.map((section) => (
        <button
          key={section}
          type="button"
          aria-current={section === current ? 'page' : undefined}
          onClick={() => onSelect(section)}
          className={`relative rounded-full px-3.5 py-1.5 text-sm font-medium transition pointer-coarse:py-3 ${
            section === current ? 'text-white' : 'text-neutral-400 hover:text-white'
          }`}
        >
          {t(TAB_LABELS[section])}
          {section === current && (
            <span
              aria-hidden="true"
              className="absolute inset-x-3.5 -bottom-px h-0.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--glow)]"
            />
          )}
        </button>
      ))}
    </nav>
  )
}

const TAB_ICONS: Record<NavTab, () => ReactElement> = {
  home: HomeIcon,
  movies: FilmIcon,
  series: TvIcon,
  anime: AnimeIcon,
  musicvideos: MusicVideoIcon,
  books: BookIcon,
  livetv: LiveTvIcon,
  music: MusicIcon,
}

/**
 * The same sections as a bar at the bottom of a phone, where a thumb reaches. It takes the room of the second header row the
 * tabs used to have there; `--nav-h` (index.css) tells the pages and the floating bars how much room it needs.
 */
export function BottomNav({ sections, current, onSelect }: { sections: NavTab[]; current: NavTab | null; onSelect: (tab: NavTab) => void }) {
  if (sections.length < 2) return null
  return (
    <nav
      aria-label={t('Sections')}
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-[var(--color-bg)]/90 pb-[var(--safe-bottom)] pl-[var(--safe-x)] pr-[var(--safe-x)] backdrop-blur-xl md:hidden"
    >
      {sections.map((section) => {
        const TabIcon = TAB_ICONS[section]
        const active = section === current
        return (
          <button
            key={section}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(section)}
            className={`relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${
              active ? 'text-[var(--color-accent)]' : 'text-neutral-400 active:text-white'
            }`}
          >
            {active && <span aria-hidden="true" className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--glow)]" />}
            <TabIcon />
            <span className="max-w-full truncate px-1">{t(TAB_LABELS[section])}</span>
          </button>
        )
      })}
    </nav>
  )
}

export function Header({
  session,
  query,
  sections,
  current,
  onSection,
  onSearch,
  onHome,
  onSettings,
  onSignOut,
}: {
  session: Session
  query: string
  /** Tabs to offer (Home plus the sections that have a library); hidden unless there are at least two. */
  sections: NavTab[]
  /** The tab being viewed (null on search results and other pages). */
  current: NavTab | null
  onSection: (tab: NavTab) => void
  onSearch: (text: string) => void
  onHome: () => void
  onSettings: () => void
  onSignOut: () => void
}) {
  // Transparent over the hero at the top of the page, frosted black once you scroll.
  const [scrolled, setScrolled] = useState(() => window.scrollY > 12)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const initial = (session.userName.trim()[0] ?? '?').toUpperCase()

  return (
    <header
      className={`fixed inset-x-0 top-0 z-30 border-b pt-[var(--safe-top)] transition-colors duration-300 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:-z-10 before:h-28 before:bg-gradient-to-b before:from-[var(--color-bg)]/85 before:to-transparent before:transition-opacity before:duration-300 ${
        scrolled
          ? 'border-white/[.07] bg-[var(--color-bg)]/75 backdrop-blur-xl before:opacity-0'
          : 'border-transparent bg-transparent before:opacity-100'
      }`}
    >
      <div className="gutter-x flex h-16 items-center gap-3 sm:gap-5">
        <button
          type="button"
          onClick={onHome}
          className="group flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-1 text-base font-semibold tracking-tight pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <span className="transition group-hover:scale-105">
            <LogoMark size={36} />
          </span>
          <span className="hidden sm:inline">
            <Wordmark height={20} />
          </span>
          <span className="sr-only sm:hidden">{t('Jellyflix, home')}</span>
        </button>
        <SectionTabs sections={sections} current={current} onSelect={onSection} className="hidden md:flex" />
        <SearchBox query={query} onSearch={onSearch} />
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden min-w-0 text-right text-xs leading-tight md:block">
            <p className="max-w-40 truncate font-medium text-neutral-100">{session.userName}</p>
            <p className="max-w-40 truncate text-neutral-500">{session.serverName}</p>
          </div>
          <button
            type="button"
            onClick={onSettings}
            aria-label={t('Settings')}
            title={t('Settings')}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-deep)] text-sm font-semibold text-[var(--color-accent-ink)] shadow-[0_0_18px_-4px_var(--glow)] transition hover:scale-105 pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <span aria-hidden="true">{initial}</span>
          </button>
          {/* On a phone the search box needs the room; signing out is in Settings (the round button). */}
          <button type="button" className="btn max-sm:hidden" onClick={onSignOut}>
            {t('Sign out')}
          </button>
        </div>
      </div>
    </header>
  )
}
