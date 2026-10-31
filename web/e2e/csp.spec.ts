import { expect, test } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { playMovie, signIn, startMock, video, waitPlaying } from './helpers'

/**
 * The page is served with a strict Content-Security-Policy (scripts/csp.mjs). This walks through the parts that load the most unusual
 * things (the player, both book readers, settings) and fails if the browser refused anything. Only the production build is served with
 * the policy, so this runs with E2E_PROD=1.
 */
test.skip(process.env.E2E_PROD !== '1', 'needs the production build (E2E_PROD=1)')

let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

test('nothing the app needs is refused by its Content-Security-Policy', async ({ page, request }) => {
  const response = await request.get('/')
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'")

  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __csp: string[] }).__csp = seen
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective}: ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`))
  })
  mock = await startMock({ movieCount: 3, books: 4 })
  await signIn(page, mock)
  await playMovie(page)
  await waitPlaying(page)
  await page.keyboard.press('Escape')
  // (Leaving goes back in the history; wait for it, or it could undo the next address.)
  await expect(video(page)).toHaveCount(0)

  for (const [name, title] of [['Test Book 001', 'EPUB'], ['Test Book 002', 'PDF']] as const) {
    await page.goto('/#/books')
    await expect(page.getByRole('region', { name: 'All books' })).toBeVisible()
    await page.getByRole('region', { name: 'All books' }).getByRole('button', { name: new RegExp(`^Open ${name}`) }).click()
    await page.getByRole('button', { name: 'Read', exact: true }).click()
    await expect(page.getByRole('region', { name: `Reading ${name}` }), title).toBeVisible()
    await expect(page.getByRole('region', { name: `Reading ${name}` }).locator('canvas, iframe').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('region', { name: `Reading ${name}` })).toHaveCount(0)
  }

  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
  // (The test EPUB carries an inline handler on purpose, to prove the reader strips it: the browser says it refused it while the
  // reader reads the chapter, before the handler is removed. It is never run, so that one is expected.)
  expect(violations.filter((v) => !v.startsWith('script-src-attr: inline'))).toEqual([])
})
