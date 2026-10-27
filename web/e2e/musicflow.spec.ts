import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/**
 * How songs follow each other: the next one made ready ahead of time (gapless) and the fade between two songs, in real
 * Chrome against the mock server (its songs are 30 seconds long).
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const audio = (page: Page) => page.getByTestId('music-audio')
const bar = (page: Page) => page.getByRole('region', { name: 'Music player' })
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })

async function playFirstSong(page: Page) {
  await tabs(page).getByRole('button', { name: 'Music' }).click()
  await page.getByRole('region', { name: 'Recently added' }).getByRole('button', { name: 'Open album Album 001-1' }).click()
  await page.getByRole('button', { name: /^Play Song 1\.1 by/ }).click()
  await page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>('[data-testid=music-audio]')
    return !!a && !a.paused && a.currentTime > 0.5 && a.readyState >= 3
  })
}

const seekTo = (page: Page, seconds: number) => audio(page).evaluate((a: HTMLAudioElement, s) => void (a.currentTime = s), seconds)
const askedAbout = (id: string) => mock.requests.some((r) => r.path === `/Items/${id}/PlaybackInfo`)

test('gapless: the next song is made ready near the end and takes over at once, on the other audio element', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playFirstSong(page)
  // Early in the song nothing is prepared yet.
  expect(askedAbout('tr0001-1-2')).toBe(false)
  await page.evaluate(() => {
    ;(window as unknown as { first: Element | null }).first = document.querySelector('[data-testid=music-audio]')
  })

  await seekTo(page, 22)
  await expect.poll(() => askedAbout('tr0001-1-2')).toBe(true) // asked while the first song is still playing
  await expect(page.getByTestId('music-audio-spare')).toHaveAttribute('src', /tr0001-1-2/)
  await expect(audio(page)).toHaveJSProperty('paused', false)

  // At the end the song that was waiting is the one playing, with no loading in between.
  await expect(bar(page)).toContainText('Song 1.2', { timeout: 20_000 })
  expect(await page.evaluate(() => document.querySelector('[data-testid=music-audio]') !== (window as unknown as { first: Element }).first)).toBe(true)
  await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.3 && a.currentTime < 10)).toBe(true)
  // The first one was reported as played in full, and the new one reports itself.
  await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing/Stopped' && (r.body as { ItemId?: string })?.ItemId === 'tr0001-1-1')).toBe(true)
  await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing' && (r.body as { ItemId?: string })?.ItemId === 'tr0001-1-2')).toBe(true)
})

test('gapless can be turned off, and then nothing is prepared ahead', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Playback' }).click()
  await page.getByRole('switch', { name: 'Gapless playback' }).uncheck()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').gapless)).toBe(false)
  await page.goBack()
  await page.goto('/#/music')
  await playFirstSong(page)
  await seekTo(page, 22)
  await page.waitForTimeout(2500)
  expect(askedAbout('tr0001-1-2')).toBe(false)
  // It still goes on by itself the usual way.
  await expect(bar(page)).toContainText('Song 1.2', { timeout: 20_000 })
})

test('crossfade: the two songs play together for a moment, then the old one is let go', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Playback' }).click()
  await page.getByLabel('Crossfade between songs').selectOption('4')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').crossfadeSeconds)).toBe(4)
  await page.goto('/#/music')
  await playFirstSong(page)

  await seekTo(page, 20)
  await expect.poll(() => askedAbout('tr0001-1-2')).toBe(true)
  // Both are playing at once during the fade, the old one getting quieter.
  const spare = page.getByTestId('music-audio-spare')
  await expect
    .poll(() => spare.evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0), { timeout: 20_000 })
    .toBe(true)
  await expect(bar(page)).toContainText('Song 1.2')
  const quiet = await spare.evaluate((a: HTMLAudioElement) => a.volume)
  expect(quiet).toBeLessThan(1)
  // ...then the old one is stopped and the new one is at full volume.
  await expect.poll(() => spare.evaluate((a: HTMLAudioElement) => a.paused), { timeout: 10_000 }).toBe(true)
  await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.volume)).toBe(1)
  await expect(audio(page)).toHaveJSProperty('paused', false)
})

test('crossfade: pausing in the middle of the fade settles it at once', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await page.evaluate(() => localStorage.setItem('jellyflix.player', JSON.stringify({ crossfadeSeconds: 8 })))
  await page.goto('/#/music')
  await playFirstSong(page)
  await seekTo(page, 21)
  await expect.poll(() => page.getByTestId('music-audio-spare').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0), { timeout: 20_000 }).toBe(true)
  await bar(page).getByRole('button', { name: 'Pause' }).click()
  await expect.poll(() => page.getByTestId('music-audio-spare').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await expect(audio(page)).toHaveJSProperty('paused', true)
  await expect(audio(page)).toHaveJSProperty('volume', 1)
})

test('gapless also works when the server converts the songs (hls.js on the spare element)', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3, playMode: 'hls' })
  await signIn(page, mock)
  await playFirstSong(page)
  await page.evaluate(() => {
    ;(window as unknown as { first: Element | null }).first = document.querySelector('[data-testid=music-audio]')
  })
  await seekTo(page, 20)
  await expect.poll(() => askedAbout('tr0001-1-2')).toBe(true)
  await expect(bar(page)).toContainText('Song 1.2', { timeout: 25_000 })
  expect(await page.evaluate(() => document.querySelector('[data-testid=music-audio]') !== (window as unknown as { first: Element }).first)).toBe(true)
  await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.3)).toBe(true)
})
