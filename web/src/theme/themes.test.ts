import { describe, expect, it } from 'vitest'
import { contrastRatio, isHexColor, parseHex, toHex } from './colors'
import { ACCENTS, CANVASES, DEFAULT_THEME, accentColor, canvasOf, deriveAccent, resolveAccent, sanitizeTheme, themeVariables } from './themes'

describe('colour helpers', () => {
  it('parses six and three digit hex colours and rejects the rest', () => {
    expect(parseHex('#4d8dff')).toEqual([77, 141, 255])
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('4d8dff')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
    expect(isHexColor('red')).toBe(false)
  })

  it('round-trips through hex', () => {
    expect(toHex([77, 141, 255])).toBe('#4d8dff')
    expect(toHex([300, -4, 0.4])).toBe('#ff0000')
  })

  it('measures contrast the way WCAG does', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(contrastRatio('#000000', '#ffffff'), 5)
  })
})

describe('themes', () => {
  it('keeps the original look as the default', () => {
    const vars = themeVariables(DEFAULT_THEME)
    expect(vars['--color-bg']).toBe('#000000')
    expect(vars['--color-surface']).toBe('#07090e')
    expect(vars['--color-accent']).toBe('#4d8dff')
    expect(vars['--color-accent-strong']).toBe('#2563eb')
    expect(vars['--color-accent-ink']).toBe('#ffffff')
    expect(vars['--color-cyan']).toBe('#38d6f5')
  })

  it('reads secondary text on every surface of every background', () => {
    for (const c of CANVASES) {
      for (const surface of [c.bg, c.surface, c.surface2, c.surface3]) {
        expect(contrastRatio(c.muted, surface), `${c.id} muted on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('makes every accent readable on every background and its text readable on its fill', () => {
    for (const c of CANVASES) {
      for (const a of ACCENTS) {
        const t = resolveAccent({ canvas: c.id, accent: a.id })
        for (const surface of [c.bg, c.surface, c.surface2, c.surface3]) {
          expect(contrastRatio(t.accent, surface), `${a.id} text on ${c.id}/${surface}`).toBeGreaterThanOrEqual(4.5)
        }
        expect(contrastRatio(t.ink, t.strong), `${a.id} ink on fill`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(t.ink, t.deep), `${a.id} ink on deep`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(t.ink, t.top), `${a.id} ink on top`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('does the same for colours a person types, from very dark to very light', () => {
    for (const colour of ['#000000', '#101010', '#7f7f7f', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#123456', '#e8d9a0']) {
      for (const c of CANVASES) {
        const t = deriveAccent(colour, c)
        expect(contrastRatio(t.accent, c.surface3), `${colour} text on ${c.id}`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(t.ink, t.strong), `${colour} ink on fill`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('cleans up what was saved', () => {
    expect(sanitizeTheme(null)).toEqual(DEFAULT_THEME)
    expect(sanitizeTheme({ canvas: 'nope' as never, accent: 'nope' })).toEqual(DEFAULT_THEME)
    expect(sanitizeTheme({ canvas: 'dusk', accent: 'rose' })).toEqual({ canvas: 'dusk', accent: 'rose' })
    expect(sanitizeTheme({ canvas: 'pine', accent: '#ABC' })).toEqual({ canvas: 'pine', accent: '#aabbcc' })
    expect(sanitizeTheme({ canvas: 'pine', accent: 'javascript:alert(1)' })).toEqual({ canvas: 'pine', accent: 'ocean' })
  })

  it('knows the colour behind a choice', () => {
    expect(accentColor('violet')).toBe('#a878ff')
    expect(accentColor('#ABCDEF')).toBe('#abcdef')
    expect(accentColor('broken')).toBe('#4d8dff')
    expect(canvasOf('missing').id).toBe('black')
  })
})
