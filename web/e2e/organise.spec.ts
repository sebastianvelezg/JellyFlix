import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { clickSeekAt, player, signIn, startMock, video, waitPlaying } from './helpers'

/** Finding things and keeping them: library filters, playlists and Watch later, what is new, and backing up the settings. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3, upcoming: true }

const cardMenu = (page: Page, title: string) =>
  page.getByRole('region', { name: 'Latest movies' }).getByRole('button', { name: `More options for ${title}` })

test('filters: decade, tag and quality narrow a library, are remembered, and can be cleared', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/#/movies', keep: true })
  const all = page.getByRole('region', { name: 'All movies' })
  await expect(all).toContainText('12 of 12 movies')

  await page.getByRole('button', { name: 'More filters' }).click()
  const panel = page.getByRole('group', { name: 'More filters' })
  await panel.getByLabel('Decade').selectOption('2010')
  await expect(all).toContainText('3 of 3 movies') // 2010, 2011 and 2012
  expect(mock.requests.some((r) => r.path === '/Items' && r.queryAll.years?.includes('2011'))).toBe(true)

  await panel.getByLabel('Decade').selectOption('')
  await panel.getByLabel('Tag').selectOption('Classic')
  await expect(all).toContainText('3 of 3 movies') // every fourth movie
  await panel.locator('label', { hasText: /^Rating/ }).locator('select').selectOption('8')
  await expect(all).toContainText('1 of 1 movies') // the Classic one rated 8 or more
  await expect(page.getByRole('button', { name: /More filters/ })).toContainText('2')
  await panel.getByLabel('Quality').selectOption('uhd')
  await expect(all).toContainText('Nothing matches these filters') // no Classic 4K movie rated 8 or more
  await panel.getByLabel('Quality').selectOption('')

  // Remembered for this library: still on after a reload.
  await page.reload()
  await expect(page.getByRole('region', { name: 'All movies' })).toContainText('1 of 1 movies')
  await expect(page.getByRole('group', { name: 'More filters' })).toBeVisible()

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('region', { name: 'All movies' })).toContainText('12 of 12 movies')
})

test('filters: genres, decades, ratings and tags come from one request, not two', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/#/movies' })
  await expect(page.getByRole('region', { name: 'All movies' })).toContainText('12 of 12 movies')
  await page.waitForLoadState('networkidle')
  // On a big library this call costs the server a scan of everything (5 s measured), so it is made once and shared.
  expect(mock.requests.filter((r) => r.path === '/Items/Filters')).toHaveLength(1)
  await page.getByRole('button', { name: 'More filters' }).click()
  await expect(page.getByRole('group', { name: 'More filters' }).getByLabel('Tag')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Genre' }).or(page.getByLabel('Genre'))).toBeVisible()
  expect(mock.requests.filter((r) => r.path === '/Items/Filters')).toHaveLength(1) // still the same one
})

test('watch later and playlists: add from the card menu, see them at home, rename, move, remove with undo, delete', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()

  // Watch later, in one click.
  await cardMenu(page, 'Test Movie 012').click({ force: true })
  await page.getByRole('menuitem', { name: 'Watch later' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Added Test Movie 012 to Watch later.' })).toBeVisible()
  const watchLater = page.getByRole('region', { name: 'Watch later' })
  await expect(watchLater.getByRole('button', { name: /^Open Test Movie 012/ })).toBeVisible()
  // Twice does not add it twice.
  await cardMenu(page, 'Test Movie 012').click({ force: true })
  await page.getByRole('menuitem', { name: 'Watch later' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Test Movie 012 is already in Watch later.' })).toBeVisible()

  // A playlist of your own, made from the picker.
  await cardMenu(page, 'Test Movie 011').click({ force: true })
  await page.getByRole('menuitem', { name: 'Add to a playlist…' }).click()
  const picker = page.getByRole('dialog', { name: 'Add to a playlist' })
  await expect(picker).toBeVisible()
  await picker.getByLabel('New playlist name').fill('Weekend')
  await picker.getByRole('button', { name: 'Create' }).click()
  await expect(picker).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Created Weekend with Test Movie 011.' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Your playlists' }).getByRole('button', { name: 'Open playlist Weekend' })).toBeVisible()

  // Add a second one to it from the picker's list.
  await cardMenu(page, 'Test Movie 010').click({ force: true })
  await page.getByRole('menuitem', { name: 'Add to a playlist…' }).click()
  await picker.getByRole('button', { name: /^Weekend/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Added Test Movie 010 to Weekend.' })).toBeVisible()

  await page.getByRole('button', { name: 'Open playlist Weekend' }).click()
  await expect(page.getByRole('heading', { name: 'Weekend' })).toBeVisible()
  const titles = () => page.getByRole('list', { name: 'Titles in this playlist' }).getByRole('listitem').evaluateAll((els) => els.map((e) => e.querySelector('span span')?.textContent))
  expect(await titles()).toEqual(['Test Movie 011', 'Test Movie 010'])

  await page.getByRole('button', { name: 'Move Test Movie 010 up' }).click()
  await expect.poll(titles).toEqual(['Test Movie 010', 'Test Movie 011'])
  await page.reload()
  await expect.poll(titles).toEqual(['Test Movie 010', 'Test Movie 011']) // the server has the new order

  await page.getByRole('button', { name: 'Remove Test Movie 010 from the playlist' }).click()
  await expect.poll(titles).toEqual(['Test Movie 011'])
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(titles).toEqual(['Test Movie 010', 'Test Movie 011']) // back in the place it was

  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByLabel('Playlist name', { exact: true }).fill('Friday night')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Friday night' })).toBeVisible()

  await page.getByRole('button', { name: 'Delete playlist' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  // Back where it was opened from: the home page, now with no playlist of its own.
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  // The rows below are only built when they come near the screen.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(page.getByRole('region', { name: 'Your playlists' }).getByRole('button', { name: 'Make a playlist' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open playlist Friday night' })).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.getByRole('region', { name: 'Watch later' })).toBeVisible()
})

test('home: what is new since your last visit, and what is coming up', async ({ page }) => {
  mock = await startMock(everything)
  // Last here on 10 January 2024: movies 10 to 12 (added 11 to 13 January) and every series are newer than that.
  await page.addInitScript(() => localStorage.setItem('jellyflix.visit', JSON.stringify({ since: Date.UTC(2024, 0, 10), seen: Date.now() })))
  await signIn(page, mock, { start: '/' })
  const fresh = page.getByRole('region', { name: 'New since your last visit' })
  await expect(fresh.getByRole('button', { name: /^Open Test Movie 012/ })).toBeVisible()
  await expect(fresh.getByRole('button', { name: /^Open Test Movie 005/ })).toHaveCount(0)

  const soon = page.getByRole('region', { name: 'Coming up' })
  await expect(soon.getByRole('button', { name: /^Open Test Show 001/ }).first()).toBeVisible()
})

test('home: with no earlier visit there is nothing "new since" to show', async ({ page }) => {
  mock = await startMock({ ...everything, upcoming: false })
  await signIn(page, mock, { start: '/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'New since your last visit' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Coming up' })).toHaveCount(0)
})

test('settings backup: export to a file, import it, and keep the settings on the server', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/', keep: true })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('region', { name: 'Posters' }).locator('label', { hasText: /^Large$/ }).click()
  await page.getByRole('tab', { name: 'About' }).click()

  // Export: a file with the preferences and nothing of the account.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export to a file' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('jellyflix-settings.json')
  const text = readFileSync(await file.path(), 'utf8')
  expect(JSON.parse(text).settings['jellyflix.appearance'].posterSize).toBe('large')
  expect(text).not.toMatch(/token|secret|127\.0\.0\.1/i)

  // A file that is not ours is refused.
  await page.getByLabel('Settings file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') })
  await expect(page.getByRole('alert').filter({ hasText: 'not a settings file' })).toBeVisible()

  // Save on the server, change something, load it back.
  await page.getByRole('button', { name: 'Save on the server' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved your settings on the server' })).toBeVisible()
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('region', { name: 'Posters' }).locator('label', { hasText: /^Compact$/ }).click()
  expect(await page.evaluate(() => document.documentElement.dataset.posters)).toBe('compact')
  await page.getByRole('tab', { name: 'About' }).click()
  await page.getByRole('button', { name: 'Load from the server' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Restarting' })).toBeVisible()
  await page.waitForFunction(() => document.documentElement.dataset.posters === 'large')

  // Import the exported file in the (now) same browser.
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'About' }).click()
  await page.getByLabel('Settings file').setInputFiles({ name: 'jellyflix-settings.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(page.getByRole('status').filter({ hasText: 'Restarting' })).toBeVisible()
})

test('the new screens pass the automatic accessibility checks', async ({ page }) => {
  mock = await startMock(everything)
  await page.addInitScript(() => localStorage.setItem('jellyflix.visit', JSON.stringify({ since: Date.UTC(2024, 0, 10), seen: Date.now() })))
  await signIn(page, mock, { start: '/#/movies' })
  const problems: string[] = []
  const check = async (label: string) => {
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    for (const v of results.violations) problems.push(`${label}: ${v.impact} ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 120)}`)
  }

  await page.getByRole('button', { name: 'More filters' }).click()
  await expect(page.getByRole('group', { name: 'More filters' })).toBeVisible()
  await check('library filters')

  await page.evaluate(() => (location.hash = '#/'))
  await expect(page.getByRole('region', { name: 'New since your last visit' })).toBeVisible()
  await check('home with the new rows')

  await cardMenu(page, 'Test Movie 012').click({ force: true })
  await page.getByRole('menuitem', { name: 'Add to a playlist…' }).click()
  const picker = page.getByRole('dialog', { name: 'Add to a playlist' })
  await picker.getByLabel('New playlist name').fill('Weekend')
  await picker.getByRole('button', { name: 'Create' }).click()
  await expect(picker).toBeHidden()
  await page.evaluate(() => (location.hash = '#/lists'))
  await expect(page.getByRole('heading', { name: 'Playlists' })).toBeVisible()
  await check('the playlists page')
  await page.getByRole('button', { name: 'Open playlist Weekend' }).click()
  await expect(page.getByRole('heading', { name: 'Weekend' })).toBeVisible()
  await check('one playlist')

  await page.evaluate(() => (location.hash = '#/settings'))
  await page.getByRole('tab', { name: 'About' }).click()
  await check('settings backup')
  expect(problems).toEqual([])
})

test('a playlist plays through: when one title ends the next one of the list follows', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await expect(page.getByRole('region', { name: 'Latest movies' })).toBeVisible()
  for (const title of ['Test Movie 012', 'Test Movie 011']) {
    await cardMenu(page, title).click({ force: true })
    await page.getByRole('menuitem', { name: 'Watch later' }).click()
    await expect(page.getByRole('status').filter({ hasText: `Added ${title} to Watch later.` })).toBeVisible()
  }
  await page.getByRole('button', { name: 'See all in Watch later' }).click()
  await expect(page.getByRole('heading', { name: 'Watch later' })).toBeVisible()
  await page.getByRole('button', { name: 'Play all' }).click()
  await expect(video(page)).toBeVisible()
  await waitPlaying(page)
  await expect(page).toHaveURL(/#\/play\/m0012\?list=/)

  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  const upNext = page.getByRole('status', { name: 'Up next' })
  await expect(upNext).toContainText('Test Movie 011')
  await upNext.getByRole('button', { name: 'Play now' }).click()
  await expect(page).toHaveURL(/#\/play\/m0011\?list=/)
  await waitPlaying(page)
  // The last title of the list has nothing after it.
  await clickSeekAt(page, 0.97)
  await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
  await expect(page.getByRole('status', { name: 'Up next' })).toHaveCount(0)
  await player(page).getByRole('button', { name: 'Back', exact: true }).click()
})
