import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_HOME_LAYOUT, toggleRow } from '../../core'
import {
  APPEARANCE_CSS_KEY,
  APPEARANCE_DEFAULTS,
  applyAppearance,
  readAppearance,
  resetAppearance,
  useAppearance,
  writeAppearance,
} from './appearance'

beforeEach(() => {
  document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#000000">')
})

afterEach(() => {
  localStorage.clear()
  document.querySelector('meta[name="theme-color"]')?.remove()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-posters')
})

describe('appearance preferences', () => {
  it('starts as the original look', () => {
    expect(readAppearance()).toEqual(APPEARANCE_DEFAULTS)
  })

  it('remembers what was chosen', () => {
    writeAppearance({ theme: { canvas: 'dusk', accent: 'rose' }, posterSize: 'large' })
    expect(readAppearance()).toMatchObject({ theme: { canvas: 'dusk', accent: 'rose' }, posterSize: 'large' })
    writeAppearance({ home: toggleRow(DEFAULT_HOME_LAYOUT, 'music') })
    expect(readAppearance().theme).toEqual({ canvas: 'dusk', accent: 'rose' }) // a later change keeps the earlier ones
    expect(readAppearance().home.hidden).toEqual(['music'])
  })

  it('ignores what is broken or tampered with', () => {
    localStorage.setItem('jellyflix.appearance', '{not json')
    expect(readAppearance()).toEqual(APPEARANCE_DEFAULTS)
    localStorage.setItem('jellyflix.appearance', JSON.stringify({ theme: { canvas: 'x', accent: 'url(javascript:1)' }, posterSize: 'huge', home: 7 }))
    expect(readAppearance()).toEqual(APPEARANCE_DEFAULTS)
  })

  it('remembers the layout choices and drops values it does not know', () => {
    applyAppearance(writeAppearance({ density: 'compact', uiSize: 'large', banner: 'compact' }))
    const root = document.documentElement
    expect([root.dataset.density, root.dataset.size, root.dataset.banner]).toEqual(['compact', 'large', 'compact'])
    localStorage.setItem('jellyflix.appearance', JSON.stringify({ density: 'tight', uiSize: 'huge', banner: 'none' }))
    expect(readAppearance()).toMatchObject({ density: 'comfortable', uiSize: 'default', banner: 'large' })
  })

  it('hands out the same object until something changes', () => {
    const first = readAppearance()
    expect(readAppearance()).toBe(first)
    writeAppearance({ posterSize: 'compact' })
    expect(readAppearance()).not.toBe(first)
  })

  it('puts the colours, the poster size and the browser bar colour on the page', () => {
    applyAppearance(writeAppearance({ theme: { canvas: 'midnight', accent: 'amber' }, posterSize: 'compact' }))
    const root = document.documentElement
    expect(root.style.getPropertyValue('--color-bg')).toBe('#050813')
    expect(root.style.getPropertyValue('--color-accent-ink')).not.toBe('#ffffff') // dark text on the light amber
    expect(root.dataset.posters).toBe('compact')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#050813')
    // Kept for the next start, so the page can be painted before the app has loaded.
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_CSS_KEY) as string)
    expect(saved).toMatchObject({ attrs: { posters: 'compact', density: 'comfortable', size: 'default', banner: 'large' }, bg: '#050813' })
    expect(saved.vars['--color-accent']).toBe(root.style.getPropertyValue('--color-accent'))
  })

  it('goes back to the original look', () => {
    applyAppearance(writeAppearance({ theme: { canvas: 'pine', accent: 'violet' }, posterSize: 'large' }))
    expect(resetAppearance()).toEqual(APPEARANCE_DEFAULTS)
    expect(readAppearance()).toEqual(APPEARANCE_DEFAULTS)
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#000000')
    expect(document.documentElement.dataset.posters).toBe('comfortable')
  })

  it('keeps a component that shows it up to date', () => {
    const { result } = renderHook(() => useAppearance())
    expect(result.current.posterSize).toBe('comfortable')
    act(() => {
      writeAppearance({ posterSize: 'large' })
    })
    expect(result.current.posterSize).toBe('large')
    act(() => {
      resetAppearance()
    })
    expect(result.current.posterSize).toBe('comfortable')
  })
})
