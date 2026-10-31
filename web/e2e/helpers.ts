import { expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { startMockJellyfin, type MockOptions, type MockServer } from '../test/mock/mockJellyfin'

export const mediaDir = resolve(import.meta.dirname, '..', 'test-media')

export async function startMock(options: MockOptions = {}): Promise<MockServer> {
  return startMockJellyfin({ mediaDir, movieCount: 5, ...options })
}

/** Signs in. Starts on the movies page (the main page is `start: '/'`), since most tests are about movies. */
export async function signIn(page: Page, mock: MockServer, opts: { keep?: boolean; start?: string; setup?: boolean } = {}) {
  // The questions of the first run are for the test that is about them: the others find the app already set up.
  if (!opts.setup) await page.addInitScript(() => localStorage.setItem('jellyflix.setup', '1'))
  await page.goto(opts.start ?? '/#/movies')
  await page.getByLabel('Server URL').fill(mock.url)
  await page.getByLabel('Username').fill('tester')
  await page.getByLabel('Password').fill('secret')
  if (opts.keep) await page.getByLabel(/Keep me signed in/).check()
  await page.getByRole('button', { name: 'Connect' }).click()
  // (On a phone the Sign out button is in Settings, so the round Settings button is the sign of being in.)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
}

export const video = (page: Page) => page.getByTestId('video')
export const player = (page: Page) => page.getByRole('region', { name: /^Playing / })
export const currentTime = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentTime)

export const waitPlaying = (page: Page, minTime = 0.5) =>
  page.waitForFunction(
    (min) => {
      const v = document.querySelector<HTMLVideoElement>('[data-testid=video]')
      return !!v && !v.paused && v.currentTime > min && v.readyState >= 3
    },
    minTime,
  )

/** Opens a movie's page from the home grid and presses Play / Resume. */
export async function playMovie(page: Page, n = 1, button: RegExp = /^(Play|Resume from .*)$/) {
  await page.getByRole('region', { name: 'All movies' }).getByRole('button', { name: new RegExp(`Open Test Movie 00${n}`) }).click()
  await page.getByRole('button', { name: button }).click()
  await expect(video(page)).toBeVisible()
}

export async function clickSeekAt(page: Page, fraction: number) {
  const bar = page.getByRole('slider', { name: 'Seek' })
  const box = await bar.boundingBox()
  if (!box) throw new Error('seek bar not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2) // wake the controls
  await page.mouse.click(box.x + 8 + (box.width - 16) * fraction, box.y + box.height / 2)
}

/** Opens the settings menu, and a page of it ('Audio', 'Subtitles', 'Subtitle look', 'Quality', 'Speed', 'Chapters') when one is named. */
export async function openSettings(page: Page, view?: string) {
  const dialog = page.getByRole('dialog', { name: 'Playback settings' })
  if (!(await dialog.isVisible())) {
    await page.mouse.move(400, 400)
    await player(page).getByRole('button', { name: 'Audio, subtitles and speed' }).click()
  }
  if (view) {
    const back = dialog.getByRole('button', { name: 'Back to settings' })
    if (await back.isVisible()) await back.click()
    await dialog.getByRole('button', { name: new RegExp(`^${view}`) }).click()
  }
  return dialog
}
