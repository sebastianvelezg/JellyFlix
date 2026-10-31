import { contrastRatio, hslToRgb, isHexColor, lightnessOf, parseHex, relativeLuminance, rgbToHsl, toHex, withLightness } from './colors'

/**
 * The look of the app as a small set of choices. A theme is a **background** (the canvas and the three surfaces that sit on it) and an
 * **accent** (the colour of buttons, links, the focus ring and the progress bars). Everything else on screen is drawn from the
 * CSS variables these produce, so the whole app follows. The defaults are exactly the look the app has always had.
 */

export type CanvasId = 'black' | 'charcoal' | 'midnight' | 'dusk' | 'pine' | 'cocoa'

export interface Canvas {
  id: CanvasId
  /** English name; the interface translates it. */
  label: string
  bg: string
  surface: string
  surface2: string
  surface3: string
  border: string
  borderStrong: string
  /** Secondary text. */
  muted: string
}

export const CANVASES: readonly Canvas[] = [
  { id: 'black', label: 'True black', bg: '#000000', surface: '#07090e', surface2: '#0e121b', surface3: '#151a27', border: '#1a2030', borderStrong: '#2b3555', muted: '#8b94ab' },
  { id: 'charcoal', label: 'Charcoal', bg: '#0d0d0f', surface: '#141416', surface2: '#1b1b1f', surface3: '#232328', border: '#2a2a30', borderStrong: '#3d3d47', muted: '#9c9ca6' },
  { id: 'midnight', label: 'Midnight', bg: '#050813', surface: '#0a0f1f', surface2: '#101730', surface3: '#172040', border: '#1d2a4d', borderStrong: '#31447d', muted: '#8f9bbd' },
  { id: 'dusk', label: 'Dusk', bg: '#0a0712', surface: '#100c1c', surface2: '#17122a', surface3: '#201a38', border: '#2a2245', borderStrong: '#41366a', muted: '#9d97b6' },
  { id: 'pine', label: 'Pine', bg: '#040a08', surface: '#09120f', surface2: '#0f1b16', surface3: '#162620', border: '#1c3029', borderStrong: '#2d4b40', muted: '#8fa89e' },
  { id: 'cocoa', label: 'Cocoa', bg: '#0b0807', surface: '#130e0c', surface2: '#1b1512', surface3: '#251d19', border: '#30251f', borderStrong: '#4b3b32', muted: '#a69c94' },
]

export const DEFAULT_CANVAS: CanvasId = 'black'

export function canvasOf(id: string): Canvas {
  return CANVASES.find((c) => c.id === id) ?? (CANVASES[0] as Canvas)
}

/** The colours the accent is drawn with. */
export interface AccentTokens {
  /** Text, icons, links, the focus ring: readable on every surface. */
  accent: string
  /** Filled things: badges, the play button. */
  strong: string
  /** The darker end of a button's gradient, and the lighter end, and the same under the pointer. */
  deep: string
  top: string
  hoverTop: string
  hoverDeep: string
  /** The colour of text and icons drawn ON the accent (white, or near-black on a light accent). */
  ink: string
  /** A second colour next to the accent, for glows and gradients. */
  second: string
}

export interface AccentPreset {
  id: string
  label: string
  /** The colour the accent is built from. */
  color: string
  /** Hand-tuned tokens, for the accent the app has always had. */
  tokens?: AccentTokens
}

const OCEAN: AccentTokens = {
  accent: '#4d8dff',
  strong: '#2563eb',
  deep: '#1d4ed8',
  top: '#2f6df0',
  hoverTop: '#2a68ea',
  hoverDeep: '#1d4ed8',
  ink: '#ffffff',
  second: '#38d6f5',
}

export const ACCENTS: readonly AccentPreset[] = [
  { id: 'ocean', label: 'Ocean', color: OCEAN.accent, tokens: OCEAN },
  { id: 'violet', label: 'Violet', color: '#a878ff' },
  { id: 'aqua', label: 'Aqua', color: '#2fd0ee' },
  { id: 'emerald', label: 'Emerald', color: '#34d399' },
  { id: 'amber', label: 'Amber', color: '#fbbf24' },
  { id: 'ember', label: 'Ember', color: '#ff8a3d' },
  { id: 'rose', label: 'Rose', color: '#fb7185' },
  { id: 'silver', label: 'Silver', color: '#d4d4dc' },
]

export const DEFAULT_ACCENT = 'ocean'

const INK_LIGHT = '#ffffff'
const INK_DARK = '#0b0e17'
/** Normal-size text needs 4.5:1, on the lighter end of a button gradient too. */
const TEXT = 4.5
const GRADIENT_TOP = TEXT

/** Raises the lightness of `color` until it reaches `ratio` against `against` (or gives up near white). */
function liftUntil(color: string, against: string, ratio: number): string {
  let l = lightnessOf(color)
  let out = color
  while (contrastRatio(out, against) < ratio && l < 0.97) {
    l += 0.02
    out = withLightness(color, l)
  }
  return out
}

/** Lowers the lightness of `color` until `ink` is readable on it (or gives up at a dark floor). */
function lowerUntil(color: string, ink: string, ratio: number): string {
  let l = lightnessOf(color)
  let out = color
  while (contrastRatio(ink, out) < ratio && l > 0.14) {
    l -= 0.02
    out = withLightness(color, l)
  }
  return out
}

/**
 * Builds every accent colour from one colour, whatever it is: the text version is lifted until it is readable on the canvas, the
 * filled version is made dark enough for white text (or the text turns near-black when the colour is light), and the second colour is
 * its neighbour on the colour wheel.
 */
export function deriveAccent(color: string, canvas: Canvas): AccentTokens {
  const base = parseHex(color) ?? (parseHex(OCEAN.accent) as [number, number, number])
  const [h, s] = rgbToHsl(base)
  const accent = liftUntil(toHex(base), canvas.surface3, TEXT)
  const lightAccent = relativeLuminance(accent) >= 0.3
  const ink = lightAccent ? INK_DARK : INK_LIGHT

  let strong: string
  if (lightAccent) {
    // Dark text on a light fill: make sure it reads, lifting the fill if the colour was a mid tone.
    strong = liftUntil(accent, ink, TEXT)
    // `liftUntil` measures against `ink` symmetrically, so a fill that is too dark is lifted until it reaches the ratio.
  } else {
    strong = lowerUntil(accent, ink, TEXT)
  }

  const l = lightnessOf(strong)
  let deep = withLightness(strong, lightAccent ? l - 0.04 : l - 0.08)
  if (contrastRatio(ink, deep) < TEXT) deep = strong
  let top = withLightness(strong, l + 0.05)
  if (contrastRatio(ink, top) < (lightAccent ? TEXT : GRADIENT_TOP)) top = strong
  let hoverTop = withLightness(top, lightnessOf(top) + 0.05)
  if (contrastRatio(ink, hoverTop) < (lightAccent ? TEXT : GRADIENT_TOP)) hoverTop = top
  const second = toHex(hslToRgb([(h + 40) % 360, Math.max(s, 0.6), 0.64]))
  return { accent, strong, deep, top, hoverTop, hoverDeep: strong, ink, second }
}

/** What is saved: a canvas id, and an accent that is a preset id or a colour typed as `#rrggbb`. */
export interface ThemeChoice {
  canvas: CanvasId
  accent: string
}

export const DEFAULT_THEME: ThemeChoice = { canvas: DEFAULT_CANVAS, accent: DEFAULT_ACCENT }

/** The colour behind an accent choice (for showing a swatch). */
export function accentColor(accent: string): string {
  const preset = ACCENTS.find((a) => a.id === accent)
  if (preset) return preset.color
  return isHexColor(accent) ? (toHex(parseHex(accent) as [number, number, number])) : OCEAN.accent
}

/** Cleans up whatever was saved: an unknown canvas or a broken colour falls back to the default. */
export function sanitizeTheme(value: Partial<ThemeChoice> | null | undefined): ThemeChoice {
  const canvas = CANVASES.some((c) => c.id === value?.canvas) ? (value?.canvas as CanvasId) : DEFAULT_CANVAS
  const accent = value?.accent
  const ok = typeof accent === 'string' && (ACCENTS.some((a) => a.id === accent) || isHexColor(accent))
  const normalized = ok && isHexColor(accent as string) ? toHex(parseHex(accent as string) as [number, number, number]) : accent
  return { canvas, accent: ok ? (normalized as string) : DEFAULT_ACCENT }
}

/** The tokens of a theme choice. */
export function resolveAccent(choice: ThemeChoice): AccentTokens {
  const canvas = canvasOf(choice.canvas)
  const preset = ACCENTS.find((a) => a.id === choice.accent)
  if (preset?.tokens) {
    // The original blue is hand-tuned; it only has to be lifted on the rare canvas where it would not read.
    return { ...preset.tokens, accent: liftUntil(preset.tokens.accent, canvas.surface3, TEXT) }
  }
  return deriveAccent(preset?.color ?? choice.accent, canvas)
}

/** Every CSS variable a theme sets, ready to be put on the page's root element. */
export function themeVariables(choice: ThemeChoice): Record<string, string> {
  const c = canvasOf(choice.canvas)
  const a = resolveAccent(choice)
  return {
    '--color-bg': c.bg,
    '--color-surface': c.surface,
    '--color-surface-2': c.surface2,
    '--color-surface-3': c.surface3,
    '--color-border': c.border,
    '--color-border-strong': c.borderStrong,
    '--color-muted': c.muted,
    '--color-accent': a.accent,
    '--color-accent-strong': a.strong,
    '--color-accent-deep': a.deep,
    '--color-accent-top': a.top,
    '--color-accent-top-hover': a.hoverTop,
    '--color-accent-deep-hover': a.hoverDeep,
    '--color-accent-ink': a.ink,
    '--color-cyan': a.second,
  }
}
