import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock, waitPlaying } from './helpers'

/**
 * Live TV against the mock server: the tab, the channels with what is on, favorites, the guide, and watching a channel (a stream the
 * server opens, with no seeking, reported like any other playback). As in the other specs, this proves the client's behaviour, not
 * compatibility with a real Jellyfin server or tuner.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const watching = (page: Page, title: string) => page.getByRole('region', { name: `Watching ${title}` })

async function openLiveTv(page: Page) {
  await tabs(page).getByRole('button', { name: 'Live TV' }).click()
  await expect(page).toHaveURL(/#\/livetv$/)
}

test('live tv: a tab with the channels, what is on each, and favorites', async ({ page }) => {
  mock = await startMock({ movieCount: 3, liveTv: 3 })
  await signIn(page, mock)
  await expect(tabs(page).getByRole('button')).toHaveText(['Home', 'Movies', 'Series', 'Live TV'])
  await openLiveTv(page)
  await expect(page.getByRole('heading', { name: 'Live TV', level: 1 })).toBeVisible()
  const first = page.getByRole('button', { name: 'Watch 1 · Test Channel 01' })
  await expect(first).toBeVisible()
  await expect(first).toContainText(/Show 1-\d+/)
  await expect(page.getByRole('progressbar').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Watch 3 · Test Channel 03' })).toBeVisible()

  // A favorite is kept on the server and can be the only thing shown.
  await page.getByRole('button', { name: 'Add 2 · Test Channel 02 to favorites' }).click()
  await expect.poll(() => mock.user.favorites.has('ch0002')).toBe(true)
  await page.getByRole('button', { name: 'Favorites', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Watch 2 · Test Channel 02' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Watch 1 · Test Channel 01' })).toHaveCount(0)
})

test('live tv: a channel can be found by a part of its name or number, and nothing found says so', async ({ page }) => {
  mock = await startMock({ movieCount: 3, liveTv: 12 })
  await signIn(page, mock)
  await openLiveTv(page)
  const finder = page.getByRole('searchbox', { name: 'Find a channel' })
  await finder.fill('channel 07')
  await expect(page.getByRole('button', { name: 'Watch 7 · Test Channel 07' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Watch/ })).toHaveCount(1)
  await finder.fill('zzz')
  await expect(page.getByText('No channel matches "zzz".')).toBeVisible()
  await finder.fill('')
  await expect(page.getByRole('button', { name: /^Watch/ }).first()).toBeVisible()
})

test('live tv: the guide shows the programmes of each channel and what is chosen can be watched', async ({ page }) => {
  mock = await startMock({ movieCount: 3, liveTv: 3 })
  await signIn(page, mock)
  await openLiveTv(page)
  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  const row = page.getByRole('list', { name: 'Test Channel 02' })
  const blocks = row.getByRole('listitem')
  await expect.poll(() => blocks.count()).toBeGreaterThanOrEqual(6)
  // A programme in the future can be read about; Watch takes you to its channel.
  await blocks.last().click()
  const details = page.getByRole('region', { name: 'Programme' })
  await expect(details).toContainText('Test Channel 02')
  await expect(details.getByRole('button', { name: 'Watch the channel' })).toBeVisible()
  await details.getByRole('button', { name: 'Watch the channel' }).click()
  await expect(page).toHaveURL(/#\/live\/ch0002$/)
})

test('live tv: watching a channel opens the stream, cannot be sought, changes channel and is reported', async ({ page }) => {
  mock = await startMock({ movieCount: 3, liveTv: 3 })
  await signIn(page, mock)
  await openLiveTv(page)
  await page.getByRole('button', { name: 'Watch 1 · Test Channel 01' }).click()
  await expect(page).toHaveURL(/#\/live\/ch0001$/)
  const shell = watching(page, '1 · Test Channel 01')
  await expect(shell).toBeVisible()
  await waitPlaying(page)
  await expect(shell.getByText('Live', { exact: true })).toBeVisible()
  await expect(shell.getByRole('slider', { name: 'Seek' })).toHaveCount(0)
  await expect(shell.getByText(/Show 1-\d+/)).toBeVisible()

  // The server was asked to open the stream and the reports say it is live.
  const ask = mock.requests.find((r) => r.path === '/Items/ch0001/PlaybackInfo')
  expect(ask?.body).toMatchObject({ AutoOpenLiveStream: true, EnableDirectPlay: false })
  await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing')).toBe(true)
  expect(mock.requests.find((r) => r.path === '/Sessions/Playing')?.body).toMatchObject({ ItemId: 'ch0001', LiveStreamId: 'live-ch0001', CanSeek: false })

  // Next channel (button and arrow key), going round at the end.
  await shell.getByRole('button', { name: 'Next channel' }).click()
  await expect(page).toHaveURL(/#\/live\/ch0002$/)
  await waitPlaying(page)
  await page.keyboard.press('ArrowUp')
  await expect(page).toHaveURL(/#\/live\/ch0001$/)
  await page.keyboard.press('ArrowUp')
  await expect(page).toHaveURL(/#\/live\/ch0003$/)
  await waitPlaying(page)

  // Leaving reports the stop and goes back to the channels.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Live TV', level: 1 })).toBeVisible()
  await expect
    .poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing/Stopped' && (r.body as { LiveStreamId?: string })?.LiveStreamId === 'live-ch0003'))
    .toBe(true)
})

test('live tv: no tab for an account without channels', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await expect(tabs(page).getByRole('button', { name: 'Live TV' })).toHaveCount(0)
})
