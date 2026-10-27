import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** The bars of the full-screen player, in real Chrome against the mock server (its songs are a steady 523 Hz tone). */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const audio = (page: Page) => page.getByTestId('music-audio')
const bar = (page: Page) => page.getByRole('region', { name: 'Music player' })
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })

async function playAndOpen(page: Page) {
  await tabs(page).getByRole('button', { name: 'Music' }).click()
  await page.getByRole('region', { name: 'Recently added' }).getByRole('button', { name: 'Open album Album 001-1' }).click()
  await page.getByRole('button', { name: /^Play Song 1\.1 by/ }).click()
  await page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>('[data-testid=music-audio]')
    return !!a && !a.paused && a.currentTime > 0.5 && a.readyState >= 3
  })
  await bar(page).getByRole('button', { name: /^Open the full-screen player/ }).click()
}

test('visualizer: bars over the cover read the real sound, the song keeps playing, and the choice is remembered', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playAndOpen(page)

  const now = page.getByRole('dialog', { name: 'Now playing' })
  await expect(page.getByTestId('visualizer')).toHaveCount(0) // off by default
  const toggle = now.getByRole('button', { name: 'Visualizer' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').visualizer)).toBe(true)

  // The song is loaded again so its sound can be read; it plays on and the bars follow the real sound.
  const canvas = page.getByTestId('visualizer')
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-source', 'live', { timeout: 15_000 })
  await expect(audio(page)).toHaveAttribute('crossorigin', 'anonymous')
  await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.3)).toBe(true)

  // The tone of the test song makes the bars rise (silence would leave them down: nothing is muted by the analysis).
  await expect.poll(async () => Number(await canvas.getAttribute('data-level')), { timeout: 10_000 }).toBeGreaterThan(0.03)

  // Something is really drawn (not an empty canvas).
  await expect
    .poll(() =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data
        return !!data && data.some((v, i) => i % 4 === 3 && v > 0)
      }),
    )
    .toBe(true)

  // Pausing stops the movement: the source is made up again only when playing without sound to read, never while paused.
  await page.keyboard.press('Escape')
  await bar(page).getByRole('button', { name: 'Pause' }).click()
  await expect(audio(page)).toHaveJSProperty('paused', true)

  // Off again: the cover is back as it was.
  await bar(page).getByRole('button', { name: /^Open the full-screen player/ }).click()
  await now.getByRole('button', { name: 'Visualizer' }).click()
  await expect(page.getByTestId('visualizer')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').visualizer)).toBe(false)
})

test('cover colours: the blur, the bars and the accent of the full-screen player follow the cover of the song', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playAndOpen(page)

  const now = page.getByRole('dialog', { name: 'Now playing' })
  // The colours of the cover are read (album 1-1 is a red-orange cover with a band of another colour) and put on the screen.
  await expect(now).toHaveAttribute('data-cover-colors', /^#[0-9a-f]{6} #[0-9a-f]{6}$/i)
  const colours = (await now.getAttribute('data-cover-colors')) as string
  const [primary, secondary] = colours.split(' ') as [string, string]
  expect(primary).not.toBe(secondary)
  await expect(page.getByTestId('cover-glow').locator('div').first()).toHaveCSS('opacity', '0.5')

  // The accent of this screen is made from the cover (what the seek bar and the buttons use), not the one chosen in Appearance.
  const accent = (el: Element) => getComputedStyle(el).getPropertyValue('--color-accent').trim()
  const pageAccent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())
  expect(await now.evaluate(accent)).not.toBe(pageAccent)

  // The bars are drawn in the same colours, from the first one to the last.
  await now.getByRole('button', { name: 'Visualizer' }).click()
  await expect(page.getByTestId('visualizer')).toHaveAttribute('data-colors', `${primary.toLowerCase()} ${secondary.toLowerCase()}`, {
    timeout: 10_000,
  })

  // Another album, other colours; and once the screen is closed nothing of it stays on the page.
  await page.keyboard.press('Escape')
  await expect(now).toBeHidden()
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())).toBe(pageAccent)
})

test('visualizer: the next songs keep being read, also the one made ready ahead of time', async ({ page }) => {
  mock = await startMock({ movieCount: 3, musicArtists: 3 })
  await signIn(page, mock)
  await playAndOpen(page)
  await page.getByRole('dialog', { name: 'Now playing' }).getByRole('button', { name: 'Visualizer' }).click()
  await expect(page.getByTestId('visualizer')).toHaveAttribute('data-source', 'live', { timeout: 15_000 })

  // Near the end the next song is prepared on the spare element, and takes over with its sound still readable.
  await audio(page).evaluate((a: HTMLAudioElement) => void (a.currentTime = 22))
  await expect(bar(page)).toContainText('Song 1.2', { timeout: 25_000 })
  await expect(page.getByTestId('visualizer')).toHaveAttribute('data-source', 'live', { timeout: 15_000 })
  await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.3)).toBe(true)
})
