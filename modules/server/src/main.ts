import { createServer } from 'node:http'
import { join } from 'node:path'
import { createApp } from './app.ts'
import { readConfig } from './config.ts'
import { openDb } from './db/db.ts'
import { createJellyfinClient } from './jellyfin/client.ts'
import { nowSeconds } from './util.ts'

let config
try {
  config = readConfig()
} catch (e) {
  console.error(`jellyflix-modules: ${e instanceof Error ? e.message : 'the settings are not valid'}`)
  process.exit(1)
}

const db = openDb(join(config.dataDir, 'modules.db'))
const jellyfin = createJellyfinClient(config.jellyfinUrl, config.apiKey, undefined, config.version)
const app = createApp({ config, db, jellyfin })

const server = createServer((req, res) => void app.handler(req, res))
server.listen(config.port, config.host, () => {
  console.log(`jellyflix-modules ${config.version} listening on ${config.host}:${config.port}`)
  console.log(`  modules: ${config.modules.join(', ') || '(none)'}`)
  console.log(`  jellyfin: ${config.jellyfinUrl}  api key: ${config.apiKey ? 'yes' : 'no'}`)
})

// The only thing that runs by itself: once a day, with an API key, the lists of titles of the channels are read again. Without a key,
// the lists are refreshed from the app (a button for administrators). Nothing else runs unless somebody is using a module.
if (config.apiKey && app.channels) {
  const channels = app.channels
  const refresh = () => void channels.refreshAllAsService(nowSeconds()).then((n) => console.log(`channels: ${n} lists of titles refreshed`))
  setTimeout(refresh, 60_000).unref()
  setInterval(refresh, 24 * 3600 * 1000).unref()
}

const stop = () => {
  server.close(() => {
    db.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
