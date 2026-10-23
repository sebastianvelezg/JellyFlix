import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { currentTime, openSettings, player, signIn, startMock, waitPlaying } from './helpers'

/**
 * Subtitle sync, look and files from your own device in real Chrome against the mock server (whose one subtitle line
 * is shown from 0 s to 29 s). Proves the client's behaviour, not how any real subtitle file looks.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const lines = (page: Page) => page.getByTestId('subtitles')

async function playWithSubtitles(page: Page) {
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const settings = await openSettings(page)
  await settings.getByLabel('English', { exact: true }).check()
  await expect(lines(page)).toContainText('Mock subtitle line')
  return settings
}

test('sync: moving the subtitles later hides them until their new time, earlier brings them back, and it is remembered', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  const settings = await playWithSubtitles(page)
  await page.keyboard.press('Escape') // close the menu; keys now go to the player
  await player(page).focus()

  // 20 times Shift+X = 10 seconds later: the line (written for 0-29 s) now starts at 10 s, so it is gone now.
  await page.keyboard.press('Home')
  for (let i = 0; i < 20; i += 1) await page.keyboard.press('Shift+X')
  await expect(page.getByRole('status').filter({ hasText: 'Subtitles:' })).toContainText('+10.0 s (later)')
  await expect.poll(() => currentTime(page)).toBeLessThan(10)
  await expect(lines(page)).toBeEmpty()

  // Seeking past the new start shows it again.
  await page.keyboard.press('Home')
  await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('[data-testid=video]')
    if (v) v.currentTime = 12
  })
  await expect(lines(page)).toContainText('Mock subtitle line')

  // The saved value is per movie, and the menu shows it.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.subsync') ?? '{}'))
  expect(saved).toEqual({ m0001: 10 })
  await openSettings(page)
  await expect(page.getByRole('dialog', { name: 'Playback settings' }).getByLabel('Subtitle sync', { exact: true })).toHaveText('+10.0 s')

  // Reset puts it back, and forgets it.
  await page.getByRole('dialog', { name: 'Playback settings' }).getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByRole('dialog', { name: 'Playback settings' }).getByLabel('Subtitle sync', { exact: true })).toHaveText('0.0 s')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.subsync') ?? '{}'))).toEqual({})
  void settings
})

test('sync: a key held down (many presses before the screen updates) still adds up', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await playWithSubtitles(page)
  await page.keyboard.press('Escape')
  await player(page).focus()
  await page.evaluate(() => {
    const region = document.querySelector('[role=region]')
    for (let i = 0; i < 10; i += 1) region?.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
  })
  await expect(page.getByRole('status').filter({ hasText: 'Subtitles:' })).toContainText('+1.0 s (later)')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.subsync') ?? '{}'))
  expect(saved).toEqual({ m0001: 1 })
})

test('sync: the buttons in the menu move the subtitles, and a new viewing starts with the saved value', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  const settings = await playWithSubtitles(page)
  for (let i = 0; i < 3; i += 1) await settings.getByRole('button', { name: 'Show subtitles 0.5 seconds later' }).click()
  await settings.getByRole('button', { name: 'Show subtitles 0.1 seconds earlier' }).click()
  await expect(settings.getByLabel('Subtitle sync', { exact: true })).toHaveText('+1.4 s')
  await expect(settings.getByText('+1.4 s (later)')).toBeVisible()

  await page.reload()
  await waitPlaying(page)
  const again = await openSettings(page)
  await again.getByLabel('English', { exact: true }).check()
  await expect(again.getByLabel('Subtitle sync', { exact: true })).toHaveText('+1.4 s')
})

test('look: colour, background and position are applied and remembered', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  const settings = await playWithSubtitles(page)
  await settings.getByLabel('Yellow').check()
  await settings.getByLabel('Dark box').check()
  await settings.getByLabel('Higher').check()
  await expect(lines(page)).toHaveCSS('color', 'rgb(255, 225, 77)')
  await expect(lines(page)).toHaveAttribute('data-background', 'box')
  await expect(lines(page).locator('.subtitle-line')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.72)')
  await expect(lines(page)).toHaveClass(/bottom-(24|40)/)
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}'))
  expect(prefs).toMatchObject({ subtitleColor: 'yellow', subtitleBackground: 'box', subtitlePosition: 'high' })
})

test('file: a .srt from your device is shown, can be synced, and a server track replaces it', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const settings = await openSettings(page)

  await settings.getByLabel('Subtitle file').setInputFiles({
    name: 'my movie.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from('1\r\n00:00:00,500 --> 00:00:29,000\r\nLine from my own file\r\n'),
  })
  await expect(lines(page)).toContainText('Line from my own file')
  await expect(settings.getByLabel('File: my movie.srt')).toBeChecked()
  // No request went to the server for it.
  expect(mock.requests.some((r) => r.path.includes('/Subtitles/'))).toBe(false)

  // It can be synced like any other.
  await expect(settings.getByRole('button', { name: 'Show subtitles 0.5 seconds later' })).toBeVisible()

  // Choosing a server track, or Off, drops the file.
  await settings.getByLabel('English', { exact: true }).check()
  await expect(lines(page)).toContainText('Mock subtitle line')
  await expect(settings.getByLabel('File: my movie.srt')).toHaveCount(0)
})

test('file: formats that cannot be read are refused with a message', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const settings = await openSettings(page)
  await settings.getByLabel('Subtitle file').setInputFiles({ name: 'styled.ass', mimeType: 'text/plain', buffer: Buffer.from('[Script Info]') })
  await expect(settings.getByRole('alert')).toContainText('Only .srt and .vtt')
  await settings.getByLabel('Subtitle file').setInputFiles({ name: 'empty.srt', mimeType: 'text/plain', buffer: Buffer.from('nothing here') })
  await expect(settings.getByRole('alert')).toContainText('No subtitles were found')
  await expect(lines(page)).toBeEmpty()
})
