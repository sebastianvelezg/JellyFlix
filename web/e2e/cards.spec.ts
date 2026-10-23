import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** The poster card's "⋯" menu and the Discover tiles, in real Chrome against the mock server. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3 }

test('card menu: opens from the ⋯ button, works with the keyboard, and marks a title watched and favorite', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const row = page.getByRole('region', { name: 'Latest movies' })
  const card = row.getByRole('button', { name: /^Open Test Movie 012/ })
  await expect(card).toBeVisible()
  const more = row.getByRole('button', { name: 'More options for Test Movie 012' })

  // Hidden until the card is hovered or focused.
  await expect(more).toHaveCSS('opacity', '0')
  await card.hover()
  await expect(more).toHaveCSS('opacity', '1')

  await more.click()
  const menu = page.getByRole('menu', { name: 'Options for Test Movie 012' })
  await expect(menu).toBeVisible()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByRole('menuitem', { name: 'Details' })).toBeFocused()

  // Arrow keys move through the entries (and wrap); Escape closes it and gives the focus back.
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Watch later' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Mark as watched' })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'Edit…' })).toBeFocused() // wrapped round to the last one (the mock account is an administrator)
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'Add to favorites' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(more).toBeFocused()

  await more.click()
  await page.getByRole('menuitem', { name: 'Mark as watched' }).click()
  await expect(row.getByTitle('Watched')).toBeVisible()
  await more.click({ force: true })
  await page.getByRole('menuitem', { name: 'Add to favorites' }).click()
  await expect(row.getByTitle('Favorite')).toBeVisible()

  // The menu reflects the new state, and a click elsewhere closes it.
  await more.click({ force: true })
  await expect(page.getByRole('menuitem', { name: 'Mark as unwatched' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Remove from favorites' })).toBeVisible()
  await page.mouse.click(5, 300)
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Details opens the title's page.
  await more.click({ force: true })
  await page.getByRole('menuitem', { name: 'Details' }).click()
  await expect(page.getByRole('heading', { name: 'Test Movie 012' })).toBeVisible()
})

test.describe('on a touchscreen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('the ⋯ button is always there, since there is no hover', async ({ page }) => {
    mock = await startMock(everything)
    await signIn(page, mock, { start: '/' })
    const more = page.getByRole('region', { name: 'Latest movies' }).getByRole('button', { name: 'More options for Test Movie 012' })
    await expect(more).toHaveCSS('opacity', '1')
    const box = await more.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(40)
  })
})

test('discover: one main button, and quiet icon buttons that still have names', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const movie = page.getByRole('article', { name: 'Random movie' })
  await expect(movie.getByRole('button', { name: /^(Play|Resume)$/ })).toBeVisible()
  await expect(movie.getByRole('button', { name: 'Details' })).toBeVisible()
  await expect(movie.getByRole('button', { name: 'Another random movie' })).toBeVisible()

  const series = page.getByRole('article', { name: 'Random series' })
  await expect(series.getByRole('button', { name: 'Start from the beginning' })).toHaveText('Start')

  const music = page.getByRole('article', { name: 'Random music' })
  await expect(music.getByRole('button', { name: 'Play album' })).toBeVisible()
  await expect(music.getByRole('button', { name: 'Shuffle songs' })).toBeVisible()
  // Nothing wraps onto a second line: the main button is one line tall.
  const box = await music.getByRole('button', { name: 'Play album' }).boundingBox()
  expect(box?.height).toBeLessThan(50)
})
