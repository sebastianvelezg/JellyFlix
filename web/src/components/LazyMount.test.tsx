import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LazyMount } from './LazyMount'

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void

/** A stand-in for the browser's IntersectionObserver that the test can fire by hand. */
function fakeObserver() {
  const observers: Array<{ callback: Callback; options?: IntersectionObserverInit; disconnected: boolean }> = []
  class Fake {
    record: (typeof observers)[number]
    constructor(callback: Callback, options?: IntersectionObserverInit) {
      this.record = { callback, options, disconnected: false }
      observers.push(this.record)
    }
    observe() {}
    disconnect() {
      this.record.disconnected = true
    }
  }
  vi.stubGlobal('IntersectionObserver', Fake)
  return observers
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LazyMount', () => {
  it('holds the space and renders nothing until it is about to be seen', () => {
    const observers = fakeObserver()
    render(
      <LazyMount height={123}>
        <p>the row</p>
      </LazyMount>,
    )
    expect(screen.queryByText('the row')).not.toBeInTheDocument()
    const holder = document.querySelector('[data-lazy=waiting]') as HTMLElement
    expect(holder.style.minHeight).toBe('123px')
    // It starts well before it is on screen.
    expect(observers[0]?.options?.rootMargin).toBe('700px 0px')

    act(() => observers[0]?.callback([{ isIntersecting: false }]))
    expect(screen.queryByText('the row')).not.toBeInTheDocument()

    act(() => observers[0]?.callback([{ isIntersecting: true }]))
    expect(screen.getByText('the row')).toBeInTheDocument()
    expect(observers[0]?.disconnected).toBe(true) // and stops watching
  })

  it('renders at once where there is no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(
      <LazyMount>
        <p>the row</p>
      </LazyMount>,
    )
    expect(screen.getByText('the row')).toBeInTheDocument()
  })
})
