import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** What the app does to feel fast, in real Chrome against the mock server (which can be made slow on purpose). */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3 }

test('a reload draws the main page at once from what was seen, even if the server is now very slow', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Featured' }).getByRole('heading', { level: 2 })).toBeVisible()
  await page.waitForLoadState('networkidle')

  mock.setDelay(4000) // every answer now takes four seconds
  const before = mock.requests.length
  await page.reload()
  // Far sooner than any answer can arrive: the banner, the rows and the tabs come from the remembered copy.
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible({ timeout: 1500 })
  await expect(page.getByRole('region', { name: 'Featured' }).getByRole('heading', { level: 2 })).toBeVisible({ timeout: 1500 })
  await expect(page.getByRole('navigation', { name: 'Sections' }).first().getByRole('button', { name: 'Music' })).toBeVisible({ timeout: 1500 })
  // ...and the fresh lists are still asked for behind it.
  await expect.poll(() => mock.requests.length, { timeout: 3000 }).toBeGreaterThan(before)
})

test('the app opens before the server has confirmed the saved session, and an expired one still ends up at sign-in', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await page.waitForLoadState('networkidle')
  mock.setDelay(3000)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 1500 })

  mock.tokens.clear() // the server now refuses the saved token
  mock.setDelay(0)
  await page.reload()
  await expect(page.getByLabel('Server URL')).toBeVisible()
  await expect(page.getByText(/session expired/i)).toBeVisible()
})

test('a title page opens at once after the mouse rested on its card', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock)
  const card = page.getByRole('region', { name: 'All movies' }).getByRole('button', { name: /Open Test Movie 002/ })
  await card.scrollIntoViewIfNeeded()
  await card.hover()
  await expect.poll(() => mock.requests.some((r) => r.path === '/Items/m0002' && r.method === 'GET')).toBe(true)
  await page.waitForLoadState('networkidle')

  mock.setDelay(4000)
  await card.click()
  await expect(page.getByRole('heading', { name: 'Test Movie 002', level: 1 })).toBeVisible({ timeout: 1500 })
})

test('a long grid only paints what is near the screen', async ({ page }) => {
  mock = await startMock({ movieCount: 120 })
  await signIn(page, mock)
  const grid = page.getByRole('region', { name: 'All movies' })
  await expect(grid.getByRole('button', { name: /Open Test Movie 001 / })).toBeVisible()
  const states = await grid.locator('li.cv-card').evaluateAll((items) => items.map((li) => getComputedStyle(li).contentVisibility))
  expect(states.length).toBeGreaterThan(30)
  expect(new Set(states)).toEqual(new Set(['auto']))
})
