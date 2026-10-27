import { hslToRgb, rgbToHsl, toHex, type Rgb } from './colors'

/** The two colours of a cover: its main colour and one that goes with it, both bright enough to glow on a dark page. */
export interface CoverPalette {
  primary: string
  secondary: string
}

const HUES = 12
/** Share of the picture that has to be coloured (not grey, black or white) for it to have a colour worth using. */
const MIN_COLOURED = 0.04

/** A colour made lively: grey-ish ones get some saturation, and the lightness stays where a glow looks good on a dark page. */
function vivid([h, s, l]: [number, number, number]): string {
  return toHex(hslToRgb([h, Math.min(0.85, Math.max(0.5, s)), Math.min(0.62, Math.max(0.48, l))]))
}

/**
 * The colours of a picture, from its pixels (red, green, blue, alpha in turn; a small copy of it is enough). Each pixel votes for its
 * hue with the weight of how coloured it is, so a big dark-blue sky wins over a few white letters, and the second colour is the
 * strongest hue that is clearly another one (or, when the cover is of one colour, its neighbour on the colour wheel).
 * Returns null for a picture with no colour to speak of (black and white, empty): the page keeps its own accent then.
 */
export function coverPalette(pixels: ArrayLike<number>): CoverPalette | null {
  const weight = new Float64Array(HUES)
  const sum = Array.from({ length: HUES }, () => [0, 0, 0] as Rgb)
  let counted = 0
  let coloured = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] as number) < 125) continue
    counted += 1
    const rgb: Rgb = [pixels[i] as number, pixels[i + 1] as number, pixels[i + 2] as number]
    const [h, s, l] = rgbToHsl(rgb)
    // Near-black and near-white pixels have no real hue, however saturated their numbers say they are.
    const lively = s * (1 - Math.abs(2 * l - 1))
    if (lively < 0.12) continue
    coloured += 1
    const bucket = Math.floor((h / 360) * HUES) % HUES
    const w = lively * lively
    weight[bucket] = (weight[bucket] as number) + w
    const acc = sum[bucket] as Rgb
    acc[0] += rgb[0] * w
    acc[1] += rgb[1] * w
    acc[2] += rgb[2] * w
  }
  if (counted === 0 || coloured / counted < MIN_COLOURED) return null

  const average = (bucket: number): [number, number, number] => {
    const w = weight[bucket] as number
    const acc = sum[bucket] as Rgb
    return rgbToHsl([acc[0] / w, acc[1] / w, acc[2] / w])
  }
  let first = 0
  for (let b = 1; b < HUES; b += 1) if ((weight[b] as number) > (weight[first] as number)) first = b
  const main = average(first)

  let second = -1
  for (let b = 0; b < HUES; b += 1) {
    const apart = Math.min(Math.abs(b - first), HUES - Math.abs(b - first))
    if (apart < 2 || (weight[b] as number) < (weight[first] as number) * 0.3) continue
    if (second < 0 || (weight[b] as number) > (weight[second] as number)) second = b
  }
  const other: [number, number, number] = second >= 0 ? average(second) : [(main[0] + 35) % 360, main[1], main[2]]
  return { primary: vivid(main), secondary: vivid(other) }
}
