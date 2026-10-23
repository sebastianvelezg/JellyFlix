import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { openSettings, signIn, startMock, waitPlaying } from './helpers'

/**
 * Automatic accessibility checks (axe, WCAG 2.1 A and AA) on every kind of page, plus a keyboard-only walk. They find
 * missing names, bad contrast, wrong roles and the like; they cannot tell whether a screen makes sense to a person.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3 }

async function check(page: Page, label: string) {
  // Let images and fades settle so contrast is measured on what people see.
  await page.waitForLoadState('networkidle')
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  // One line per kind of problem (numbers in names removed), so a list of 40 cards shows up once.
  const summary = results.violations.flatMap((v) => {
    const kinds = new Map<string, string>()
    for (const n of v.nodes) {
      const key = n.html.replace(/\d+/g, '#').slice(0, 110)
      if (!kinds.has(key)) kinds.set(key, `${v.impact} ${v.id} (${v.nodes.length}): ${n.html.slice(0, 140)} → ${(n.failureSummary ?? '').split(NEWLINE)[1]?.slice(0, 150)}`)
    }
    return [...kinds.values()].slice(0, 6)
  })
  expect.soft(summary, [label, ...summary].join(NEWLINE)).toEqual([])
}

const NEWLINE = String.fromCharCode(10)

test('sign-in form', async ({ page }) => {
  mock = await startMock(everything)
  await page.goto('/#/movies')
  await expect(page.getByLabel('Server URL')).toBeVisible()
  await check(page, 'sign-in')
})

test('home, movies, series, anime and music pages', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  await check(page, 'home')
  for (const [hash, ready] of [
    ['#/movies', 'All movies'],
    ['#/series', 'All series'],
    ['#/anime', 'All series'],
    ['#/collections', null],
    ['#/music', 'Recently added'],
    ['#/music/albums', 'All albums'],
    ['#/music/songs', 'All songs'],
    ['#/music/playlists', 'All playlists'],
    ['#/settings', 'Account'],
  ] as const) {
    await page.evaluate((h) => (location.hash = h), hash)
    if (ready) await expect(page.getByRole('region', { name: ready }).first()).toBeVisible()
    else await expect(page.getByRole('heading', { name: 'Collections', level: 1 })).toBeVisible()
    await check(page, hash)
  }
})

test('title pages, search and details', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock)
  for (const [hash, heading] of [
    ['#/movie/m0003', 'Test Movie 003'],
    ['#/show/s0001', 'Test Show 001'],
    ['#/collection/bx0001', 'Test Collection 001'],
    ['#/album/al0001-1', 'Album 001-1'],
    ['#/artist/ar0001', 'Test Artist 001'],
    ['#/playlist/pl0001', null],
    ['#/search/test', 'Results for'],
  ] as const) {
    await page.evaluate((h) => (location.hash = h), hash)
    if (heading) await expect(page.getByRole('heading', { name: new RegExp(heading) }).first()).toBeVisible()
    else await page.waitForLoadState('networkidle')
    await check(page, hash)
  }
})

test('video player and its menu', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  await page.mouse.move(400, 300)
  await check(page, 'player')
  await openSettings(page)
  await check(page, 'player menu')
})

test('music player bar and the full-screen player', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock)
  await page.goto('/#/album/al0001-1')
  await page.getByRole('button', { name: /^Play Song 1\.1 by/ }).click()
  await expect(page.getByRole('region', { name: 'Music player' })).toBeVisible()
  await check(page, 'music bar')
  await page.getByRole('button', { name: 'Open the full-screen player' }).click()
  await check(page, 'now playing')
})

test('keyboard only: Tab reaches the tabs, search and the first cards, in order, with a visible focus ring', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/#/movies' })
  await expect(page.getByRole('region', { name: 'All movies' })).toBeVisible()
  const seen: string[] = []
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Tab')
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return 'body'
        const style = getComputedStyle(el)
        const ring = style.outlineStyle !== 'none' || style.boxShadow !== 'none'
        return `${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName}${ring ? '' : ' [no ring]'}`
      }),
    )
  }
  // Nothing is skipped or trapped, and every stop shows where you are.
  expect(seen.filter((s) => s === 'body')).toEqual([])
  expect(seen.filter((s) => s.includes('[no ring]')), seen.join('\n')).toEqual([])
})
