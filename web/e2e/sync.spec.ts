import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/**
 * The optional sync of preferences between two devices of one account (two browsers here, the TV app does the same with the same rules):
 * it is off until turned on, the first time asks when the account already has different choices, and a theme chosen on one device reaches
 * the other while what depends on the screen stays as it was. The rules are tested in core/syncPrefs.test.ts and platform/web/sync.test.ts.
 */
let mock: MockServer
let second: BrowserContext | undefined
test.afterEach(async () => {
  await second?.close()
  second = undefined
  await mock?.close()
})

const canvasOf = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.appearance') ?? '{}').theme?.canvas as string | undefined)
const syncCard = (page: Page) => page.getByRole('region', { name: 'Sync settings with your account' })

test('sync: off by default; turning it on uploads this device, and a second device chooses what to do with the account\'s settings', async ({ page, browser }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock, { start: '/#/settings' })
  await page.evaluate(() => localStorage.setItem('jellyflix.appearance', JSON.stringify({ theme: { canvas: 'pine', accent: 'blue' }, posterSize: 'large' })))
  await page.reload()

  // Off by default: the card says what it does and nothing is synced.
  const card = syncCard(page)
  await expect(card).toContainText('It is off until you turn it on')
  const toggle = card.getByRole('switch', { name: 'Sync with my account' })
  await expect(toggle).not.toBeChecked()

  await toggle.check({ force: true })
  await expect(card.getByRole('status')).toContainText('Last synced', { timeout: 10_000 })

  // A second device of the same account, with its own look.
  second = await browser.newContext()
  const other = await second.newPage()
  await signIn(other, mock, { start: '/#/settings' })
  await other.evaluate(() => localStorage.setItem('jellyflix.appearance', JSON.stringify({ theme: { canvas: 'midnight', accent: 'violet' }, density: 'compact', posterSize: 'compact' })))
  await other.reload()
  await syncCard(other).getByRole('switch', { name: 'Sync with my account' }).check({ force: true })

  // The account already has other choices: nothing changes until this device says which to use.
  const ask = syncCard(other).getByRole('group', { name: 'Your account already has saved settings' })
  await expect(ask).toBeVisible()
  await expect(ask).toContainText('Jellyflix Web')
  expect(await canvasOf(other)).toBe('midnight')
  await ask.getByRole('button', { name: 'Use the saved settings' }).click()
  await expect(syncCard(other).getByRole('status')).toContainText('Last synced', { timeout: 10_000 })

  // The theme came across; what depends on the screen did not.
  expect(await canvasOf(other)).toBe('pine')
  const look = await other.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.appearance') ?? '{}'))
  expect(look.density).toBe('compact')
  expect(look.posterSize).toBe('compact')
})

test('sync: a change on one device reaches the other without turning anything on again', async ({ page, browser }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock, { start: '/#/settings' })
  await syncCard(page).getByRole('switch', { name: 'Sync with my account' }).check({ force: true })
  await expect(syncCard(page).getByRole('status')).toContainText('Last synced', { timeout: 10_000 })

  second = await browser.newContext()
  const other = await second.newPage()
  await signIn(other, mock, { start: '/#/settings' })
  await syncCard(other).getByRole('switch', { name: 'Sync with my account' }).check({ force: true })
  await expect(syncCard(other).getByRole('status')).toContainText('Last synced', { timeout: 10_000 })

  // A theme is chosen on the first device: it is sent a few seconds later, and the other takes it with "Sync now".
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('radio', { name: /Pine/ }).check({ force: true })
  await expect.poll(() => canvasOf(page)).toBe('pine')
  await page.waitForTimeout(5500)
  await other.getByRole('button', { name: 'Sync now' }).click()
  await expect.poll(() => canvasOf(other), { timeout: 10_000 }).toBe('pine')
})
