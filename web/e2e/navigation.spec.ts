import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** Moving around: the bottom bar on a phone, search (recent searches and filters), the shortcuts list and the layout options. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3 }
const sections = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Sections' })

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the sections are a bar at the bottom, which the music player sits above', async ({ page }) => {
    mock = await startMock(everything)
    await signIn(page, mock, { start: '/' })
    const bar = sections(page)
    await expect(bar).toBeVisible()
    const box = await bar.boundingBox()
    expect(box && Math.abs(box.y + box.height - 844) < 2).toBe(true)
    // The header is one row again.
    expect((await page.locator('header').boundingBox())?.height).toBeLessThan(80)
    await expect(bar.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

    await bar.getByRole('button', { name: 'Series' }).click()
    await expect(page).toHaveURL(/#\/series$/)
    await expect(bar.getByRole('button', { name: 'Series' })).toHaveAttribute('aria-current', 'page')
    await bar.getByRole('button', { name: 'Home' }).click()

    await page.getByRole('article', { name: 'Random music' }).getByRole('button', { name: 'Play album' }).click()
    const player = page.getByRole('region', { name: 'Music player' })
    await expect(player).toBeVisible()
    const playerBox = await player.boundingBox()
    const barBox = await bar.boundingBox()
    expect(playerBox && barBox && Math.abs(playerBox.y + playerBox.height - barBox.y) < 2).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test('on a computer the sections stay in the header, with no bar at the bottom', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const nav = sections(page)
  await expect(nav).toHaveCount(1)
  const box = await nav.boundingBox()
  expect(box && box.y < 80).toBe(true)
})

test('search: remembers what you searched for, offers it again, and can be cleared', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const search = page.getByRole('searchbox', { name: 'Search' })
  await search.fill('Test Movie 003')
  await search.press('Enter')
  await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()
  await search.fill('')
  await page.keyboard.press('Escape')

  await search.focus()
  const recent = page.getByText('Recent searches')
  await expect(recent).toBeVisible()
  await page.getByRole('button', { name: 'Test Movie 003', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Results for/ })).toContainText('Test Movie 003')

  await search.fill('')
  await search.press('Escape')
  await search.focus()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByText('Recent searches')).toHaveCount(0)
})

test('search: the filters keep one kind of result', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const search = page.getByRole('searchbox', { name: 'Search' })
  await search.fill('Test')
  await search.press('Enter')
  await expect(page.getByRole('region', { name: 'Movies' }).first()).toBeVisible()
  const filters = page.getByRole('group', { name: 'Filter the results' })
  await expect(filters.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  await filters.getByRole('button', { name: 'Series' }).click()
  await expect(page.getByRole('region', { name: 'Movies' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Series' })).toBeVisible()
  await filters.getByRole('button', { name: 'All' }).click()
  await expect(page.getByRole('region', { name: 'Movies' }).first()).toBeVisible()
})

test('shortcuts: "?" opens the list, Esc closes it, and it can be opened from Settings', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Play or pause')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Show the list' }).click()
  await expect(dialog).toBeVisible()
  const results = await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
})

test('layout: interface size, space between rows and banner height change the page and are remembered', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/', keep: true })
  const banner = page.getByRole('region', { name: 'Featured' })
  await expect(banner).toBeVisible()
  const tall = (await banner.boundingBox())?.height ?? 0
  const fontSize = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
  expect(await fontSize()).toBe(16)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Appearance' }).click()
  const choose = (group: string, option: string) =>
    page.getByRole('group', { name: group }).locator('label', { hasText: new RegExp(`^${option}$`) }).click()
  await choose('Featured banner height', 'Compact')
  await choose('Interface size', 'Large')
  expect(await fontSize()).toBeGreaterThan(16)
  await choose('Interface size', 'Small')
  expect(await fontSize()).toBeLessThan(16)

  await page.reload()
  expect(await page.evaluate(() => document.documentElement.dataset.size)).toBe('small') // painted before the app loads
  await page.evaluate(() => (location.hash = '#/'))
  const short = (await banner.boundingBox())?.height ?? 0
  expect(short).toBeLessThan(tall)
})
