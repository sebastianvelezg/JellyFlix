import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Guide, GuideChannel, Program } from '../../../core/modules'
import { clampNameWidth, favouritesFirst, joinGuide, joinPrograms, markStep, NAME_DEFAULT, NAME_MAX, NAME_MIN, readSetting, startsNewDay, stepZoom, writeSetting, ZOOMS } from './guideLayout'

const program = (start: number, title = `P${start}`): Program => ({ start, end: start + 1800, itemId: `i${start}`, title, type: 'Movie', runtime: 1800 })
const channel = (id: string, number: number, programs: Program[], extra: Partial<GuideChannel> = {}): GuideChannel => ({ id, number, name: `Channel ${id}`, color: '#fff', programs, ...extra })
const guide = (from: number, to: number, channels: GuideChannel[]): Guide => ({ serverTime: to, from, to, channels })

describe('the width of the column of names', () => {
  it('stays between its smallest and its largest, and a nonsense value gives the usual width', () => {
    expect(clampNameWidth(10)).toBe(NAME_MIN)
    expect(clampNameWidth(9999)).toBe(NAME_MAX)
    expect(clampNameWidth(200.4)).toBe(200)
    expect(clampNameWidth(Number.NaN)).toBe(NAME_DEFAULT)
  })
})

describe('the scale of the time', () => {
  it('goes one step closer or farther and stops at both ends', () => {
    expect(stepZoom(200, 1)).toBe(280)
    expect(stepZoom(200, -1)).toBe(140)
    expect(stepZoom(ZOOMS[ZOOMS.length - 1] as number, 1)).toBe(ZOOMS[ZOOMS.length - 1])
    expect(stepZoom(ZOOMS[0] as number, -1)).toBe(ZOOMS[0])
    expect(stepZoom(215, 1)).toBe(280) // a value that is not one of the steps counts as the nearest one
  })

  it('marks every half hour when there is room for the times, and every hour when there is not', () => {
    expect(markStep(400)).toBe(1800)
    expect(markStep(200)).toBe(1800)
    expect(markStep(140)).toBe(3600)
    expect(markStep(90)).toBe(3600)
  })
})

describe('joining the pieces of the guide', () => {
  it('puts the next piece after the first, each moment once, the newer one winning', () => {
    expect(joinPrograms([program(0), program(1800)], [program(1800, 'New'), program(3600)]).map((p) => [p.start, p.title])).toEqual([
      [0, 'P0'],
      [1800, 'New'],
      [3600, 'P3600'],
    ])
  })

  it('widens the range, keeps what each channel had and follows the order of the newest answer', () => {
    const first = guide(0, 7200, [channel('a', 1, [program(0), program(3600)]), channel('b', 2, [program(0)]), channel('gone', 3, [program(0)])])
    const piece = guide(7200, 14400, [channel('b', 2, [program(7200)], { favorite: true }), channel('a', 1, [program(7200)]), channel('new', 4, [program(7200)])])
    const all = joinGuide(first, piece)
    expect([all.from, all.to, all.serverTime]).toEqual([0, 14400, 14400])
    expect(all.channels.map((c) => c.id)).toEqual(['b', 'a', 'new'])
    expect(all.channels.find((c) => c.id === 'a')?.programs.map((p) => p.start)).toEqual([0, 3600, 7200])
    expect(all.channels.find((c) => c.id === 'b')?.favorite).toBe(true)
    expect(all.channels.find((c) => c.id === 'new')?.programs.map((p) => p.start)).toEqual([7200])
  })
})

describe('favourites first', () => {
  it('puts the favourites before the rest, each group by number, without touching the list it was given', () => {
    const list = [{ id: 'a', number: 1 }, { id: 'b', number: 2 }, { id: 'c', number: 3 }, { id: 'd', number: 4 }]
    const out = favouritesFirst(list, (id) => id === 'c' || id === 'b')
    expect(out.map((c) => c.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(list.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(favouritesFirst(list, () => false).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('days and settings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('knows when a mark is on another day', () => {
    const noon = Math.floor(new Date(2026, 10, 10, 12, 0).getTime() / 1000)
    expect(startsNewDay(noon, noon + 3600)).toBe(false)
    expect(startsNewDay(noon, noon + 13 * 3600)).toBe(true)
  })

  it('keeps a setting, and goes back to the usual one when it cannot be read', () => {
    expect(readSetting('guide.test', 7)).toBe(7)
    writeSetting('guide.test', 42)
    expect(readSetting('guide.test', 7)).toBe(42)
    window.localStorage.setItem('guide.test', 'not a number')
    expect(readSetting('guide.test', 7)).toBe(7)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readSetting('guide.test', 9)).toBe(9)
    expect(() => writeSetting('guide.test', 1)).not.toThrow()
  })
})
