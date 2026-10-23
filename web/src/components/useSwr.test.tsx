import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSwr, dropSwrMemory, prefetchSwr, swrKey, useSwr } from './useSwr'

beforeEach(() => {
  clearSwr()
  sessionStorage.clear()
})

/** A loader that answers with the next value each time it is called, and counts the calls. */
function counter() {
  let n = 0
  return vi.fn(async () => ++n)
}

describe('useSwr', () => {
  it('loads once, then a second reader of the same list gets it at once without asking again', async () => {
    const load = counter()
    const first = renderHook(() => useSwr('k1', load))
    expect(first.result.current.state.status).toBe('loading')
    await waitFor(() => expect(first.result.current.state).toEqual({ status: 'ready', data: 1 }))

    const second = renderHook(() => useSwr('k1', load))
    expect(second.result.current.state).toEqual({ status: 'ready', data: 1 }) // no loading state at all
    expect(load).toHaveBeenCalledTimes(1) // recent enough: not asked again
  })

  it('shares one request between readers that start together', async () => {
    const load = counter()
    const a = renderHook(() => useSwr('k2', load))
    const b = renderHook(() => useSwr('k2', load))
    await waitFor(() => expect(a.result.current.state.status).toBe('ready'))
    await waitFor(() => expect(b.result.current.state.status).toBe('ready'))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('shows the old copy at once when it is stale and swaps in the fresh one', async () => {
    const load = counter()
    const first = renderHook(() => useSwr('k3', load, { fresh: 0 }))
    await waitFor(() => expect(first.result.current.state).toEqual({ status: 'ready', data: 1 }))
    first.unmount()

    const again = renderHook(() => useSwr('k3', load, { fresh: 0 }))
    expect(again.result.current.state).toEqual({ status: 'ready', data: 1 }) // the old copy, immediately
    await waitFor(() => expect(again.result.current.state).toEqual({ status: 'ready', data: 2 }))
  })

  it('keeps the old copy when the refresh fails, and shows an error only when there is none', async () => {
    const load = vi.fn<() => Promise<number>>().mockResolvedValueOnce(1).mockRejectedValue(new Error('server down'))
    const first = renderHook(() => useSwr('k4', load, { fresh: 0 }))
    await waitFor(() => expect(first.result.current.state.status).toBe('ready'))
    first.unmount()
    const again = renderHook(() => useSwr('k4', load, { fresh: 0 }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(again.result.current.state).toEqual({ status: 'ready', data: 1 })

    const none = renderHook(() => useSwr('k5', load))
    await waitFor(() => expect(none.result.current.state).toEqual({ status: 'error', message: 'server down' }))
  })

  it('survives a reload within the tab (sessionStorage) and is forgotten by clearSwr', async () => {
    const load = counter()
    const first = renderHook(() => useSwr('k6', load))
    await waitFor(() => expect(first.result.current.state.status).toBe('ready'))
    first.unmount()

    dropSwrMemory() // what a reload does to memory
    const afterReload = renderHook(() => useSwr('k6', load, { fresh: 0 }))
    expect(afterReload.result.current.state).toEqual({ status: 'ready', data: 1 })
    afterReload.unmount()

    clearSwr() // sign-out
    const afterSignOut = renderHook(() => useSwr('k6', load))
    expect(afterSignOut.result.current.state.status).toBe('loading')
  })

  it('goes to the server when the person asks to try again, even if the copy is recent', async () => {
    const load = counter()
    const hook = renderHook(() => useSwr('k7', load))
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'))
    act(() => hook.result.current.retry())
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'ready', data: 2 }))
  })

  it('starts a different key from its own copy, not the previous one', async () => {
    const load = counter()
    const { result, rerender } = renderHook(({ k }) => useSwr(k, load), { initialProps: { k: 'a' } })
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: 1 }))
    rerender({ k: 'b' })
    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: 2 }))
  })

  it('writes edits through to the remembered copy', async () => {
    const load = counter()
    const first = renderHook(() => useSwr('k8', load))
    await waitFor(() => expect(first.result.current.state.status).toBe('ready'))
    act(() => first.result.current.update((n) => n + 100))
    expect(first.result.current.state).toEqual({ status: 'ready', data: 101 })
    first.unmount()
    const again = renderHook(() => useSwr('k8', load))
    expect(again.result.current.state).toEqual({ status: 'ready', data: 101 })
  })
})

describe('prefetchSwr and keys', () => {
  it('reads ahead so the first reader finds it ready', async () => {
    const load = counter()
    prefetchSwr('k9', load)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const hook = renderHook(() => useSwr('k9', load))
    expect(hook.result.current.state).toEqual({ status: 'ready', data: 1 })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('makes keys that differ per person', () => {
    expect(swrKey('u1', 'recent', 'movie', undefined)).toBe('u1|recent|movie|')
    expect(swrKey('u1', 'a')).not.toBe(swrKey('u2', 'a'))
  })
})
