import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBannerLineup } from './useBannerLineup'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const lists = (quickReady: boolean, fullReady: boolean) => ({
  quick: { ready: quickReady, build: () => ['newest'] },
  full: { ready: fullReady, build: () => ['newest', 'random-1', 'random-2'] },
})

function setup(initial: [boolean, boolean], key = 'home') {
  return renderHook(({ q, f, k }) => useBannerLineup(k, lists(q, f).quick, lists(q, f).full), {
    initialProps: { q: initial[0], f: initial[1], k: key },
  })
}

describe('useBannerLineup', () => {
  it('shows nothing until the newest titles are known', () => {
    const { result } = setup([false, false])
    expect(result.current).toEqual({ items: [], shown: false })
  })

  it('shows the newest first, then the fuller lineup if it arrives in time', () => {
    const { result, rerender } = setup([true, false])
    expect(result.current.items).toEqual(['newest'])
    act(() => vi.advanceTimersByTime(1500))
    rerender({ q: true, f: true, k: 'home' })
    expect(result.current.items).toEqual(['newest', 'random-1', 'random-2'])
  })

  it('leaves the banner alone when the fuller lineup arrives too late', () => {
    const { result, rerender } = setup([true, false])
    act(() => vi.advanceTimersByTime(4500))
    rerender({ q: true, f: true, k: 'home' })
    expect(result.current.items).toEqual(['newest'])
  })

  it('fills an empty banner with the fuller lineup even when it arrives late', () => {
    // The newest list came back empty (as a real server did for series), so there is nothing to flip.
    const empty = renderHook(({ f }) => useBannerLineup('home', { ready: true, build: () => [] }, { ready: f, build: () => ['random-1'] }), {
      initialProps: { f: false },
    })
    expect(empty.result.current.items).toEqual([])
    act(() => vi.advanceTimersByTime(9000))
    empty.rerender({ f: true })
    expect(empty.result.current.items).toEqual(['random-1'])
  })

  it('is one step when everything is known at the start, and never changes afterwards', () => {
    const { result, rerender } = setup([true, true])
    expect(result.current.items).toEqual(['newest', 'random-1', 'random-2'])
    rerender({ q: true, f: false, k: 'home' })
    expect(result.current.items).toEqual(['newest', 'random-1', 'random-2'])
  })

  it('starts over for another library', () => {
    const { result, rerender } = setup([true, true], 'movies')
    expect(result.current.shown).toBe(true)
    rerender({ q: false, f: false, k: 'anime' })
    expect(result.current).toEqual({ items: [], shown: false })
  })
})
