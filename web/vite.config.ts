import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Writes `sw.js` next to the built app: the service worker (scripts/sw.template.js) with the list of files to keep for opening the
 * app without a network, and a version made from their content so a new build is noticed by the browser.
 */
function serviceWorker(): Plugin {
  return {
    name: 'jellyflix-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
      // The video library (hls.js) is only needed for some streams, and the non-Latin fonts for some languages: they are kept the
      // first time they are used instead of being downloaded up front.
      const upFront = files.filter((f) => /\.(js|css)$/.test(f) && !/(^|\/)hls-/.test(f)).concat(files.filter((f) => /inter-latin-wght/.test(f)))
      const hash = createHash('sha256')
      for (const f of upFront.sort()) hash.update(f)
      const list = ['./index.html', ...upFront.map((f) => './' + f)]
      const source = readFileSync(new URL('./scripts/sw.template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('/*PRECACHE*/ []', JSON.stringify(list, null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  // Relative file addresses, so the app works from any folder or sub-path it is put in (its routes live after the #).
  base: './',
  plugins: [react(), tailwindcss(), serviceWorker()],
  server: { host: 'localhost', port: 5173 },
  // hls.js (~570 kB) is a lazily loaded chunk, only fetched when a stream needs HLS.
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Libraries change much less often than the app: keeping them in their own files means a new version of the
        // app does not make browsers download React and the Jellyfin client again, and they load in parallel.
        manualChunks(id) {
          const inPackage = (names: string[]) => names.some((name) => id.includes(`/node_modules/${name}/`))
          if (inPackage(['react', 'react-dom', 'scheduler'])) return 'react'
          if (inPackage(['axios', '@jellyfin'])) return 'jellyfin'
          return undefined
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
