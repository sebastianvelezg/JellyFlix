import { describe, expect, it } from 'vitest'
import { shareWhileRunning } from './inFlight'

describe('shareWhileRunning', () => {
  it('lets readers that ask at the same moment share one request, and asks again afterwards', async () => {
    const owner = {}
    let calls = 0
    const read = () => shareWhileRunning(owner, 'list', async () => ((calls += 1), calls))
    const [a, b] = await Promise.all([read(), read()])
    expect([a, b]).toEqual([1, 1])
    expect(await read()).toBe(2) // the first answer is not kept
  })

  it('does not share between owners or keys, and a failure is not kept either', async () => {
    let calls = 0
    const run = async () => (calls += 1)
    expect(await Promise.all([shareWhileRunning({}, 'a', run), shareWhileRunning({}, 'a', run), shareWhileRunning({}, 'b', run)])).toHaveLength(3)
    expect(calls).toBe(3)
    const owner = {}
    await expect(shareWhileRunning(owner, 'x', () => Promise.reject(new Error('down')))).rejects.toThrow('down')
    expect(await shareWhileRunning(owner, 'x', async () => 'back')).toBe('back')
  })
})
