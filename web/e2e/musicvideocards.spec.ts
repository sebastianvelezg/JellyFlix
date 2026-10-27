import { expect, test, type Locator, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { clickSeekAt, player, signIn, startMock, waitPlaying } from './helpers'

/**
 * A music video's card: the card opens its page, the round play button in the middle of the picture plays it, and whatever it is played
 * from (a row, a grid, a folder) goes on with the next video of it. Real Chrome against the mock server.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const options = { movieCount: 3, musicVideos: 7, musicVideoFolders: 2 }
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const playing = (page: Page, title: string) => page.getByRole('region', { name: `Playing ${title}` })

/** The names of the videos in a row or grid, in the order shown. */
const names = async (where: Locator) =>
  (await where.getByRole('button', { name: /^Open Test Music Video/ }).evaluateAll((els) => els.map((e) => /Test Music Video \d+/.exec(e.getAttribute('aria-label') ?? '')?.[0] ?? '')))

test('the card opens the title, the play button in the middle of its picture plays it', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music videos' }).click()
  const all = page.getByRole('region', { name: 'All music videos' })

  const card = all.getByRole('button', { name: /^Open Test Music Video 003/ })
  const picture = await card.locator('div').first().boundingBox()
  await card.hover({ position: { x: 12, y: 12 } })
  const play = all.getByRole('button', { name: /^Play Test Music Video 003/ })
  await expect(play).toBeVisible()
  await expect(play).toHaveCSS('opacity', '1')
  // In the middle of the picture (not of the card, which has its title under it).
  const button = await play.boundingBox()
  expect(picture && button && Math.abs(button.x + button.width / 2 - (picture.x + picture.width / 2))).toBeLessThan(6)
  expect(picture && button && Math.abs(button.y + button.height / 2 - (picture.y + picture.height / 2))).toBeLessThan(6)

  // Pressing the button plays it...
  await play.click()
  await expect(page).toHaveURL(/#\/play\/mv0003/)
  await expect(playing(page, 'Test Music Video 003')).toBeVisible()
  await waitPlaying(page)

  // ...and the rest of the card opens the title page.
  await page.goto('/#/musicvideos')
  await all.getByRole('button', { name: /^Open Test Music Video 004/ }).click({ position: { x: 12, y: 12 } })
  await expect(page).toHaveURL(/#\/movie\/mv0004$/)
  await expect(page.getByRole('heading', { name: 'Test Music Video 004', level: 1 })).toBeVisible()
})

test('movies keep their cards as they were: no play button over the poster', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  const card = page.getByRole('region', { name: 'All movies' }).getByRole('button', { name: /^Open Test Movie 001/ })
  await card.hover()
  await expect(page.getByRole('button', { name: /^Play Test Movie/ })).toHaveCount(0)
  await card.click()
  await expect(page).toHaveURL(/#\/movie\/m0001$/)
})

test('played from "Recently added", the next video of that row follows', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music videos' }).click()
  const row = page.getByRole('region', { name: 'Recently added' })
  await expect(row.getByRole('button', { name: /^Open Test Music Video/ }).first()).toBeVisible()
  const order = await names(row)
  expect(order.length).toBeGreaterThan(2)

  await row.getByRole('button', { name: new RegExp(`^Play ${(order[0] as string)}`) }).click({ force: true })
  await expect(page).toHaveURL(/#\/play\/mv\d{4}\?queue=[0-9a-z]+$/)
  await expect(playing(page, (order[0] as string))).toBeVisible()
  await waitPlaying(page)

  await clickSeekAt(page, 0.85)
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText((order[1] as string))
  await expect(playing(page, (order[1] as string))).toBeVisible({ timeout: 15_000 })
  expect(page.url()).toMatch(/\?start=0&queue=/) // still in the row's queue, from its start
  await waitPlaying(page)
  await clickSeekAt(page, 0.85)
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText((order[2] as string))
})

test('played from the main page, the next video of its row follows (and the end of the row stops)', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock, { start: '/' })
  const row = page.getByRole('region', { name: 'New music videos' })
  await expect(row.getByRole('button', { name: /^Open Test Music Video/ }).first()).toBeVisible()
  const order = await names(row)
  expect(order.length).toBeGreaterThan(1)

  // Start with the last one of the row: nothing follows it.
  const last = (order[order.length - 1] as string)
  await row.getByRole('button', { name: new RegExp(`^Play ${last}`) }).click({ force: true })
  await expect(playing(page, last)).toBeVisible()
  await waitPlaying(page)
  await clickSeekAt(page, 0.85)
  await expect(page.getByRole('status', { name: 'Up next' })).toHaveCount(0)
  await page.goto('/#/')

  // Start with the first: the second follows.
  await row.getByRole('button', { name: new RegExp(`^Play ${(order[0] as string)}`) }).click({ force: true })
  await waitPlaying(page)
  await clickSeekAt(page, 0.85)
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText((order[1] as string))
})

test('played from a folder, a video goes on through that folder from where it is', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await page.goto('/#/folder/mvf0001')
  await page.getByRole('button', { name: /^Play Test Music Video 002/ }).click({ force: true })
  await expect(page).toHaveURL(/#\/play\/mv0002\?folder=mvf0001$/)
  await waitPlaying(page)
  await clickSeekAt(page, 0.85)
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText('Test Music Video 003')
  await expect(player(page)).toBeVisible()
})

test('the play button also reaches a touch screen (it is there without hovering)', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music videos' }).click()
  const play = page.getByRole('region', { name: 'All music videos' }).getByRole('button', { name: /^Play Test Music Video 001/ })
  await expect(play).toBeAttached()
  // With a keyboard it shows when it has focus.
  await play.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(play).toBeFocused()
  await expect(play).toHaveCSS('opacity', '1')
})
