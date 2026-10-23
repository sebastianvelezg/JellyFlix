import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { openSettings, signIn, startMock, video, waitPlaying } from './helpers'

/** The seek bar's pictures, the quality limit, your stats, and the music sleep timer and queue, in real Chrome against the mock server. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 3, collections: 3 }
const audio = (page: Page) => page.getByTestId('music-audio')

test('trickplay: pointing at the seek bar shows the picture of that moment, and moves with the pointer', async ({ page }) => {
  mock = await startMock({ ...everything, trickplay: true })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const seek = page.getByRole('slider', { name: 'Seek' })
  const box = await seek.boundingBox()
  if (!box) throw new Error('no seek bar')

  const thumb = page.getByTestId('trickplay-thumb')
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height / 2)
  await expect(thumb).toBeVisible()
  await expect(thumb).toHaveCSS('background-image', /^url\("blob:/) // the sheet came with the Authorization header, as a picture in the page
  const early = await thumb.evaluate((el) => (el as HTMLElement).style.backgroundPosition)
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2)
  await expect.poll(() => thumb.evaluate((el) => (el as HTMLElement).style.backgroundPosition)).not.toBe(early)

  // One sheet, asked for once, with the header and no token in the address.
  const sheets = mock.requests.filter((r) => r.path.startsWith('/Videos/m0001/Trickplay/'))
  expect(sheets).toHaveLength(1)
  expect(sheets[0]).toMatchObject({ auth: 'header' })
  expect('ApiKey' in (sheets[0]?.query ?? {})).toBe(false)
})

test('trickplay: a server without the pictures just shows the time', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const box = await page.getByRole('slider', { name: 'Seek' }).boundingBox()
  if (!box) throw new Error('no seek bar')
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
  await expect(page.getByTestId('trickplay-thumb')).toHaveCount(0)
  expect(mock.requests.some((r) => r.path.includes('/Trickplay/'))).toBe(false)
})

test('quality: the limit can be chosen in Settings before anything plays, and a live channel asks with it too', async ({ page }) => {
  mock = await startMock({ ...everything, liveTv: 3 })
  await signIn(page, mock, { keep: true })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Playback' }).click()
  await page.getByLabel('Maximum quality').selectOption({ label: 'Up to 4 Mbps' })
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const asked = mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/m0001/PlaybackInfo')
  expect((asked.at(-1)?.body as { MaxStreamingBitrate?: number }).MaxStreamingBitrate).toBe(4_000_000)

  await page.goto('/#/live/ch0001')
  await expect.poll(() => mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/ch0001/PlaybackInfo').length).toBeGreaterThan(0)
  const live = mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/ch0001/PlaybackInfo')
  expect((live.at(-1)?.body as { MaxStreamingBitrate?: number }).MaxStreamingBitrate).toBe(4_000_000)
  // Changing it while watching tunes the channel again with the new limit.
  const before = live.length
  await page.getByLabel('Quality').selectOption({ label: 'Original quality' })
  await expect.poll(() => mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/ch0001/PlaybackInfo').length).toBeGreaterThan(before)
  const after = mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/ch0001/PlaybackInfo')
  expect((after.at(-1)?.body as { MaxStreamingBitrate?: number }).MaxStreamingBitrate).toBe(120_000_000)
})

test('quality: a lower limit makes the server convert the video, says why, and is remembered', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { keep: true })
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  let dialog = await openSettings(page)
  await expect(dialog.getByRole('radio', { name: 'Original quality' })).toBeChecked()
  await expect(dialog.getByRole('status', { name: 'How this is playing' })).toContainText('nothing is converted')

  await dialog.getByRole('radio', { name: 'Up to 8 Mbps' }).click({ force: true })
  await waitPlaying(page)
  const asked = mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/m0001/PlaybackInfo')
  expect((asked.at(-1)?.body as { MaxStreamingBitrate?: number }).MaxStreamingBitrate).toBe(8_000_000)
  expect(mock.requests.some((r) => r.path === '/videos/m0001/master.m3u8')).toBe(true) // now a transcode
  dialog = await openSettings(page)
  await expect(dialog.getByRole('radio', { name: 'Up to 8 Mbps' })).toBeChecked()
  await expect(dialog.getByRole('status', { name: 'How this is playing' })).toContainText('The server is converting this video.')
  await expect(dialog.getByRole('status', { name: 'How this is playing' })).toContainText('The file is above your quality limit')

  // The next video starts with the same limit.
  await page.goto('/#/play/m0002')
  await waitPlaying(page)
  const second = mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/m0002/PlaybackInfo')
  expect((second.at(-1)?.body as { MaxStreamingBitrate?: number }).MaxStreamingBitrate).toBe(8_000_000)

  // Back to the original quality.
  dialog = await openSettings(page)
  await dialog.getByRole('radio', { name: 'Original quality' }).click({ force: true })
  await waitPlaying(page)
  dialog = await openSettings(page)
  await expect(dialog.getByRole('status', { name: 'How this is playing' })).toContainText('nothing is converted')
  expect(await video(page).evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0)
})

test('stats: hours, counts, genres and months worked out from what you watched', async ({ page }) => {
  mock = await startMock(everything)
  // Three movies seen (30 s each in the mock), one of them twice, and one episode.
  for (const id of ['m0001', 'm0002', 'm0003', 's0001-ep-1-1']) mock.user.played.add(id)
  mock.user.plays.set('m0001', 3)
  mock.user.lastPlayed.push('m0001', 'm0002', 'm0003', 's0001-ep-1-1')
  await signIn(page, mock)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Show my stats' }).click()
  await expect(page.getByRole('heading', { name: 'Your stats' })).toBeVisible()
  await expect(page.getByText('Movies', { exact: true }).locator('xpath=following-sibling::p')).toContainText('3')
  await expect(page.getByText('Episodes', { exact: true }).locator('xpath=following-sibling::p')).toContainText('1')
  await expect(page.getByRole('region', { name: 'Favorite genres' }).getByRole('listitem')).not.toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Titles by month' }).getByRole('listitem')).toHaveCount(12)
  await expect(page.getByRole('region', { name: 'Watched more than once' })).toContainText('Test Movie 001')
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('tab', { name: 'General' })).toBeVisible()
})

test('music: "pause after this song" stops at the end of the song, and the queue can be reordered', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await page.getByRole('article', { name: 'Random music' }).getByRole('button', { name: 'Play album' }).click()
  const bar = page.getByRole('region', { name: 'Music player' })
  await expect(bar).toBeVisible()
  await page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>('[data-testid=music-audio]')
    return !!a && !a.paused && a.currentTime > 0.3 && a.readyState >= 3
  })
  await bar.getByRole('button', { name: /^Open the full-screen player/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Now playing' })
  const queue = sheet.getByRole('complementary', { name: 'Queue' })
  const names = () => queue.getByRole('button', { name: /^Play / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  const before = await names()
  expect(before.length).toBeGreaterThan(2)

  // Move the second one up: it swaps with the first of those coming up.
  const second = before[1]?.replace(/^Play (.*) by .*/, '$1') as string
  await queue.getByRole('button', { name: `Move ${second} up` }).click()
  await expect.poll(async () => (await names())[0]).toBe(before[1])
  expect((await names())[1]).toBe(before[0])
  await expect(queue.getByRole('button', { name: `Move ${second} up` })).toBeDisabled() // it is first now

  // Sleep after this song: it plays on to its end, then waits instead of starting the next.
  const heading = await sheet.getByRole('heading', { level: 2 }).first().innerText()
  await sheet.getByLabel('Sleep timer').selectOption('track')
  await audio(page).evaluate((a: HTMLAudioElement) => {
    a.currentTime = Math.max(0, a.duration - 0.8)
  })
  await expect(audio(page)).toHaveJSProperty('paused', true, { timeout: 15_000 })
  await expect(sheet.getByLabel('Sleep timer')).toHaveValue('off') // used up
  // It moved on to the next song, ready, but did not start it.
  await expect(sheet.getByRole('heading', { level: 2 }).first()).not.toHaveText(heading)
  await page.waitForTimeout(1200)
  await expect(audio(page)).toHaveJSProperty('paused', true)
})

test('the new screens pass the automatic accessibility checks (stats, quality menu, sleep timer)', async ({ page }) => {
  mock = await startMock({ ...everything, trickplay: true })
  mock.user.played.add('m0001')
  mock.user.lastPlayed.push('m0001')
  await signIn(page, mock, { start: '/' })
  const problems: string[] = []
  const check = async (label: string) => {
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    for (const v of results.violations) problems.push(`${label}: ${v.impact} ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 120)}`)
  }
  await page.evaluate(() => (location.hash = '#/stats'))
  await expect(page.getByRole('heading', { name: 'Your stats' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Titles by month' })).toBeVisible()
  await check('stats')

  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  await openSettings(page)
  await check('player settings with quality')
  await page.goto('/#/')
  await page.getByRole('article', { name: 'Random music' }).getByRole('button', { name: 'Play album' }).click()
  await page.getByRole('region', { name: 'Music player' }).getByRole('button', { name: /^Open the full-screen player/ }).click()
  await expect(page.getByLabel('Sleep timer')).toBeVisible()
  await check('full-screen music player')
  expect(problems).toEqual([])
})
