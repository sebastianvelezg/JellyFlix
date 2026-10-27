import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock, waitPlaying } from './helpers'

/**
 * Music in real Chrome against the mock server, which serves a real MP3 (and the same as HLS/AAC). They prove
 * the client's playback mechanics, queue and reporting, not compatibility with a real Jellyfin server.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const audio = (page: Page) => page.getByTestId('music-audio')
const bar = (page: Page) => page.getByRole('region', { name: 'Music player' })
const time = (page: Page) => audio(page).evaluate((a: HTMLAudioElement) => a.currentTime)
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })

async function waitAudio(page: Page, minTime = 0.5) {
  await page.waitForFunction(
    (min) => {
      const a = document.querySelector<HTMLAudioElement>('[data-testid=music-audio]')
      return !!a && !a.paused && a.currentTime > min && a.readyState >= 3
    },
    minTime,
  )
}

/** Opens an album from the Music tab and plays one of its songs. */
async function playSong(page: Page, album = 'Album 001-1', song = 'Song 1.1') {
  await tabs(page).getByRole('button', { name: 'Music' }).click()
  await page.getByRole('region', { name: 'Recently added' }).getByRole('button', { name: `Open album ${album}` }).click()
  await page.getByRole('button', { name: new RegExp(`^Play ${song} by`) }).click()
  await waitAudio(page)
}

test('music: plays a song from an album, with real audio, a player bar and progress reports', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playSong(page)

  await expect(bar(page)).toContainText('Song 1.1')
  await expect(bar(page).getByRole('button', { name: /Test Artist 001/ })).toBeVisible()
  await expect(audio(page)).toHaveJSProperty('paused', false)
  const stream = mock.requests.find((r) => r.path === '/Audio/tr0001-1-1/stream')
  expect(stream).toMatchObject({ auth: 'query' }) // an audio element cannot send headers
  await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing')).toBe(true)
  const start = mock.requests.find((r) => r.path === '/Sessions/Playing')
  expect(start?.body).toMatchObject({ ItemId: 'tr0001-1-1', PlayMethod: 'DirectPlay' })

  // The bar stays while you move around the app.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await tabs(page).getByRole('button', { name: 'Movies' }).click()
  await expect(bar(page)).toContainText('Song 1.1')
  expect(await time(page)).toBeGreaterThan(0.5)
})

test('music: pause, resume, seek, next, previous and volume', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playSong(page)

  await bar(page).getByRole('button', { name: 'Pause' }).click()
  await expect(audio(page)).toHaveJSProperty('paused', true)
  await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing/Progress')).toBe(true)
  await bar(page).getByRole('button', { name: 'Play', exact: true }).click()
  await expect(audio(page)).toHaveJSProperty('paused', false)

  // Seeking with the keyboard on the timeline.
  const seek = bar(page).getByRole('slider', { name: 'Seek' })
  await seek.focus()
  const before = await time(page)
  for (let i = 0; i < 6; i += 1) await seek.press('ArrowRight')
  await expect.poll(() => time(page)).toBeGreaterThan(before + 4)

  // Next: the second song of the album, and the first one is reported as stopped.
  await bar(page).getByRole('button', { name: 'Next song' }).click()
  await expect(bar(page)).toContainText('Song 1.2')
  await waitAudio(page)
  expect(mock.requests.some((r) => r.path === '/Sessions/Playing/Stopped')).toBe(true)

  // Previous, a few seconds in, starts the same song over; right at the start it goes back one.
  await expect.poll(() => time(page)).toBeGreaterThan(3.2)
  await bar(page).getByRole('button', { name: 'Previous song' }).click()
  await expect(bar(page)).toContainText('Song 1.2')
  await expect.poll(() => time(page)).toBeLessThan(2)
  await bar(page).getByRole('button', { name: 'Previous song' }).click()
  await expect(bar(page)).toContainText('Song 1.1')

  // Volume and mute.
  await bar(page).getByRole('button', { name: 'Mute' }).click()
  await expect(audio(page)).toHaveJSProperty('muted', true)
  await bar(page).getByRole('button', { name: 'Unmute' }).click()
  await expect(audio(page)).toHaveJSProperty('muted', false)
})

test('music: a finished song counts as played and the next one starts by itself', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playSong(page)
  await audio(page).evaluate((a: HTMLAudioElement) => {
    a.currentTime = 28
  })
  await expect(bar(page)).toContainText('Song 1.2', { timeout: 10_000 })
  await waitAudio(page)
  expect(mock.user.plays.get('tr0001-1-1')).toBe(1)
  const stopped = mock.requests.filter((r) => r.path === '/Sessions/Playing/Stopped').at(0)
  expect((stopped?.body as { ItemId: string; PositionTicks: number }).PositionTicks).toBeGreaterThan(270_000_000)

  // It now shows under "Jump back in" and "Most played" on the music home.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Jump back in' }).getByRole('button', { name: 'Open album Album 001-1' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Most played' })).toContainText('Song 1.1')
})

test('music: repeat one replays the song, and shuffle keeps the playing song', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playSong(page)
  await page.setViewportSize({ width: 1280, height: 800 })

  const repeat = bar(page).getByRole('button', { name: /^Repeat:/ })
  await repeat.click() // all
  await repeat.click() // one
  await expect(repeat).toHaveAccessibleName('Repeat: one')
  await audio(page).evaluate((a: HTMLAudioElement) => {
    a.currentTime = 28.5
  })
  await expect.poll(() => mock.requests.filter((r) => r.path === '/Items/tr0001-1-1/PlaybackInfo').length, { timeout: 10_000 }).toBeGreaterThan(1)
  await expect(bar(page)).toContainText('Song 1.1')
  await waitAudio(page)

  await repeat.click() // off
  const shuffle = bar(page).getByRole('button', { name: 'Shuffle' })
  await shuffle.click()
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  await expect(bar(page)).toContainText('Song 1.1')
  await shuffle.click()
  await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
})

test('music: the full-screen player lists what is coming up and can reorder by jumping and removing', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playSong(page)
  await page.getByRole('button', { name: 'Add Song 1.4 to the queue' }).click()
  await bar(page).getByRole('button', { name: 'Open the full-screen player' }).click()
  const sheet = page.getByRole('dialog', { name: 'Now playing' })
  await expect(sheet.getByRole('heading', { name: 'Song 1.1' })).toBeVisible()
  const queue = sheet.getByRole('complementary', { name: 'Queue' })
  await expect(queue.getByRole('button', { name: /^Play / })).toHaveCount(4) // 1.2, 1.3 and 1.4, and the extra 1.4 added at the end
  await queue.getByRole('button', { name: 'Remove Song 1.3 from the queue' }).click()
  await expect(queue.getByRole('button', { name: /^Play / })).toHaveCount(3)
  await queue.getByRole('button', { name: /^Play Song 1\.4 by/ }).first().click()
  await expect(sheet.getByRole('heading', { name: 'Song 1.4' })).toBeVisible()
  await waitAudio(page)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await bar(page).getByRole('button', { name: 'Close the music player' }).click()
  await expect(bar(page)).toHaveCount(0)
  await expect(audio(page)).toHaveJSProperty('paused', true)
})

test('music: a song the browser cannot play directly falls back to the server converting it (HLS)', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3, breakMedia: 'direct' })
  await signIn(page, mock)
  await playSong(page)
  await expect(bar(page)).toContainText('Song 1.1')
  const hls = mock.requests.filter((r) => r.path.startsWith('/audio/tr0001-1-1/'))
  expect(hls.length).toBeGreaterThan(1)
  expect(hls.every((r) => r.auth === 'header')).toBe(true) // hls.js sends the header, no token in the URL
  expect(hls.every((r) => !('ApiKey' in r.query))).toBe(true)
})

test('music: with the server transcoding, music plays through hls.js', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3, playMode: 'hls' })
  await signIn(page, mock)
  // Seeking to the very end would otherwise hand over to the next song at once (gapless), which has its own test.
  await page.evaluate(() => localStorage.setItem('jellyflix.player', JSON.stringify({ gapless: false })))
  await playSong(page)
  expect(mock.requests.some((r) => r.path === '/audio/tr0001-1-1/master.m3u8')).toBe(true)
  await bar(page).getByRole('slider', { name: 'Seek' }).focus()
  await page.keyboard.press('End')
  await expect.poll(() => time(page)).toBeGreaterThan(20)
})

test('music: a song that cannot be played is reported, and the next one is tried', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3, breakMedia: 'all' })
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music' }).click()
  await page.getByRole('region', { name: 'Recently added' }).getByRole('button', { name: 'Open album Album 001-1' }).click()
  await page.getByRole('button', { name: /^Play Song 1\.1 by/ }).click()
  await expect(bar(page)).toContainText('Could not play', { timeout: 10_000 })
  await expect(bar(page)).toContainText('Song 1.2', { timeout: 10_000 }) // it moved on by itself
})

test('music: playing a video stops the music', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playSong(page)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  await expect(audio(page)).toHaveJSProperty('paused', true)
})

test('music: the library tabs, search and queueing work, and the layout fits a phone', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 12 })
  await page.setViewportSize({ width: 390, height: 800 })
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Albums', exact: true }).click()
  await expect(page.getByText(/^\d+ of 24 albums$/)).toBeVisible()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search songs' }).fill('Song 2.4')
  const first = page.getByRole('region', { name: 'All songs' }).getByRole('button', { name: /^Play Song 2\.4 by/ }).first()
  await first.click()
  await waitAudio(page)
  await expect(bar(page)).toContainText('Song 2.4')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // The bar leaves room at the bottom of the page and stays on screen.
  const box = await bar(page).boundingBox()
  expect(box && box.y + box.height <= 800 + 1).toBe(true)
})

test('music: the words fill the screen, a line can be pressed to jump there, and the queue can be put away', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playSong(page)
  await bar(page).getByRole('button', { name: 'Lyrics' }).click()
  const sheet = page.getByRole('dialog', { name: 'Now playing' })
  await expect(sheet.getByRole('button', { name: 'Second line' })).toBeVisible()
  await expect(sheet.getByRole('complementary', { name: 'Queue' })).toHaveCount(0)

  await sheet.getByRole('button', { name: 'Second line' }).click() // the second line starts at 10 s
  await expect.poll(() => time(page)).toBeGreaterThan(9.5)
  await expect(sheet.getByRole('button', { name: 'Second line' })).toHaveAttribute('aria-current', 'true')

  // Back to the player, with the queue beside it; put it away and the song is alone in the middle; show it again.
  await sheet.getByRole('button', { name: 'Lyrics', exact: true }).click()
  await expect(sheet.getByRole('complementary', { name: 'Queue' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Queue', exact: true }).click()
  await expect(sheet.getByRole('complementary', { name: 'Queue' })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Queue', exact: true }).click()
  await expect(sheet.getByRole('complementary', { name: 'Queue' })).toBeVisible()
})
