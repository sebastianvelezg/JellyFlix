/** Small colour helpers for the theme: parsing, lightness, and the contrast ratio the accessibility rules are written in. */

export type Rgb = [number, number, number]
/** Hue in degrees (0 to 360), saturation and lightness from 0 to 1. */
export type Hsl = [number, number, number]

const HEX = /^#([0-9a-f]{6})$/i

/** "#rrggbb" (three-digit shorthand is expanded) to red, green and blue (0 to 255); null when it is not a colour. */
export function parseHex(input: string): Rgb | null {
  let text = input.trim()
  if (/^#[0-9a-f]{3}$/i.test(text)) text = `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`
  const match = HEX.exec(text)
  if (!match) return null
  const n = parseInt(match[1] as string, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function isHexColor(input: string): boolean {
  return parseHex(input) !== null
}

export function toHex([r, g, b]: Rgb): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

export function rgbToHsl([r, g, b]: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255] as const
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h * 60, s, l]
}

export function hslToRgb([h, s, l]: Hsl): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: string): number {
  const rgb = parseHex(color)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two colours, 1 (none) to 21 (black on white). Normal text needs 4.5. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** The same colour with another lightness (0 to 1). */
export function withLightness(color: string, lightness: number): string {
  const rgb = parseHex(color)
  if (!rgb) return color
  const [h, s] = rgbToHsl(rgb)
  return toHex(hslToRgb([h, s, Math.min(1, Math.max(0, lightness))]))
}

export function lightnessOf(color: string): number {
  const rgb = parseHex(color)
  return rgb ? rgbToHsl(rgb)[2] : 0
}
