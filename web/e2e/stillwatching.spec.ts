import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { clickSeekAt, openSettings, signIn, startMock, video, waitPlaying } from './helpers'

/**
 * "Are you still watching?" after a number of titles that began by themselves, and the sleep timer, in real Chrome against the mock
 * server (a collection plays on from one title to the next). The rules themselves are tested in core/watchLimit.test.ts.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const playing = (page: Page, title: string) => page.getByRole('region', { name: `Playing ${title}` })
const question = (page: Page) => page.getByRole('alertdialog', { name: 'Are you still watching?' })

async function endOfTitle(page: Page) {
  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
}

async function setUp(page: Page, after: number) {
  mock = await startMock({ movieCount: 6, collections: 2 })
  await signIn(page, mock)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Playback' }).click()
  await page.getByLabel('Ask “Are you still watching?”').selectOption(String(after))
  // A short countdown keeps the test quick.
  await page.getByLabel('Countdown before the next title').selectOption('3')
}

test('still watching: after the limit the next title waits for an answer, and Keep watching starts it with a new count', async ({ page }) => {
  await setUp(page, 2)
  await page.goto('/#/play/m0001?collection=bx0001')
  await waitPlaying(page)
  await endOfTitle(page)
  // The first title was started by hand and the second begins by itself: nothing is asked yet.
  await expect(playing(page, 'Test Movie 002')).toBeVisible({ timeout: 15_000 })
  await waitPlaying(page)
  await endOfTitle(page)

  // Two in a row: the third does not begin until somebody says so.
  await expect(question(page)).toBeVisible({ timeout: 15_000 })
  await expect(question(page)).toContainText('2 titles have played in a row')
  await page.waitForTimeout(3500)
  await expect(page).toHaveURL(/#\/play\/m0002\?collection=bx0001$/)

  await question(page).getByRole('button', { name: 'Keep watching' }).click()
  await expect(playing(page, 'Test Movie 003')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/#\/play\/m0003\?collection=bx0001$/)
})

test('still watching: Stop leaves the player, and the position of the title is already saved', async ({ page }) => {
  await setUp(page, 2)
  await page.goto('/#/play/m0001?collection=bx0001')
  await waitPlaying(page)
  await endOfTitle(page)
  await expect(playing(page, 'Test Movie 002')).toBeVisible({ timeout: 15_000 })
  await waitPlaying(page)
  await endOfTitle(page)
  await question(page).getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('region', { name: /^Playing / })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Stopped.' })).toBeVisible()
})

test('still watching: a title started by hand begins a new count', async ({ page }) => {
  await setUp(page, 2)
  await page.goto('/#/play/m0001?collection=bx0001')
  await waitPlaying(page)
  await endOfTitle(page)
  await expect(playing(page, 'Test Movie 002')).toBeVisible({ timeout: 15_000 })
  // Somebody opens a title themself instead of answering a question that has not even come: the count starts again.
  await page.goto('/#/play/m0001?collection=bx0001')
  await waitPlaying(page)
  await endOfTitle(page)
  await expect(playing(page, 'Test Movie 002')).toBeVisible({ timeout: 15_000 })
  await expect(question(page)).toHaveCount(0)
})

test('still watching: with the limit off (the default) titles go on and on as before', async ({ page }) => {
  await setUp(page, 0)
  await page.goto('/#/play/m0001?collection=bx0001')
  await waitPlaying(page)
  await endOfTitle(page)
  await expect(playing(page, 'Test Movie 002')).toBeVisible({ timeout: 15_000 })
  await waitPlaying(page)
  await endOfTitle(page)
  await expect(playing(page, 'Test Movie 003')).toBeVisible({ timeout: 15_000 })
  await expect(question(page)).toHaveCount(0)
})

test('sleep timer: "At the end of this episode" stops there; nothing follows and nothing is asked', async ({ page }) => {
  await setUp(page, 2)
  await page.goto('/#/play/m0001?collection=bx0001')
  await waitPlaying(page)
  const menu = await openSettings(page)
  await menu.getByRole('button', { name: /Sleep timer/ }).click()
  await menu.getByLabel('At the end of this episode').check()
  await page.keyboard.press('Escape')
  // (The player is already gone when the end is reached, so this does not wait for the video to say it ended.)
  await clickSeekAt(page, 0.97)
  await expect(page.getByRole('status').filter({ hasText: 'Stopped at the end of the episode.' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('region', { name: /^Playing / })).toHaveCount(0)
  await expect(question(page)).toHaveCount(0)
})

test('sleep timer: a time can be chosen and the menu says how long is left', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const menu = await openSettings(page)
  await menu.getByRole('button', { name: /Sleep timer/ }).click()
  await menu.getByLabel('Stop in 15 minutes').check()
  await menu.getByRole('button', { name: 'Back to settings' }).click()
  await expect(menu.getByRole('button', { name: /Sleep timer/ })).toContainText('15 min left')
})
