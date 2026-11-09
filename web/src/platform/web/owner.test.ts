import { afterEach, describe, expect, it } from 'vitest'
import { startVisit } from './lastVisit'
import { ownedKey, setStorageOwner } from './owner'
import { clearSeriesPrefs, readBookProgress, readSeriesPrefs, readSubtitleOffset, writeBookProgress, writeSeriesPrefs, writeSubtitleOffset } from './prefs'
import { addRecentSearch, readRecentSearches } from './recentSearches'

afterEach(() => {
  setStorageOwner(null)
  localStorage.clear()
})

describe('what each account keeps on a shared browser', () => {
  it('names keys after the account signed in, and has none with nobody signed in', () => {
    expect(ownedKey('jellyflix.series')).toBeNull()
    setStorageOwner('alice')
    expect(ownedKey('jellyflix.series')).toBe('jellyflix.series:alice')
  })

  it('never shows one account the searches, series choices, subtitle timing or books of another', () => {
    setStorageOwner('parent')
    addRecentSearch('a film for grown-ups')
    writeSeriesPrefs('s1', { audioLanguage: 'jpn' })
    writeSubtitleOffset('m1', 1.5)
    writeBookProgress('b1', { percent: 40, place: '3' })

    setStorageOwner('child')
    expect(readRecentSearches()).toEqual([])
    expect(readSeriesPrefs('s1')).toEqual({})
    expect(readSubtitleOffset('m1')).toBe(0)
    expect(readBookProgress('b1')).toBeUndefined()

    // Forgetting is for the account signed in only.
    addRecentSearch('cartoons')
    clearSeriesPrefs()
    setStorageOwner('parent')
    expect(readRecentSearches()).toEqual(['a film for grown-ups'])
    expect(readSeriesPrefs('s1')).toEqual({ audioLanguage: 'jpn' })
    expect(readSubtitleOffset('m1')).toBe(1.5)
    expect(readBookProgress('b1')?.percent).toBe(40)
  })

  it('reads and writes nothing with nobody signed in', () => {
    addRecentSearch('alien')
    writeSeriesPrefs('s1', { audioLanguage: 'jpn' })
    expect(readRecentSearches()).toEqual([])
    expect(localStorage.length).toBe(0)
    expect(startVisit()).toBeUndefined()
  })

  it('drops the old copies kept without an owner, which cannot be given back to the right account', () => {
    localStorage.setItem('jellyflix.recentSearches', JSON.stringify(['old']))
    localStorage.setItem('jellyflix.series', JSON.stringify({ s1: { audioLanguage: 'jpn' } }))
    localStorage.setItem('jellyflix.visit', JSON.stringify({ seen: 1 }))
    localStorage.setItem('jellyflix.player', JSON.stringify({ volume: 0.5 }))
    setStorageOwner('alice')
    expect(localStorage.getItem('jellyflix.recentSearches')).toBeNull()
    expect(localStorage.getItem('jellyflix.series')).toBeNull()
    expect(localStorage.getItem('jellyflix.visit')).toBeNull()
    // Device preferences (player, look...) are not anybody's in particular and stay.
    expect(localStorage.getItem('jellyflix.player')).not.toBeNull()
    expect(readRecentSearches()).toEqual([])
  })

  it('counts a visit for each account', () => {
    const hour = 3600_000
    localStorage.setItem('jellyflix.visit:alice', JSON.stringify({ seen: 1000 }))
    setStorageOwner('alice')
    expect(startVisit(1000 + 2 * hour)).toBe(1000)
    setStorageOwner('bob')
    expect(startVisit(1000 + 2 * hour)).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('jellyflix.visit:bob') ?? '{}').seen).toBe(1000 + 2 * hour)
  })
})
