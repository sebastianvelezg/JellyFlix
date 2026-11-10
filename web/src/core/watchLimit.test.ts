import { describe, expect, it } from 'vitest'
import { decideAtEnd, NO_STREAK, sleepAfterMinutes, sleepSecondsLeft, sleepState, startOfPlayback, type SleepTimer, type Streak } from './watchLimit'

const NOW = 1_000_000

/** Plays `titles` titles in a row the way the player does: each starts, then ends and the next begins by itself. Returns what happened. */
function run(limit: number, titles: number, timer: SleepTimer | null = null, now = NOW) {
  let streak: Streak = startOfPlayback(NO_STREAK, 't1')
  const played: string[] = ['t1']
  for (let n = 1; n < titles; n += 1) {
    const next = `t${n + 1}`
    const decision = decideAtEnd({ streak, limit, timer, nextId: next, now })
    if (decision.action !== 'continue') return { played, decision }
    streak = startOfPlayback(decision.streak, next)
    played.push(next)
  }
  return { played, decision: decideAtEnd({ streak, limit, timer, nextId: `t${titles + 1}`, now }) }
}

describe('the still-watching limit', () => {
  it('does nothing when it is off', () => {
    const { played, decision } = run(0, 12)
    expect(played.length).toBe(12)
    expect(decision.action).toBe('continue')
  })

  it('asks before the title that would come after the limit', () => {
    const { played, decision } = run(3, 10)
    expect(played).toEqual(['t1', 't2', 't3'])
    expect(decision.action).toBe('ask')
  })

  it('counts the title a person started as the first', () => {
    // With a limit of 2: the one started by hand and one that began by itself, then the question.
    const { played, decision } = run(2, 5)
    expect(played).toEqual(['t1', 't2'])
    expect(decision.action).toBe('ask')
  })

  it('starts again when a person starts a title, whatever the count was', () => {
    const streak: Streak = { count: 7, pendingFor: null, startedFor: 'x' }
    expect(startOfPlayback(streak, 'other')).toEqual({ count: 1, pendingFor: null, startedFor: 'other' })
  })

  it('does not carry the run to a title that was not the one started by itself', () => {
    const decision = decideAtEnd({ streak: { count: 2, pendingFor: null, startedFor: 'a' }, limit: 5, timer: null, nextId: 'n1', now: NOW })
    if (decision.action !== 'continue') throw new Error('expected to continue')
    // Somebody opens another title instead of waiting for n1: that is a new run.
    expect(startOfPlayback(decision.streak, 'something else')).toEqual({ count: 1, pendingFor: null, startedFor: 'something else' })
    expect(startOfPlayback(decision.streak, 'n1')).toEqual({ count: 3, pendingFor: null, startedFor: 'n1' })
  })

  it('counting a start twice changes nothing (a screen drawn again)', () => {
    const once = startOfPlayback(NO_STREAK, 't1')
    expect(startOfPlayback(once, 't1')).toBe(once)
    const carried = startOfPlayback({ count: 2, pendingFor: 't2', startedFor: 't1' }, 't2')
    expect(startOfPlayback(carried, 't2')).toEqual({ count: 2, pendingFor: null, startedFor: 't2' })
  })

  it('after the answer "Keep watching" the next title begins a new run', () => {
    // The answer clears the run, and the title that follows is started on purpose.
    expect(startOfPlayback(NO_STREAK, 'n1')).toEqual({ count: 1, pendingFor: null, startedFor: 'n1' })
  })
})

describe('the sleep timer', () => {
  it('is running, then warns in the last half minute, then is due', () => {
    const timer = sleepAfterMinutes(15, NOW)
    expect(timer).toEqual({ kind: 'at', endsAt: NOW + 15 * 60_000 })
    if (timer.kind !== 'at') throw new Error()
    expect(sleepState(timer, NOW)).toBe('running')
    expect(sleepState(timer, NOW + 15 * 60_000 - 30_000)).toBe('warning')
    expect(sleepState(timer, NOW + 15 * 60_000)).toBe('due')
    expect(sleepSecondsLeft(timer, NOW + 15 * 60_000 - 1_500)).toBe(2)
    expect(sleepSecondsLeft(timer, NOW + 20 * 60_000)).toBe(0)
  })

  it('"at the end of this episode" stops there: the next one does not start, and no question is asked', () => {
    const { played, decision } = run(3, 4, { kind: 'episodeEnd' })
    expect(played).toEqual(['t1'])
    expect(decision.action).toBe('stop')
  })

  it('a timer that ran out during the countdown wins over the next title', () => {
    const timer = { kind: 'at', endsAt: NOW - 1 } as const
    expect(run(0, 3, timer).decision.action).toBe('stop')
  })

  it('a timer that has not run out yet lets the next title start', () => {
    const timer = { kind: 'at', endsAt: NOW + 60_000 } as const
    expect(run(0, 3, timer).decision.action).toBe('continue')
  })

  it('when the limit and the timer both apply, the timer stops it and there is only one outcome (no question)', () => {
    const timer = { kind: 'at', endsAt: NOW } as const
    // Limit reached at the same moment the timer ran out: stop, not ask.
    const decision = decideAtEnd({ streak: { count: 3, pendingFor: null, startedFor: 'a' }, limit: 3, timer, nextId: 'n', now: NOW })
    expect(decision.action).toBe('stop')
    // With the timer still running, the question comes alone.
    const later = decideAtEnd({ streak: { count: 3, pendingFor: null, startedFor: 'a' }, limit: 3, timer: { kind: 'at', endsAt: NOW + 600_000 }, nextId: 'n', now: NOW })
    expect(later.action).toBe('ask')
  })
})
