import { describe, expect, it } from 'vitest'
import { arrangeMenu, DEFAULT_MENU_LAYOUT, isDefaultMenuLayout, moveMenuItem, sanitizeMenuLayout, toggleMenuItem } from './menuLayout'

describe('the buttons at the top', () => {
  it('starts in the usual order with nothing turned off', () => {
    expect(isDefaultMenuLayout(DEFAULT_MENU_LAYOUT)).toBe(true)
    expect(arrangeMenu(['home', 'movies', 'series', 'music'], DEFAULT_MENU_LAYOUT)).toEqual(['home', 'movies', 'series', 'music'])
  })

  it('follows the chosen order and leaves out what is off, and what the account does not have', () => {
    const layout = moveMenuItem(toggleMenuItem(DEFAULT_MENU_LAYOUT, 'series'), 'music', -1)
    expect(isDefaultMenuLayout(layout)).toBe(false)
    // Music moved one place up, so it comes before Live TV; Series is off; Books is not offered at all (the account has none)
    expect(arrangeMenu(['home', 'movies', 'series', 'livetv', 'music'], layout)).toEqual(['home', 'movies', 'music', 'livetv'])
    const all = { ...DEFAULT_MENU_LAYOUT, order: ['music', 'home', 'movies', 'series', 'anime', 'musicvideos', 'books', 'livetv'] as typeof DEFAULT_MENU_LAYOUT.order }
    expect(arrangeMenu(['home', 'movies', 'music'], all)).toEqual(['music', 'home', 'movies'])
  })

  it('never turns Home off, and a button at the end does not move out of the list', () => {
    expect(toggleMenuItem(DEFAULT_MENU_LAYOUT, 'home')).toBe(DEFAULT_MENU_LAYOUT)
    expect(moveMenuItem(DEFAULT_MENU_LAYOUT, 'home', -1)).toBe(DEFAULT_MENU_LAYOUT)
    expect(moveMenuItem(DEFAULT_MENU_LAYOUT, 'music', 1)).toBe(DEFAULT_MENU_LAYOUT)
    expect(toggleMenuItem(toggleMenuItem(DEFAULT_MENU_LAYOUT, 'books'), 'books').hidden).toEqual([])
  })

  it('cleans up what was saved', () => {
    expect(sanitizeMenuLayout(undefined)).toEqual(DEFAULT_MENU_LAYOUT)
    expect(sanitizeMenuLayout('x')).toEqual(DEFAULT_MENU_LAYOUT)
    const saved = sanitizeMenuLayout({ order: ['music', 'nope', 'music', 'books'], hidden: ['home', 'books', 'books', 7] })
    expect(saved.order.slice(0, 2)).toEqual(['music', 'books'])
    expect(saved.order).toHaveLength(8)
    expect(new Set(saved.order).size).toBe(8)
    expect(saved.hidden).toEqual(['books'])
  })
})
