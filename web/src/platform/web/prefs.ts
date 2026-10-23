import { sanitizeFilters, type AdvancedFilters, type Section, type SortKey, type WatchFilter } from '../../core'
import type { LanguageChoice } from '../../i18n'

/** Per-device preferences. Harmless to lose; every read falls back to a default. */
export type SubtitleSize = 'small' | 'medium' | 'large'
export type SubtitleColor = 'white' | 'yellow' | 'cyan'
export type SubtitleBackground = 'shadow' | 'box' | 'none'
export type SubtitlePosition = 'low' | 'high'

export const SUBTITLE_COLORS: SubtitleColor[] = ['white', 'yellow', 'cyan']
export const SUBTITLE_BACKGROUNDS: SubtitleBackground[] = ['shadow', 'box', 'none']
export const SUBTITLE_POSITIONS: SubtitlePosition[] = ['low', 'high']

export interface PlayerPrefs {
  volume: number
  muted: boolean
  subtitleSize: SubtitleSize
  subtitleColor: SubtitleColor
  subtitleBackground: SubtitleBackground
  subtitlePosition: SubtitlePosition
  /** Language code of the last subtitle you chose (turned on automatically next time); null = none. */
  subtitleLanguage: string | null
  /** Start the next episode on its own when one ends. */
  autoplayNext: boolean
  /** The most the video may stream at, in megabits per second; 0 is no limit (the original quality). */
  maxBitrateMbps: number
}

/** What you last chose while watching one series (so an anime keeps its Japanese audio and English subtitles). */
export interface SeriesPrefs {
  audioLanguage?: string | null
  subtitleLanguage?: string | null
}

export interface BrowsePrefs {
  libraryId?: string
  sort: SortKey
  filter: WatchFilter
  /** Decade, rating, age rating, tag and quality: kept for each section like the sort and the filter. */
  advanced?: AdvancedFilters
}

/** The limits the player offers, in megabits per second (0 = original quality). */
export const QUALITY_CHOICES = [0, 20, 8, 4, 2] as const

const PLAYER_KEY = 'jellyflix.player'
const BROWSE_KEY = 'jellyflix.browse'

const PLAYER_DEFAULTS: PlayerPrefs = {
  volume: 1,
  muted: false,
  subtitleSize: 'medium',
  subtitleColor: 'white',
  subtitleBackground: 'shadow',
  subtitlePosition: 'low',
  subtitleLanguage: null,
  autoplayNext: true,
  maxBitrateMbps: 0,
}
const BROWSE_DEFAULTS: BrowsePrefs = { sort: 'title', filter: 'all' }

function read<T extends object>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<T>) } : defaults
  } catch {
    return defaults
  }
}

function write(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Preferences are a convenience only.
  }
}

export function readPlayerPrefs(): PlayerPrefs {
  const p = read(PLAYER_KEY, PLAYER_DEFAULTS)
  return {
    volume: Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : 1,
    muted: !!p.muted,
    subtitleSize: ['small', 'medium', 'large'].includes(p.subtitleSize) ? p.subtitleSize : 'medium',
    subtitleColor: SUBTITLE_COLORS.includes(p.subtitleColor) ? p.subtitleColor : 'white',
    subtitleBackground: SUBTITLE_BACKGROUNDS.includes(p.subtitleBackground) ? p.subtitleBackground : 'shadow',
    subtitlePosition: SUBTITLE_POSITIONS.includes(p.subtitlePosition) ? p.subtitlePosition : 'low',
    subtitleLanguage: typeof p.subtitleLanguage === 'string' ? p.subtitleLanguage : null,
    autoplayNext: p.autoplayNext !== false,
    maxBitrateMbps: (QUALITY_CHOICES as readonly number[]).includes(p.maxBitrateMbps) ? p.maxBitrateMbps : 0,
  }
}

export function writePlayerPrefs(patch: Partial<PlayerPrefs>): void {
  write(PLAYER_KEY, { ...readPlayerPrefs(), ...patch })
}

/** Movies keep the original key; series and anime have their own sort, filter and library. */
const browseKey = (section: Section) => (section === 'movies' ? BROWSE_KEY : `${BROWSE_KEY}.${section}`)

export function readBrowsePrefs(section: Section = 'movies'): BrowsePrefs {
  const saved = read(browseKey(section), BROWSE_DEFAULTS)
  return saved.advanced === undefined ? saved : { ...saved, advanced: sanitizeFilters(saved.advanced) }
}

export function writeBrowsePrefs(patch: Partial<BrowsePrefs>, section: Section = 'movies'): void {
  write(browseKey(section), { ...readBrowsePrefs(section), ...patch })
}

/** Forgets sort, filter and library choices for every section. */
export function clearBrowsePrefs(): void {
  for (const section of ['movies', 'series', 'anime', 'musicvideos', 'books'] as const) {
    try {
      localStorage.removeItem(browseKey(section))
    } catch {
      // Preferences are a convenience only.
    }
  }
}

const SERIES_KEY = 'jellyflix.series'
const SERIES_LIMIT = 100

const SYNC_KEY = 'jellyflix.subsync'
const SYNC_LIMIT = 200

/**
 * How many seconds later (negative: earlier) the subtitles of a movie or series should show, as set with the sync
 * buttons. Series share one value across their episodes. 0 when none was saved.
 */
export function readSubtitleOffset(titleId: string): number {
  const all = read<Record<string, number>>(SYNC_KEY, {})
  const value = all[titleId]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Saves the offset; 0 forgets it. The oldest entries are dropped so this never grows without bound. */
export function writeSubtitleOffset(titleId: string, seconds: number): void {
  const others = Object.entries(read<Record<string, number>>(SYNC_KEY, {})).filter(([id]) => id !== titleId)
  const kept = others.slice(-(SYNC_LIMIT - 1))
  write(SYNC_KEY, Object.fromEntries(seconds === 0 ? kept : [...kept, [titleId, seconds]]))
}

export function countSeriesPrefs(): number {
  return Object.keys(read<Record<string, SeriesPrefs>>(SERIES_KEY, {})).length
}

export function clearSeriesPrefs(): void {
  try {
    localStorage.removeItem(SERIES_KEY)
    localStorage.removeItem(SYNC_KEY)
    localStorage.removeItem(BOOKS_KEY)
  } catch {
    // Preferences are a convenience only.
  }
}

export function readSeriesPrefs(seriesId: string): SeriesPrefs {
  const all = read<Record<string, SeriesPrefs>>(SERIES_KEY, {})
  return all[seriesId] ?? {}
}

export function writeSeriesPrefs(seriesId: string, patch: SeriesPrefs): void {
  const all = read<Record<string, SeriesPrefs>>(SERIES_KEY, {})
  const { [seriesId]: previous, ...others } = all
  // Most recently used last; the oldest entries are dropped so this never grows without bound.
  const kept = Object.entries(others).slice(-(SERIES_LIMIT - 1))
  write(SERIES_KEY, Object.fromEntries([...kept, [seriesId, { ...previous, ...patch }]]))
}

const BOOKS_KEY = 'jellyflix.books'
const BOOKS_LIMIT = 100

/** Where you stopped in a book: how far through it ("percent", 0 to 100), the reader's own place, and when. */
export interface BookProgress {
  percent: number
  /** What the reader needs to come back to the spot ("3:0.42" for chapter 3, 42% down; "12" for page 12). */
  place: string
  at: number
}

function cleanProgress(value: unknown): BookProgress | undefined {
  const p = value as Partial<BookProgress> | null
  if (!p || typeof p.place !== 'string' || typeof p.percent !== 'number' || !Number.isFinite(p.percent) || typeof p.at !== 'number') return undefined
  return { percent: Math.min(100, Math.max(0, p.percent)), place: p.place.slice(0, 40), at: p.at }
}

export function readBookProgress(bookId: string): BookProgress | undefined {
  return cleanProgress(read<Record<string, unknown>>(BOOKS_KEY, {})[bookId])
}

/** A book counts as finished from here on: it is opened at the beginning again, and is no longer in "Continue reading". */
export const BOOK_FINISHED_PERCENT = 98

/** The place to open a book at: where you stopped, unless you had finished it. */
export function readResumePlace(bookId: string): string | undefined {
  const progress = readBookProgress(bookId)
  return progress && progress.percent < BOOK_FINISHED_PERCENT ? progress.place : undefined
}

/** Every book with a place saved, the most recently read first. */
export function readAllBookProgress(): Array<[string, BookProgress]> {
  return Object.entries(read<Record<string, unknown>>(BOOKS_KEY, {}))
    .map(([id, value]) => [id, cleanProgress(value)] as const)
    .filter((entry): entry is [string, BookProgress] => entry[1] !== undefined)
    .sort((a, b) => b[1].at - a[1].at)
}

/** Remembers the place in a book. The oldest are dropped so this never grows without bound. */
export function writeBookProgress(bookId: string, progress: Omit<BookProgress, 'at'>): void {
  const others = Object.entries(read<Record<string, unknown>>(BOOKS_KEY, {})).filter(([id]) => id !== bookId)
  write(BOOKS_KEY, Object.fromEntries([...others.slice(-(BOOKS_LIMIT - 1)), [bookId, { ...progress, at: Date.now() }]]))
}

export type ReaderTheme = 'dark' | 'light' | 'sepia'
export const READER_THEMES: ReaderTheme[] = ['dark', 'light', 'sepia']

/** How the book reader looks: the text size (percent of normal), the page colours, and a comic read right to left. */
export interface ReaderPrefs {
  textSize: number
  theme: ReaderTheme
  rightToLeft: boolean
}

const READER_KEY = 'jellyflix.reader'
const READER_DEFAULTS: ReaderPrefs = { textSize: 100, theme: 'dark', rightToLeft: false }
export const READER_TEXT_SIZES = { min: 70, max: 220, step: 10 }

export function readReaderPrefs(): ReaderPrefs {
  const p = read(READER_KEY, READER_DEFAULTS)
  return {
    textSize: Number.isFinite(p.textSize) ? Math.min(READER_TEXT_SIZES.max, Math.max(READER_TEXT_SIZES.min, Math.round(p.textSize))) : 100,
    theme: READER_THEMES.includes(p.theme) ? p.theme : 'dark',
    rightToLeft: p.rightToLeft === true,
  }
}

export function writeReaderPrefs(patch: Partial<ReaderPrefs>): void {
  write(READER_KEY, { ...readReaderPrefs(), ...patch })
}

/** Interface preferences. */
export interface UiPrefs {
  /** The home banner moves to the next title by itself. */
  autoRotateBanner: boolean
  /** The language of the interface: `auto` follows the browser. */
  language: LanguageChoice
}

const UI_KEY = 'jellyflix.ui'
const UI_DEFAULTS: UiPrefs = { autoRotateBanner: true, language: 'auto' }

export function readUiPrefs(): UiPrefs {
  const p = read(UI_KEY, UI_DEFAULTS)
  return { autoRotateBanner: p.autoRotateBanner !== false, language: p.language === 'en' || p.language === 'es' ? p.language : 'auto' }
}

export function writeUiPrefs(patch: Partial<UiPrefs>): void {
  write(UI_KEY, { ...readUiPrefs(), ...patch })
}
