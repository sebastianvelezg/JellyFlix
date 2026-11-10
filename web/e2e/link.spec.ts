import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { startMock } from './helpers'

/**
 * The page a TV's QR code opens. A phone with no session signs in first and then lands on the confirmation, and nothing is approved
 * until the person presses the button.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

async function tvCode(): Promise<{ code: string; secret: string }> {
  const response = await fetch(`${mock.url}/QuickConnect/Initiate`, { method: 'POST' })
  const data = (await response.json()) as { Code: string; Secret: string }
  return { code: data.Code, secret: data.Secret }
}

const approved = async (secret: string) => {
  const response = await fetch(`${mock.url}/QuickConnect/Connect?secret=${encodeURIComponent(secret)}`)
  return ((await response.json()) as { Authenticated: boolean }).Authenticated
}

test('link: a phone without a session signs in, then confirms the TV code', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  const tv = await tvCode()
  await page.addInitScript(() => localStorage.setItem('jellyflix.setup', '1'))
  await page.goto(`/#/link?code=${tv.code}`)
  await page.getByLabel('Server URL').fill(mock.url)
  await page.getByLabel('Username').fill('tester')
  await page.getByLabel('Password').fill('secret')
  await page.getByRole('button', { name: 'Connect' }).click()

  await expect(page.getByRole('heading', { name: 'Sign in your TV' })).toBeVisible()
  // Being on the page approved nothing.
  expect(await approved(tv.secret)).toBe(false)
  await page.getByRole('button', { name: 'Let it sign in' }).click()
  await expect(page.getByRole('status')).toContainText('Your TV is signing in as tester')
  expect(await approved(tv.secret)).toBe(true)

  await page.getByRole('button', { name: 'Go to the home page' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in your TV' })).toHaveCount(0)
  // The code is no longer in the address.
  expect(page.url()).not.toContain('code=')
})

test('link: Not now leaves the code unapproved and goes home', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  const tv = await tvCode()
  await page.addInitScript(() => localStorage.setItem('jellyflix.setup', '1'))
  await page.goto(`/#/link?code=${tv.code}`)
  await page.getByLabel('Server URL').fill(mock.url)
  await page.getByLabel('Username').fill('tester')
  await page.getByLabel('Password').fill('secret')
  await page.getByRole('button', { name: 'Connect' }).click()
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in your TV' })).toHaveCount(0)
  expect(await approved(tv.secret)).toBe(false)
})
