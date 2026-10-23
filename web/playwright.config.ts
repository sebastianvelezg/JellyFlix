import { defineConfig } from '@playwright/test'

// E2E_PROD=1 runs the suite against the production build (vite preview) instead of the dev server.
const prod = process.env.E2E_PROD === '1'
const port = prod ? 4173 : 5173

// Browser-level tests run in the locally installed Google Chrome (it includes the H.264/AAC
// decoders that Playwright's bundled Chromium lacks), so no browser download is needed.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: prod
      ? `npm run build && npm run preview -- --port ${port} --strictPort`
      : `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
