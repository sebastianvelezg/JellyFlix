// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { trailerLinks } from './details'

describe('trailerLinks', () => {
  it('keeps web addresses, each once, with the name the server gave', () => {
    const links = trailerLinks([
      { Url: 'https://www.youtube.com/watch?v=abc', Name: ' Official Trailer ' },
      { Url: 'https://www.youtube.com/watch?v=abc', Name: 'The same one' },
      { Url: 'http://example.test/t.mp4', Name: null },
    ])
    expect(links).toEqual([
      { name: 'Official Trailer', url: 'https://www.youtube.com/watch?v=abc' },
      { name: '', url: 'http://example.test/t.mp4' },
    ])
  })

  it('never lets through anything that is not a web address', () => {
    expect(trailerLinks([{ Url: 'javascript:alert(1)' }, { Url: 'file:///etc/passwd' }, { Url: 'data:text/html,hi' }, { Url: 'not a url' }, { Url: null }])).toEqual([])
  })

  it('answers nothing for nothing', () => {
    expect(trailerLinks(undefined)).toEqual([])
    expect(trailerLinks([])).toEqual([])
  })
})
