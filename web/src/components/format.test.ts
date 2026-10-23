import { describe, expect, it } from 'vitest'
import { formatBitrate, formatBytes, formatDate } from './format'

describe('format helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(4.2 * 1024 ** 3)).toBe('4.2 GB')
    expect(formatBytes(250 * 1024 ** 2)).toBe('250 MB')
  })
  it('formats bitrate', () => {
    expect(formatBitrate(8_400_000)).toBe('8.4 Mbps')
    expect(formatBitrate(640_000)).toBe('640 kbps')
    expect(formatBitrate(undefined)).toBe('')
  })
  it('formats dates and rejects garbage', () => {
    expect(formatDate('2005-06-01T00:00:00Z')).toContain('2005')
    expect(formatDate('nope')).toBe('')
    expect(formatDate(undefined)).toBe('')
  })
})
