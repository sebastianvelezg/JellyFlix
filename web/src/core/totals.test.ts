// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Lists no longer count everything by themselves (see `withoutTotals` in jellyfin.ts), so every place that reads a total must say
 * it wants one. This fails when a file starts to read `TotalRecordCount` and never asks for it (the counts would come back as the size of the
 * page: "16 of 16"). The tests of each list check that it gets the right total.
 */
describe('totals', () => {
  const dir = new URL('.', import.meta.url)
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  it('every list that is read for its total asks for it', () => {
    const readers = files.filter((f) => /\.TotalRecordCount/.test(readFileSync(new URL(f, dir), 'utf8')))
    expect(readers.length).toBeGreaterThan(3) // (the check itself is looking at something)
    for (const file of readers) {
      const text = readFileSync(new URL(file, dir), 'utf8')
      const asks = (text.match(/enableTotalRecordCount: (true|\w+\.withTotal \?\? true)/g) ?? []).length
      expect(asks, `${file} reads a total but never asks the server for one`).toBeGreaterThanOrEqual(1)
    }
  })
})
