import { describe, expect, it } from 'vitest'
import { coverage, daysKind, EVERY_DAY, shadowed, slotBlock, WEEKDAYS, WEEKEND } from './slots'

describe('the weekly grid helpers', () => {
  it('names a set of days', () => {
    expect(daysKind(EVERY_DAY)).toBe('every')
    expect(daysKind([5, 4, 3, 2, 1])).toBe('weekdays')
    expect(daysKind([0, 6])).toBe('weekend')
    expect(daysKind([1, 3])).toBe('other')
    expect(daysKind([])).toBe('other')
  })

  it('makes a block for a stretch of the day, with no sources ticked (it then draws from everything)', () => {
    expect(slotBlock('morning', WEEKDAYS)).toEqual({ days: [1, 2, 3, 4, 5], start: '06:00', end: '12:00', sources: [] })
    expect(slotBlock('night')).toMatchObject({ start: '23:00', end: '06:00', days: [1, 2, 3, 4, 5, 6, 0] })
  })

  it('shows which hours of the week a block covers, like the engine does', () => {
    const grid = coverage([{ days: [1], start: '06:00', end: '12:00', sources: [] }])
    expect(grid[1]!.slice(5, 13)).toEqual([-1, 0, 0, 0, 0, 0, 0, -1])
    expect(grid[2]!.every((x) => x === -1)).toBe(true)
  })

  it('lets a block that ends before it starts run into the next morning', () => {
    const grid = coverage([{ days: [6], start: '23:00', end: '02:00', sources: [] }])
    expect(grid[6]![22]).toBe(-1)
    expect(grid[6]![23]).toBe(0)
    expect(grid[0]!.slice(0, 3)).toEqual([0, 0, -1])
  })

  it('counts a block with the same start and end as the whole day', () => {
    expect(coverage([{ days: WEEKEND.slice(), start: '00:00', end: '00:00', sources: [] }])[0]!.every((x) => x === 0)).toBe(true)
  })

  it('gives each hour to the first block that covers it, and notices a block nothing is left of', () => {
    const blocks = [
      { days: EVERY_DAY.slice(), start: '00:00', end: '00:00', sources: [0] },
      { days: [1], start: '20:00', end: '22:00', sources: [1] },
    ]
    expect(coverage(blocks)[1]![20]).toBe(0)
    expect(shadowed(blocks)).toEqual([false, true])
    expect(shadowed([blocks[1]!, blocks[0]!])).toEqual([false, false])
  })
})
