import { describe, expect, it } from 'vitest'
import { buildPlayHistory, cleanUserId, isConverted, parseTable, playbackQueries, windowStart, type PlayHistoryTables, type QueryTable } from './playbackReporting'

const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime()
const table = (rows: string[][]): QueryTable => ({ columns: [], rows })
const none = table([])
const tables = (over: Partial<PlayHistoryTables> = {}): PlayHistoryTables => ({
  totals: table([['0', '']]),
  since: table([['']]),
  months: none,
  hours: none,
  weekdays: none,
  devices: none,
  methods: none,
  ...over,
})

describe('cleanUserId', () => {
  it('gives the 32 lowercase digits the plugin stores, whatever way the server spelled it', () => {
    expect(cleanUserId('01234567-89AB-CDEF-0123-456789ABCDEF')).toHaveLength(32)
    expect(cleanUserId('0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef')
    expect(cleanUserId('01234567-89AB-CDEF-0123-456789ABCDEF')).toBe('0123456789abcdef0123456789abcdef')
  })

  it('refuses anything else, so nothing but an id can ever reach a query', () => {
    for (const bad of ['', 'abc', "x'; DROP TABLE PlaybackActivity; --", '0123456789abcdef0123456789abcde', '0123456789abcdef0123456789abcdef0', 'zz23456789abcdef0123456789abcdef']) {
      expect(() => cleanUserId(bad)).toThrow()
    }
  })
})

describe('playbackQueries', () => {
  const q = playbackQueries('01234567-89AB-CDEF-0123-456789ABCDEF', NOW)

  it('only reads, and only the one user', () => {
    for (const sql of Object.values(q)) {
      expect(sql.startsWith('SELECT ')).toBe(true)
      expect(sql).toContain("UserId = '0123456789abcdef0123456789abcdef'")
      expect(sql).not.toMatch(/;|--|\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|PRAGMA)\b/i)
    }
  })

  it('looks at the last twelve months, but at all the history for the first day', () => {
    expect(windowStart(NOW)).toBe('2025-11-01')
    expect(q.totals).toContain("DateCreated >= '2025-11-01'")
    expect(q.months).toContain("DateCreated >= '2025-11-01'")
    expect(q.since).not.toContain('DateCreated >=')
  })

  it('counts the window over a new year', () => {
    expect(windowStart(new Date(2026, 1, 15).getTime())).toBe('2025-03-01')
  })
})

describe('parseTable', () => {
  it('reads the plugin answer, which spells "colums", and turns every cell into text', () => {
    expect(parseTable({ colums: ['a', 'b'], results: [['1', null], [2, 'x']], message: '' })).toEqual({ columns: ['a', 'b'], rows: [['1', ''], ['2', 'x']] })
  })

  it('takes anything else for an empty table', () => {
    for (const odd of [null, undefined, 'text', 4, [], {}, { results: 'nope' }, { message: 'Query executed, no data returned.' }]) {
      expect(parseTable(odd).rows).toEqual([])
    }
  })
})

describe('isConverted', () => {
  it('calls a transcode a conversion and everything else played as it is', () => {
    expect(isConverted('Transcode (v:h264 a:aac)')).toBe(true)
    expect(isConverted('transcode')).toBe(true)
    expect(isConverted('DirectPlay')).toBe(false)
    expect(isConverted('DirectStream')).toBe(false)
    expect(isConverted('')).toBe(false)
  })
})

describe('buildPlayHistory', () => {
  it('has nothing in it when the plugin has recorded nothing yet', () => {
    const h = buildPlayHistory(tables(), NOW)
    expect(h.plays).toBe(0)
    expect(h.seconds).toBe(0)
    expect(h.since).toBeUndefined()
    expect(h.months).toHaveLength(12)
    expect(h.months.every((m) => m.seconds === 0)).toBe(true)
    expect(h.hours).toHaveLength(24)
    expect(h.weekdays).toHaveLength(7)
    expect(h.devices).toEqual([])
  })

  it('puts every answer where it belongs', () => {
    const h = buildPlayHistory(
      tables({
        totals: table([['5', '14400']]),
        since: table([['2026-08-14 20:05:11.0000000']]),
        months: table([['2026-09', '2', '5400'], ['2026-10', '3', '9000'], ['2019-01', '9', '9']]),
        hours: table([['20', '9000'], ['21', '5400'], ['25', '7'], ['x', '7']]),
        weekdays: table([['5', '9000'], ['6', '5400'], ['9', '1']]),
        devices: table([['Phone', 'Jellyflix', '2', '5400'], ['Living room TV', 'Jellyflix TV', '3', '9000'], ['', '', '1', '60']]),
        methods: table([['DirectPlay', '10800'], ['Transcode (v:h264 a:aac)', '3600']]),
      }),
      NOW,
    )
    expect(h.since).toBe('2026-08-14')
    expect(h.plays).toBe(5)
    expect(h.seconds).toBe(14400)
    expect(h.months.at(-1)).toEqual({ key: '2026-10', plays: 3, seconds: 9000 })
    expect(h.months.find((m) => m.key === '2026-09')?.seconds).toBe(5400)
    // A month outside the twelve shown is dropped.
    expect(h.months.some((m) => m.key === '2019-01')).toBe(false)
    expect(h.hours[20]).toBe(9000)
    expect(h.hours[21]).toBe(5400)
    expect(h.hours.reduce((a, b) => a + b, 0)).toBe(14400)
    expect(h.weekdays[5]).toBe(9000)
    expect(h.weekdays.reduce((a, b) => a + b, 0)).toBe(14400)
    // The most used device first; one with no name at all is left out.
    expect(h.devices.map((d) => d.name)).toEqual(['Living room TV', 'Phone'])
    expect(h.direct).toBe(10800)
    expect(h.converted).toBe(3600)
  })

  it('ignores numbers that are not numbers', () => {
    const h = buildPlayHistory(tables({ totals: table([['abc', '-4']]), hours: table([['3', 'many']]) }), NOW)
    expect(h.plays).toBe(0)
    expect(h.seconds).toBe(0)
    expect(h.hours[3]).toBe(0)
  })
})
