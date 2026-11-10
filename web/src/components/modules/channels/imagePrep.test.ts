import { describe, expect, it } from 'vitest'
import { fitWithin } from './imagePrep'

describe('fitting a picture in a square', () => {
  it('shrinks the longer side to the size asked for and keeps the shape', () => {
    expect(fitWithin(1000, 500, 256)).toEqual({ width: 256, height: 128 })
    expect(fitWithin(300, 900, 256)).toEqual({ width: 85, height: 256 })
  })

  it('never makes a small picture bigger, and never gives a side of zero', () => {
    expect(fitWithin(100, 50, 256)).toEqual({ width: 100, height: 50 })
    expect(fitWithin(5000, 1, 256)).toEqual({ width: 256, height: 1 })
    expect(fitWithin(0, 10, 256)).toEqual({ width: 1, height: 1 })
    expect(fitWithin(Number.NaN, 10, 256)).toEqual({ width: 1, height: 1 })
  })
})
