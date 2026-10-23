import { describe, expect, it } from 'vitest'
import { NO_FILTERS, countActiveFilters, decadeLabel, decadeYears, filterQuery, sanitizeFilters, toFacets } from './filters'

describe('advanced filters', () => {
  it('turn into the parameters of the server query', () => {
    expect(filterQuery(NO_FILTERS)).toEqual({
      years: undefined,
      minCommunityRating: undefined,
      officialRatings: undefined,
      tags: undefined,
      is4K: undefined,
      isHd: undefined,
    })
    expect(filterQuery({ decade: 1990, minRating: 7, officialRating: 'PG-13', tag: 'Classic', quality: 'uhd' })).toEqual({
      years: [1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999],
      minCommunityRating: 7,
      officialRatings: ['PG-13'],
      tags: ['Classic'],
      is4K: true,
      isHd: undefined,
    })
    expect(filterQuery({ quality: 'hd' }).isHd).toBe(true)
  })

  it('cleans up what was saved', () => {
    expect(sanitizeFilters(null)).toEqual({})
    expect(sanitizeFilters('x')).toEqual({})
    expect(sanitizeFilters({ decade: 1995, minRating: 11, quality: '8k', tag: '   ', officialRating: 5 })).toEqual({})
    expect(sanitizeFilters({ decade: 2010, minRating: 8, quality: 'hd', tag: '  Classic ', officialRating: 'R', extra: 1 })).toEqual({
      decade: 2010,
      minRating: 8,
      quality: 'hd',
      tag: 'Classic',
      officialRating: 'R',
    })
    expect(sanitizeFilters({ tag: 'x'.repeat(200) }).tag).toHaveLength(60)
  })

  it('counts what is switched on', () => {
    expect(countActiveFilters({})).toBe(0)
    expect(countActiveFilters({ decade: 1980, tag: 'Classic' })).toBe(2)
  })

  it('names decades and lists their years', () => {
    expect(decadeLabel(1980)).toBe('1980s')
    expect(decadeYears(2020)).toHaveLength(10)
    expect(decadeYears(2020)[9]).toBe(2029)
  })

  it('builds the menus from what the library has: newest decade first, no repeats, no blanks', () => {
    expect(toFacets([1994, 1999, 2003, 2011, null, 0], ['R', 'PG-13', 'R', ''], ['b', 'a', null])).toEqual({
      decades: [2010, 2000, 1990],
      officialRatings: ['PG-13', 'R'],
      tags: ['a', 'b'],
    })
    expect(toFacets(undefined, undefined, undefined)).toEqual({ decades: [], officialRatings: [], tags: [] })
  })
})
