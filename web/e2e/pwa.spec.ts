import { expect, test } from '@playwright/test'

/**
 * The installable app: a manifest with real icons, and a service worker that lets the app open with no network.
 * The service worker only exists in the production build, so this runs with E2E_PROD=1 (npm run e2e:prod); in the dev
 * server these checks are skipped.
 */
test.skip(process.env.E2E_PROD !== '1', 'needs the production build (E2E_PROD=1)')

test('has a manifest an install prompt accepts', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()
  const manifest = await (await request.get(new URL(href as string, page.url()).href)).json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBeTruthy()
  const sizes = manifest.icons.map((i: { sizes: string; type: string }) => `${i.sizes} ${i.type}`)
  expect(sizes).toContain('192x192 image/png')
  expect(sizes).toContain('512x512 image/png')
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
  // Every icon the manifest names really exists.
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, new URL(href as string, page.url())).href)
    expect(res.ok(), icon.src).toBe(true)
  }
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
  expect((await request.get(new URL(apple as string, page.url()).href)).ok()).toBe(true)
})

test('opens with no network once it has been opened before', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByLabel('Server URL')).toBeVisible()
  // Wait until the worker has saved the app.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    if (!reg.active) throw new Error('no active worker')
  })
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0)
  await page.reload() // now controlled by the worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByLabel('Server URL')).toBeVisible()
  await context.setOffline(false)
})

test('never keeps anything the server sends', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0)
  const urls = await page.evaluate(async () => {
    const out: string[] = []
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname)
    return out
  })
  expect(urls.every((u) => u.endsWith('/') || u.endsWith('.html') || /\/assets\//.test(u))).toBe(true)
})
