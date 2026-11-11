import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reloadForStaleBuild, RELOAD_WINDOW_MS } from './staleBuild'

describe('a tab that asks for a file of an old build', () => {
  beforeEach(() => sessionStorage.clear())

  it('reloads once, and not again right after', () => {
    const reload = vi.fn()
    expect(reloadForStaleBuild(reload, 1_000)).toBe(true)
    expect(reloadForStaleBuild(reload, 1_000 + 5_000)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads again for a failure long after', () => {
    const reload = vi.fn()
    reloadForStaleBuild(reload, 1_000)
    expect(reloadForStaleBuild(reload, 1_000 + RELOAD_WINDOW_MS + 1)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
