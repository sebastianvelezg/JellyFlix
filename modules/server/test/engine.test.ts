import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { activeBlock, buildRun, emptyState, generate, localParts, type PoolItem } from '../src/modules/channels/engine.ts'

const movie = (n: number, source = 0): PoolItem => ({ id: `m${n}`, source, ord: n, name: `Film ${n}`, type: 'Movie', runtime: 6000 })
const episode = (series: string, n: number, source = 0): PoolItem => ({
  id: `${series}e${n}`,
  source,
  ord: n,
  name: `${series} ${n}`,
  type: 'Episode',
  seriesId: series,
  season: 1,
  episode: n,
  runtime: 1500,
})

const marathon = { mode: 'marathon' as const, order: 'interleave' as const, blocks: [], timezone: 'UTC', avoidRepeat: 3 }

describe('buildRun', () => {
  const pool = [movie(1), movie(2), episode('A', 1), episode('A', 2), episode('A', 3), episode('B', 1), episode('B', 2)]

  it('keeps each series in order when it mixes (interleave)', () => {
    const run = buildRun(pool, 'interleave', 'seed')
    assert.equal(run.length, pool.length)
    for (const series of ['A', 'B']) {
      const mine = run.filter((id) => id.startsWith(`${series}e`))
      assert.deepEqual(mine, [...mine].sort())
    }
  })

  it('is the same for the same seed and different for another', () => {
    assert.deepEqual(buildRun(pool, 'shuffle', 's1'), buildRun(pool, 'shuffle', 's1'))
    assert.notDeepEqual(buildRun(pool, 'shuffle', 's1'), buildRun(pool, 'shuffle', 's2'))
  })

  it('leaves out a title twice in the sources and one without a usable length', () => {
    const run = buildRun([movie(1), movie(1, 1), { ...movie(2), runtime: 0 }], 'sequential', 'x')
    assert.deepEqual(run, ['m1'])
  })
})

describe('generate (marathon)', () => {
  const pool = Array.from({ length: 6 }, (_, i) => movie(i + 1))

  it('makes programs one right after the other, with no gaps, until the time asked', () => {
    const out = generate({ def: marathon, seed: 'c', pool, state: emptyState(), from: 1000, until: 1000 + 6 * 6000 + 1 })
    assert.equal(out.programs[0]?.start, 1000)
    for (let i = 1; i < out.programs.length; i += 1) assert.equal(out.programs[i]?.start, out.programs[i - 1]?.end)
    assert.ok((out.programs.at(-1)?.end ?? 0) >= 1000 + 6 * 6000 + 1)
  })

  it('goes on where it stopped when run again with the state it gave', () => {
    const first = generate({ def: marathon, seed: 'c', pool, state: emptyState(), from: 0, until: 20_000 })
    const second = generate({ def: marathon, seed: 'c', pool, state: first.state, from: first.programs.at(-1)?.end ?? 0, until: 60_000 })
    const together = generate({ def: marathon, seed: 'c', pool, state: emptyState(), from: 0, until: 60_000 })
    assert.deepEqual([...first.programs, ...second.programs].map((p) => p.itemId), together.programs.slice(0, first.programs.length + second.programs.length).map((p) => p.itemId))
  })

  it('shows every title once before any is repeated', () => {
    const out = generate({ def: marathon, seed: 'c', pool, state: emptyState(), from: 0, until: 6 * 6000 })
    assert.equal(new Set(out.programs.slice(0, 6).map((p) => p.itemId)).size, 6)
  })

  it('makes nothing when there is nothing to show', () => {
    const out = generate({ def: marathon, seed: 'c', pool: [], state: emptyState(), from: 0, until: 9999 })
    assert.deepEqual(out.programs, [])
  })

  it('is deterministic', () => {
    const a = generate({ def: marathon, seed: 'c', pool, state: emptyState(), from: 0, until: 50_000 })
    const b = generate({ def: marathon, seed: 'c', pool, state: emptyState(), from: 0, until: 50_000 })
    assert.deepEqual(a, b)
  })
})

describe('time blocks', () => {
  // 2026-11-07 is a Saturday. 16:00 UTC.
  const saturday4pm = Date.UTC(2026, 10, 7, 16, 0) / 1000

  it('knows the day and minute in a time zone', () => {
    assert.deepEqual(localParts(saturday4pm, 'UTC'), { day: 6, minute: 16 * 60 })
    assert.deepEqual(localParts(saturday4pm, 'America/Bogota'), { day: 6, minute: 11 * 60 })
  })

  it('finds the block that covers a moment, including one that passes midnight', () => {
    const day = { days: [6], start: '16:00', end: '22:00', sources: [0] }
    const night = { days: [6], start: '23:00', end: '04:00', sources: [1] }
    assert.equal(activeBlock([day, night], saturday4pm, 'UTC'), day)
    assert.equal(activeBlock([day, night], saturday4pm - 3600, 'UTC'), null)
    const sundayAt2 = Date.UTC(2026, 10, 8, 2, 0) / 1000
    assert.equal(activeBlock([day, night], sundayAt2, 'UTC'), night)
  })

  it('draws a block’s programs only from its sources', () => {
    const pool = [...Array.from({ length: 5 }, (_, i) => movie(i + 1, 0)), ...Array.from({ length: 5 }, (_, i) => movie(i + 101, 1))]
    const def = { mode: 'grid' as const, order: 'interleave' as const, timezone: 'UTC', avoidRepeat: 2, blocks: [{ days: [6], start: '16:00', end: '22:00', sources: [1] }] }
    const out = generate({ def, seed: 'g', pool, state: emptyState(), from: saturday4pm, until: saturday4pm + 5 * 6000 })
    assert.ok(out.programs.length >= 3)
    assert.ok(out.programs.slice(0, 3).every((p) => Number(p.itemId.slice(1)) > 100))
  })

  it('does not repeat a title until avoidRepeat others have passed', () => {
    const pool = Array.from({ length: 6 }, (_, i) => movie(i + 1))
    const def = { mode: 'grid' as const, order: 'interleave' as const, timezone: 'UTC', avoidRepeat: 3, blocks: [] }
    const out = generate({ def, seed: 'r', pool, state: emptyState(), from: 0, until: 40 * 6000 })
    for (let i = 3; i < out.programs.length; i += 1) {
      const window = out.programs.slice(i - 3, i).map((p) => p.itemId)
      assert.ok(!window.includes(out.programs[i]!.itemId), `repeat at ${i}`)
    }
  })

  it('goes through a series in order in the grid', () => {
    const pool = [episode('A', 1), episode('A', 2), episode('A', 3), episode('A', 4)]
    const def = { mode: 'grid' as const, order: 'interleave' as const, timezone: 'UTC', avoidRepeat: 0, blocks: [] }
    const out = generate({ def, seed: 'r', pool, state: emptyState(), from: 0, until: 8 * 1500 })
    assert.deepEqual(out.programs.slice(0, 6).map((p) => p.itemId), ['Ae1', 'Ae2', 'Ae3', 'Ae4', 'Ae1', 'Ae2'])
  })
})
