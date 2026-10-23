import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/**
 * How the app talks to the server: few reads at a time, most important first, and no counting of what nobody shows.
 * Against the mock server, which can answer slowly and remembers how many reads were waiting at once.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

test('requests: the home page never has more than four reads on their way, and every row still arrives', async ({ page }) => {
  mock = await startMock({ movieCount: 30, seriesCount: 6, animeCount: 3, musicArtists: 3 })
  mock.setDelay(120)
  await signIn(page, mock, { start: '/#/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'New series' })).toBeVisible()
  await expect.poll(() => mock.requests.filter((r) => r.path === '/Items' && r.query.sortBy === 'Random').length).toBeGreaterThan(0)
  expect(mock.peakApiRequests()).toBeLessThanOrEqual(4)
  expect(mock.peakApiRequests()).toBeGreaterThan(1) // (still in parallel, not one by one)
})

test('requests: who you are is asked once per sign-in, and again on a reload (to check the saved session), not more', async ({ page }) => {
  mock = await startMock({ movieCount: 6, seriesCount: 2, musicArtists: 1 })
  await signIn(page, mock, { start: '/#/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click() // the page that checks whether you are an administrator
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  expect(mock.requests.filter((r) => r.path === '/Users/Me')).toHaveLength(1)

  mock.requests.length = 0
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect.poll(() => mock.requests.filter((r) => r.path === '/Users/Me').length).toBe(1)
})

test('requests: rows do not ask the server to count everything, the paged grids do', async ({ page }) => {
  mock = await startMock({ movieCount: 30, seriesCount: 4, animeCount: 2, musicArtists: 2 })
  await signIn(page, mock, { start: '/#/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  const lists = mock.requests.filter((r) => r.path === '/Items' || r.path === '/UserItems/Resume' || r.path === '/Shows/NextUp')
  expect(lists.length).toBeGreaterThan(3)
  for (const r of lists) expect(r.query.enableTotalRecordCount, `${r.path} ${JSON.stringify(r.query)}`).toBe('false')

  const mark = mock.requests.length
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Movies' }).click()
  await expect(page.getByText(/of 30 movies/)).toBeVisible() // the total is read where it is shown
  const paged = mock.requests.slice(mark).filter((r) => r.path === '/Items' && r.query.startIndex !== undefined)
  expect(paged.some((r) => r.query.enableTotalRecordCount === 'true')).toBe(true)
})
