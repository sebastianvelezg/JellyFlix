import { describe, expect, it } from 'vitest'
import { placeMenu } from './CardMenu'

const button = (left: number, top: number): DOMRect => ({ left, top, right: left + 32, bottom: top + 32, width: 32, height: 32, x: left, y: top, toJSON: () => ({}) }) as DOMRect
const view = { width: 1000, height: 700 }
const size = { width: 200, height: 240 }

describe('placeMenu', () => {
  it('goes under the button, lined up with its right corner', () => {
    const p = placeMenu(button(500, 100), size, 'right', view)
    expect(p.top).toBe(100 + 32 + 6)
    expect(p.left).toBe(500 + 32 - 200)
  })

  it('goes over the button when there is no room under it', () => {
    const p = placeMenu(button(500, 600), size, 'right', view)
    expect(p.top).toBe(600 - 6 - 240)
  })

  it('stays inside the window at either side', () => {
    expect(placeMenu(button(0, 100), size, 'right', view).left).toBe(8)
    expect(placeMenu(button(980, 100), size, 'left', view).left).toBe(1000 - 200 - 8)
  })

  it('shrinks (and so scrolls) when it fits neither under nor over', () => {
    const p = placeMenu(button(500, 150), { width: 200, height: 900 }, 'right', { width: 1000, height: 400 })
    expect(p.maxHeight).toBeLessThan(900)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(400)
  })
})
