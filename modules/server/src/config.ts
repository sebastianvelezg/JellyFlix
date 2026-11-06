import type { ModuleId } from '../../contract/index.ts'
import { MODULE_IDS } from '../../contract/index.ts'

export interface Config {
  port: number
  host: string
  /** The address of Jellyfin as seen from this container (not the one the browsers use). */
  jellyfinUrl: string
  /** Optional: lets the container read the library by night and look at what other people have watched. Never leaves the container. */
  apiKey: string | undefined
  modules: ModuleId[]
  dataDir: string
  /** The sites allowed to call the API from a browser. "*" is fine: the API uses a token in a header, not cookies. */
  origins: string[]
  version: string
}

const clean = (value: string | undefined): string => (value ?? '').trim()

/** Reads the settings from environment variables. Throws a plain message when something needed is missing or wrong. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jellyfinUrl = clean(env.JELLYFIN_URL).replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s/]+/.test(jellyfinUrl)) {
    throw new Error('JELLYFIN_URL is required: the address of your Jellyfin server as seen from this container, for example http://jellyfin:8096')
  }
  const asked = clean(env.JELLYFLIX_MODULES ?? 'channels,match')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  const unknown = asked.filter((x) => !(MODULE_IDS as readonly string[]).includes(x))
  if (unknown.length) throw new Error(`JELLYFLIX_MODULES lists modules that do not exist: ${unknown.join(', ')}. Available: ${MODULE_IDS.join(', ')}`)
  const port = Number(clean(env.PORT) || 8097)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number from 1 to 65535')
  return {
    port,
    host: clean(env.HOST) || '0.0.0.0',
    jellyfinUrl,
    apiKey: clean(env.JELLYFIN_API_KEY) || undefined,
    modules: [...new Set(asked)] as ModuleId[],
    dataDir: clean(env.DATA_DIR) || './data',
    origins: (clean(env.JELLYFLIX_ORIGINS) || '*').split(',').map((x) => x.trim()).filter(Boolean),
    version: '0.1.0',
  }
}
