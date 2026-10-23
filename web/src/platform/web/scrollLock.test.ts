import { afterEach, describe, expect, it } from 'vitest'
import { lockPageScroll } from './scrollLock'

afterEach(() => {
  document.body.style.overflow = ''
})

describe('lockPageScroll', () => {
  it('holds the page still until the lock is let go', () => {
    const release = lockPageScroll()
    expect(document.body.style.overflow).toBe('hidden')
    release()
    expect(document.body.style.overflow).toBe('')
  })

  it('lets the page scroll again only when the last lock lets go, in whatever order', () => {
    const music = lockPageScroll()
    const video = lockPageScroll()
    music()
    expect(document.body.style.overflow).toBe('hidden')
    video()
    expect(document.body.style.overflow).toBe('')
  })

  it('ignores a lock let go twice', () => {
    const first = lockPageScroll()
    const second = lockPageScroll()
    first()
    first()
    expect(document.body.style.overflow).toBe('hidden')
    second()
    expect(document.body.style.overflow).toBe('')
  })

  it('puts back what was there before', () => {
    document.body.style.overflow = 'scroll'
    const release = lockPageScroll()
    release()
    expect(document.body.style.overflow).toBe('scroll')
  })
})
