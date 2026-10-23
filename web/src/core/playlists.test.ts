import { describe, expect, it } from 'vitest'
import { findWatchLater, isWatchLater, reorder, targetIndex } from './playlists'

describe('video playlists', () => {
  it('recognises "Watch later" by name in either language', () => {
    expect(isWatchLater({ name: 'Watch later' })).toBe(true)
    expect(isWatchLater({ name: '  ver más tarde ' })).toBe(true)
    expect(isWatchLater({ name: 'Weekend' })).toBe(false)
    const lists = [
      { id: 'a', name: 'Weekend' },
      { id: 'b', name: 'Watch later' },
    ]
    expect(findWatchLater(lists)?.id).toBe('b')
    expect(findWatchLater([{ id: 'a', name: 'Weekend' }])).toBeUndefined()
  })

  it('knows where a move ends up, and refuses to go past the ends', () => {
    expect(targetIndex(1, -1, 4)).toBe(0)
    expect(targetIndex(1, 1, 4)).toBe(2)
    expect(targetIndex(0, -1, 4)).toBeNull()
    expect(targetIndex(3, 1, 4)).toBeNull()
  })

  it('reorders a list without touching the original', () => {
    const list = ['a', 'b', 'c', 'd']
    expect(reorder(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(reorder(list, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(list).toEqual(['a', 'b', 'c', 'd'])
    expect(reorder(list, 1, 1)).toBe(list)
    expect(reorder(list, 1, 9)).toBe(list)
  })
})
