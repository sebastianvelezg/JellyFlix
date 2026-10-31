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

/** What a time label beside the seek bar shows. */
export type TimeLabel = 'elapsed' | 'remaining' | 'total' | 'endsAt' | 'none'
export const TIME_LABELS: TimeLabel[] = ['elapsed', 'remaining', 'total', 'endsAt', 'none']

/** What to do when the picture enters a skippable stretch: offer the button, skip it at once, or ignore it. */
export type SkipAction = 'ask' | 'auto' | 'off'
export const SKIP_ACTIONS: SkipAction[] = ['ask', 'auto', 'off']
export type SkipKind = 'intro' | 'recap' | 'outro' | 'preview'
export const SKIP_KINDS: SkipKind[] = ['intro', 'recap', 'outro', 'preview']

/** Audio codecs the server can be asked to convert (the browser could play them, but the sound may be wrong or silent). */
export const CONVERTIBLE_AUDIO = ['ac3', 'eac3', 'flac'] as const
export type ConvertibleAudio = (typeof CONVERTIBLE_AUDIO)[number]

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
  /** How many seconds the "Up next" countdown runs before the next title starts by itself. */
  autoplayCountdown: number
  /** Play a queue again from its first title after the last one (a folder of music videos, a playlist, a collection). */
  repeatQueue: boolean
  /** Cinema mode: the picture fades in from black, the controls get out of the way sooner and also while paused. */
  cinemaMode: boolean
  /** Music: seconds the end of a song fades into the start of the next one (0 = no crossfade). */
  crossfadeSeconds: number
  /** Music: the next song is made ready ahead of time so there is no pause between songs. */
  gapless: boolean
  /** Music: the full-screen player shows bars that move with the sound. */
  visualizer: boolean
  /** The most the video may stream at, in megabits per second; 0 is no limit (the original quality). */
  maxBitrateMbps: number
  /** Draw the start of each chapter on the seek bar. */
  chapterMarks: boolean
  /** Dragging the seek bar pauses the video until it is let go (instead of playing on while you look for a place). */
  pauseWhileScrubbing: boolean
  /** The labels on the left and the right of the seek bar. */
  timeLeft: TimeLabel
  timeRight: TimeLabel
  /** What to do in each kind of skippable stretch. */
  skipActions: Record<SkipKind, SkipAction>
  /** A second subtitle track shown above the first (to learn a language, or to read a dub): its language, null = none. */
  secondSubtitleLanguage: string | null
  /** Audio codecs the server converts for this device even though the browser could play them. */
  convertAudio: ConvertibleAudio[]
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

/** How long a song can fade into the next one, in seconds (0 = off). */
export const CROSSFADE_CHOICES = [0, 2, 4, 6, 8, 10, 12] as const

/** How long the "Up next" countdown can run, in seconds. */
export const COUNTDOWN_CHOICES = [3, 5, 8, 10, 15] as const

/** The limits the player offers, in megabits per second (0 = original quality). */
export const QUALITY_CHOICES = [0, 40, 20, 10, 8, 4, 2] as const

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
  autoplayCountdown: 8,
  cinemaMode: false,
  repeatQueue: false,
  crossfadeSeconds: 0,
  gapless: true,
  visualizer: false,
  maxBitrateMbps: 0,
  chapterMarks: true,
  pauseWhileScrubbing: false,
  timeLeft: 'elapsed',
  timeRight: 'total',
  skipActions: { intro: 'ask', recap: 'ask', outro: 'ask', preview: 'ask' },
  secondSubtitleLanguage: null,
  convertAudio: [],
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
    autoplayCountdown: (COUNTDOWN_CHOICES as readonly number[]).includes(p.autoplayCountdown) ? p.autoplayCountdown : 8,
    cinemaMode: p.cinemaMode === true,
    repeatQueue: p.repeatQueue === true,
    crossfadeSeconds: (CROSSFADE_CHOICES as readonly number[]).includes(p.crossfadeSeconds) ? p.crossfadeSeconds : 0,
    gapless: p.gapless !== false,
    visualizer: p.visualizer === true,
    maxBitrateMbps: (QUALITY_CHOICES as readonly number[]).includes(p.maxBitrateMbps) ? p.maxBitrateMbps : 0,
    chapterMarks: p.chapterMarks !== false,
    pauseWhileScrubbing: p.pauseWhileScrubbing === true,
    timeLeft: TIME_LABELS.includes(p.timeLeft) ? p.timeLeft : 'elapsed',
    timeRight: TIME_LABELS.includes(p.timeRight) ? p.timeRight : 'total',
    skipActions: Object.fromEntries(
      SKIP_KINDS.map((kind) => [kind, SKIP_ACTIONS.includes(p.skipActions?.[kind] as SkipAction) ? p.skipActions[kind] : 'ask']),
    ) as Record<SkipKind, SkipAction>,
    secondSubtitleLanguage: typeof p.secondSubtitleLanguage === 'string' ? p.secondSubtitleLanguage : null,
    convertAudio: Array.isArray(p.convertAudio) ? CONVERTIBLE_AUDIO.filter((codec) => (p.convertAudio as string[]).includes(codec)) : [],
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

const VERSION_KEY = 'jellyflix.version'

/** The picture of the version you chose last time ("4K", "1080p"): the title page offers that one first when it has it. */
export function readVersionPref(): string | null {
  try {
    return localStorage.getItem(VERSION_KEY)
  } catch {
    return null
  }
}

export function writeVersionPref(resolution: string | null): void {
  try {
    if (resolution) localStorage.setItem(VERSION_KEY, resolution)
    else localStorage.removeItem(VERSION_KEY)
  } catch {
    // Preferences are a convenience only.
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
