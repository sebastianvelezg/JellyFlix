import { useSyncExternalStore } from 'react'
import { DEFAULT_HOME_LAYOUT, sanitizeHomeLayout, type HomeLayout } from '../../core'
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

export interface AppearancePrefs {
  theme: ThemeChoice
  posterSize: PosterSize
  home: HomeLayout
  density: Density
  uiSize: UiSize
  banner: BannerSize
}

export const APPEARANCE_DEFAULTS: AppearancePrefs = {
  theme: DEFAULT_THEME,
  posterSize: 'comfortable',
  home: DEFAULT_HOME_LAYOUT,
  density: 'comfortable',
  uiSize: 'default',
  banner: 'large',
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
  const attrs = { posters: prefs.posterSize, density: prefs.density, size: prefs.uiSize, banner: prefs.banner }
  root.dataset.posters = attrs.posters
  root.dataset.density = attrs.density
  root.dataset.size = attrs.size
  root.dataset.banner = attrs.banner
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
