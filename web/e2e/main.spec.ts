import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock, video, waitPlaying } from './helpers'

/**
 * The main page, the random picks and collections in real Chrome against the mock server. As in the other specs, this
 * proves the client's behaviour (and that what it starts really plays), not compatibility with a real Jellyfin server.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const everything = { movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3 }

test('main page: a banner with movies and series, the rows of every library and a random pick of each kind', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await expect(tabs(page).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

  const banner = page.getByRole('region', { name: 'Featured' })
  await expect(banner.getByRole('heading', { level: 2 })).toBeVisible()
  const labels = await banner.getByRole('button', { name: /^Featured title/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  expect(labels.length).toBeGreaterThan(3)
  expect(labels.some((l) => /Test Movie/.test(l))).toBe(true)
  expect(labels.some((l) => /Test (Show|Anime)/.test(l))).toBe(true)

  for (const row of ['Latest movies', 'New series', 'New anime']) {
    await expect(page.getByRole('region', { name: row })).toBeVisible()
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  for (const row of ['Collections', 'New in music']) {
    await expect(page.getByRole('region', { name: row })).toBeVisible()
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  const discover = page.getByRole('region', { name: 'Discover' })
  for (const pick of ['Random movie', 'Random series', 'Random music']) {
    await expect(discover.getByRole('article', { name: pick }).getByRole('heading', { level: 3 })).toBeVisible()
  }
  // The tabs lead to the other pages and "Home" comes back.
  await tabs(page).getByRole('button', { name: 'Movies' }).click()
  await expect(page.getByRole('region', { name: 'All movies' })).toBeVisible()
  await tabs(page).getByRole('button', { name: 'Home' }).click()
  await expect(discover).toBeVisible()
})

test('random movie: shows a pick, "Another" changes it, and Play really plays it', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const pick = page.getByRole('article', { name: 'Random movie' })
  const title = pick.getByRole('heading', { level: 3 })
  await expect(title).toHaveText(/Test Movie/)
  const seen = new Set([await title.innerText()])
  for (let i = 0; i < 8 && seen.size < 2; i += 1) {
    await pick.getByRole('button', { name: 'Another random movie' }).click()
    await expect(pick.getByRole('button', { name: /Play|Resume/ })).toBeVisible()
    seen.add(await title.innerText())
  }
  expect(seen.size).toBeGreaterThan(1) // twelve movies: eight tries that all land on one are practically impossible

  const chosen = await title.innerText()
  await pick.getByRole('button', { name: /^(Play|Resume)$/ }).click()
  await expect(video(page)).toBeVisible()
  await waitPlaying(page)
  await expect(page.getByRole('region', { name: `Playing ${chosen}` })).toBeVisible()
})

test('random series: starts from the first episode of a series nothing of which has been watched', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const pick = page.getByRole('article', { name: 'Random series' })
  await expect(pick.getByText(/Never watched/)).toBeVisible()
  const name = await pick.getByRole('heading', { level: 3 }).innerText()
  await pick.getByRole('button', { name: 'Start from the beginning' }).click()
  await expect(video(page)).toBeVisible()
  await waitPlaying(page)
  await expect(page.getByRole('region', { name: new RegExp(`^Playing ${name} · S1 E1`) })).toBeVisible()
})

test('random music: plays the album with real audio, and shuffle songs mixes the library', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const pick = page.getByRole('article', { name: 'Random music' })
  await pick.getByRole('button', { name: 'Play album' }).click()
  const bar = page.getByRole('region', { name: 'Music player' })
  await expect(bar).toBeVisible()
  await page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>('[data-testid=music-audio]')
    return !!a && !a.paused && a.currentTime > 0.5 && a.readyState >= 3
  })

  await pick.getByRole('button', { name: 'Shuffle songs' }).click()
  await expect.poll(() => mock.requests.some((r) => r.query.sortBy === 'Random' && r.query.includeItemTypes === 'Audio')).toBe(true)
  await expect(bar).toContainText(/Song \d\.\d/)
})

test('main page: Continue watching mixes a movie and an episode, and opening the episode goes to its series', async ({ page }) => {
  mock = await startMock(everything)
  mock.resume.set('m0004', 12 * 10_000_000)
  mock.resume.set('s0001-ep-1-2', 10 * 10_000_000)
  mock.user.lastPlayed.push('m0004', 's0001-ep-1-2')
  await signIn(page, mock, { start: '/' })
  const row = page.getByRole('region', { name: 'Continue watching' })
  await expect(row.getByRole('button', { name: /^Resume Test Show 001 S1 E2/ })).toBeVisible()
  await expect(row.getByRole('button', { name: /^Resume Test Movie 004/ })).toBeVisible()
  await row.getByRole('button', { name: 'Details for Episode Title 1-2' }).click({ force: true })
  await expect(page.getByRole('heading', { name: 'Test Show 001', level: 1 })).toBeVisible()
})

test('collections: row on the movies page, the list, a collection page, and playing from it', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock)
  const row = page.getByRole('region', { name: 'Collections' })
  await expect(row.getByRole('button', { name: /^Open collection/ })).toHaveCount(3)
  await row.getByRole('button', { name: /See all/ }).click()
  await expect(page).toHaveURL(/#\/collections$/)
  await expect(page.getByRole('heading', { name: 'Collections', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Open collection Test Collection 001' }).click()
  await expect(page).toHaveURL(/#\/collection\/bx0001$/)
  const article = page.getByRole('article', { name: 'Test Collection 001' })
  await expect(article.getByText('3 titles')).toBeVisible()
  await expect(article.getByRole('region', { name: 'In this collection' }).getByRole('button', { name: /^Open Test Movie/ })).toHaveCount(3)

  await article.getByRole('button', { name: /^Play$/ }).click()
  await expect(video(page)).toBeVisible()
  await waitPlaying(page)
  await expect(page.getByRole('region', { name: 'Playing Test Movie 001' })).toBeVisible()

  // Going back from the player returns to the collection.
  await page.goBack()
  await expect(page).toHaveURL(/#\/collection\/bx0001$/)
})

test('an account with only movies has no main page, and the logo goes to the movies', async ({ page }) => {
  mock = await startMock({ movieCount: 4, noTvLibrary: true })
  await signIn(page, mock, { start: '/' })
  await expect(page.getByRole('region', { name: 'All movies' })).toBeVisible()
  await expect(page).toHaveURL(/#\/movies$/)
  await expect(tabs(page)).toHaveCount(0)
  await page.getByRole('button', { name: /Jellyflix/ }).first().click()
  await expect(page).toHaveURL(/#\/movies$/)
})
