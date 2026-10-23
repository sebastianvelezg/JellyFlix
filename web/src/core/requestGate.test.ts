import { describe, expect, it } from 'vitest'
import { createGate, priorityOf } from './requestGate'
import { withoutTotals } from './jellyfin'

describe('createGate', () => {
  it('lets only `limit` through at once and hands a place on when one is given back', async () => {
    const gate = createGate(2)
    await gate.acquire(1)
    await gate.acquire(1)
    expect(gate.counts()).toEqual({ active: 2, waiting: 0 })
    let third = false
    void gate.acquire(1).then(() => {
      third = true
    })
    await Promise.resolve()
    expect(third).toBe(false)
    expect(gate.counts()).toEqual({ active: 2, waiting: 1 })
    gate.release()
    await Promise.resolve()
    expect(third).toBe(true)
    expect(gate.counts()).toEqual({ active: 2, waiting: 0 })
  })

  it('serves the most important first, and in order of arrival among equals', async () => {
    const gate = createGate(1)
    await gate.acquire(1)
    const order: string[] = []
    const wait = (name: string, priority: 0 | 1 | 2) => gate.acquire(priority).then(() => order.push(name))
    const all = [wait('slow-1', 2), wait('normal-1', 1), wait('urgent', 0), wait('normal-2', 1), wait('slow-2', 2)]
    for (let i = 0; i < all.length; i += 1) {
      gate.release()
      await Promise.resolve()
    }
    await Promise.all(all)
    expect(order).toEqual(['urgent', 'normal-1', 'normal-2', 'slow-1', 'slow-2'])
  })

  it('drops a read that is cancelled while it waits, without using up a place', async () => {
    const gate = createGate(1)
    await gate.acquire(1)
    const stop = new AbortController()
    const waiting = gate.acquire(1, stop.signal)
    stop.abort()
    await expect(waiting).rejects.toBeDefined()
    expect(gate.counts()).toEqual({ active: 1, waiting: 0 })
    gate.release()
    expect(gate.counts()).toEqual({ active: 0, waiting: 0 })
    // Already cancelled: refused at once.
    await expect(gate.acquire(1, stop.signal)).rejects.toBeDefined()
  })

  it('never counts below zero', () => {
    const gate = createGate(2)
    gate.release()
    gate.release()
    expect(gate.counts().active).toBe(0)
  })
})

describe('priorityOf', () => {
  const base = 'https://jellyfin.local:8096'
  it('puts what a page is made of first', () => {
    expect(priorityOf(`${base}/UserItems/Resume?userId=u&limit=16`)).toBe(0)
    expect(priorityOf(`${base}/Shows/NextUp?userId=u`)).toBe(0)
    expect(priorityOf(`${base}/Items/Latest?userId=u&parentId=lib`)).toBe(0)
    expect(priorityOf(`${base}/Items/abc123?userId=u`)).toBe(0)
    expect(priorityOf(`${base}/Shows/s1/Episodes?userId=u`)).toBe(0)
    expect(priorityOf(`${base}/Items?userId=u&searchTerm=matrix`)).toBe(0)
    expect(priorityOf(`${base}/Items?userId=u&ids=a,b`)).toBe(0)
  })

  it('puts the slow extras last', () => {
    expect(priorityOf(`${base}/Items?userId=u&sortBy=Random&limit=20`)).toBe(2)
    expect(priorityOf(`${base}/Items?sortBy=Random,SortName`)).toBe(2)
    expect(priorityOf(`${base}/Items/Filters?userId=u`)).toBe(2)
    expect(priorityOf(`${base}/Items/Filters2?userId=u`)).toBe(2)
    expect(priorityOf(`${base}/Movies/abc/Similar`)).toBe(2)
  })

  it('treats the rest as ordinary', () => {
    expect(priorityOf(`${base}/Items?userId=u&sortBy=SortName&startIndex=40`)).toBe(1)
    expect(priorityOf('/Items?includeItemTypes=Movie')).toBe(1)
  })
})

describe('withoutTotals', () => {
  const base = 'https://jellyfin.local:8096'
  it('asks the lists that were not asked about totals not to count', () => {
    for (const path of ['/Items', '/UserItems/Resume', '/Shows/NextUp', '/Artists/AlbumArtists', '/Genres', '/MusicGenres', '/Users/u1/Items']) {
      expect(withoutTotals(`${base}${path}?limit=16`)).toBe(`${base}${path}?limit=16&enableTotalRecordCount=false`)
    }
    expect(withoutTotals(`${base}/jellyfin/Items`)).toBe(`${base}/jellyfin/Items?enableTotalRecordCount=false`)
  })

  it('leaves alone what asked on purpose, and what is not a counted list', () => {
    expect(withoutTotals(`${base}/Items?enableTotalRecordCount=true&limit=40`)).toBe(`${base}/Items?enableTotalRecordCount=true&limit=40`)
    expect(withoutTotals(`${base}/Items?enableTotalRecordCount=false`)).toBe(`${base}/Items?enableTotalRecordCount=false`)
    for (const path of ['/Items/Latest', '/Items/abc', '/Shows/s1/Episodes', '/System/ActivityLog/Entries', '/Users/Me', '/Sessions']) {
      expect(withoutTotals(`${base}${path}?x=1`)).toBe(`${base}${path}?x=1`)
    }
  })

  it('works on an address without a server too', () => {
    expect(withoutTotals('/Items?limit=3')).toBe('/Items?limit=3&enableTotalRecordCount=false')
    expect(withoutTotals('')).toBe('')
  })
})
