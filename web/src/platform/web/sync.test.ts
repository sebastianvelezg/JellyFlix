import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../../test/mock/mockJellyfin'
import {
  connect,
  loadSyncText,
  parseSyncFile,
  readableSection,
  saveSyncText,
  serializeSyncFile,
  withSection,
  EMPTY_SYNC_FILE,
  type Session,
} from '../../core'
import { readAppearance, writeAppearance } from './appearance'
import { setStorageOwner } from './owner'
import { readPlayerPrefs, writePlayerPrefs } from './prefs'
import { disableSync, enableSync, previewActivation, readSyncState, runSync } from './sync'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 3 })
})
afterAll(() => mock.close())
beforeEach(async () => {
  session = await connect(mock.url, 'tester', 'secret')
  setStorageOwner(session.userId)
  // Start every test from an account with nothing synced.
  await saveSyncText(session, serializeSyncFile(EMPTY_SYNC_FILE))
})
afterEach(() => {
  setStorageOwner(null)
  localStorage.clear()
})

const account = async () => parseSyncFile((await loadSyncText(session)).text)

/** Another device (the TV) saving its choices on the account. */
async function otherDeviceSaves(sections: Record<string, { at: number; data: unknown; by?: string; v?: number }>) {
  let file = parseSyncFile((await loadSyncText(session)).text)
  for (const [name, s] of Object.entries(sections)) file = withSection(file, name as 'appearance', { v: s.v ?? 1, at: s.at, by: s.by ?? 'tv', data: s.data })
  await saveSyncText(session, serializeSyncFile(file))
}

describe('sync of preferences', () => {
  it('does nothing while it is off: nothing is read or written on the server', async () => {
    writeAppearance({ theme: { canvas: 'pine', accent: 'blue' } })
    const report = await runSync(session)
    expect(report).toMatchObject({ pushed: [], applied: [], error: null })
    expect((await account()).sections).toEqual({})
    expect(readSyncState().enabled).toBe(false)
  })

  it('turned on with an empty account, it uploads this device\'s choices, with who saved them', async () => {
    writeAppearance({ theme: { canvas: 'pine', accent: 'blue' } })
    expect((await previewActivation(session)).kind).toBe('upload')
    const report = await enableSync(session, 'upload')
    expect(report.pushed.sort()).toEqual(['appearance', 'playback'])
    const file = await account()
    expect(readableSection(file, 'appearance')).toMatchObject({ by: 'web', data: { theme: { canvas: 'pine' } } })
    expect(readSyncState().enabled).toBe(true)
  })

  it('a theme changed on the TV reaches this device, and what depends on the screen does not change', async () => {
    writeAppearance({ posterSize: 'large', density: 'compact', uiSize: 'large' })
    await enableSync(session, 'upload')
    await otherDeviceSaves({ appearance: { at: Date.now() + 60_000, data: { theme: { canvas: 'midnight', accent: 'violet' }, menu: { order: [], hidden: [] }, home: { banner: false, order: [], hidden: [] } } } })
    const report = await runSync(session)
    expect(report.applied).toEqual(['appearance'])
    const look = readAppearance()
    expect(look.theme.canvas).toBe('midnight')
    expect(look.home.banner).toBe(false)
    expect(look).toMatchObject({ posterSize: 'large', density: 'compact', uiSize: 'large' })
  })

  it('a change made here is sent, and is the newest on the account', async () => {
    await enableSync(session, 'upload')
    const before = readableSection(await account(), 'playback')?.at ?? 0
    writePlayerPrefs({ stillWatchingAfter: 4 })
    const report = await runSync(session)
    expect(report.pushed).toEqual(['playback'])
    const after = readableSection(await account(), 'playback')
    expect(after?.at).toBeGreaterThan(before)
    expect(after?.data).toMatchObject({ stillWatching: 4 })
  })

  it('when both sides changed, the later change wins, and a section lost says so', async () => {
    await enableSync(session, 'upload')
    writePlayerPrefs({ stillWatchingAfter: 3 })
    // The account got a newer copy than the change made here.
    await otherDeviceSaves({ playback: { at: Date.now() + 3_600_000, data: { autoplayNext: false, stillWatching: 8, skip: { intro: 'auto', recap: 'ask', outro: 'ask', preview: 'ask' } } } })
    const report = await runSync(session)
    expect(report.conflicts).toEqual(['playback'])
    expect(readPlayerPrefs()).toMatchObject({ autoplayNext: false, stillWatchingAfter: 8 })
    expect(readPlayerPrefs().skipActions.intro).toBe('auto')
  })

  it('the first time it asks when the account already has different choices, and each answer does what it says', async () => {
    await otherDeviceSaves({ appearance: { at: 5_000, data: { theme: { canvas: 'midnight', accent: 'violet' }, menu: { order: [], hidden: [] }, home: { banner: true, order: [], hidden: [] } } } })
    writeAppearance({ theme: { canvas: 'pine', accent: 'blue' } })
    const preview = await previewActivation(session)
    expect(preview).toMatchObject({ kind: 'ask', sections: [{ name: 'appearance', by: 'tv' }] })
    // Nothing was changed by asking.
    expect(readAppearance().theme.canvas).toBe('pine')

    await enableSync(session, 'use-account')
    expect(readAppearance().theme.canvas).toBe('midnight')

    disableSync()
    writeAppearance({ theme: { canvas: 'pine', accent: 'blue' } })
    await enableSync(session, 'upload')
    expect(readableSection(await account(), 'appearance')?.data).toMatchObject({ theme: { canvas: 'pine' } })
  })

  it('has nothing to ask when the account already holds the same choices', async () => {
    await enableSync(session, 'upload')
    disableSync()
    expect((await previewActivation(session)).kind).toBe('same')
  })

  it('keeps the menu buttons and rows only another kind of app has, when this device sends its order', async () => {
    await otherDeviceSaves({ appearance: { at: 5_000, data: { theme: { canvas: 'black', accent: 'blue' }, menu: { order: ['home', 'collections'], hidden: ['collections'] }, home: { banner: true, order: ['favorites', 'discover'], hidden: ['favorites'] } } } })
    await enableSync(session, 'use-account')
    writeAppearance({ home: { banner: false, order: readAppearance().home.order, hidden: readAppearance().home.hidden } })
    await runSync(session)
    const data = readableSection(await account(), 'appearance')?.data as { menu: { order: string[]; hidden: string[] }; home: { order: string[]; hidden: string[]; banner: boolean } }
    expect(data.home.banner).toBe(false)
    expect(data.menu.order).toContain('collections')
    expect(data.menu.hidden).toContain('collections')
    expect(data.home.order).toContain('favorites')
    expect(data.home.hidden).toContain('favorites')
  })

  it('leaves a section of a later format and any section it does not know exactly as they were', async () => {
    await otherDeviceSaves({ playback: { at: 5_000, v: 2, data: { future: true } }, extra: { at: 1, data: { keep: 'me' } } })
    await enableSync(session, 'upload')
    writeAppearance({ theme: { canvas: 'pine', accent: 'blue' } })
    await runSync(session)
    const file = await account()
    expect(file.sections.playback).toMatchObject({ v: 2, data: { future: true } })
    expect(file.sections.extra).toMatchObject({ data: { keep: 'me' } })
    expect(readableSection(file, 'appearance')?.data).toMatchObject({ theme: { canvas: 'pine' } })
  })

  it('reads what the TV app writes, byte for byte as the TV app wrote it', async () => {
    // Copied from a real run of the TV app (a theme chosen there, then Sync with my account).
    const fromTv = {
      theme: { canvas: 'midnight', accent: 'ocean' },
      menu: { order: ['home', 'movies', 'series', 'anime', 'musicvideos', 'books', 'livetv', 'music', 'collections'], hidden: [] },
      home: {
        banner: true,
        order: ['discover', 'continue', 'nextUp', 'newSinceVisit', 'upcoming', 'watchLater', 'playlists', 'because', 'latestMovies', 'favorites', 'collections', 'newSeries', 'newAnime', 'newMusicVideos', 'newBooks'],
        hidden: ['favorites'],
      },
    }
    await otherDeviceSaves({
      appearance: { at: 1_794_276_303_000, data: fromTv },
      playback: { at: 1_794_276_303_000, data: { autoplayNext: false, stillWatching: 3, skip: { intro: 'auto', recap: 'ask', outro: 'off', preview: 'ask' } } },
    })
    const report = await runSync(session)
    await enableSync(session, 'use-account')
    expect(report.error).toBeNull()
    expect(readAppearance().theme).toEqual({ canvas: 'midnight', accent: 'ocean' })
    expect(readPlayerPrefs()).toMatchObject({ autoplayNext: false, stillWatchingAfter: 3, skipActions: { intro: 'auto', outro: 'off' } })
    // Sending this device's order back does not lose what only the TV has.
    writeAppearance({ nav: 'icons', home: { banner: false, order: readAppearance().home.order, hidden: readAppearance().home.hidden } })
    await runSync(session)
    const data = readableSection(await account(), 'appearance')?.data as { menu: { order: string[] }; home: { order: string[]; hidden: string[] } }
    expect(data.menu.order).toContain('collections')
    expect(data.home.order).toContain('favorites')
    expect(data.home.hidden).toContain('favorites')
  })

  it('is kept for each account on this device', async () => {
    await enableSync(session, 'upload')
    expect(readSyncState().enabled).toBe(true)
    setStorageOwner('another-account')
    expect(readSyncState().enabled).toBe(false)
    setStorageOwner(session.userId)
    expect(readSyncState().enabled).toBe(true)
  })

  it('turning it off stops everything and keeps this device\'s choices', async () => {
    writeAppearance({ theme: { canvas: 'pine', accent: 'blue' } })
    await enableSync(session, 'upload')
    disableSync()
    writePlayerPrefs({ stillWatchingAfter: 6 })
    await runSync(session)
    expect(readableSection(await account(), 'playback')?.data).not.toMatchObject({ stillWatching: 6 })
    expect(readAppearance().theme.canvas).toBe('pine')
  })

  it('a run whose account was left while the server answered changes nothing for the account that came after', async () => {
    writeAppearance({ theme: { canvas: 'pine', accent: 'blue' } })
    await enableSync(session, 'upload')
    await otherDeviceSaves({ appearance: { at: Date.now() + 60_000, data: { theme: { canvas: 'midnight', accent: 'violet' }, menu: { order: [], hidden: [] }, home: { banner: true, order: [], hidden: [] } } } })
    const run = runSync(session)
    // Another account signs in on this browser before the answer arrives.
    setStorageOwner('another-account')
    const report = await run
    expect(report).toMatchObject({ applied: [], pushed: [], conflicts: [] })
    expect(readAppearance().theme.canvas).toBe('pine')
    expect(readSyncState().enabled).toBe(false)
    setStorageOwner(session.userId)
    expect(readSyncState().enabled).toBe(true)
  })

  it('turning it off while a run is in flight does not turn it back on', async () => {
    await enableSync(session, 'upload')
    const run = runSync(session)
    disableSync()
    await run
    expect(readSyncState().enabled).toBe(false)
  })
})
