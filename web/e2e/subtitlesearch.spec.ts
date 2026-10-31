import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { openSettings, signIn, startMock, video, waitPlaying } from './helpers'

/** Subtitles from the internet (through the server's subtitle plugin), in real Chrome against the mock server. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

test('searches for subtitles, saves one on the server and switches it on', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)

  const settings = await openSettings(page, 'Subtitles')
  const tracks = settings.getByRole('group', { name: 'Subtitles' }).getByRole('radio')
  await expect(tracks).toHaveCount(2) // Off, English
  await settings.getByRole('button', { name: 'Search online…' }).click()

  const dialog = page.getByRole('dialog', { name: 'Find subtitles' })
  await expect(dialog).toBeVisible()
  // The video waits while you choose.
  await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  // The one matching the file is first, and the machine translated one is last.
  const rows = dialog.getByRole('listitem')
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText('Mock.Movie.2020.1080p.BluRay')
  await expect(rows.first()).toContainText('Matches this file')
  await expect(rows.last()).toContainText('Machine translated')

  await dialog.getByRole('button', { name: /^Use Mock\.Movie\.2020\.1080p\.BluRay$/ }).click()
  expect(mock.adminLog).toContain('subtitle-download m0001 os-exact')

  // The video starts again with the new track chosen and its words on screen.
  await waitPlaying(page)
  await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')
  const after = await openSettings(page, 'Subtitles')
  const now = after.getByRole('group', { name: 'Subtitles' }).getByRole('radio')
  await expect(now).toHaveCount(3)
  await expect(now.nth(2)).toBeChecked()
})

test('changing the language searches again, and closing leaves the video playing', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  await (await openSettings(page, 'Subtitles')).getByRole('button', { name: 'Search online…' }).click()

  const dialog = page.getByRole('dialog', { name: 'Find subtitles' })
  await expect(dialog.getByRole('listitem')).toHaveCount(3)
  await dialog.getByLabel('Language').selectOption('spa')
  await expect.poll(() => mock.adminLog.filter((l) => l.startsWith('subtitle-search')).at(-1)).toBe('subtitle-search m0001 spa')
  await dialog.getByLabel('Only matches for this exact file').check()
  await expect.poll(() => mock.adminLog.at(-1)).toBe('subtitle-search m0001 spa exact')

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await waitPlaying(page) // it was playing before, so it carries on
  expect(mock.adminLog.some((l) => l.startsWith('subtitle-download'))).toBe(false)
})

test('says so when the server has no subtitle plugin', async ({ page }) => {
  mock = await startMock({ movieCount: 3, noSubtitlePlugin: true })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  await (await openSettings(page, 'Subtitles')).getByRole('button', { name: 'Search online…' }).click()
  await expect(page.getByRole('dialog', { name: 'Find subtitles' }).getByRole('alert')).toContainText('no subtitle plugin')
})
