import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/**
 * Hiding a title from Continue watching and a series from Next up: the choice is the client's (Jellyfin has no way to do it), kept for the
 * account on this device. It must not change what has been watched, it can be undone at once, and it comes back by itself when the title
 * is played again.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 3 }

async function setUp(page: Page) {
  mock = await startMock(everything)
  mock.resume.set('m0004', 12 * 10_000_000)
  mock.resume.set('m0005', 20 * 10_000_000)
  mock.user.lastPlayed.push('m0004', 'm0005')
  // A series whose first episode is watched: its second is "up next".
  mock.user.played.add('s0001-ep-1-1')
  mock.user.lastPlayed.push('s0001-ep-1-1')
  await signIn(page, mock, { start: '/' })
}

const continueRow = (page: Page) => page.getByRole('region', { name: 'Continue watching' })
const nextRow = (page: Page) => page.getByRole('region', { name: 'Next up' })

async function openMenu(row: ReturnType<typeof continueRow>, title: RegExp) {
  const card = row.locator('div.group\\/card').filter({ hasText: title })
  await card.hover()
  await card.getByRole('button', { name: /^More options for/ }).click()
}

test('hidden: a title leaves Continue watching, keeps its progress, can be undone, and comes back when restored', async ({ page }) => {
  await setUp(page)
  await expect(continueRow(page).getByRole('button', { name: /^Resume Test Movie 004/ })).toBeVisible()

  await openMenu(continueRow(page), /Test Movie 004/)
  await page.getByRole('menuitem', { name: 'Hide from Continue watching' }).click()
  await expect(continueRow(page).getByRole('button', { name: /^Resume Test Movie 004/ })).toHaveCount(0)
  await expect(continueRow(page).getByRole('button', { name: /^Resume Test Movie 005/ })).toBeVisible()
  // The server knows nothing about it: the position is where it was and nothing was marked watched.
  expect(mock.resume.get('m0004')).toBe(12 * 10_000_000)
  expect(mock.user.played.has('m0004')).toBe(false)

  // Undo at once.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(continueRow(page).getByRole('button', { name: /^Resume Test Movie 004/ })).toBeVisible()

  // Hide again: it stays hidden after a reload, and the library still has it.
  await openMenu(continueRow(page), /Test Movie 004/)
  await page.getByRole('menuitem', { name: 'Hide from Continue watching' }).click()
  await page.reload()
  await expect(continueRow(page).getByRole('button', { name: /^Resume Test Movie 005/ })).toBeVisible()
  await expect(continueRow(page).getByRole('button', { name: /^Resume Test Movie 004/ })).toHaveCount(0)
  await page.goto('/#/movies')
  await expect(page.getByRole('region', { name: 'All movies' }).getByRole('button', { name: /Open Test Movie 004/ })).toBeVisible()

  // It is listed in Settings, and restoring brings it back.
  await page.goto('/#/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  const card = page.getByRole('region', { name: 'Hidden from Continue watching and Next up' })
  await expect(card).toContainText('Test Movie 004')
  await card.getByRole('button', { name: 'Restore Test Movie 004' }).click()
  await expect(card).toContainText('Nothing is hidden')
  await page.goto('/#/')
  await expect(continueRow(page).getByRole('button', { name: /^Resume Test Movie 004/ })).toBeVisible()
})

test('hidden: a title that is played again after being hidden comes back to Continue watching', async ({ page }) => {
  await setUp(page)
  await openMenu(continueRow(page), /Test Movie 004/)
  await page.getByRole('menuitem', { name: 'Hide from Continue watching' }).click()
  await expect(continueRow(page).getByRole('button', { name: /^Resume Test Movie 004/ })).toHaveCount(0)
  // It is watched again (the server's last-played order puts it last, with a new date).
  mock.user.lastPlayed.splice(mock.user.lastPlayed.indexOf('m0004'), 1)
  mock.user.lastPlayed.push('m0004', 'm0006')
  mock.resume.set('m0004', 30 * 10_000_000)
  await page.reload()
  await expect(continueRow(page).getByRole('button', { name: /^Resume Test Movie 004/ })).toBeVisible()
})

test('hidden: a whole series leaves Next up until it is restored', async ({ page }) => {
  await setUp(page)
  await expect(nextRow(page).getByRole('button', { name: /Test Show 001/ }).first()).toBeVisible()
  await openMenu(nextRow(page), /Test Show 001/)
  await page.getByRole('menuitem', { name: 'Hide series from Next up' }).click()
  await expect(nextRow(page)).toHaveCount(0)
  // Watching more of it does not bring it back.
  mock.user.played.add('s0001-ep-1-2')
  mock.user.lastPlayed.push('s0001-ep-1-2')
  await page.reload()
  await expect(nextRow(page)).toHaveCount(0)

  await page.goto('/#/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  const card = page.getByRole('region', { name: 'Hidden from Continue watching and Next up' })
  await expect(card).toContainText('Test Show 001')
  await card.getByRole('button', { name: 'Restore all (1)' }).click()
  await page.goto('/#/')
  await expect(nextRow(page).getByRole('button', { name: /Test Show 001/ }).first()).toBeVisible()
})
