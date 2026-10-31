import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { clickSeekAt, currentTime, openSettings, signIn, startMock, video, waitPlaying } from './helpers'

/** Player extras (skip intro/credits, chapters, picture-in-picture) in real Chrome against the mock server. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

async function playEpisode(page: Page, id: string) {
  await page.goto(`/#/play/${id}`)
  await waitPlaying(page)
}

test('skip intro: the button shows during the intro and jumps past it', async ({ page }) => {
  mock = await startMock({ movieCount: 2, seriesCount: 1, segments: true })
  await signIn(page, mock)
  await playEpisode(page, 's0001-ep-1-1')
  expect(await currentTime(page)).toBeLessThan(3)
  await expect(page.getByRole('button', { name: 'Skip intro' })).toHaveCount(0)

  // The intro is 3-8 s; the button is there while it plays.
  const skip = page.getByRole('button', { name: 'Skip intro' })
  await expect(skip).toBeVisible({ timeout: 8000 })
  await skip.click()
  await expect.poll(() => currentTime(page)).toBeGreaterThan(7.9)
  await expect(skip).toHaveCount(0)
})

test('credits: "Next episode" jumps to the next episode, and the last episode skips to the end', async ({ page }) => {
  mock = await startMock({ movieCount: 2, seriesCount: 1, segments: true })
  await signIn(page, mock)
  await playEpisode(page, 's0001-ep-1-1')
  await clickSeekAt(page, 0.85) // 25 s: inside the credits (24-30 s)
  const toNext = page.locator('button.btn-primary', { hasText: 'Next episode' })
  await expect(toNext).toBeVisible()
  await toNext.click()
  await expect(page.getByRole('region', { name: /S1 E2/ })).toBeVisible()

  await playEpisode(page, 's0001-ep-2-3') // the last one: nothing follows
  await clickSeekAt(page, 0.85)
  const skipCredits = page.getByRole('button', { name: 'Skip credits' })
  await expect(skipCredits).toBeVisible()
  await skipCredits.click()
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 10_000 })
})

test('chapters: markers on the timeline, a chapter list in the settings menu, and the hover time names the chapter', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const settings = await openSettings(page, 'Chapters')
  const list = settings.getByRole('group', { name: 'Chapters' })
  await expect(list.getByRole('button')).toHaveCount(3)
  await expect(list.getByRole('button', { name: /Opening/ })).toHaveAttribute('aria-current', 'true')
  await list.getByRole('button', { name: /The middle/ }).click()
  await expect.poll(() => currentTime(page)).toBeGreaterThan(11.9)
  await expect(list.getByRole('button', { name: /The middle/ })).toHaveAttribute('aria-current', 'true')

  // Hovering the timeline names the chapter under the pointer.
  await page.keyboard.press('Escape')
  const bar = page.getByRole('slider', { name: 'Seek' })
  const box = await bar.boundingBox()
  if (!box) throw new Error('no seek bar')
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2)
  await expect(page.getByText(/· Finale$/)).toBeVisible()
})

test('picture-in-picture: offered where the browser supports it', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const supported = await page.evaluate(() => document.pictureInPictureEnabled === true)
  const button = page.getByRole('button', { name: 'Picture-in-picture' })
  if (supported) await expect(button).toBeVisible()
  else await expect(button).toHaveCount(0)
})
