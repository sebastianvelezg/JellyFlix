/* Jellyflix Web: service worker. Generated into dist/sw.js at build time (see vite.config.ts), where the version
 * and the list of files below are filled in. It only ever handles this app's own files. Everything that goes to the Jellyfin server
 * (the API, pictures, video, music) never passes through it, so nothing about the library or the account is stored here.
 */
const VERSION = '__VERSION__'
const CACHE = 'app-' + VERSION
const PRECACHE = /*PRECACHE*/ []

self.addEventListener('install', (event) => {
  // Fetched fresh from the network (not the browser's cache), so a new build never gets a stale file from the old one.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep the version before this one too: a page opened before the update may still ask for one of its lazily loaded files.
      const names = (await caches.keys()).filter((n) => n.startsWith('app-') && n !== CACHE).sort()
      await Promise.all(names.slice(0, -1).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

const scope = new URL(self.registration.scope)

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return

  // Opening the app: the network first (so a new version shows at once), the saved page when there is no network.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(new URL('index.html', scope).href)) ?? Response.error()),
    )
    return
  }
  // The app's own built files (their names change with every change of their content, so a saved copy is never stale).
  // Anything else (the icon, the manifest) goes to the network as usual.
  const relative = url.pathname.slice(scope.pathname.length)
  if (relative.startsWith('assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              void caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})
