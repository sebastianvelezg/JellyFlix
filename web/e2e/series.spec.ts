import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { clickSeekAt, openSettings, player, signIn, startMock, video, waitPlaying } from './helpers'

/**
 * Series and anime against the mock server: browsing, the series page, playing episodes, the
 * "up next" hand-over and the per-series audio memory. As in the other specs, this proves the
 * client's behaviour, not compatibility with a real Jellyfin server.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const playing = (page: Page, title: string) => page.getByRole('region', { name: `Playing ${title}` })

/** Opens "Test Show 001" from the Series tab and starts it from the Play button. */
async function playFirstEpisode(page: Page) {
  await tabs(page).getByRole('button', { name: 'Series' }).click()
  await page.getByRole('region', { name: 'All series' }).getByRole('button', { name: /Open Test Show 001/ }).click()
  await expect(page.getByRole('heading', { name: 'Test Show 001', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Play S1 E1', exact: true }).click()
  await expect(playing(page, 'Test Show 001 · S1 E1 · Episode Title 1-1')).toBeVisible()
  await waitPlaying(page)
}

test('series: open from the Series tab, play, finish an episode, and go on to the next one', async ({ page }) => {
  mock = await startMock({ movieCount: 3, seriesCount: 2, animeCount: 1 })
  await signIn(page, mock)
  await expect(tabs(page).getByRole('button')).toHaveText(['Home', 'Movies', 'Series', 'Anime'])
  await playFirstEpisode(page)
  await expect(page).toHaveTitle('▶ Test Show 001 · S1 E1 · Episode Title 1-1')

  // Finishing the episode reports it as watched and offers the next one.
  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  const upNext = page.getByRole('status', { name: 'Up next' })
  await expect(upNext).toContainText('Episode Title 1-2')
  await expect(upNext).toContainText('Starting in')
  await upNext.getByRole('button', { name: 'Play now' }).click()
  await expect(playing(page, 'Test Show 001 · S1 E2 · Episode Title 1-2')).toBeVisible()
  await waitPlaying(page)
  expect(mock.user.played.has('s0001-ep-1-1')).toBe(true)
  await expect(page).toHaveURL(/#\/play\/s0001-ep-1-2$/)

  // Back goes to the series page (not to the previous episode), which now offers the second episode.
  await player(page).getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/#\/show\/s0001$/)
  await expect(page.getByRole('button', { name: 'Play S1 E2', exact: true })).toBeVisible()
})

test('series: the next episode starts by itself after a few seconds, unless cancelled', async ({ page }) => {
  mock = await startMock({ movieCount: 3, seriesCount: 1 })
  await signIn(page, mock)
  await playFirstEpisode(page)
  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  const upNext = page.getByRole('status', { name: 'Up next' })
  await upNext.getByRole('button', { name: 'Cancel' }).click()
  await expect(upNext).toHaveCount(0)
  await page.waitForTimeout(1500)
  await expect(page).toHaveURL(/#\/play\/s0001-ep-1-1$/) // still here
  // The next episode is still one click away in the controls.
  await page.getByRole('button', { name: /^Next episode: S1 E2/ }).click()
  await expect(playing(page, 'Test Show 001 · S1 E2 · Episode Title 1-2')).toBeVisible()
})

test('series: the countdown moves on to the next episode on its own', async ({ page }) => {
  mock = await startMock({ movieCount: 3, seriesCount: 1 })
  await signIn(page, mock)
  await playFirstEpisode(page)
  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText('Starting in')
  await expect(playing(page, 'Test Show 001 · S1 E2 · Episode Title 1-2')).toBeVisible({ timeout: 15_000 })
  await waitPlaying(page)
})

test('series: autoplay can be turned off, and the last episode has no next one', async ({ page }) => {
  mock = await startMock({ movieCount: 3, seriesCount: 1 })
  await signIn(page, mock)
  await playFirstEpisode(page)
  const settings = await openSettings(page)
  await settings.getByLabel('Play the next episode automatically').uncheck()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').autoplayNext)).toBe(false)
  await page.keyboard.press('Escape')
  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  const upNext = page.getByRole('status', { name: 'Up next' })
  await expect(upNext).toBeVisible()
  await expect(upNext).not.toContainText('Starting in')
  await expect(upNext.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

  // The last episode of the series has nothing after it.
  await page.goto('/#/play/s0001-ep-2-3')
  await expect(playing(page, 'Test Show 001 · S2 E3 · Episode Title 2-3')).toBeVisible()
  await waitPlaying(page)
  await expect(page.getByRole('button', { name: /Next episode/ })).toHaveCount(0)
  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  await expect(page.getByRole('status', { name: 'Up next' })).toHaveCount(0)
})

test('series: the audio language you pick is kept for the rest of the series', async ({ page }) => {
  mock = await startMock({ movieCount: 3, seriesCount: 2, playMode: 'hls' })
  await signIn(page, mock)
  await playFirstEpisode(page)
  const settings = await openSettings(page)
  await settings.getByLabel('Spanish · AAC Stereo').click()
  await expect
    .poll(() => mock.requests.some((r) => r.path === '/videos/s0001-ep-1-1/master.m3u8' && r.query.AudioStreamIndex === '2'))
    .toBe(true)
  await waitPlaying(page)

  // The next episode starts on the Spanish track without asking.
  await page.getByRole('button', { name: /^Next episode/ }).click()
  await expect(playing(page, 'Test Show 001 · S1 E2 · Episode Title 1-2')).toBeVisible()
  await expect
    .poll(() => mock.requests.some((r) => r.path === '/videos/s0001-ep-1-2/master.m3u8' && r.query.AudioStreamIndex === '2'))
    .toBe(true)
  await waitPlaying(page)
  const again = await openSettings(page)
  await expect(again.getByLabel('Spanish · AAC Stereo')).toBeChecked()
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.series') ?? '{}'))
  expect(prefs.s0001).toMatchObject({ audioLanguage: 'spa' })

  // Another series is not affected.
  await player(page).getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/#\/show\/s0001$/)
  await page.goto('/#/show/s0002')
  await page.getByRole('button', { name: 'Play S1 E1', exact: true }).click()
  await waitPlaying(page)
  const other = await openSettings(page)
  await expect(other.getByLabel('English · AAC Stereo')).toBeChecked()
})

test('anime: has its own tab and library, kept apart from series', async ({ page }) => {
  mock = await startMock({ movieCount: 3, seriesCount: 1, animeCount: 2 })
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Anime' }).click()
  await expect(page).toHaveURL(/#\/anime$/)
  const grid = page.getByRole('region', { name: 'All series' })
  await expect(grid.getByRole('button', { name: /Open Test Anime 001/ })).toBeVisible()
  await expect(grid.getByRole('button', { name: /Open Test Show/ })).toHaveCount(0)
  await grid.getByRole('button', { name: /Open Test Anime 002/ }).click()
  await expect(page.getByRole('heading', { name: 'Test Anime 002', level: 1 })).toBeVisible()
  // Back returns to the anime page, with the tab still selected.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/#\/anime$/)
  await expect(tabs(page).getByRole('button', { name: 'Anime' })).toHaveAttribute('aria-current', 'page')
})

test('series: the layout works on a phone-sized screen (tabs in a bar at the bottom)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  mock = await startMock({ movieCount: 3, seriesCount: 2, animeCount: 1 })
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Series' }).click()
  await expect(page.getByRole('region', { name: 'All series' }).getByRole('button', { name: /Open Test Show 001/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const header = await page.locator('header').boundingBox()
  const tabsBox = await tabs(page).boundingBox()
  expect(tabsBox && header && header.height < 80 && Math.abs(tabsBox.y + tabsBox.height - 800) < 2).toBe(true)
  await page.getByRole('region', { name: 'All series' }).getByRole('button', { name: /Open Test Show 001/ }).click()
  await expect(page.getByRole('button', { name: 'Play S1 E1', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Season 2' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('series: the "Play on…" list opens above the description and can be clicked', async ({ page }) => {
  mock = await startMock({ movieCount: 3, seriesCount: 2 })
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Series' }).click()
  await page.getByRole('region', { name: 'All series' }).getByRole('button', { name: /Open Test Show 001/ }).click()
  await expect(page.getByRole('heading', { name: 'Test Show 001', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Play on…' }).first().click()
  const item = page.getByRole('menuitem', { name: /Living room TV/ })
  await expect(item).toBeVisible()
  // The click only goes through when nothing (the description under the buttons) covers the list.
  await item.click({ timeout: 3000 })
  await expect.poll(() => mock.remoteLog.some((l) => / play /.test(l))).toBe(true)
})
