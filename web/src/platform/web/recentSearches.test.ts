import { afterEach, describe, expect, it } from 'vitest'
import { RECENT_LIMIT, addRecentSearch, clearRecentSearches, readRecentSearches } from './recentSearches'

afterEach(() => localStorage.clear())

describe('recent searches', () => {
  it('starts empty and keeps the newest first', () => {
    expect(readRecentSearches()).toEqual([])
    addRecentSearch('alien')
    addRecentSearch('blade runner')
    expect(readRecentSearches()).toEqual(['blade runner', 'alien'])
  })

  it('moves a repeated search to the top instead of listing it twice, ignoring case and extra spaces', () => {
    addRecentSearch('alien')
    addRecentSearch('heat')
    addRecentSearch('  ALIEN ')
    expect(readRecentSearches()).toEqual(['ALIEN', 'heat'])
    addRecentSearch('the   matrix')
    expect(readRecentSearches()[0]).toBe('the matrix')
  })

  it('ignores an empty search and never grows past the limit', () => {
    addRecentSearch('   ')
    expect(readRecentSearches()).toEqual([])
    for (let i = 0; i < RECENT_LIMIT + 5; i += 1) addRecentSearch(`movie ${i}`)
    expect(readRecentSearches()).toHaveLength(RECENT_LIMIT)
    expect(readRecentSearches()[0]).toBe(`movie ${RECENT_LIMIT + 4}`)
  })

  it('can be cleared, and survives broken storage', () => {
    addRecentSearch('alien')
    expect(clearRecentSearches()).toEqual([])
    expect(readRecentSearches()).toEqual([])
    localStorage.setItem('jellyflix.recentSearches', '{nope')
    expect(readRecentSearches()).toEqual([])
    localStorage.setItem('jellyflix.recentSearches', JSON.stringify([1, 'ok', '', null]))
    expect(readRecentSearches()).toEqual(['ok'])
  })
})
