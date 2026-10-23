import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { startMock } from './helpers'

/**
 * The pages hold their layout: with every library the mock can have, in English and in Spanish, each background paired with a
 * different screen width (from a small phone to a wide monitor), no page is wider than the screen and the menu stays inside it.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const THEMES = [/^(True black|Negro puro)$/, /^(Charcoal|Carbón)$/, /^(Midnight|Medianoche)$/, /^(Dusk|Crepúsculo)$/, /^(Pine|Pino)$/, /^(Cocoa|Cacao)$/] as const
const WIDTHS = [360, 768, 1024, 1280, 1600, 1900] as const
const ROUTES = ['#/', '#/movies', '#/books', '#/musicvideos', '#/livetv', '#/settings'] as const

/** The sign-in of the other tests, with the words of either language. */
async function signInAnyLanguage(page: Page, mock: MockServer) {
  await page.goto('/')
  await page.getByLabel(/^(Server URL|Dirección del servidor)/).fill(mock.url)
  await page.getByLabel(/^(Username|Usuario)/).fill('tester')
  await page.getByLabel(/^(Password|Contraseña)/).fill('secret')
  await page.getByRole('button', { name: /^(Connect|Conectar)$/ }).click()
  await expect(page.locator('header nav').first()).toBeAttached()
}

async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const wide = document.documentElement.scrollWidth - window.innerWidth
    const problems: string[] = []
    if (wide > 1) {
      // Name the first thing that sticks out, to make the message worth reading.
      const clipped = (el: Element) => {
        for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
          const { overflowX, position } = getComputedStyle(up)
          if (position === 'fixed' || overflowX !== 'visible') return true
        }
        return false
      }
      const culprit = Array.from(document.body.querySelectorAll('*')).find((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && el.getClientRects().length > 0 && !clipped(el))
      problems.push(`page is ${wide}px wider than the screen (${culprit?.tagName.toLowerCase()}.${String(culprit?.className).slice(0, 80)})`)
    }
    for (const bar of Array.from(document.querySelectorAll('nav'))) {
      const box = bar.getBoundingClientRect()
      if (box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1)) problems.push(`menu sticks out (${Math.round(box.left)}..${Math.round(box.right)})`)
    }
    return problems
  })
}

for (const [locale, appearance] of [['en-US', 'Appearance'], ['es-ES', 'Apariencia']] as const) {
  test.describe(locale, () => {
    test.use({ locale })

    test(`${locale}: pages fit the screen on every background and width`, async ({ page }) => {
      test.slow()
      mock = await startMock({ movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3, musicVideos: 3, books: 3, liveTv: 4 })
      await page.setViewportSize({ width: WIDTHS[0], height: 800 })
      await signInAnyLanguage(page, mock)
      const problems: string[] = []
      for (const [i, theme] of THEMES.entries()) {
        const width = WIDTHS[i] ?? 1280
        await page.setViewportSize({ width, height: 800 })
        await page.evaluate(() => (location.hash = '#/settings'))
        await page.getByRole('tab', { name: appearance }).click()
        await page.getByRole('radio', { name: theme }).check({ force: true })
        for (const route of ROUTES) {
          await page.evaluate((hash) => (location.hash = hash), route)
          await page.waitForTimeout(350)
          for (const p of await overflow(page)) problems.push(`${locale} #${i} ${width}px ${route}: ${p}`)
        }
      }
      expect(problems).toEqual([])
    })
  })
}
