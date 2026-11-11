import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../core'
import { doneWatching, markWatching, noteWatched, PENDING_STALE_SECONDS, restoreLeftOver } from './channelPending'

const TICKS = 10_000_000
let held: { PlaybackPositionTicks?: number } | undefined
const getItem = vi.fn(async () => ({ data: held ?? {} }))
const updateItemUserData = vi.fn(async () => ({ data: {} }))

vi.mock('@jellyfin/sdk/lib/utils/api/user-data-api', () => ({ getUserDataApi: () => ({ getItemUserData: getItem, updateItemUserData }) }))

const session = { api: {}, userId: 'u1' } as unknown as Session

beforeEach(() => {
  getItem.mockClear()
  updateItemUserData.mockClear()
})

describe('a restore the page did not get to do', () => {
  beforeEach(() => localStorage.clear())

  it('is done on the next visit, from where the channel last said it was', async () => {
    markWatching('u1', 'm1', 300 * TICKS, 6000, 1000)
    noteWatched('u1', 'm1', 1800, 1500)
    held = { PlaybackPositionTicks: 1805 * TICKS }
    expect(await restoreLeftOver(session, 1500 + PENDING_STALE_SECONDS + 1)).toBe(1)
    expect(updateItemUserData).toHaveBeenCalledWith({ itemId: 'm1', userId: 'u1', updateUserItemDataDto: { PlaybackPositionTicks: 300 * TICKS } })
    // Once is enough.
    updateItemUserData.mockClear()
    expect(await restoreLeftOver(session, 5000)).toBe(0)
    expect(updateItemUserData).not.toHaveBeenCalled()
  })

  it('leaves alone a title that is being watched right now (its entry is fresh) and one that was put back already', async () => {
    markWatching('u1', 'm1', 300 * TICKS, 6000, 1000)
    held = { PlaybackPositionTicks: 5 * TICKS }
    expect(await restoreLeftOver(session, 1000 + 10)).toBe(0)
    expect(getItem).not.toHaveBeenCalled()
    doneWatching('u1', 'm1')
    expect(await restoreLeftOver(session, 9999)).toBe(0)
    expect(getItem).not.toHaveBeenCalled()
  })

  it('does not touch what another person left on this device', async () => {
    markWatching('u2', 'm1', 300 * TICKS, 6000, 1000)
    expect(await restoreLeftOver(session, 9999)).toBe(0)
    expect(getItem).not.toHaveBeenCalled()
  })
})
