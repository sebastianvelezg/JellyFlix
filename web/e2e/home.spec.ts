import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** Home-page and app-wide behaviour (banner, settings, offline handling...) in real Chrome against the mock server. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

test('banner: moves to the next title every 10 seconds, and waits while you hover over it', async ({ page }) => {
  mock = await startMock({ movieCount: 12 })
  await signIn(page, mock)
  const banner = page.getByRole('region', { name: 'Featured' })
  const title = () => banner.getByRole('heading', { level: 2 }).innerText()
  await expect(banner.getByRole('heading', { level: 2 })).toBeVisible()
  const first = await title()
  const progress = banner.locator('.hero-progress')

  // Hovering pauses the countdown (the dot's fill stops).
  await banner.hover({ position: { x: 600, y: 300 } })
  await expect(progress).toHaveCSS('animation-play-state', 'paused')
  await page.mouse.move(5, 5)
  await expect(progress).toHaveCSS('animation-play-state', 'running')

  await expect.poll(title, { timeout: 15_000 }).not.toBe(first)
  const second = await title()
  expect(second).not.toBe(first)
  await expect(banner.getByRole('button', { name: /^Featured title 2 of / })).toHaveAttribute('aria-current', 'true')
})

test('banner: stays on one title when automatic rotation is off', async ({ page }) => {
  mock = await startMock({ movieCount: 12 })
  await page.addInitScript(() => localStorage.setItem('jellyflix.ui', JSON.stringify({ autoRotateBanner: false })))
  await signIn(page, mock)
  const banner = page.getByRole('region', { name: 'Featured' })
  await expect(banner.getByRole('heading', { level: 2 })).toBeVisible()
  await expect(banner.locator('.hero-progress')).toHaveCount(0)
  // The dots still work.
  const first = await banner.getByRole('heading', { level: 2 }).innerText()
  await banner.getByRole('button', { name: /^Featured title 2 of / }).click()
  await expect.poll(() => banner.getByRole('heading', { level: 2 }).innerText()).not.toBe(first)
})

test('offline: a notice appears when the connection drops and goes away when it returns', async ({ page, context }) => {
  mock = await startMock({ movieCount: 5 })
  await signIn(page, mock)
  await context.setOffline(true)
  await expect(page.getByRole('status').filter({ hasText: 'You are offline' })).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByRole('status').filter({ hasText: 'Back online' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Back online' })).toHaveCount(0, { timeout: 6000 })
  await expect(page.getByRole('status').filter({ hasText: 'You are offline' })).toHaveCount(0)
})

test('retries: the library loads even when the server hiccups once', async ({ page }) => {
  mock = await startMock({ movieCount: 5, flaky: { path: '/Items/Latest', status: 503, times: 1 } })
  await signIn(page, mock)
  await expect(page.getByRole('region', { name: 'All movies' }).getByRole('button', { name: /Open Test Movie 001/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recently added' })).toBeVisible()
  expect(mock.flakyHits()).toBe(1)
})
