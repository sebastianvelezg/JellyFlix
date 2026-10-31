// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  BlockedTitle,
  guardResponse,
  guardUrl,
  hashPin,
  isBlocked,
  isValidPin,
  ratingValue,
  verifyPin,
  waitAfterFailures,
  type KidsGuard,
} from './parental'
import { sha256 } from './sha256'

const guard: KidsGuard = {
  maxName: 'PG',
  maxValue: 5,
  ratings: { g: 1, pg: 5, 'pg-13': 7, r: 9, 'tv-y': 2, 'tv-ma': 10 },
  allowedSeries: new Set(['show-ok']),
}

describe('sha256', () => {
  it('matches the known answers', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('a'.repeat(100))).toBe('2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e')
  })
})

describe('ratings', () => {
  it('looks a rating up without minding case or spaces', () => {
    expect(ratingValue(' PG-13 ', guard.ratings)).toBe(7)
    expect(ratingValue('NR', guard.ratings)).toBeUndefined()
    expect(ratingValue(null, guard.ratings)).toBeUndefined()
  })

  it('blocks what is above the limit, what has no rating and what the server cannot rank', () => {
    expect(isBlocked({ Type: 'Movie', OfficialRating: 'G' }, guard)).toBe(false)
    expect(isBlocked({ Type: 'Movie', OfficialRating: 'PG' }, guard)).toBe(false)
    expect(isBlocked({ Type: 'Movie', OfficialRating: 'PG-13' }, guard)).toBe(true)
    expect(isBlocked({ Type: 'Movie' }, guard)).toBe(true)
    expect(isBlocked({ Type: 'Movie', OfficialRating: 'XYZ' }, guard)).toBe(true)
  })

  it('lets through what has no age rating (music, folders, people)', () => {
    expect(isBlocked({ Type: 'MusicAlbum' }, guard)).toBe(false)
    expect(isBlocked({ Type: 'CollectionFolder' }, guard)).toBe(false)
    expect(isBlocked({ Type: 'Person' }, guard)).toBe(false)
  })

  it('lets an episode through when its series passes, and blocks it otherwise', () => {
    expect(isBlocked({ Type: 'Episode', SeriesId: 'show-ok' }, guard)).toBe(false)
    expect(isBlocked({ Type: 'Season', SeriesId: 'show-ok' }, guard)).toBe(false)
    expect(isBlocked({ Type: 'Episode', SeriesId: 'show-other' }, guard)).toBe(true)
    expect(isBlocked({ Type: 'Episode', SeriesId: 'show-other', OfficialRating: 'TV-Y' }, guard)).toBe(false)
    expect(isBlocked({ Type: 'Series', Id: 'show-ok' }, guard)).toBe(false)
  })
})

describe('guardUrl', () => {
  it('asks the server to limit the lists made of titles that carry a rating', () => {
    expect(guardUrl('/Items?includeItemTypes=Movie&recursive=true', guard)).toBe('/Items?includeItemTypes=Movie&recursive=true&maxOfficialRating=PG&hasParentalRating=true')
    expect(guardUrl('https://x.test/Users/u1/Items?includeItemTypes=Movie,Series&limit=5', guard)).toContain('maxOfficialRating=PG')
  })

  it('does not ask it for lists that hold episodes, music or anything unsaid (they have no rating of their own)', () => {
    expect(guardUrl('/Items?includeItemTypes=Episode', guard)).toBe('/Items?includeItemTypes=Episode')
    expect(guardUrl('/Items?includeItemTypes=Movie&includeItemTypes=Episode', guard)).not.toContain('maxOfficialRating')
    expect(guardUrl('/Items?includeItemTypes=MusicAlbum', guard)).not.toContain('maxOfficialRating')
    expect(guardUrl('/Items?recursive=true', guard)).toBe('/Items?recursive=true')
  })

  it('leaves everything else, and a request with no guard, alone', () => {
    expect(guardUrl('/Items/abc/PlaybackInfo', guard)).toBe('/Items/abc/PlaybackInfo')
    expect(guardUrl('/Items?x=1', null)).toBe('/Items?x=1')
  })
})

describe('guardResponse', () => {
  const movie = (id: string, OfficialRating?: string) => ({ Id: id, Type: 'Movie', OfficialRating })

  it('takes blocked titles out of a list and corrects the count', () => {
    const answer = guardResponse({ Items: [movie('a', 'G'), movie('b', 'R'), movie('c')], TotalRecordCount: 30 }, guard) as { Items: unknown[]; TotalRecordCount: number }
    expect(answer.Items).toEqual([movie('a', 'G')])
    expect(answer.TotalRecordCount).toBe(28)
  })

  it('filters a plain list of titles, and leaves other plain lists alone', () => {
    expect(guardResponse([movie('a', 'PG'), movie('b', 'R')], guard)).toEqual([movie('a', 'PG')])
    expect(guardResponse([{ Name: 'x' }], guard)).toEqual([{ Name: 'x' }])
    expect(guardResponse({ Version: '12' }, guard)).toEqual({ Version: '12' })
  })

  it('refuses a single title above the limit, as if it were not there', () => {
    expect(() => guardResponse(movie('b', 'R'), guard)).toThrow(BlockedTitle)
    expect(guardResponse(movie('a', 'G'), guard)).toEqual(movie('a', 'G'))
  })

  it('does nothing without a guard', () => {
    const data = { Items: [movie('b', 'R')] }
    expect(guardResponse(data, null)).toBe(data)
  })
})

describe('the PIN', () => {
  it('is four to eight digits', () => {
    expect(isValidPin('1234')).toBe(true)
    expect(isValidPin('12345678')).toBe(true)
    expect(isValidPin('123')).toBe(false)
    expect(isValidPin('123456789')).toBe(false)
    expect(isValidPin('12a4')).toBe(false)
  })

  it('is kept as a salted hash that only the same PIN matches', () => {
    const hash = hashPin('1234', 'salt-1')
    expect(hash).not.toContain('1234')
    expect(verifyPin('1234', 'salt-1', hash)).toBe(true)
    expect(verifyPin('1235', 'salt-1', hash)).toBe(false)
    expect(verifyPin('1234', 'salt-2', hash)).toBe(false)
  })

  it('makes a wait grow after five wrong tries, up to fifteen minutes', () => {
    expect([0, 1, 4].map(waitAfterFailures)).toEqual([0, 0, 0])
    expect(waitAfterFailures(5)).toBe(30)
    expect(waitAfterFailures(6)).toBe(60)
    expect(waitAfterFailures(7)).toBe(120)
    expect(waitAfterFailures(40)).toBe(900)
  })
})
