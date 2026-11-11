import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDb } from '../src/db/db.ts'
import { HttpError, type AuthUser } from '../src/http/router.ts'
import type { JellyfinClient } from '../src/jellyfin/client.ts'
import { createMatchService } from '../src/modules/match/service.ts'

const HOST: AuthUser = { id: 'u-host', name: 'Host', isAdmin: true, token: 'tok-host' }
const BEN: AuthUser = { id: 'u-ben', name: 'Ben', isAdmin: false, token: 'tok-ben' }

/** A library of 300 films, and a Jellyfin that remembers how many ids each question carried. */
function library(hasServiceKey: boolean) {
  const films = Array.from({ length: 300 }, (_, i) => ({ Id: `m${String(i).padStart(3, '0')}`, Name: `Film ${i}`, Type: 'Movie', RunTimeTicks: 100 * 60 * 10_000_000 }))
  const asked: number[] = []
  const jellyfin: JellyfinClient = {
    hasServiceKey,
    async get<T>(): Promise<T> {
      return { Items: films } as T
    },
    async getAsService<T>(_path: string, query?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
      const ids = (query?.ids ?? []) as string[]
      asked.push(ids.length)
      return { Items: films.filter((f) => ids.includes(f.Id)) } as T
    },
  }
  return { jellyfin, asked }
}

describe('Match asks Jellyfin about the other people in small batches', () => {
  it('never puts more than 50 ids in one question, even for 300 candidates', async () => {
    const { jellyfin, asked } = library(true)
    const match = createMatchService(openDb(':memory:'), jellyfin)
    const lobby = await match.create(HOST, { mode: 'phones', deckSize: 6, series: true }, 1_800_000_000)
    match.join(BEN, lobby.code, 1_800_000_000)
    const started = await match.start(HOST, lobby.id, 1_800_000_000)
    assert.equal(started.deck.length, 6)
    assert.ok(asked.length >= 6, 'it asked about 300 films, in several questions')
    assert.ok(Math.max(...asked) <= 50, `the biggest question carried ${Math.max(...asked)} ids`)
  })
})

describe('Match on phones without the container\'s own key', () => {
  it('is refused, with a message that says what is missing; a Match on one device still works', async () => {
    const { jellyfin } = library(false)
    const match = createMatchService(openDb(':memory:'), jellyfin)
    await assert.rejects(match.create(HOST, { mode: 'phones', deckSize: 6 }, 1_800_000_000), (e: unknown) => e instanceof HttpError && e.status === 409 && /JELLYFIN_API_KEY/.test(e.message))
    const local = await match.create(HOST, { mode: 'local', deckSize: 6 }, 1_800_000_000)
    assert.equal(local.phase, 'swipe')
  })
})
