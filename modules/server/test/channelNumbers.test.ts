import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { openDb } from '../src/db/db.ts'

describe('the number of a channel', () => {
  it('cannot belong to two channels', () => {
    const db = openDb(':memory:')
    const add = (id: string, n: number) => db.prepare('INSERT INTO channels (id, number, name, def, owner, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, n, id, '{}', 'u')
    add('a', 7)
    assert.throws(() => add('b', 7), /UNIQUE constraint failed: channels\.number/)
  })

  it('is made unique, without stopping the container, for a database that already has two channels with one number', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jf-'))
    const file = join(dir, 'modules.db')
    try {
      const before = openDb(file)
      before.exec('DROP INDEX channels_number')
      before.exec('PRAGMA user_version = 3')
      const add = (id: string, n: number) => before.prepare('INSERT INTO channels (id, number, name, def, owner, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, n, id, JSON.stringify({ number: n }), 'u')
      add('a', 7)
      add('b', 7)
      add('c', 7)
      add('d', 12)
      before.close()
      const after = openDb(file)
      const rows = after.prepare('SELECT id, number, def FROM channels ORDER BY rowid').all() as Array<{ id: string; number: number; def: string }>
      assert.deepEqual(rows.map((r) => [r.id, r.number]), [['a', 7], ['b', 13], ['c', 14], ['d', 12]])
      assert.equal((JSON.parse(rows[1]!.def) as { number: number }).number, 13)
      after.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
