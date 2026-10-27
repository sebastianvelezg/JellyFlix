import { describe, expect, it } from 'vitest'
import type { Movie } from '../core'
import { recallPlayList, rememberPlayList } from './playQueues'

const video = (id: string) => ({ id, name: id }) as Movie

describe('play queues of rows and grids', () => {
  it('finds a remembered list again under its word, in the same order, as a copy', () => {
    const items = [video('a'), video('b'), video('c')]
    const word = rememberPlayList(items)
    expect(recallPlayList(word)?.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    items.pop()
    expect(recallPlayList(word)).toHaveLength(3)
  })

  it('knows nothing about a word it was not given (a reload forgets them)', () => {
    expect(recallPlayList('nope')).toBeUndefined()
  })

  it('keeps only the latest lists, so a long session does not pile them up', () => {
    const first = rememberPlayList([video('x')])
    for (let i = 0; i < 20; i += 1) rememberPlayList([video(`v${i}`)])
    expect(recallPlayList(first)).toBeUndefined()
  })
})
