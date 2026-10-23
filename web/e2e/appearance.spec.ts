import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** Settings → Appearance: the theme, the poster size and the rows of the home page, in real Chrome against the mock server. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3 }

const cssVar = (page: Page, name: string) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name)

async function openAppearance(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await expect(page.getByRole('region', { name: 'Theme' })).toBeVisible()
}

test('theme: a background and an accent change the whole app, survive a reload, and can be undone', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/', keep: true })
  expect(await cssVar(page, '--color-bg')).toBe('#000000') // nothing chosen yet: the original look

  await openAppearance(page)
  await page.locator('label', { hasText: /^Midnight$/ }).click()
  await page.getByTitle('Violet').click()
  expect(await cssVar(page, '--color-bg')).toBe('#050813')
  expect(await cssVar(page, '--color-accent-strong')).not.toBe('#2563eb')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(5, 8, 19)')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#050813')

  // Painted from the first frame next time, before the app has loaded.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  expect(await cssVar(page, '--color-bg')).toBe('#050813')
  await openAppearance(page)
  await expect(page.getByRole('radio', { name: 'Violet' })).toBeChecked()

  await page.getByRole('button', { name: 'Reset all appearance' }).click()
  expect(await cssVar(page, '--color-bg')).toBe('#000000')
  await expect(page.getByRole('radio', { name: 'Ocean' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'True black' })).toBeChecked()
})

test('theme: a colour of your own keeps its text readable, even a very light one', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await openAppearance(page)
  await page.getByLabel('Custom colour').fill('#ffee00')
  expect(await cssVar(page, '--color-accent-ink')).not.toBe('#ffffff') // dark text on a light fill
  await page.getByLabel('Custom colour').fill('#112233')
  expect(await cssVar(page, '--color-accent-ink')).toBe('#ffffff')
  // The text-coloured accent was lifted until it can be read on the surfaces.
  const accent = await cssVar(page, '--color-accent')
  expect(accent).toMatch(/^#[0-9a-f]{6}$/)
  expect(accent).not.toBe('#112233')
})

test('menu buttons: icons and names, icons only, or names only; the buttons keep their names for a screen reader', async ({ page }) => {
  mock = await startMock({ ...everything, musicVideos: 2, books: 2, liveTv: 3 })
  await page.setViewportSize({ width: 1700, height: 900 })
  await signIn(page, mock, { start: '/', keep: true })
  const menu = page.getByRole('navigation', { name: 'Sections' })
  const movies = menu.getByRole('button', { name: 'Movies' })
  // Eight sections: with names and icons they would not all fit in 1700 pixels beside the search, so the icons stay and the names go.
  await expect(menu.getByRole('button')).toHaveCount(8)
  await expect(movies.locator('svg')).toBeVisible()
  const widest = await movies.evaluate((el) => (el.parentElement as HTMLElement).scrollWidth <= (el.parentElement as HTMLElement).clientWidth + 1)
  expect(widest).toBe(true)

  await openAppearance(page)
  await page.getByRole('radio', { name: 'Names only' }).check({ force: true })
  await expect(page.locator('html')).toHaveAttribute('data-nav', 'text')
  await expect(movies).toHaveText('Movies')
  await expect(movies.locator('svg')).toHaveCount(0)

  await page.getByRole('radio', { name: 'Icons only' }).check({ force: true })
  await expect(page.locator('html')).toHaveAttribute('data-nav', 'icons')
  await expect(movies).toHaveText('')
  await expect(movies.locator('svg')).toBeVisible()
  await expect(movies).toHaveAttribute('title', 'Movies')

  // It is kept, and goes back with the rest.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-nav', 'icons')
  await openAppearance(page)
  await page.getByRole('button', { name: 'Reset all appearance' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-nav', 'full')
})

test('posters: the size setting changes the width of the cards in the rows', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const card = page.getByRole('region', { name: 'Latest movies' }).getByRole('button', { name: /^Open / }).first()
  await expect(card).toBeVisible()
  const width = async () => (await card.boundingBox())?.width ?? 0
  const comfortable = await width()

  await openAppearance(page)
  await page.getByRole('region', { name: 'Posters' }).locator('label', { hasText: /^Compact$/ }).click()
  await page.evaluate(() => (location.hash = '#/'))
  const compact = await width()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('region', { name: 'Posters' }).locator('label', { hasText: /^Large$/ }).click()
  await page.evaluate(() => (location.hash = '#/'))
  const large = await width()

  expect(compact).toBeLessThan(comfortable)
  expect(large).toBeGreaterThan(comfortable)
})

test('home: rows can be hidden and moved, the banner can be turned off, and it is all remembered', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const home = page.getByRole('region', { name: /^(Latest movies|New series|New anime)$/ })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Featured' })).toBeVisible()
  const order = async () => (await home.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))))
  expect(await order()).toEqual(['Latest movies', 'New series', 'New anime'])

  await openAppearance(page)
  await page.getByRole('switch', { name: 'Latest movies' }).uncheck()
  await page.getByRole('button', { name: 'Move New anime up' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'New anime is now number' })).toBeAttached()
  await page.getByRole('switch', { name: 'Featured banner' }).uncheck()

  await page.evaluate(() => (location.hash = '#/'))
  await expect(page.getByRole('region', { name: 'New series' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Latest movies' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Featured' })).toHaveCount(0)
  expect(await order()).toEqual(['New anime', 'New series'])

  await page.reload()
  await expect(page.getByRole('region', { name: 'New series' })).toBeVisible()
  expect(await order()).toEqual(['New anime', 'New series'])

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('button', { name: 'Restore the home page' }).click()
  await page.evaluate(() => (location.hash = '#/'))
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Featured' })).toBeVisible()
  expect(await order()).toEqual(['Latest movies', 'New series', 'New anime'])
})

test('every background and accent passes the automatic accessibility checks (home and settings)', async ({ page }) => {
  test.slow()
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()

  const problems: string[] = []
  const check = async (label: string) => {
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    for (const v of results.violations) problems.push(`${label}: ${v.impact} ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 100)}`)
  }

  const themes = [
    ['True black', 'Ocean'],
    ['Charcoal', 'Amber'],
    ['Midnight', 'Violet'],
    ['Dusk', 'Rose'],
    ['Pine', 'Emerald'],
    ['Cocoa', 'Silver'],
  ] as const
  for (const [canvas, accent] of themes) {
    await page.evaluate(() => (location.hash = '#/settings'))
    await page.getByRole('tab', { name: 'Appearance' }).click()
    await page.locator('label', { hasText: new RegExp(`^${canvas}$`) }).click()
    await page.getByTitle(accent).click()
    await check(`settings ${canvas}/${accent}`)
    await page.evaluate(() => (location.hash = '#/'))
    await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
    await check(`home ${canvas}/${accent}`)
  }
  expect(problems).toEqual([])
})

// Pictures of the settings page and the home page in a few themes, for the docs: `APPEARANCE_SHOTS=<folder> npx playwright test appearance`.
test('pictures of the themes', async ({ page }) => {
  test.skip(!process.env.APPEARANCE_SHOTS, 'only when asked for')
  const dir = process.env.APPEARANCE_SHOTS as string
  mock = await startMock(everything)
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page, mock, { start: '/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const shots: Array<[string, string, string]> = [['black-ocean', 'True black', 'Ocean'], ['midnight-violet', 'Midnight', 'Violet'], ['pine-emerald', 'Pine', 'Emerald'], ['cocoa-amber', 'Cocoa', 'Amber']]
  for (const [name, canvas, accent] of shots) {
    await page.evaluate(() => (location.hash = '#/settings'))
    await page.getByRole('tab', { name: 'Appearance' }).click()
    await page.locator('label', { hasText: new RegExp(`^${canvas}$`) }).click()
    await page.getByTitle(accent).click()
    await page.screenshot({ path: `${dir}/settings-${name}.png`, animations: 'disabled' })
    await page.evaluate(() => (location.hash = '#/'))
    await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${dir}/home-${name}.png`, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => (location.hash = '#/settings'))
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.screenshot({ path: `${dir}/settings-phone.png`, animations: 'disabled', fullPage: true })
  await page.evaluate(() => (location.hash = '#/'))
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${dir}/home-phone.png`, animations: 'disabled' })
  await page.getByRole('region', { name: 'Discover' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${dir}/discover-phone.png`, animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 900 })
  const row = page.getByRole('region', { name: 'Latest movies' })
  await row.scrollIntoViewIfNeeded()
  await row.getByRole('button', { name: /^More options for / }).first().click({ force: true })
  await page.screenshot({ path: `${dir}/card-menu.png`, animations: 'disabled' })
  await page.getByRole('region', { name: 'Discover' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${dir}/discover-desktop.png`, animations: 'disabled' })
})
