import { describe, expect, it } from 'vitest'
import { rgbToHsl, parseHex, type Rgb } from './colors'
import { coverPalette } from './coverColors'

/** A picture of `count` pixels per colour, in the order given. */
function picture(...parts: Array<[Rgb, number]>): Uint8ClampedArray {
  const out: number[] = []
  for (const [[r, g, b], count] of parts) for (let i = 0; i < count; i += 1) out.push(r, g, b, 255)
  return Uint8ClampedArray.from(out)
}

const hue = (hex: string) => rgbToHsl(parseHex(hex) as Rgb)[0]

describe('coverPalette', () => {
  it('takes the colour that fills most of the cover', () => {
    const palette = coverPalette(picture([[200, 30, 30], 70], [[30, 60, 200], 30]))
    expect(palette).not.toBeNull()
    expect(hue(palette!.primary)).toBeLessThan(15) // red
    expect(hue(palette!.secondary)).toBeGreaterThan(210) // blue, a clearly different colour
  })

  it('is not fooled by black, white or grey, which have no colour', () => {
    const palette = coverPalette(picture([[0, 0, 0], 50], [[255, 255, 255], 30], [[20, 160, 60], 20]))
    expect(hue(palette!.primary)).toBeGreaterThan(110) // green
    expect(hue(palette!.primary)).toBeLessThan(150)
  })

  it('has nothing for a picture without colour', () => {
    expect(coverPalette(picture([[0, 0, 0], 40], [[255, 255, 255], 40], [[128, 128, 128], 20]))).toBeNull()
    expect(coverPalette(new Uint8ClampedArray(0))).toBeNull()
    // Transparent pixels do not count.
    expect(coverPalette(Uint8ClampedArray.from([200, 30, 30, 0, 200, 30, 30, 0]))).toBeNull()
  })

  it('falls back to a neighbour of the main colour when the cover is of one colour', () => {
    const palette = coverPalette(picture([[30, 90, 210], 100]))
    expect(palette!.secondary).not.toBe(palette!.primary)
    expect(Math.abs(hue(palette!.secondary) - hue(palette!.primary))).toBeGreaterThan(20)
    expect(Math.abs(hue(palette!.secondary) - hue(palette!.primary))).toBeLessThan(60)
  })

  it('makes dull colours lively enough to glow, and keeps them from being too dark or too light', () => {
    const dull = coverPalette(picture([[120, 100, 160], 100])) // a greyish purple
    const [, s, l] = rgbToHsl(parseHex(dull!.primary) as Rgb)
    expect(s).toBeGreaterThanOrEqual(0.45)
    expect(l).toBeGreaterThan(0.4)
    expect(l).toBeLessThan(0.7)
  })
})
