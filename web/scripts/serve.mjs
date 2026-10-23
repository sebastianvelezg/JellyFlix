// Serves the built app (dist/) without Docker or any dependency: `npm run build`, then `npm run serve`.
//
//   JELLYFIN_URL    the address the sign-in screen starts with, e.g. http://YOUR-JELLYFIN-IP:8096   (default: empty)
//   JELLYFLIX_PORT  port to listen on (PORT also works)                                            (default 8080)
//   HOST            address to listen on; 0.0.0.0 makes it reachable from other devices             (default 0.0.0.0)
//
// The same names are read from a file called .env in the web folder (see .env.example), if there is one; real environment variables win.
// It only sends the files in dist/ plus a generated config.js; it has no other behaviour and talks to no one.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch {
  // No .env file: the settings come from the environment, or the defaults apply.
}

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const port = Number(process.env.PORT || process.env.JELLYFLIX_PORT || 8080)
const host = process.env.HOST ?? '0.0.0.0'
const serverUrl = (process.env.JELLYFIN_URL ?? '').trim()

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

const configJs = `window.JELLYFLIX_CONFIG = ${JSON.stringify({ serverUrl })}\n`

const server = createServer(async (req, res) => {
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    if (path === '/config.js') {
      res.writeHead(200, { ...headers, 'Content-Type': types['.js'], 'Cache-Control': 'no-cache' })
      res.end(configJs)
      return
    }
    const file = normalize(join(root, path === '/' ? 'index.html' : path))
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) throw Object.assign(new Error('outside'), { code: 'ENOENT' })
    if (!(await stat(file)).isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' })
    // Built files carry a hash of their content in the name, so they can be kept for good; the rest must be asked again.
    const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache })
    res.end(await readFile(file))
  } catch (e) {
    const missing = e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT'
    res.writeHead(missing ? 404 : 400, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(missing ? 'Not found' : 'Bad request')
  }
})

server.listen(port, host, () => {
  console.log(`Jellyflix Web is served on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
  console.log(serverUrl ? `Sign-in starts with the server ${serverUrl}` : 'Sign-in starts with an empty server address (set JELLYFIN_URL to change that)')
})
