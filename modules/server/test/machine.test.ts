import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MatchCard } from '../../contract/index.ts'
import { addMember, advance, newRoom, pick, removeMember, restart, RuleError, startRound, startSwiping, viewFor, vote, type RoomData } from '../src/modules/match/machine.ts'

const card = (id: string): MatchCard => ({ id, name: id, kind: 'Movie', genres: [] })
const deck = (...ids: string[]): MatchCard[] => ids.map(card)
const ME = { id: 'me', name: 'Me' }
const BEN = { id: 'ben', name: 'Ben' }

function room(cards: MatchCard[]): RoomData {
  return addMember(newRoom({ id: 'r1', code: 'ABCDE', creator: ME, mode: 'local', deck: cards, deckSize: cards.length }), BEN)
}

function swipeAll(r: RoomData, who: string, likes: string[]): RoomData {
  let out = r
  for (const c of r.deck) out = vote(out, who, c.id, likes.includes(c.id) ? 'like' : 'pass')
  return out
}

describe('Match rules', () => {
  it('waits until everybody has voted on every card', () => {
    let r = room(deck('a', 'b', 'c'))
    r = swipeAll(r, 'me', ['a'])
    assert.equal(advance(r).kind, 'waiting')
    r = vote(r, 'ben', 'a', 'like')
    assert.equal(advance(r).kind, 'waiting')
  })

  it('ends a round with one person in the room (a Match on one device)', () => {
    const alone = swipeAll(newRoom({ id: 'r', code: 'X', creator: ME, mode: 'local', deck: deck('a', 'b'), deckSize: 2 }), 'me', ['a'])
    const step = advance(alone)
    assert.equal(step.kind, 'next')
    assert.equal(step.room.phase, 'done')
    assert.equal(step.room.winner?.id, 'a')
  })

  it('a Match for phones waits in a lobby, without cards and members, until the host starts it with somebody in', () => {
    const lobby = newRoom({ id: 'r', code: 'X', creator: ME, mode: 'phones', deck: deck('a', 'b', 'c', 'd'), deckSize: 4 })
    assert.equal(lobby.phase, 'lobby')
    assert.deepEqual(lobby.members, [])
    assert.deepEqual(lobby.deck, [])
    assert.throws(() => vote(addMember(lobby, BEN), 'ben', 'a', 'like'), RuleError)
    assert.equal(advance(addMember(lobby, BEN)).kind, 'waiting')
    assert.throws(() => startSwiping(lobby, deck('a', 'b', 'c', 'd')), /Nobody has joined/)
    const started = startSwiping(addMember(lobby, BEN), deck('a', 'b', 'c', 'd'))
    assert.equal(started.phase, 'swipe')
    assert.deepEqual(started.deck.map((c) => c.id), ['a', 'b', 'c', 'd'])
    assert.throws(() => startSwiping(started, deck('x')), /already started/)
    // The host did not join, so only Ben has to vote.
    const done = swipeAll(started, 'ben', ['b'])
    assert.equal(advance(done).room.winner?.id, 'b')
    // In the lobby the view has no cards.
    const view = viewFor(addMember(lobby, BEN), 'ben', 1)
    assert.equal(view.phase, 'lobby')
    assert.equal(view.mode, 'phones')
    assert.equal(view.hostId, 'me')
    assert.deepEqual(view.remaining, [])
  })

  it('has a winner when only one film was liked by both', () => {
    let r = room(deck('a', 'b', 'c'))
    r = swipeAll(r, 'me', ['a', 'b'])
    r = swipeAll(r, 'ben', ['b', 'c'])
    const step = advance(r)
    assert.equal(step.room.phase, 'done')
    assert.equal(step.room.winner?.id, 'b')
    assert.equal(step.room.winnerBy, 'agreement')
  })

  it('runs another round with just the films both liked, when there are several', () => {
    let r = room(deck('a', 'b', 'c', 'd'))
    r = swipeAll(r, 'me', ['a', 'b', 'c'])
    r = swipeAll(r, 'ben', ['a', 'b', 'd'])
    const step = advance(r)
    assert.equal(step.kind, 'next')
    assert.equal(step.room.phase, 'swipe')
    assert.equal(step.room.round, 2)
    assert.deepEqual(step.room.deck.map((c) => c.id), ['a', 'b'])
    assert.deepEqual(step.room.votes, {})
  })

  it('asks for a fresh set when nothing was liked by both', () => {
    let r = room(deck('a', 'b'))
    r = swipeAll(r, 'me', ['a'])
    r = swipeAll(r, 'ben', ['b'])
    const step = advance(r)
    assert.equal(step.kind, 'needs-fresh')
    const next = startRound(step.room, deck('x', 'y'))
    assert.equal(next.round, 2)
    assert.deepEqual(next.seen, ['a', 'b', 'x', 'y'])
  })

  it('goes to choosing a favourite when everybody liked everything', () => {
    let r = room(deck('a', 'b'))
    r = swipeAll(r, 'me', ['a', 'b'])
    r = swipeAll(r, 'ben', ['a', 'b'])
    const step = advance(r)
    assert.equal(step.room.phase, 'pick')
    assert.deepEqual(step.room.deck.map((c) => c.id), ['a', 'b'])
  })

  it('settles a pick by agreement, or by chance when the picks differ', () => {
    const base: RoomData = { ...room(deck('a', 'b')), phase: 'pick' }
    const same = advance(pick(pick(base, 'me', 'a'), 'ben', 'a'))
    assert.equal(same.room.winner?.id, 'a')
    assert.equal(same.room.winnerBy, 'agreement')
    const differ = advance(pick(pick(base, 'me', 'a'), 'ben', 'b'))
    assert.equal(differ.room.phase, 'done')
    assert.equal(differ.room.winnerBy, 'coin')
    assert.ok(['a', 'b'].includes(differ.room.winner?.id ?? ''))
  })

  it('hides the other person’s votes and shows only what is left for me', () => {
    let r = room(deck('a', 'b', 'c'))
    r = vote(vote(r, 'me', 'a', 'like'), 'ben', 'b', 'pass')
    const mine = viewFor(r, 'me', 1)
    assert.deepEqual(mine.myVotes, { a: 'like' })
    assert.deepEqual(mine.remaining.map((c) => c.id), ['b', 'c'])
    assert.equal(JSON.stringify(mine).includes('"pass"'), false)
  })

  it('refuses votes from outsiders, for cards not in the round and in the wrong phase', () => {
    const r = room(deck('a', 'b'))
    assert.throws(() => vote(r, 'eve', 'a', 'like'), RuleError)
    assert.throws(() => vote(r, 'me', 'zzz', 'like'), RuleError)
    assert.throws(() => pick(r, 'me', 'a'), RuleError)
  })

  it('lets the room go on when the person who was missing leaves', () => {
    let r = room(deck('a', 'b'))
    r = swipeAll(r, 'me', ['a'])
    assert.equal(advance(r).kind, 'waiting')
    r = removeMember(r, 'ben')
    const step = advance(r)
    assert.equal(step.kind, 'next')
    assert.equal(step.room.winner?.id, 'a')
  })

  it('starts again after a winner with a fresh set', () => {
    let r = room(deck('a', 'b'))
    r = swipeAll(r, 'me', ['a'])
    r = swipeAll(r, 'ben', ['a'])
    const done = advance(r).room
    const again = restart(done, deck('x', 'y'))
    assert.equal(again.phase, 'swipe')
    assert.equal(again.round, 1)
    assert.equal(again.winner, undefined)
  })
})
