import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { player, signIn, startMock, waitPlaying } from './helpers'

/**
 * Music videos against the mock server: the tab, the wide cards, the title page with the artist, playing one, search and the main
 * page. As in the other specs, this proves the client's behaviour, not compatibility with a real Jellyfin server.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })

test('music videos: a tab with a library of them, its cards, its title page and playback', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicVideos: 4 })
  await signIn(page, mock)
  await expect(tabs(page).getByRole('button')).toHaveText(['Home', 'Movies', 'Series', 'Music videos'])

  await tabs(page).getByRole('button', { name: 'Music videos' }).click()
  await expect(page).toHaveURL(/#\/musicvideos$/)
  const all = page.getByRole('region', { name: 'All music videos' })
  await expect(all.getByText('4 of 4 music videos')).toBeVisible()
  // The artist is under the title, and the card is a wide frame, not a poster.
  const card = all.getByRole('button', { name: /^Open Test Music Video 001/ })
  await expect(card).toHaveAttribute('aria-label', 'Open Test Music Video 001 by Test Artist 2 (1991)')
  const frame = await card.locator('div').first().boundingBox()
  expect(frame && frame.width / frame.height).toBeCloseTo(16 / 9, 1)

  // (The middle of the picture is the play button; the rest of the card opens the title.)
  await card.click({ position: { x: 12, y: 12 } })
  await expect(page.getByRole('heading', { name: 'Test Music Video 001', level: 1 })).toBeVisible()
  await expect(page.getByText('Test Artist 2', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /^(Play|Resume from .*)$/ }).click()
  await expect(player(page)).toBeVisible()
  await waitPlaying(page)
  const start = mock.requests.find((r) => r.path === '/Sessions/Playing')
  expect(start?.body).toMatchObject({ ItemId: 'mv0001' })

  // Back returns to the title page, which is where it was opened from.
  await player(page).getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/#\/movie\/mv0001$/)
})

test('music videos: found by search, with their own filter', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicVideos: 4 })
  await signIn(page, mock)
  await page.getByRole('searchbox').fill('music video 002')
  await page.getByRole('searchbox').press('Enter')
  const section = page.getByRole('region', { name: 'Music videos' })
  await expect(section.getByRole('button', { name: /^Open Test Music Video 002/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Movies' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Filter the results' }).getByRole('button', { name: 'Music videos' })).toBeVisible()
})

test('music videos: a row on the main page, and a half-watched one in "Continue watching"', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicVideos: 4 })
  mock.resume.set('mv0003', 12 * 10_000_000)
  mock.user.resume.set('mv0003', 12 * 10_000_000)
  mock.user.lastPlayed.push('mv0003')
  await signIn(page, mock, { start: '/' })
  const row = page.getByRole('region', { name: 'New music videos' })
  await expect(row.getByRole('button', { name: /^Open Test Music Video 004/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Continue watching' }).getByRole('button', { name: /Resume Test Music Video 003/ })).toBeVisible()
  await row.getByRole('button', { name: /See all in Music videos/ }).click()
  await expect(page).toHaveURL(/#\/musicvideos$/)
})

test('music videos: an account with only music videos starts on them', async ({ page }) => {
  mock = await startMock({ movieCount: 3, noMovieLibrary: true, noTvLibrary: true, musicVideos: 3 })
  await signIn(page, mock, { start: '/' })
  await expect(page).toHaveURL(/#\/musicvideos$/)
  await expect(page.getByRole('region', { name: 'All music videos' })).toBeVisible()
})
