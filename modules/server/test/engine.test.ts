import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { activeBlock, buildRun, emptyState, generate, localParts, playable, type PoolItem } from '../src/modules/channels/engine.ts'

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

describe('settings of a marathon', () => {
  const aged = (n: number, year: number | undefined, source = 0): PoolItem => ({ ...movie(n, source), ...(year ? { year } : {}) })

  it('puts the oldest first, titles without a year last, and keeps the order of the sources within a year', () => {
    const pool = [aged(1, 1999), aged(2, undefined), aged(3, 1980), aged(4, 1999, 1), aged(5, 1975)]
    assert.deepEqual(buildRun(pool, 'oldest', 'x'), ['m5', 'm3', 'm1', 'm4', 'm2'])
  })

  it('gives a series the episodes in a row that were asked for, in order, and films one at a time', () => {
    const pool = [movie(1), movie(2), ...[1, 2, 3, 4, 5].map((n) => episode('A', n)), ...[1, 2, 3].map((n) => episode('B', n))]
    for (const row of [1, 2, 3, 9]) {
      const run = buildRun(pool, 'interleave', 'seed', row)
      assert.equal(run.length, pool.length)
      assert.equal(new Set(run).size, pool.length)
      for (const series of ['A', 'B']) {
        const mine = run.filter((id) => id.startsWith(`${series}e`))
        assert.deepEqual(mine, [...mine].sort()) // still in order
      }
    }
    // With 3 in a row the episodes of A come in a block of up to 3 (5 = 3 + 2), never apart by a film in the middle of a block.
    const run = buildRun(pool, 'interleave', 'seed', 3)
    const a = run.map((id, i) => (id.startsWith('Ae') ? i : -1)).filter((i) => i >= 0)
    assert.ok(a[1]! - a[0]! === 1 && a[2]! - a[1]! === 1)
    assert.deepEqual(buildRun(pool, 'interleave', 'seed'), buildRun(pool, 'interleave', 'seed', 1)) // one in a row is what it always was
  })

  it('leaves out titles longer than the limit, and ignores a limit that nothing meets', () => {
    const pool = [{ ...movie(1), runtime: 3600 }, { ...movie(2), runtime: 9000 }, { ...movie(3), runtime: 5400 }]
    assert.deepEqual(playable(pool, { maxMinutes: 90 }).map((i) => i.id), ['m1', 'm3'])
    assert.deepEqual(playable(pool, { maxMinutes: 0 }).map((i) => i.id), ['m1', 'm2', 'm3'])
    assert.deepEqual(playable(pool, {}).map((i) => i.id), ['m1', 'm2', 'm3'])
    assert.deepEqual(playable(pool, { maxMinutes: 10 }).map((i) => i.id), ['m1', 'm2', 'm3'])
    const out = generate({ def: { ...marathon, maxMinutes: 90 }, seed: 'c', pool, state: emptyState(), from: 0, until: 100_000 })
    assert.ok(out.programs.length > 0 && out.programs.every((p) => p.runtime <= 5400))
  })

  it('runs a stored channel that has none of the new settings', () => {
    const out = generate({ def: marathon, seed: 'c', pool: [movie(1), episode('A', 1)], state: emptyState(), from: 0, until: 20_000 })
    assert.ok(out.programs.length > 0)
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
