import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { clickSeekAt, openSettings, player, signIn, startMock, video, waitPlaying } from './helpers'

/** Playing on from one title to the next (collections), the countdown, and cinema mode, in real Chrome against the mock server. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const playing = (page: import('@playwright/test').Page, title: string) => page.getByRole('region', { name: `Playing ${title}` })

test('collections: Play goes through the whole saga, with the countdown between titles', async ({ page }) => {
  mock = await startMock({ movieCount: 6, collections: 2 })
  await signIn(page, mock)
  await page.goto('/#/collection/bx0001')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page).toHaveURL(/#\/play\/m0001\?collection=bx0001$/)
  await waitPlaying(page)

  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  const upNext = page.getByRole('status', { name: 'Up next' })
  await expect(upNext).toContainText('Test Movie 002')
  await expect(upNext).toContainText('Starting in')
  // The bar under the card runs down with the seconds.
  await expect(upNext.getByTestId('countdown-bar')).toBeVisible()

  // It goes on by itself, staying inside the collection.
  await expect(playing(page, 'Test Movie 002')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/#\/play\/m0002\?collection=bx0001$/)
  await waitPlaying(page)

  // The last title of the collection has nothing after it.
  await page.goto('/#/play/m0003?collection=bx0001')
  await waitPlaying(page)
  await expect(page.getByRole('button', { name: /Next title|Next episode/ })).toHaveCount(0)
  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  await expect(page.getByRole('status', { name: 'Up next' })).toHaveCount(0)
})

test('the countdown length is a setting, and it is what the player counts from', async ({ page }) => {
  mock = await startMock({ movieCount: 6, collections: 2 })
  await signIn(page, mock)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Playback' }).click()
  await page.getByLabel('Countdown before the next title').selectOption('15')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').autoplayCountdown)).toBe(15)

  await page.goto('/#/play/m0001?collection=bx0001')
  await waitPlaying(page)
  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText('Starting in 15s')
  // It is still counting a few seconds later, not already gone to the next title.
  await page.waitForTimeout(2500)
  await expect(page).toHaveURL(/#\/play\/m0001\?collection=bx0001$/)
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText(/Starting in 1[0-3]s/)
})

test('cinema mode: fades in from black, the controls leave even while paused, and it can be switched in the player', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  // Off by default: no curtain, and pausing keeps the controls.
  await expect(page.getByTestId('curtain')).toHaveCount(0)

  const settings = await openSettings(page)
  await settings.getByLabel('Cinema mode').check()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').cinemaMode)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('curtain')).toHaveAttribute('data-down', 'false')

  // Paused: the controls show for a moment, then go (outside cinema mode they would stay).
  const stage = player(page)
  await stage.focus()
  await page.keyboard.press('k')
  await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  const back = stage.getByRole('button', { name: 'Back', exact: true })
  await expect(back).toBeVisible()
  await expect(stage.locator('div.pointer-events-none.opacity-0').first()).toBeAttached({ timeout: 6000 })
  await page.mouse.move(300, 300)
  await page.mouse.move(320, 320)
  await expect(stage.locator('div.pointer-events-none.opacity-0')).toHaveCount(0)
})

test('cinema mode: a title started with it on lifts the curtain once it plays', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.evaluate(() => localStorage.setItem('jellyflix.player', JSON.stringify({ cinemaMode: true })))
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  await expect(page.getByTestId('curtain')).toHaveAttribute('data-down', 'false')
})
