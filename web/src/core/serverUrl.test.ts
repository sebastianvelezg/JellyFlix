// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeServerUrl, ServerUrlError, tidyServerAddress } from './serverUrl'

describe('normalizeServerUrl', () => {
  it.each([
    ['http://jellyfin.local:8096', 'http://jellyfin.local:8096'],
    ['http://jellyfin.local:8096/', 'http://jellyfin.local:8096'],
    ['  http://jellyfin.local:8096///  ', 'http://jellyfin.local:8096'],
    ['jellyfin.local:8096', 'http://jellyfin.local:8096'],
    ['jellyfin.local', 'http://jellyfin.local'],
    ['HTTPS://Media.Example.com', 'https://media.example.com'],
    ['https://media.example.com:443/', 'https://media.example.com'],
    ['http://host:8096/jellyfin/', 'http://host:8096/jellyfin'],
    ['http://host:8096/web/index.html', 'http://host:8096'],
    ['http://host:8096/web/', 'http://host:8096'],
    ['http://host:8096/jellyfin/web/index.html#!/home', 'http://host:8096/jellyfin'],
    ['http://host:8096/?x=1#frag', 'http://host:8096'],
    ['http://[::1]:8096', 'http://[::1]:8096'],
    ['http://http://jellyfin.local:8096', 'http://jellyfin.local:8096'],
    ['http://https://media.example.com/', 'https://media.example.com'],
    ['HTTP://http://http://host:8096', 'http://host:8096'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected)
  })

  it.each([[''], ['   '], ['ftp://host'], ['javascript:alert(1)'], ['http://'], ['http://user:pass@host:8096'], ['http://exa mple.com']])(
    'rejects %j',
    (input) => {
      expect(() => normalizeServerUrl(input)).toThrow(ServerUrlError)
    },
  )
})

describe('tidyServerAddress', () => {
  it('drops a scheme that was typed twice and trims', () => {
    expect(tidyServerAddress('  http://http://host:8096 ')).toBe('http://host:8096')
    expect(tidyServerAddress('https://http://host')).toBe('http://host')
    expect(tidyServerAddress('host:8096')).toBe('host:8096')
    expect(tidyServerAddress('')).toBe('')
  })
})
