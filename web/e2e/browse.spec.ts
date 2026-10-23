import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { currentTime, signIn, startMock, video, waitPlaying } from './helpers'

let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const grid = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'All movies' })

test('browse: infinite scroll loads more pages as you scroll', async ({ page }) => {
  mock = await startMock({ movieCount: 150 })
  await signIn(page, mock)
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 001 /, })).toBeVisible()
  await expect(page.getByText('60 of 150 movies')).toBeVisible()
  await page.mouse.wheel(0, 20_000)
  await expect(page.getByText(/^1[0-9]{2} of 150 movies$|^[89][0-9] of 150 movies$/)).toBeVisible({ timeout: 10_000 })
  await page.mouse.wheel(0, 40_000)
  await expect(page.getByText('150 of 150 movies')).toBeVisible({ timeout: 10_000 })
  expect(mock.requests.filter((r) => r.path === '/Items' && r.query.startIndex === '60').length).toBeGreaterThan(0)
})

test('search, open a movie, toggle favorite, and use the browser Back button throughout', async ({ page }) => {
  mock = await startMock({ movieCount: 40 })
  await signIn(page, mock)

  await page.getByRole('searchbox', { name: 'Search' }).fill('Movie 03')
  await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()
  await expect(page.getByText('10 movies found')).toBeVisible()
  expect(page.url()).toContain('#/search/Movie%2003')

  await page.getByRole('button', { name: /Open Test Movie 035/ }).click()
  await expect(page.getByRole('heading', { name: 'Test Movie 035', level: 1 })).toBeVisible()
  await expect(page.getByText(/Overview of test movie 35/)).toBeVisible()
  await expect(page.getByText('Ada Actor')).toBeVisible()
  await page.getByRole('button', { name: /Add to favorites/ }).click()
  await expect(page.getByRole('button', { name: /^Favorite$/ })).toHaveAttribute('aria-pressed', 'true')
  expect(mock.user.favorites.has('m0035')).toBe(true)

  // Browser Back: movie page -> search results -> home.
  await page.goBack()
  await expect(page.getByText('10 movies found')).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: /Results for/ })).toHaveCount(0)
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 001 /, })).toBeVisible()

  // Favorites filter shows the movie we just favorited.
  await page.getByLabel('Show').selectOption('favorites')
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 035/ })).toBeVisible()
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 001 /, })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Continue watching' })).toHaveCount(0) // rows hide while filtering

  // Escape clears the search box.
  await page.getByRole('searchbox', { name: 'Search' }).fill('zzz')
  await expect(page.getByText(/No movies match/)).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search' }).press('Escape')
  await expect(page.getByText(/No movies match/)).toHaveCount(0)
})

test('keeps scroll position and loaded pages when going Back from a movie page', async ({ page }) => {
  mock = await startMock({ movieCount: 100 })
  await signIn(page, mock)
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 001 /, })).toBeVisible()
  await page.mouse.wheel(0, 1500)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
  const before = await page.evaluate(() => window.scrollY)
  // dispatchEvent clicks without Playwright scrolling the card into view first.
  await grid(page).getByRole('button', { name: /Open Test Movie 030 / }).dispatchEvent('click')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50) // movie pages start at the top
  await page.goBack()
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 001 /, })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(before - 5)
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(before + 5)
})

test('a page reload keeps you signed in and on the same page; closing the tab would not (sessionStorage)', async ({ page }) => {
  mock = await startMock()
  await signIn(page, mock)
  await grid(page).getByRole('button', { name: /Open Test Movie 002 / }).click()
  await expect(page.getByRole('heading', { name: 'Test Movie 002', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Test Movie 002', level: 1 })).toBeVisible()
  expect(page.url()).toContain('#/movie/m0002')
  const storage = await page.evaluate(() => ({
    session: sessionStorage.getItem('jellyflix.session') !== null,
    local: localStorage.getItem('jellyflix.session') !== null,
  }))
  expect(storage).toEqual({ session: true, local: false })

  // Deep link straight into playback works after a reload too.
  await page.goto(`/#/play/m0002`)
  await page.reload()
  await waitPlaying(page)
  expect(await currentTime(page)).toBeGreaterThan(0)
})

test('"Keep me signed in" survives a brand new browser context storage state', async ({ page, browser }) => {
  mock = await startMock()
  await signIn(page, mock, { keep: true })
  const state = await page.context().storageState()
  const context = await browser.newContext({ storageState: state })
  const fresh = await context.newPage()
  await fresh.goto('/')
  await expect(fresh.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await context.close()
})

test('a revoked session returns to sign-in with an explanation', async ({ page }) => {
  mock = await startMock()
  await signIn(page, mock)
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 002/ })).toBeVisible()
  await page.waitForLoadState('networkidle') // the home rows load in the background; let them finish first
  mock.tokens.clear()
  await grid(page).getByRole('button', { name: /Open Test Movie 002/ }).click()
  await expect(page.getByText(/session expired/i)).toBeVisible()
  await expect(page.getByLabel('Server URL')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('jellyflix.session'))).toBeNull()
})

test('sign out ends the session and clears stored data', async ({ page }) => {
  mock = await startMock()
  await signIn(page, mock, { keep: true })
  const token = [...mock.tokens].at(-1) as string
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByLabel('Server URL')).toBeVisible()
  await expect.poll(() => mock.tokens.has(token)).toBe(false)
  const all = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(all).not.toContain(token)
  expect(all).not.toContain('jellyflix.session')
})

test('the layout works on a phone-sized screen', async ({ page }) => {
  mock = await startMock()
  await page.setViewportSize({ width: 390, height: 800 })
  await signIn(page, mock)
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 001 /, })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await grid(page).getByRole('button', { name: /Open Test Movie 001 /, }).click()
  await page.getByRole('button', { name: /^Play$/ }).click()
  await waitPlaying(page)
  await expect(video(page)).toBeVisible()
  const box = await page.getByRole('button', { name: 'Fullscreen' }).boundingBox()
  expect(box && box.x + box.width <= 390).toBe(true)
})

test('cast page, "Surprise me", instant favorites and the favorites row', async ({ page }) => {
  mock = await startMock({ movieCount: 12 })
  await signIn(page, mock)
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 001 / })).toBeVisible()

  await page.getByRole('button', { name: /Surprise me/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(page.url()).toMatch(/#\/movie\/m\d{4}$/)

  // Favorite flips immediately (before the server answers), then shows up on the home page.
  const favorite = page.getByRole('button', { name: /Add to favorites/ })
  await favorite.click()
  await expect(page.getByRole('button', { name: /^Favorite$/ })).toHaveAttribute('aria-pressed', 'true', { timeout: 500 })
  await expect.poll(() => mock.user.favorites.size).toBe(1)

  // Cast member -> their movies -> Back to the movie.
  await page.getByRole('button', { name: 'Movies with Ada Actor' }).click()
  await expect(page.getByRole('heading', { name: 'Ada Actor', level: 1 })).toBeVisible()
  await expect(page.getByText('12 movies', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  const row = page.getByRole('region', { name: 'Your favorites' })
  await expect(row).toBeVisible()
  await expect(row.getByRole('button', { name: /Open Test Movie/ })).toHaveCount(1)
})
