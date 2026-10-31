import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { startMock } from './helpers'

/** The interface in Spanish and English: following the browser, switching in Settings, and remembering the choice. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3 }

test.describe('a browser set to Spanish', () => {
  test.use({ locale: 'es-CO' })

  test('opens in Spanish, from the sign-in form to the pages, and can be switched to English and back', async ({ page }) => {
    mock = await startMock(everything)
    await page.goto('/#/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByRole('button', { name: 'Conectar' })).toBeVisible()
    await page.getByLabel('Dirección del servidor').fill(mock.url)
    await page.getByLabel('Usuario').fill('tester')
    await page.getByLabel('Contraseña').fill('secret')
    await page.getByRole('button', { name: 'Conectar' }).click()

    const tabs = page.getByRole('navigation', { name: 'Secciones' }).first()
    await expect(tabs.getByRole('button')).toHaveText(['Inicio', 'Películas', 'Series', 'Anime', 'Música'])
    await expect(page.getByRole('region', { name: 'Últimas películas' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Descubrir' }).getByRole('article', { name: 'Película al azar' })).toBeVisible()
    expect(await page.title()).toBe('Inicio · Jellyflix')

    // A movie page, a series page and the music pages.
    await page.evaluate(() => (location.hash = '#/movie/m0003'))
    await expect(page.getByRole('button', { name: 'Marcar como visto' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Añadir a favoritos' })).toBeVisible()
    await page.evaluate(() => (location.hash = '#/show/s0001'))
    await expect(page.getByRole('button', { name: 'Reproducir S1 E1', exact: true })).toBeVisible()
    await page.evaluate(() => (location.hash = '#/music'))
    await expect(page.getByRole('region', { name: 'Añadido recientemente' })).toBeVisible()

    // Switch to English in Settings: it changes at once, and survives a reload.
    await page.getByRole('button', { name: 'Ajustes' }).click()
    await page.getByLabel('Idioma').selectOption('en')
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const englishTabs = page.getByRole('navigation', { name: 'Sections' }).first()
    await expect(englishTabs.getByRole('button')).toHaveText(['Home', 'Movies', 'Series', 'Anime', 'Music'])
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.ui') ?? '{}').language)).toBe('en')

    // ...and back to following the browser.
    await page.getByLabel('Language').selectOption('auto')
    await expect(page.getByRole('heading', { name: 'Ajustes', level: 1 })).toBeVisible()
  })

  test('the player and its menu speak Spanish, and subtitle sync is announced in Spanish', async ({ page }) => {
    mock = await startMock(everything)
    await page.goto('/#/play/m0001')
    await page.getByLabel('Dirección del servidor').fill(mock.url)
    await page.getByLabel('Usuario').fill('tester')
    await page.getByLabel('Contraseña').fill('secret')
    await page.getByRole('button', { name: 'Conectar' }).click()
    const player = page.getByRole('region', { name: /^Reproduciendo / })
    await expect(player).toBeVisible()
    await page.mouse.move(400, 300)
    await player.getByRole('button', { name: 'Audio, subtítulos y velocidad' }).click()
    const menu = page.getByRole('dialog', { name: 'Ajustes de reproducción' })
    await menu.getByRole('button', { name: /^Subtítulos/ }).click()
    await expect(menu.getByText('Cargar un archivo de subtítulos (.srt, .vtt)…')).toBeVisible()
    await menu.getByLabel('English', { exact: true }).check()
    await page.keyboard.press('Escape')
    await player.focus()
    await page.keyboard.press('x')
    await expect(page.getByRole('status').filter({ hasText: 'Subtítulos:' })).toContainText('+0.1 s (más tarde)')
  })
})

test('a browser set to English shows English, and Settings can switch it to Spanish', async ({ page }) => {
  mock = await startMock(everything)
  await page.goto('/#/settings')
  await page.getByLabel('Server URL').fill(mock.url)
  await page.getByLabel('Username').fill('tester')
  await page.getByLabel('Password').fill('secret')
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByLabel('Language').selectOption('es')
  await expect(page.getByRole('heading', { name: 'Ajustes', level: 1 })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
})
