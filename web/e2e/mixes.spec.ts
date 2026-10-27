import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** The mix of the day, the radios, and a radio from one song, in real Chrome against the mock server. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const bar = (page: Page) => page.getByRole('region', { name: 'Music player' })
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })

async function waitAudio(page: Page) {
  await page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>('[data-testid=music-audio]')
    return !!a && !a.paused && a.currentTime > 0.3 && a.readyState >= 3
  })
}

test('music home: a mix of the day made from your favourites, the same all day, and a new one on request', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 4 })
  mock.user.favorites.add('tr0003-1-1')
  mock.user.favorites.add('tr0003-2-2')
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music' }).click()

  const row = page.getByRole('region', { name: 'Made for you' })
  await expect(row.getByRole('button', { name: 'Play Mix of the day' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Play Test Artist 003 radio' })).toBeVisible()
  // It leaned on the artist of the songs that are favourites.
  expect(mock.adminLog).toContain('mix Artists ar0003')

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.daymix') ?? 'null'))
  expect(stored.ids.length).toBeGreaterThan(10)
  expect(stored.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  // Opening Music again the same day shows the same mix without asking the server for new radios.
  const askedBefore = mock.adminLog.filter((l) => l.startsWith('mix ')).length
  await page.reload()
  await expect(page.getByRole('region', { name: 'Made for you' }).getByRole('button', { name: 'Play Mix of the day' })).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('mix ')).length).toBe(askedBefore)
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.daymix') ?? 'null'))).ids).toEqual(stored.ids)

  // Playing it starts the first song of the mix, with the rest queued.
  await page.getByRole('region', { name: 'Made for you' }).getByRole('button', { name: 'Play Mix of the day' }).click()
  await waitAudio(page)
  await expect(bar(page)).toBeVisible()

  // "Make another mix" asks for a fresh one.
  await page.getByRole('button', { name: 'Make another mix' }).click()
  await expect.poll(() => mock.adminLog.filter((l) => l.startsWith('mix ')).length).toBeGreaterThan(askedBefore)
})

test('artist radio: a button on the artist page starts songs that go with the artist', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 4 })
  await signIn(page, mock)
  await page.goto('/#/artist/ar0002')
  await page.getByRole('button', { name: 'Radio', exact: true }).click()
  await waitAudio(page)
  expect(mock.adminLog).toContain('mix Artists ar0002')
  await expect(bar(page).getByRole('button', { name: /Test Artist 002/ })).toBeVisible() // the artist's own songs come first
})

test('album radio and song radio', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 4 })
  await signIn(page, mock)
  await page.goto('/#/album/al0001-1')
  await page.getByRole('button', { name: 'Radio', exact: true }).click()
  await waitAudio(page)
  expect(mock.adminLog).toContain('mix Albums al0001-1')

  // From one song: that song plays first, the radio follows it.
  await page.getByRole('button', { name: 'Start a radio from Song 1.2' }).click({ force: true })
  await expect(bar(page)).toContainText('Song 1.2')
  expect(mock.adminLog).toContain('mix Songs tr0001-1-2')
})

test('the new music screens pass the automatic accessibility checks', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 4 })
  mock.user.favorites.add('tr0003-1-1')
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music' }).click()
  await expect(page.getByRole('region', { name: 'Made for you' })).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
})
