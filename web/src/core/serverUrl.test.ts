// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isPrivateHost, isUnencryptedPublic, normalizeServerUrl, ServerUrlError, tidyServerAddress } from './serverUrl'

describe('normalizeServerUrl', () => {
  it.each([
    ['http://jellyfin.local:8096', 'http://jellyfin.local:8096'],
    ['http://jellyfin.local:8096/', 'http://jellyfin.local:8096'],
    ['  http://jellyfin.local:8096///  ', 'http://jellyfin.local:8096'],
    ['jellyfin.local:8096', 'http://jellyfin.local:8096'],
    ['jellyfin.local', 'http://jellyfin.local'],
    ['192.168.0.10:8096', 'http://192.168.0.10:8096'],
    ['nas:8096', 'http://nas:8096'],
    ['[::1]:8096', 'http://[::1]:8096'],
    ['media.example.com', 'https://media.example.com'],
    ['media.example.com:8920/jellyfin', 'https://media.example.com:8920/jellyfin'],
    ['8.8.8.8:8096', 'https://8.8.8.8:8096'],
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

describe('isPrivateHost', () => {
  it.each([
    'localhost', 'nas', 'jellyfin.local', 'box.home.arpa', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1',
    '169.254.1.1', '100.64.0.1', '100.127.255.255', '::1', '[::1]', 'fd12:3456::1', 'fe80::1', 'my-tv.tail1234.ts.net',
  ])('%s is on a private network', (host) => {
    expect(isPrivateHost(host)).toBe(true)
  })

  it.each(['', 'example.com', '8.8.8.8', '172.32.0.1', '172.15.0.1', '100.128.0.1', '192.169.0.1', '11.0.0.1', '300.1.1.1', '2001:db8::1'])(
    '%j is not',
    (host) => {
      expect(isPrivateHost(host)).toBe(false)
    },
  )
})

describe('isUnencryptedPublic', () => {
  it('warns only about http to somewhere that is not private', () => {
    expect(isUnencryptedPublic('http://media.example.com')).toBe(true)
    expect(isUnencryptedPublic('http://8.8.8.8:8096')).toBe(true)
    expect(isUnencryptedPublic('https://media.example.com')).toBe(false)
    expect(isUnencryptedPublic('http://192.168.0.10:8096')).toBe(false)
    expect(isUnencryptedPublic('http://jellyfin.local:8096')).toBe(false)
    expect(isUnencryptedPublic('not an address')).toBe(false)
  })
})
