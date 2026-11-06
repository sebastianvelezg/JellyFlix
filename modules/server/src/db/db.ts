import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

/** One step of the schema. Steps are only ever added at the end; a step that has run is never edited. */
const MIGRATIONS: string[] = [
  // 1: channels
  `
  CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    def TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '{}',
    owner TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    pool_refreshed_at INTEGER
  );
  CREATE TABLE pool_items (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    source INTEGER NOT NULL,
    ord INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (channel_id, item_id, source)
  );
  CREATE TABLE programs (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    type TEXT NOT NULL,
    series_id TEXT,
    runtime INTEGER NOT NULL,
    PRIMARY KEY (channel_id, start)
  );
  CREATE INDEX programs_end ON programs (channel_id, end);
  `,
  // 2: match
  `
  CREATE TABLE match_rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE match_members (
    room_id TEXT NOT NULL REFERENCES match_rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );
  CREATE INDEX match_members_user ON match_members (user_id);
  `,
]

/** Opens (and creates) the database and brings its schema up to date. `path` may be ":memory:" for tests. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let step = row.user_version; step < MIGRATIONS.length; step += 1) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[step] as string)
      db.exec(`PRAGMA user_version = ${step + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return db
}

/** Runs `work` as one transaction (all or nothing). */
export function transaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
