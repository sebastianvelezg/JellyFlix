import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { JellyfinClient } from '../src/jellyfin/client.ts'
import { loadPool, POOL_LIMIT, type Reader } from '../src/modules/channels/pool.ts'

const TICKS = 10_000_000

/** A Jellyfin that gives `perRule` films for every rule, with ids that are never the same twice, and one film for each id asked for. */
function reader(perRule: number): { reader: Reader; asked: string[][] } {
  const asked: string[][] = []
  let next = 0
  const jellyfin = {
    get: async (_path: string, _token: string, query: Record<string, unknown>) => {
      if (Array.isArray(query.ids)) {
        asked.push(query.ids as string[])
        return { Items: (query.ids as string[]).map((id) => ({ Id: id, Name: `Film ${id}`, Type: 'Movie', RunTimeTicks: 90 * 60 * TICKS, ProductionYear: 2000 })) }
      }
      return { Items: Array.from({ length: perRule }, () => ({ Id: `r${(next += 1)}`, Name: 'Film', Type: 'Movie', RunTimeTicks: 90 * 60 * TICKS })) }
    },
  } as unknown as JellyfinClient
  return { reader: { jellyfin, token: 't', userId: 'u' }, asked }
}

const rule = (name: string) => ({ kind: 'rule' as const, name, genres: [], types: ['Movie' as const] })

describe('reading the sources of a channel', () => {
  it('asks for plain films in batches of 50, keeping the order and the year', async () => {
    const { reader: r, asked } = reader(0)
    const ids = Array.from({ length: 120 }, (_, i) => `a${i}`)
    const { items, warnings } = await loadPool(r, ids.map((id) => ({ kind: 'item' as const, id, name: id })))
    assert.deepEqual(asked.map((a) => a.length), [50, 50, 20])
    assert.deepEqual(items.map((i) => i.id), ids)
    assert.deepEqual(items.map((i) => i.source), ids.map((_, i) => i))
    assert.equal(items[0]?.year, 2000)
    assert.deepEqual(warnings, [])
  })

  it('asks for the same film once even if it is picked twice', async () => {
    const { reader: r, asked } = reader(0)
    const { items } = await loadPool(r, [{ kind: 'item', id: 'x1', name: 'A' }, { kind: 'item', id: 'x1', name: 'A again' }])
    assert.deepEqual(asked, [['x1']])
    assert.equal(items.length, 2) // each source gave it; the schedule maker shows it once
  })

  it('keeps up to the limit of titles, says where it stopped, and does not read the rest', async () => {
    const { reader: r } = reader(9000)
    const { items, warnings } = await loadPool(r, [rule('One'), rule('Two'), rule('Three'), rule('Four')])
    assert.equal(items.length, POOL_LIMIT)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] as string, /left out/)
  })
})
