// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { describeOffset, MAX_SUBTITLE_OFFSET, srtToVtt, stepOffset, subtitleFileToVtt } from './subtitleSync'

describe('stepOffset', () => {
  it('moves in tenths without floating point drift', () => {
    let offset = 0
    for (let i = 0; i < 3; i += 1) offset = stepOffset(offset, 0.1)
    expect(offset).toBe(0.3)
    expect(stepOffset(0.3, -0.5)).toBe(-0.2)
    expect(stepOffset(1.1, 0.2)).toBe(1.3)
  })

  it('never shows negative zero and stays within the limit', () => {
    expect(Object.is(stepOffset(0.1, -0.1), 0)).toBe(true)
    expect(stepOffset(MAX_SUBTITLE_OFFSET, 5)).toBe(MAX_SUBTITLE_OFFSET)
    expect(stepOffset(-MAX_SUBTITLE_OFFSET, -5)).toBe(-MAX_SUBTITLE_OFFSET)
  })
})

describe('describeOffset', () => {
  it('says which way the subtitles are moved', () => {
    expect(describeOffset(0)).toBe('In sync')
    expect(describeOffset(0.5)).toBe('+0.5 s (later)')
    expect(describeOffset(-1.2)).toBe('−1.2 s (earlier)')
  })
})

describe('srtToVtt', () => {
  it('converts timestamps, drops indexes and keeps the lines', () => {
    const srt = '1\r\n00:00:01,500 --> 00:00:03,000\r\nHello\r\nthere\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,250\r\n<i>Bye</i>\r\n'
    expect(srtToVtt(srt)).toBe(
      'WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHello\nthere\n\n00:00:04.000 --> 00:00:05.250\n<i>Bye</i>\n',
    )
  })

  it('handles a byte-order mark, short fractions, single-digit hours and position hints', () => {
    const srt = `${String.fromCharCode(0xfeff)}1\n0:00:01,5 --> 0:00:02,25  X1:100 X2:200 Y1:10 Y2:20\nHi\n`
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n00:00:01.500 --> 00:00:02.250\nHi\n')
  })

  it('skips blocks that are not cues, and cues with no text', () => {
    const srt = 'garbage\n\n1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\nOnly this\n'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nOnly this\n')
  })

  it('leaves WebVTT as it is, apart from line endings', () => {
    expect(srtToVtt('WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHi\r\n')).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n')
  })

  it('gives an empty (valid) file for an empty input', () => {
    expect(srtToVtt('')).toBe('WEBVTT\n\n\n')
  })
})

describe('subtitleFileToVtt', () => {
  it('reads .srt and .vtt by name, in any case, and refuses other formats', () => {
    expect(subtitleFileToVtt('Movie.EN.SRT', '1\n00:00:01,000 --> 00:00:02,000\nHi')).toContain('00:00:01.000 --> 00:00:02.000')
    expect(subtitleFileToVtt('movie.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi')).toMatch(/^WEBVTT/)
    expect(subtitleFileToVtt('movie.ass', '[Script Info]')).toBeNull()
    expect(subtitleFileToVtt('movie', 'x')).toBeNull()
  })
})
