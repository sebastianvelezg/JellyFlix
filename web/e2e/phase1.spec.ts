import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { currentTime, openSettings, player, signIn, startMock, video, waitPlaying } from './helpers'

/**
 * The player and the way a title starts: time labels, pausing while dragging the seek bar, skipping by kind, the episode list,
 * the version / audio / subtitle chosen on the title page, a second subtitle line, and converted sound.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

/** Saves some player preferences (what Settings would) before the player opens. */
async function setPlayerPrefs(page: Page, prefs: Record<string, unknown>) {
  await page.evaluate((value) => {
    const saved = JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}')
    localStorage.setItem('jellyflix.player', JSON.stringify({ ...saved, ...value }))
  }, prefs)
}

test('time labels: the choice in Settings decides what shows on each side of the seek bar', async ({ page }) => {
  mock = await startMock({ movieCount: 2 })
  await signIn(page, mock)
  await page.goto('/#/settings')
  await page.getByRole('tab', { name: 'Playback' }).click()
  await page.getByLabel('Left of the seek bar').selectOption('remaining')
  await page.getByLabel('Right of the seek bar').selectOption('none')
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  await page.mouse.move(400, 400)
  // The time left starts with a minus; nothing is drawn on the right.
  await expect(player(page).getByText(/^-\d+:\d\d$/)).toBeVisible()
  await expect(player(page).getByText(/^\d+:\d\d$/)).toHaveCount(0)
})

test('pause while dragging: the picture waits while the seek bar is held, and goes on when it is let go', async ({ page }) => {
  mock = await startMock({ movieCount: 2 })
  await signIn(page, mock)
  await setPlayerPrefs(page, { pauseWhileScrubbing: true })
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  const box = await page.getByRole('slider', { name: 'Seek' }).boundingBox()
  if (!box) throw new Error('seek bar not visible')
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 })
  await expect(video(page)).toHaveJSProperty('paused', true)
  await page.mouse.up()
  await expect(video(page)).toHaveJSProperty('paused', false)
  expect(await currentTime(page)).toBeGreaterThan(8)
})

test('chapter marks: the setting takes them off the seek bar', async ({ page }) => {
  mock = await startMock({ movieCount: 2 })
  await signIn(page, mock)
  await setPlayerPrefs(page, { chapterMarks: false })
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  await page.mouse.move(400, 400)
  await expect(page.getByRole('slider', { name: 'Seek' })).toBeVisible()
  await expect(player(page).locator('span[class*="bg-black/80"][class*="w-[3px]"]')).toHaveCount(0)
})

test('chapter marks: drawn on the seek bar unless they are turned off', async ({ page }) => {
  mock = await startMock({ movieCount: 2 })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  await page.mouse.move(400, 400)
  await expect(player(page).locator('span[class*="bg-black/80"][class*="w-[3px]"]')).toHaveCount(2)
})

test('converted sound: the choice in Settings is kept for this device', async ({ page }) => {
  mock = await startMock({ movieCount: 2 })
  await signIn(page, mock)
  await page.goto('/#/settings')
  await page.getByRole('tab', { name: 'Playback' }).click()
  await page.getByRole('switch', { name: 'AC-3 (Dolby Digital)' }).check()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}'))
  expect(saved.convertAudio).toEqual(['ac3'])
  await page.getByRole('switch', { name: 'AC-3 (Dolby Digital)' }).uncheck()
  const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}'))
  expect(cleared.convertAudio).toEqual([])
})

test('skip by kind: an intro can be skipped by itself', async ({ page }) => {
  mock = await startMock({ movieCount: 2, seriesCount: 1, segments: true })
  await signIn(page, mock)
  await setPlayerPrefs(page, { skipActions: { intro: 'auto', recap: 'ask', outro: 'ask', preview: 'ask' } })
  await page.goto('/#/play/s0001-ep-1-1')
  await waitPlaying(page)
  // The intro is 3-8 s: with "skip by itself" the picture jumps past it and no button is ever drawn.
  await expect.poll(() => currentTime(page), { timeout: 12_000 }).toBeGreaterThan(7.9)
  await expect(page.getByRole('button', { name: 'Skip intro' })).toHaveCount(0)
})

test('skip by kind: "do nothing" leaves the intro alone, with no button', async ({ page }) => {
  mock = await startMock({ movieCount: 2, seriesCount: 1, segments: true })
  await signIn(page, mock)
  await setPlayerPrefs(page, { skipActions: { intro: 'off', recap: 'ask', outro: 'ask', preview: 'ask' } })
  await page.goto('/#/play/s0001-ep-1-1')
  await waitPlaying(page)
  await expect.poll(() => currentTime(page), { timeout: 8000 }).toBeGreaterThan(4)
  await expect(page.getByRole('button', { name: 'Skip intro' })).toHaveCount(0)
  expect(await currentTime(page)).toBeLessThan(8)
})

test('episodes: a list with a tab per season changes the episode without leaving the player', async ({ page }) => {
  mock = await startMock({ movieCount: 2, seriesCount: 1 })
  await signIn(page, mock)
  await page.goto('/#/play/s0001-ep-1-1')
  await waitPlaying(page)
  await page.mouse.move(400, 400)
  await player(page).getByRole('button', { name: 'Episodes' }).click()
  const list = page.getByRole('dialog', { name: 'Episodes' })
  await expect(list.getByRole('button', { name: /Episode Title 1-1/ })).toHaveAttribute('aria-current', 'true')
  await expect(list.getByRole('button')).toHaveCount(3)
  // Escape closes the list only: the player stays.
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(player(page)).toBeVisible()
  await page.mouse.move(420, 420)
  await player(page).getByRole('button', { name: 'Episodes' }).click()
  // The second season has its own episodes.
  await list.getByRole('tab', { name: '2' }).click()
  await list.getByRole('button', { name: /Episode Title 2-1/ }).click()
  await expect(page).toHaveURL(/#\/play\/s0001-ep-2-1$/)
  await expect(player(page)).toHaveAccessibleName(/S2 E1/)
  await waitPlaying(page)
})

test('play options: the version, the audio and the subtitle picked on the title page are what plays', async ({ page }) => {
  mock = await startMock({ movieCount: 3, versions: true })
  await signIn(page, mock)
  await page.getByRole('region', { name: 'All movies' }).getByRole('button', { name: /Open Test Movie 002/ }).click()
  const options = page.getByRole('group', { name: 'Play options' })
  await expect(options.getByLabel('Version')).toBeVisible()
  await options.getByLabel('Version').selectOption({ index: 1 })
  await options.getByLabel('Audio').selectOption({ label: 'Spanish · AAC Stereo' })
  await options.getByLabel('Subtitles').selectOption({ label: 'English' })
  await page.getByRole('button', { name: /^(Play|Resume from .*)$/ }).click()
  await expect(video(page)).toBeVisible()
  await waitPlaying(page)
  // The 4K version was asked for, the Spanish track is the one playing, and the English subtitle is on.
  const asked = mock.requests.filter((r) => r.path === '/Items/m0002/PlaybackInfo').map((r) => (r.body as { MediaSourceId?: string }).MediaSourceId)
  expect(asked).toContain('ms-m0002-4k')
  let settings = await openSettings(page, 'Audio')
  await expect(settings.getByLabel(/^Spanish/)).toBeChecked()
  settings = await openSettings(page, 'Subtitles')
  await expect(settings.getByLabel('English', { exact: true })).toBeChecked()
  await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')

  // The picture chosen is offered first next time.
  await page.keyboard.press('Escape')
  await page.goto('/#/movie/m0002')
  await expect(page.getByRole('group', { name: 'Play options' }).getByLabel('Version')).toHaveValue('ms-m0002-4k')
})

test('second subtitle: another track shows above the first, and goes with it', async ({ page }) => {
  mock = await startMock({ movieCount: 2, secondSubtitle: true })
  await signIn(page, mock)
  await page.goto('/#/play/m0001')
  await waitPlaying(page)
  // Only offered once a first subtitle is on.
  let settings = await openSettings(page)
  await expect(settings.getByRole('button', { name: /^Second subtitle/ })).toHaveCount(0)
  settings = await openSettings(page, 'Subtitles')
  await settings.getByLabel('English', { exact: true }).check()
  await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')

  settings = await openSettings(page, 'Second subtitle')
  await settings.getByLabel('Spanish', { exact: true }).check()
  await expect(page.getByTestId('subtitles-second')).toContainText('Segunda linea de prueba')
  await expect(page.getByTestId('subtitles')).toContainText('Mock subtitle line')

  // Turning the first one off takes the second with it.
  settings = await openSettings(page, 'Subtitles')
  await settings.getByLabel('Off').check()
  await expect(page.getByTestId('subtitles')).toBeEmpty()
  await expect(page.getByTestId('subtitles-second')).toBeEmpty()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}'))
  expect(saved.secondSubtitleLanguage).toBe('spa')
})
