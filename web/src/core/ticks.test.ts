// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatTime, secondsToTicks, ticksToSeconds } from './ticks'

describe('ticks', () => {
  it('converts both ways', () => {
    expect(secondsToTicks(1.5)).toBe(15_000_000)
    expect(ticksToSeconds(15_000_000)).toBe(1.5)
    expect(ticksToSeconds(undefined)).toBe(0)
    expect(secondsToTicks(-5)).toBe(0)
  })

  it('formats time', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(65.9)).toBe('1:05')
    expect(formatTime(3600)).toBe('1:00:00')
    expect(formatTime(7322)).toBe('2:02:02')
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})

describe('formatRuntime', () => {
  it('formats hours and minutes', async () => {
    const { formatRuntime } = await import('./ticks')
    expect(formatRuntime(6454)).toBe('1h 47m')
    expect(formatRuntime(7200)).toBe('2h')
    expect(formatRuntime(3120)).toBe('52m')
    expect(formatRuntime(30)).toBe('<1m')
    expect(formatRuntime(0)).toBe('')
    expect(formatRuntime(Number.NaN)).toBe('')
  })
})
