import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { clickSeekAt, currentTime, player, signIn, startMock, video, waitPlaying } from './helpers'

/**
 * A music video left with Back goes on playing in a bar at the bottom of the page, like the music, while another one is looked for. Real
 * Chrome against the mock server: it proves the client's behaviour (the same <video> never stops), not a real Jellyfin server.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const options = { movieCount: 3, musicVideos: 7, musicVideoFolders: 2, musicArtists: 3 }
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const bar = (page: Page, title: string) => page.getByRole('region', { name: `Video mini player: ${title}` })
const anyBar = (page: Page) => page.getByRole('region', { name: /^Video mini player: / })
const musicBar = (page: Page) => page.getByRole('region', { name: 'Music player' })

/** True while the <video> on the page is the one that was marked by `dock` (it was never replaced by another). */
const sameVideo = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-testid=video]') === (window as unknown as { __video?: Element }).__video)

/** Plays the first folder from its page, marks its <video> and leaves the player with Back: the video goes on in the bar. */
async function dock(page: Page) {
  await page.goto('/#/folder/mvf0001')
  await page.getByRole('button', { name: 'Play folder', exact: true }).click()
  await expect(player(page)).toBeVisible()
  await waitPlaying(page)
  await page.evaluate(() => {
    ;(window as unknown as { __video?: Element }).__video = document.querySelector('[data-testid=video]') ?? undefined
  })
  await page.mouse.move(400, 400) // wake the controls
  await player(page).getByRole('button', { name: 'Back', exact: true }).click()
  await expect(bar(page, 'Test Music Video 001')).toBeVisible()
}

test('Back keeps the music video playing in a bar; it follows you around, opens full screen again and closes', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await dock(page)

  // Back to the folder, with the bar over the page and no full-screen player.
  await expect(page).toHaveURL(/#\/folder\/mvf0001$/)
  await expect(player(page)).toHaveCount(0)
  // The same <video>, still playing: it was not stopped and started again.
  const before = await currentTime(page)
  await expect.poll(() => currentTime(page)).toBeGreaterThan(before + 0.5)
  expect(await sameVideo(page)).toBe(true)
  await expect(video(page)).toHaveJSProperty('paused', false)
  const frame = await video(page).boundingBox()
  expect(frame && frame.height).toBeLessThan(80) // a thumbnail in the bar

  // The bar passes the automatic accessibility check (names, contrast) like the rest of the page.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])

  // It follows the app around, and Esc leaves it alone (it is the page's key now).
  await tabs(page).getByRole('button', { name: 'Movies' }).click()
  await expect(bar(page, 'Test Music Video 001')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(bar(page, 'Test Music Video 001')).toBeVisible()

  // Pause and play from the bar.
  const mini = bar(page, 'Test Music Video 001')
  await mini.getByRole('button', { name: 'Pause' }).click()
  await expect(video(page)).toHaveJSProperty('paused', true)
  await mini.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(video(page)).toHaveJSProperty('paused', false)

  // Open it full screen: the same video, from where it was.
  await mini.getByRole('button', { name: /^Open the video full screen/ }).click()
  await expect(player(page)).toBeVisible()
  await expect(page).toHaveURL(/#\/play\/mv0001\?folder=mvf0001$/)
  await expect(anyBar(page)).toHaveCount(0)
  expect(await sameVideo(page)).toBe(true)
  expect(await currentTime(page)).toBeGreaterThan(before)

  // Back again, and then close the bar: the video goes away and its end is reported to the server.
  await page.mouse.move(400, 400)
  await player(page).getByRole('button', { name: 'Back', exact: true }).click()
  await bar(page, 'Test Music Video 001').getByRole('button', { name: 'Close the video player' }).click()
  await expect(anyBar(page)).toHaveCount(0)
  await expect(video(page)).toHaveCount(0)
  await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing/Stopped')).toBe(true)
})

test('playing another video takes the place of the one in the bar', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await dock(page)

  await page.getByRole('button', { name: /^Open Test Music Video 002/ }).click({ position: { x: 12, y: 12 } })
  await page.getByRole('button', { name: /^(Play|Resume from .*)$/ }).click()
  await expect(page.getByRole('region', { name: 'Playing Test Music Video 002' })).toBeVisible()
  await expect(anyBar(page)).toHaveCount(0)
  await waitPlaying(page)
  await expect(video(page)).toHaveCount(1) // the first one is gone, not playing behind it

  await page.mouse.move(400, 400)
  await player(page).getByRole('button', { name: 'Back', exact: true }).click()
  await expect(anyBar(page)).toHaveCount(1)
  await expect(bar(page, 'Test Music Video 002')).toBeVisible()
})

test('the next video of the queue follows inside the bar, without taking the page along', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await dock(page)

  await clickSeekAt(page, 0.85) // near the end: the 3-2-1 and the next one
  await expect(bar(page, 'Test Music Video 002')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/#\/folder\/mvf0001$/)
  await expect(player(page)).toHaveCount(0)
  await waitPlaying(page) // from its start, on its own
  await expect(video(page)).toHaveCount(1)

  // "Next title" in the bar moves on as well.
  await bar(page, 'Test Music Video 002').getByRole('button', { name: 'Next title' }).click()
  await expect(bar(page, 'Test Music Video 003')).toBeVisible({ timeout: 15_000 })
})

test('video and music take turns: the video pauses the music and holds the bar, a song takes the bar back', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  const audio = page.getByTestId('music-audio')

  // A song is playing...
  await tabs(page).getByRole('button', { name: 'Music', exact: true }).click()
  await page.getByRole('region', { name: 'Recently added' }).getByRole('button', { name: 'Open album Album 001-1' }).click()
  await page.getByRole('button', { name: /^Play Song 1\.1 by/ }).click()
  await expect(musicBar(page)).toContainText('Song 1.1')
  await expect(audio).toHaveJSProperty('paused', false)

  // ...a music video starts: the music waits, and in the bar the video has the place.
  await dock(page)
  await expect(audio).toHaveJSProperty('paused', true)
  await expect(musicBar(page)).toHaveCount(0)

  // Closing the video gives the bar back to the music (paused where it was).
  await bar(page, 'Test Music Video 001').getByRole('button', { name: 'Close the video player' }).click()
  await expect(musicBar(page)).toContainText('Song 1.1')
  await expect(audio).toHaveJSProperty('paused', true)

  // Video again, and this time a song is started while it is in the bar: the song takes the place.
  await dock(page)
  await tabs(page).getByRole('button', { name: 'Music', exact: true }).click()
  await page.getByRole('region', { name: 'Recently added' }).getByRole('button', { name: 'Open album Album 001-1' }).click()
  await page.getByRole('button', { name: /^Play Song 1\.2 by/ }).click()
  await expect(anyBar(page)).toHaveCount(0)
  await expect(video(page)).toHaveCount(0)
  await expect(musicBar(page)).toContainText('Song 1.2')
})

test('the browser\'s own Back (a back gesture, a mouse button) also keeps the video in the bar', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await page.goto('/#/folder/mvf0001')
  await page.getByRole('button', { name: 'Play folder', exact: true }).click()
  await waitPlaying(page)
  await page.evaluate(() => {
    ;(window as unknown as { __video?: Element }).__video = document.querySelector('[data-testid=video]') ?? undefined
  })
  await page.goBack()
  await expect(bar(page, 'Test Music Video 001')).toBeVisible()
  await expect(page).toHaveURL(/#\/folder\/mvf0001$/)
  expect(await sameVideo(page)).toBe(true)
  await expect(video(page)).toHaveJSProperty('paused', false)
})

test('closing the bar leaves nothing behind, and a new viewing is kept again when it is left', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await page.goto('/#/folder/mvf0001')
  await page.getByRole('button', { name: 'Play folder', exact: true }).click()
  await waitPlaying(page)
  // Closing from the bar leaves nothing behind (the video is stopped, not waiting to be docked again).
  await page.goBack()
  await bar(page, 'Test Music Video 001').getByRole('button', { name: 'Close the video player' }).click()
  await expect(anyBar(page)).toHaveCount(0)
  await page.goForward()
  await expect(player(page)).toBeVisible() // the full-screen player starts it afresh
  await waitPlaying(page)
  await page.goBack()
  await expect(bar(page, 'Test Music Video 001')).toBeVisible() // and leaving it keeps it again
})
