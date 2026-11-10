import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../jellyfin'
import { restoreResumePosition } from './channelWatch'

const TICKS = 10_000_000
let held: { PlaybackPositionTicks?: number } | undefined
const getItem = vi.fn(async () => ({ data: held ?? {} }))
const updateItemUserData = vi.fn(async () => ({ data: {} }))

vi.mock('@jellyfin/sdk/lib/utils/api/user-data-api', () => ({ getUserDataApi: () => ({ getItemUserData: getItem, updateItemUserData }) }))

const session = { api: {}, userId: 'u1' } as unknown as Session

beforeEach(() => {
  getItem.mockClear()
  updateItemUserData.mockClear()
  getItem.mockImplementation(async () => ({ data: held ?? {} }))
  updateItemUserData.mockImplementation(async () => ({ data: {} }))
})

describe('putting back the place a title had before a channel touched it', () => {
  it('puts it back when the title is where the channel left it', async () => {
    held = { PlaybackPositionTicks: 1805 * TICKS }
    // The title was at 5 minutes before the channel; the channel played it up to 1800 s.
    expect(await restoreResumePosition(session, 'm1', 300 * TICKS, 1800, 6000)).toBe(true)
    expect(updateItemUserData).toHaveBeenCalledWith({ itemId: 'm1', userId: 'u1', updateUserItemDataDto: { PlaybackPositionTicks: 300 * TICKS } })
  })

  it('puts back "not started" for a title that had never been watched', async () => {
    held = { PlaybackPositionTicks: 600 * TICKS }
    expect(await restoreResumePosition(session, 'm1', 0, 610, 6000)).toBe(true)
    expect(updateItemUserData).toHaveBeenCalledWith(expect.objectContaining({ updateUserItemDataDto: { PlaybackPositionTicks: 0 } }))
  })

  it('leaves a program watched to the end alone (it counts as watched), without even asking', async () => {
    held = { PlaybackPositionTicks: 5900 * TICKS }
    expect(await restoreResumePosition(session, 'm1', 0, 5900, 6000)).toBe(false)
    expect(getItem).not.toHaveBeenCalled()
    expect(updateItemUserData).not.toHaveBeenCalled()
  })

  it('does not overwrite progress made somewhere else on the same title meanwhile', async () => {
    // The channel left it near 1800 s; another device has since taken it to 4000 s.
    held = { PlaybackPositionTicks: 4000 * TICKS }
    expect(await restoreResumePosition(session, 'm1', 300 * TICKS, 1800, 6000)).toBe(false)
    expect(updateItemUserData).not.toHaveBeenCalled()
  })

  it('does nothing when the title is already where it was before', async () => {
    held = { PlaybackPositionTicks: 300 * TICKS }
    expect(await restoreResumePosition(session, 'm1', 300 * TICKS, 1800, 6000)).toBe(false)
    expect(updateItemUserData).not.toHaveBeenCalled()
  })

  it('tolerates the little difference between where the player was and what it last reported', async () => {
    held = { PlaybackPositionTicks: 1750 * TICKS }
    expect(await restoreResumePosition(session, 'm1', 300 * TICKS, 1800, 6000)).toBe(true)
  })

  it('does not say anything when Jellyfin cannot be asked, or refuses', async () => {
    getItem.mockRejectedValueOnce(new Error('offline'))
    expect(await restoreResumePosition(session, 'm1', 300 * TICKS, 1800, 6000)).toBe(false)
    held = { PlaybackPositionTicks: 1800 * TICKS }
    updateItemUserData.mockRejectedValueOnce(new Error('refused'))
    expect(await restoreResumePosition(session, 'm1', 300 * TICKS, 1800, 6000)).toBe(false)
  })
})
