import { afterEach, describe, expect, it } from 'vitest'
import { defaultServerUrl, readRememberedServerUrl, rememberServerUrl } from './browser'

afterEach(() => {
  delete window.JELLYFLIX_CONFIG
  localStorage.clear()
})

describe('the address the sign-in screen starts with', () => {
  it('is empty when nobody configured one', () => {
    expect(defaultServerUrl()).toBe('')
  })

  it('is the one set by whoever hosts the app (config.js)', () => {
    window.JELLYFLIX_CONFIG = { serverUrl: ' http://jellyfin.local:8096 ' }
    expect(defaultServerUrl()).toBe('http://jellyfin.local:8096')
    expect(readRememberedServerUrl()).toBe('http://jellyfin.local:8096')
  })

  it('drops a scheme that was written twice', () => {
    window.JELLYFLIX_CONFIG = { serverUrl: 'http://http://jellyfin.local:8096' }
    expect(defaultServerUrl()).toBe('http://jellyfin.local:8096')
  })

  it('ignores a blank or odd value from config.js', () => {
    window.JELLYFLIX_CONFIG = { serverUrl: '   ' }
    expect(defaultServerUrl()).toBe('')
    window.JELLYFLIX_CONFIG = { serverUrl: 42 as unknown as string }
    expect(defaultServerUrl()).toBe('')
  })

  it('gives way to the address the person used last', () => {
    window.JELLYFLIX_CONFIG = { serverUrl: 'http://hosted:8096' }
    rememberServerUrl('http://mine:8096')
    expect(readRememberedServerUrl()).toBe('http://mine:8096')
  })
})
