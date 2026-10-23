import { expect, test, type Page } from '@playwright/test'
import type { MockOptions, MockServer } from '../test/mock/mockJellyfin'
import {
  clickSeekAt,
  currentTime,
  openSettings,
  player,
  playMovie,
  signIn,
  startMock,
  video,
  waitPlaying,
} from './helpers'

/**
 * These tests drive the real app in real Chrome against a *mock* Jellyfin server that serves
 * real (synthetic) H.264/AAC media with Range support and real HLS segments. They prove the
 * client's playback mechanics. They do NOT prove compatibility with a real Jellyfin server.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

async function start(page: Page, options: MockOptions = {}) {
  mock = await startMock(options)
  await signIn(page, mock)
}

test.describe('direct play', () => {
  test('plays a movie with working controls, subtitles, speed, seeking and progress reports', async ({ page }) => {
    await start(page)
    await playMovie(page)

    // Playback really starts, via direct play with a Range-capable stream.
    await waitPlaying(page)
    await expect(video(page)).toHaveAttribute('data-play-method', 'DirectPlay')
    await expect(page.getByText('/ 0:30')).toBeVisible()
    const stream = mock.requests.find((r) => r.path === '/Videos/m0001/stream')
    expect(stream).toMatchObject({ auth: 'query' })
    expect(mock.requests.some((r) => r.path === '/Videos/m0001/stream' && r.range)).toBe(true)
    await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing')).toBe(true)
    const startReport = mock.requests.find((r) => r.path === '/Sessions/Playing')
    expect(startReport?.body).toMatchObject({ ItemId: 'm0001', PlayMethod: 'DirectPlay', CanSeek: true, AudioStreamIndex: 1 })

    // The tab title reflects what is playing.
    await expect(page).toHaveTitle('▶ Test Movie 001')

    // Pause / play.
    await page.keyboard.press('Space')
    await expect(video(page)).toHaveJSProperty('paused', true)
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing/Progress')).toBe(true)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(video(page)).toHaveJSProperty('paused', false)

    // Skip buttons and keyboard shortcuts.
    const before = await currentTime(page)
    await page.getByRole('button', { name: 'Forward 10 seconds' }).click()
    await waitPlaying(page, before + 9)
    await page.getByRole('button', { name: 'Back 10 seconds' }).click()
    await expect.poll(() => currentTime(page)).toBeLessThan(before + 9)
    await page.keyboard.press('5') // jump to 50%
    await expect.poll(() => currentTime(page)).toBeGreaterThan(13)
    await expect.poll(() => currentTime(page)).toBeLessThan(18)

    // Seeking from the timeline lands near the target position.
    await clickSeekAt(page, 0.66)
    await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(18)
    await expect.poll(() => currentTime(page)).toBeLessThan(24)
    await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', /of 0:30/)

    // Volume, mute, and remembered preference.
    await player(page).getByRole('button', { name: 'Mute' }).click()
    await expect(video(page)).toHaveJSProperty('muted', true)
    await player(page).getByRole('button', { name: 'Unmute' }).click()
    await expect(video(page)).toHaveJSProperty('muted', false)
    await page.getByRole('slider', { name: 'Volume' }).focus()
    await page.keyboard.press('ArrowLeft')
    expect(await video(page).evaluate((v: HTMLVideoElement) => v.volume)).toBeLessThan(1)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}'))
    expect(saved.volume).toBeLessThan(1)

    // Playback speed from the settings menu.
    let settings = await openSettings(page)
    await settings.getByLabel('1.5×').check()
    await expect(video(page)).toHaveJSProperty('playbackRate', 1.5)
    await settings.getByLabel('Normal').check()
    await expect(video(page)).toHaveJSProperty('playbackRate', 1)

    // Subtitles: fetched with the Authorization header and drawn in our own overlay, above the controls.
    await settings.getByLabel('English', { exact: true }).check()
    await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')
    const sub = mock.requests.find((r) => r.path === '/Videos/m0001/ms-m0001/Subtitles/3/Stream.vtt')
    expect(sub).toMatchObject({ auth: 'header', status: 200 })
    // Bigger text.
    await settings.getByLabel('Large').check()
    await expect(page.getByTestId('subtitles')).toHaveClass(/text-2xl/)
    // Escape closes only the menu; "c" toggles subtitles off and on.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Playback settings' })).toHaveCount(0)
    await expect(video(page)).toBeVisible()
    await player(page).focus()
    await page.keyboard.press('c')
    await expect(page.getByTestId('subtitles')).toBeEmpty()
    await page.keyboard.press('c')
    await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')
    settings = await openSettings(page)
    await settings.getByLabel('Off').check()
    await expect(page.getByTestId('subtitles')).toBeEmpty()

    // Fullscreen toggles on the player container.
    await page.keyboard.press('Escape')
    await player(page).getByRole('button', { name: 'Fullscreen' }).click()
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
    await player(page).getByRole('button', { name: 'Exit fullscreen' }).click()
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)
  })

  test('plays to the end, reports completion, shows it under Continue watching, and resumes', async ({ page }) => {
    await start(page)
    await playMovie(page)
    await waitPlaying(page)

    // Completion.
    await clickSeekAt(page, 0.97)
    await expect(video(page)).toHaveJSProperty('ended', true, { timeout: 15_000 })
    await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing/Stopped')).toBe(true)
    const stopped = mock.requests.filter((r) => r.path === '/Sessions/Playing/Stopped').at(-1)
    expect((stopped?.body as { PositionTicks: number }).PositionTicks).toBeGreaterThan(280_000_000)

    // Leave mid-way on another movie.
    await player(page).getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click() // from the movie page to the library
    await playMovie(page, 2)
    await waitPlaying(page)
    await clickSeekAt(page, 0.5)
    await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(13)
    await player(page).getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Test Movie 002', level: 1 })).toBeVisible()
    await expect.poll(() => mock.resume.get('m0002') ?? 0).toBeGreaterThan(130_000_000)

    // The movie page now offers Resume and Start over.
    await expect(page.getByRole('button', { name: /^Resume from 0:1\d$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    const row = page.getByRole('region', { name: 'Continue watching' })
    await expect(row.getByRole('button', { name: 'Resume Test Movie 002' })).toBeVisible()

    // Resuming from the row continues near where we left off.
    await row.getByRole('button', { name: 'Resume Test Movie 002' }).click()
    await waitPlaying(page, 12)
    expect(await currentTime(page)).toBeGreaterThan(13)
    expect(await currentTime(page)).toBeLessThan(22)
  })

  test('remembers your subtitle language and turns subtitles on in the next movie', async ({ page }) => {
    await start(page)
    await playMovie(page, 1)
    await waitPlaying(page)
    const settings = await openSettings(page)
    await settings.getByLabel('English', { exact: true }).check()
    await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')
    await page.keyboard.press('Escape') // closes the menu
    await player(page).getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()

    await playMovie(page, 2)
    await waitPlaying(page)
    await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')
    const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}'))
    expect(pref.subtitleLanguage).toBe('eng')

    // Turning them off is remembered too.
    await page.keyboard.press('c')
    await expect(page.getByTestId('subtitles')).toBeEmpty()
    const off = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}'))
    expect(off.subtitleLanguage).toBeNull()
  })

  test('"Start over" ignores the saved position', async ({ page }) => {
    mock = await startMock()
    mock.resume.set('m0003', 20 * 10_000_000)
    await signIn(page, mock)
    await playMovie(page, 3, /^Start over$/)
    await waitPlaying(page, 0.3)
    expect(await currentTime(page)).toBeLessThan(6)
  })

  test('does not stop playing when progress reporting fails', async ({ page }) => {
    await start(page, { failReporting: true })
    await playMovie(page)
    await waitPlaying(page, 1)
    await page.keyboard.press('Space')
    await page.keyboard.press('Space')
    await waitPlaying(page, 1)
    await expect
      .poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing/Progress' && r.status === 500))
      .toBe(true)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('falls back to a server transcode when the browser cannot play the direct stream', async ({ page }) => {
    await start(page, { breakMedia: 'direct' })
    await playMovie(page)
    await expect(video(page)).toHaveAttribute('data-protocol', 'hls', { timeout: 15_000 })
    await waitPlaying(page)
    const infos = mock.requests.filter((r) => r.path === '/Items/m0001/PlaybackInfo')
    // (React StrictMode in dev may negotiate the first load twice, hence >= 2.)
    expect(infos.length).toBeGreaterThanOrEqual(2)
    expect((infos.at(-1)?.body as { EnableDirectPlay: boolean }).EnableDirectPlay).toBe(false)
    expect((infos[0]?.body as { EnableDirectPlay: boolean }).EnableDirectPlay).toBe(true)
  })

  test('shows an error with retry when nothing can be played', async ({ page }) => {
    await start(page, { breakMedia: 'all' })
    await playMovie(page)
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await player(page).getByRole('alert').getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Test Movie 001', level: 1 })).toBeVisible()
  })
})

test.describe('HLS (server transcode) playback', () => {
  test('plays through hls.js with header auth, seeks, and switches audio tracks keeping speed and subtitles', async ({
    page,
  }) => {
    await start(page, { playMode: 'hls' })
    await playMovie(page)
    await waitPlaying(page)
    await expect(video(page)).toHaveAttribute('data-play-method', 'Transcode')
    await expect(video(page)).toHaveAttribute('data-protocol', 'hls')

    // Credentials: no token in any HLS URL (the server's embedded key was stripped); header auth instead.
    const hlsRequests = mock.requests.filter((r) => r.path.startsWith('/videos/m0001/'))
    expect(hlsRequests.length).toBeGreaterThan(1)
    expect(hlsRequests.every((r) => r.auth === 'header')).toBe(true)
    expect(hlsRequests.every((r) => !('ApiKey' in r.query) && !('api_key' in r.query))).toBe(true)

    // Seek within the HLS timeline.
    await clickSeekAt(page, 0.7)
    await expect.poll(() => currentTime(page), { timeout: 15_000 }).toBeGreaterThan(19)

    // Choose speed + subtitles, then switch audio: the client renegotiates and keeps position and choices.
    const settings = await openSettings(page)
    await settings.getByLabel('1.25×').check()
    await settings.getByLabel('English', { exact: true }).check()
    await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')
    const position = await currentTime(page)
    await settings.getByLabel('Spanish · AAC Stereo').click() // the player rebuilds, so check()'s verification can't run
    await expect
      .poll(() => mock.requests.some((r) => r.path === '/videos/m0001/master.m3u8' && r.query.AudioStreamIndex === '2'))
      .toBe(true)
    await waitPlaying(page, position - 2)
    expect(await currentTime(page)).toBeGreaterThan(position - 2)
    await expect(video(page)).toHaveJSProperty('playbackRate', 1.25)
    await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')
    const infos = mock.requests.filter((r) => r.path === '/Items/m0001/PlaybackInfo')
    expect(infos.at(-1)?.body).toMatchObject({ AudioStreamIndex: 2, EnableDirectPlay: false })
    // The old stream's final position was reported before the new one started.
    expect(mock.requests.some((r) => r.path === '/Sessions/Playing/Stopped')).toBe(true)
    // The new stream reports the chosen audio track.
    await expect
      .poll(() =>
        mock.requests.some(
          (r) => r.path === '/Sessions/Playing' && (r.body as { AudioStreamIndex?: number }).AudioStreamIndex === 2,
        ),
      )
      .toBe(true)
  })
})
