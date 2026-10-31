import { useSyncExternalStore } from 'react'
import { DEFAULT_HOME_LAYOUT, DEFAULT_MENU_LAYOUT, sanitizeHomeLayout, sanitizeMenuLayout, type HomeLayout, type MenuLayout } from '../../core'
import { DEFAULT_THEME, canvasOf, sanitizeTheme, themeVariables, type ThemeChoice } from '../../theme/themes'

/**
 * How the app looks on this device: the theme (background and accent colours), how big the posters are, and which rows the home page has.
 * Kept apart from the other interface preferences, and harmless to lose: every read falls back to the defaults.
 */

export type PosterSize = 'compact' | 'comfortable' | 'large'
export const POSTER_SIZES: readonly PosterSize[] = ['compact', 'comfortable', 'large']

/** How much room there is between the rows of a page. */
export type Density = 'comfortable' | 'compact'
export const DENSITIES: readonly Density[] = ['comfortable', 'compact']

/** The size of text and controls, everything that is measured in rem. */
export type UiSize = 'small' | 'default' | 'large'
export const UI_SIZES: readonly UiSize[] = ['small', 'default', 'large']

/** How tall the featured banner of the home page is. */
export type BannerSize = 'large' | 'compact'
export const BANNER_SIZES: readonly BannerSize[] = ['large', 'compact']

/** What the buttons of the menu (Home, Movies, Live TV...) show: a picture and the name, only the picture, or only the name. */
export type NavStyle = 'full' | 'icons' | 'text'
export const NAV_STYLES: readonly NavStyle[] = ['full', 'icons', 'text']

/** What pressing a card of "Continue watching" or "Next up" does: start playing, or open the title's page. */
export type CardAction = 'play' | 'open'
export const CARD_ACTIONS: readonly CardAction[] = ['play', 'open']

/** How far back "Next up" looks for a series you have been watching, in days (0 = as far as the server goes). */
export const NEXT_UP_DAYS: readonly number[] = [0, 30, 90, 180, 365]

export interface AppearancePrefs {
  theme: ThemeChoice
  posterSize: PosterSize
  home: HomeLayout
  density: Density
  uiSize: UiSize
  banner: BannerSize
  nav: NavStyle
  /** Which buttons the top menu has, and in what order. */
  menu: MenuLayout
  /** The name and the year under each poster. */
  titles: boolean
  continueAction: CardAction
  nextUpDays: number
}

export const APPEARANCE_DEFAULTS: AppearancePrefs = {
  theme: DEFAULT_THEME,
  posterSize: 'comfortable',
  home: DEFAULT_HOME_LAYOUT,
  density: 'comfortable',
  uiSize: 'default',
  banner: 'large',
  nav: 'full',
  menu: DEFAULT_MENU_LAYOUT,
  titles: true,
  continueAction: 'play',
  nextUpDays: 0,
}

export const KEY = 'jellyflix.appearance'
/** The colours the saved theme works out to, so the page can be painted before any script of the app has run. */
export const APPEARANCE_CSS_KEY = 'jellyflix.appearance.css'

/** Cleans up whatever was saved (or imported): every part that is not a valid choice goes back to its default. */
export function sanitizeAppearance(value: unknown): AppearancePrefs {
  const p = (value && typeof value === 'object' ? value : {}) as Partial<AppearancePrefs>
  return {
    theme: sanitizeTheme(p.theme),
    posterSize: POSTER_SIZES.includes(p.posterSize as PosterSize) ? (p.posterSize as PosterSize) : 'comfortable',
    home: sanitizeHomeLayout(p.home),
    density: DENSITIES.includes(p.density as Density) ? (p.density as Density) : 'comfortable',
    uiSize: UI_SIZES.includes(p.uiSize as UiSize) ? (p.uiSize as UiSize) : 'default',
    banner: BANNER_SIZES.includes(p.banner as BannerSize) ? (p.banner as BannerSize) : 'large',
    nav: NAV_STYLES.includes(p.nav as NavStyle) ? (p.nav as NavStyle) : 'full',
    menu: sanitizeMenuLayout(p.menu),
    titles: p.titles !== false,
    continueAction: CARD_ACTIONS.includes(p.continueAction as CardAction) ? (p.continueAction as CardAction) : 'play',
    nextUpDays: NEXT_UP_DAYS.includes(p.nextUpDays as number) ? (p.nextUpDays as number) : 0,
  }
}

function parse(raw: string | null): AppearancePrefs {
  try {
    return sanitizeAppearance(raw ? JSON.parse(raw) : {})
  } catch {
    return APPEARANCE_DEFAULTS
  }
}

function rawValue(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

// The same object is handed out for as long as what is saved does not change (a React store needs that).
let cache: { raw: string | null; prefs: AppearancePrefs } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export function readAppearance(): AppearancePrefs {
  const raw = rawValue()
  if (!cache || cache.raw !== raw) cache = { raw, prefs: parse(raw) }
  return cache.prefs
}

export function writeAppearance(patch: Partial<AppearancePrefs>): AppearancePrefs {
  const next = { ...readAppearance(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Preferences are a convenience only.
  }
  const saved = readAppearance()
  notify()
  return saved
}

/** The look as it is now, kept up to date: the home page that stays open behind Settings follows what is changed there. */
export function useAppearance(): AppearancePrefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      // Another tab or window of the app changed it.
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY || e.key === null) {
          applyAppearance(readAppearance())
          listener()
        }
      }
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        window.removeEventListener('storage', onStorage)
      }
    },
    readAppearance,
    () => APPEARANCE_DEFAULTS,
  )
}

/** Puts the look on the page: the theme's colours as CSS variables, and the poster size. */
export function applyAppearance(prefs: AppearancePrefs = readAppearance(), root: HTMLElement = document.documentElement): void {
  const vars = themeVariables(prefs.theme)
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  const attrs = { posters: prefs.posterSize, density: prefs.density, size: prefs.uiSize, banner: prefs.banner, nav: prefs.nav, titles: prefs.titles ? 'on' : 'off' }
  root.dataset.posters = attrs.posters
  root.dataset.density = attrs.density
  root.dataset.size = attrs.size
  root.dataset.banner = attrs.banner
  root.dataset.nav = attrs.nav
  root.dataset.titles = attrs.titles
  // The browser's own bars (Android address bar, the iPhone status area) follow the page.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvasOf(prefs.theme.canvas).bg)
  try {
    localStorage.setItem(APPEARANCE_CSS_KEY, JSON.stringify({ vars, attrs, bg: vars['--color-bg'] }))
  } catch {
    // Preferences are a convenience only.
  }
}

/** Forgets the look and goes back to the original one. */
export function resetAppearance(): AppearancePrefs {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(APPEARANCE_CSS_KEY)
  } catch {
    // Preferences are a convenience only.
  }
  const next = readAppearance()
  applyAppearance(next)
  notify()
  return next
}
