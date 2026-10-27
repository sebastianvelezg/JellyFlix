import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** The suggestion rows of the main page, in real Chrome against the mock server. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

test('home: several rows of suggestions, from different titles you watched and from a favourite', async ({ page }) => {
  mock = await startMock({ movieCount: 30, musicArtists: 1 })
  for (const id of ['m0003', 'm0010', 'm0020']) {
    mock.user.played.add(id)
    mock.user.lastPlayed.push(id)
  }
  mock.user.favorites.add('m0025')
  await signIn(page, mock, { start: '/' })

  const rows = page.getByRole('region', { name: /^Because you / })
  await expect(rows).toHaveCount(3)
  // Alternating: the last one watched, a favourite, the one watched before.
  await expect(rows.nth(0)).toHaveAccessibleName('Because you watched Test Movie 020')
  await expect(rows.nth(1)).toHaveAccessibleName('Because you liked Test Movie 025')
  await expect(rows.nth(2)).toHaveAccessibleName('Because you watched Test Movie 010')
  // No title shows twice among them.
  const titles = await rows.locator('button[aria-label^="Open "]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(new Set(titles).size).toBe(titles.length)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('section[aria-label^="Because you"]').analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
})

test('home: nothing watched yet means no suggestion rows', async ({ page }) => {
  mock = await startMock({ movieCount: 30, musicArtists: 1 })
  await signIn(page, mock, { start: '/' })
  await expect(page.getByRole('region', { name: 'Featured' })).toBeVisible()
  await expect(page.getByRole('region', { name: /^Because you / })).toHaveCount(0)
})
