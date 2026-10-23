import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInstallState } from './pwa'

afterEach(() => vi.unstubAllGlobals())

describe('useInstallState', () => {
  it('points to the browser menu where nothing else is known', () => {
    const { result } = renderHook(() => useInstallState())
    expect(result.current.kind).toBe('manual')
  })

  it('knows the app is already installed when it runs in its own window', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { result } = renderHook(() => useInstallState())
    expect(result.current.kind).toBe('installed')
  })

  it('points iPhones and iPads to the Share menu', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')
    const { result } = renderHook(() => useInstallState())
    expect(result.current.kind).toBe('ios')
    vi.restoreAllMocks()
  })

  it('offers the install dialog once the browser says the app can be installed', async () => {
    const { result } = renderHook(() => useInstallState())
    const prompt = vi.fn().mockResolvedValue(undefined)
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(result.current.kind).toBe('prompt')
    expect(event.defaultPrevented).toBe(true) // the browser's own mini bar is replaced by the button in Settings
    if (result.current.kind === 'prompt') await act(() => (result.current as { install: () => Promise<void> }).install())
    expect(prompt).toHaveBeenCalledOnce()
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(result.current.kind).toBe('manual')
  })
})
