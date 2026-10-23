import { describe, expect, it } from 'vitest'
import { DEFAULT_HOME_LAYOUT, HOME_ROW_IDS, isDefaultHomeLayout, isRowVisible, moveRow, sanitizeHomeLayout, toggleRow, visibleRows } from './homeLayout'

describe('home layout', () => {
  it('starts with every row, in the original order', () => {
    expect(visibleRows(DEFAULT_HOME_LAYOUT)).toEqual([...HOME_ROW_IDS])
    expect(DEFAULT_HOME_LAYOUT.banner).toBe(true)
    expect(isDefaultHomeLayout(DEFAULT_HOME_LAYOUT)).toBe(true)
  })

  it('hides and shows a row without moving it', () => {
    const hidden = toggleRow(DEFAULT_HOME_LAYOUT, 'newAnime')
    expect(isRowVisible(hidden, 'newAnime')).toBe(false)
    expect(visibleRows(hidden)).not.toContain('newAnime')
    expect(hidden.order).toEqual(DEFAULT_HOME_LAYOUT.order)
    expect(isDefaultHomeLayout(hidden)).toBe(false)
    expect(toggleRow(hidden, 'newAnime')).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('moves a row up and down, and stops at the ends', () => {
    const down = moveRow(DEFAULT_HOME_LAYOUT, 'discover', 1)
    expect(down.order.slice(0, 2)).toEqual(['continue', 'discover'])
    expect(moveRow(down, 'discover', -1)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(moveRow(DEFAULT_HOME_LAYOUT, 'discover', -1)).toBe(DEFAULT_HOME_LAYOUT)
    expect(moveRow(DEFAULT_HOME_LAYOUT, 'music', 1)).toBe(DEFAULT_HOME_LAYOUT)
  })

  it('keeps a hidden row hidden when it, or the row next to it, is moved', () => {
    const layout = toggleRow(DEFAULT_HOME_LAYOUT, 'continue')
    const moved = moveRow(layout, 'discover', 1)
    expect(moved.order.slice(0, 2)).toEqual(['continue', 'discover'])
    expect(moved.hidden).toEqual(['continue'])
    expect(visibleRows(moved)).not.toContain('continue')
    expect(visibleRows(moveRow(moved, 'continue', 1))[0]).toBe('discover')
  })

  it('cleans up what was saved', () => {
    expect(sanitizeHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(sanitizeHomeLayout('nonsense')).toEqual(DEFAULT_HOME_LAYOUT)
    const messy = sanitizeHomeLayout({ banner: false, order: ['music', 'nope', 'music', 'continue'], hidden: ['newSeries', 'newSeries', 'x', 4] })
    expect(messy.banner).toBe(false)
    expect(messy.order.slice(0, 2)).toEqual(['music', 'continue'])
    expect(new Set(messy.order).size).toBe(HOME_ROW_IDS.length)
    expect(messy.order).toHaveLength(HOME_ROW_IDS.length)
    expect(messy.hidden).toEqual(['newSeries'])
  })

  it('adds rows that an older copy did not know about at the end', () => {
    const old = sanitizeHomeLayout({ order: ['music', 'discover'] })
    expect(old.order.slice(0, 2)).toEqual(['music', 'discover'])
    expect(old.order).toHaveLength(HOME_ROW_IDS.length)
  })
})
