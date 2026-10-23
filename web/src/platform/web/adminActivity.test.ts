import { afterEach, describe, expect, it } from 'vitest'
import { fieldsOf } from '../../core'
import { ACTIVITY_KEY, ACTIVITY_LIMIT, activityOf, clearActivity, readActivity, recordActivity, sanitizeActivity, withEntry, type ActivityEntry } from './adminActivity'

afterEach(() => localStorage.clear())

const before = fieldsOf({ Name: 'Old', Genres: ['Drama'] })
const after = { ...before, name: 'New' }
const edit = { itemId: 'm1', itemName: 'New', kind: 'edit' as const, summary: 'Changed the title', changes: [{ key: 'name' as const, label: 'Title', before: 'Old', after: 'New' }], before, after }

describe('what an administrator changed from this browser', () => {
  it('starts empty, keeps the newest first and remembers the details an edit can be undone with', () => {
    expect(readActivity()).toEqual([])
    recordActivity(edit)
    recordActivity({ itemId: 'm2', itemName: 'Other', kind: 'refresh', summary: 'Refreshed' })
    const list = readActivity()
    expect(list.map((e) => e.itemId)).toEqual(['m2', 'm1'])
    expect(list[1]?.before?.name).toBe('Old')
    expect(activityOf(list, 'm1')).toHaveLength(1)
  })

  it('never grows past the limit', () => {
    for (let i = 0; i < ACTIVITY_LIMIT + 5; i += 1) recordActivity({ itemId: `m${i}`, itemName: 'x', kind: 'refresh', summary: 's' })
    expect(readActivity()).toHaveLength(ACTIVITY_LIMIT)
    expect(readActivity()[0]?.itemId).toBe(`m${ACTIVITY_LIMIT + 4}`)
  })

  it('can be cleared', () => {
    recordActivity(edit)
    clearActivity()
    expect(readActivity()).toEqual([])
    expect(localStorage.getItem(ACTIVITY_KEY)).toBeNull()
  })

  it('does not trust the storage: broken text, wrong shapes and unknown kinds are dropped', () => {
    localStorage.setItem(ACTIVITY_KEY, '{nope')
    expect(readActivity()).toEqual([])
    const good: ActivityEntry = { id: 'a', at: 1, itemId: 'm1', itemName: 'N', kind: 'refresh', summary: 's' }
    expect(sanitizeActivity([good, { ...good, kind: 'format-disk' }, { ...good, id: 5 }, null, 'x', { ...good, summary: 'x'.repeat(501) }])).toEqual([good])
    // An edit with damaged details loses its undo data but is still listed.
    const [entry] = sanitizeActivity([{ ...good, kind: 'edit', changes: [{ key: 'name', label: 'Title', before: 'a', after: 'b' }], before: { name: 1 }, after }])
    expect(entry).toMatchObject({ kind: 'edit' })
    expect(entry?.before).toBeUndefined()
    expect(sanitizeActivity('not a list')).toEqual([])
  })

  it('withEntry puts the new one first without changing the old list', () => {
    const list: ActivityEntry[] = [{ id: 'a', at: 1, itemId: 'm1', itemName: 'N', kind: 'refresh', summary: 's' }]
    const next = withEntry(list, { ...list[0], id: 'b' } as ActivityEntry)
    expect(next.map((e) => e.id)).toEqual(['b', 'a'])
    expect(list).toHaveLength(1)
  })
})
