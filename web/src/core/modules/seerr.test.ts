import { describe, expect, it, vi } from 'vitest'
import type { ModulesClient } from './client'
import { canAskFor, canAskForMore, seerrMe, seerrMyRequests, seerrPosterUrl, seerrRequest, seerrSearch, seerrTitle } from './seerr'

function client(): ModulesClient & { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> } {
  return { baseUrl: 'http://m.test', get: vi.fn(async () => ({})), post: vi.fn(async () => ({})), put: vi.fn(), del: vi.fn() } as never
}

describe('the Seerr calls', () => {
  it('ask the container for what they name, with the text encoded', async () => {
    const c = client()
    await seerrMe(c)
    await seerrSearch(c, 'rock & roll/100% 日本', 2)
    await seerrTitle(c, 'tv', 1396)
    await seerrMyRequests(c, 3)
    expect(c.get.mock.calls.map((x) => x[0])).toEqual([
      '/v1/seerr/me',
      `/v1/seerr/search?query=${encodeURIComponent('rock & roll/100% 日本')}&page=2`,
      '/v1/seerr/title/tv/1396',
      '/v1/seerr/requests?page=3',
    ])
  })

  it('send a request as it is given', async () => {
    const c = client()
    await seerrRequest(c, { mediaType: 'tv', mediaId: 5, seasons: [1, 2] })
    expect(c.post).toHaveBeenCalledWith('/v1/seerr/requests', { mediaType: 'tv', mediaId: 5, seasons: [1, 2] })
  })
})

describe('what is built from an answer', () => {
  it('makes a poster address only from a plain TMDb path', () => {
    expect(seerrPosterUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg')
    for (const bad of [undefined, '', 'abc.jpg', '//evil.test/x.jpg', '/../x.jpg', 'https://evil.test/x.jpg', '/a/b.jpg']) expect(seerrPosterUrl(bad)).toBeNull()
  })

  it('knows when a title, or some of a series, can be asked for', () => {
    expect(canAskFor('none')).toBe(true)
    expect(['available', 'partial', 'processing', 'pending', 'blocked'].some((s) => canAskFor(s as never))).toBe(false)
    expect(canAskForMore('partial')).toBe(true)
    expect(canAskForMore('pending')).toBe(false)
  })
})
