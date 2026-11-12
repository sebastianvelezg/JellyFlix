import type { IncomingMessage, ServerResponse } from 'node:http'
import { API_VERSION, MODULE_VERSIONS, type Manifest, type ModuleId, type ModuleInfo } from '../../contract/index.ts'
import { clientOf, createAuthenticator, tokenFrom } from './auth/auth.ts'
import type { Config } from './config.ts'
import type { Db } from './db/db.ts'
import { corsHeaders, HttpError, RawResponse, readJson, Router, send, type Ctx } from './http/router.ts'
import type { JellyfinClient } from './jellyfin/client.ts'
import { registerChannelRoutes } from './modules/channels/routes.ts'
import { createChannelsService, type ChannelsService } from './modules/channels/service.ts'
import { createMatchService } from './modules/match/service.ts'
import { registerMatchRoutes } from './modules/match/routes.ts'
import { createSeerrClient } from './modules/seerr/client.ts'
import { registerSeerrRoutes } from './modules/seerr/routes.ts'
import { createSeerrService, type SeerrService } from './modules/seerr/service.ts'
import { nowSeconds } from './util.ts'

export interface AppDeps {
  config: Config
  db: Db
  jellyfin: JellyfinClient
  /** Seconds since the epoch; replaced in tests. */
  clock?: () => number
  /** A fetch for Seerr; replaced in tests. */
  seerrFetch?: (url: string, init?: RequestInit) => Promise<Response>
}

/** A module of the container: how it joins the router and, when it can be unwell or unset, how it says so in the manifest. */
interface ModuleEntry {
  id: ModuleId
  register: () => void
  status?: () => Promise<Pick<ModuleInfo, 'state' | 'detail'>>
}

export interface App {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  channels: ChannelsService | undefined
}

export function createApp({ config, db, jellyfin, clock = nowSeconds, seerrFetch }: AppDeps): App {
  const router = new Router()
  const authenticate = createAuthenticator(jellyfin)

  router.get('/v1/health', 'public', () => ({ status: 'ok', version: config.version, api: API_VERSION }))
  // Adding a module is adding one entry here (plus its id in the contract): how it joins the router and how it reports itself.
  let channels: ChannelsService | undefined
  let seerr: SeerrService | undefined
  const registry: ModuleEntry[] = [
    {
      id: 'channels',
      register: () => {
        channels = createChannelsService(db, jellyfin)
        registerChannelRoutes(router, channels, clock)
      },
    },
    { id: 'match', register: () => registerMatchRoutes(router, createMatchService(db, jellyfin), clock) },
    {
      // Seerr needs an address and a key, and it is only "ready" while Seerr answers and is new enough.
      id: 'seerr',
      register: () => {
        if (!config.seerrUrl || !config.seerrApiKey) return
        seerr = createSeerrService(createSeerrClient(config.seerrUrl, config.seerrApiKey, seerrFetch))
        registerSeerrRoutes(router, seerr)
      },
      status: async () => {
        if (!seerr) return { state: 'needs-setup', detail: 'SEERR_URL and SEERR_API_KEY are needed in the modules container.' }
        const health = await seerr.health()
        return health.ok ? { state: 'ready' } : { state: 'error', detail: health.detail }
      },
    },
  ]
  const on = registry.filter((entry) => config.modules.includes(entry.id))
  for (const entry of on) entry.register()

  router.get('/v1/manifest', 'user', async (ctx): Promise<Manifest> => {
    const modules: ModuleInfo[] = []
    for (const entry of on) modules.push({ id: entry.id, version: MODULE_VERSIONS[entry.id], ...((await entry.status?.()) ?? { state: 'ready' }) })
    return {
      api: API_VERSION,
      version: config.version,
      serverTime: clock(),
      user: { id: ctx.user!.id, name: ctx.user!.name, isAdmin: ctx.user!.isAdmin },
      modules,
      serviceKey: jellyfin.hasServiceKey,
    }
  })

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cors = corsHeaders(req.headers.origin, config.origins)
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const method = (req.method ?? 'GET').toUpperCase()
      if (method === 'OPTIONS') return send(res, 204, undefined, cors)
      const found = router.match(method, url.pathname)
      if (found === null) throw new HttpError(404, 'Not found.')
      if (found === 'wrong-method') throw new HttpError(405, 'That method is not allowed here.')
      const { route, params } = found
      const user = route.access === 'public' ? undefined : await authenticate(tokenFrom(req), clientOf(req, config.trustProxy))
      if (route.access === 'admin' && !user?.isAdmin) throw new HttpError(403, 'Only an administrator can do that.')
      const body = method === 'GET' || method === 'DELETE' ? undefined : await readJson(req)
      const ctx: Ctx = { method, path: url.pathname, params, query: url.searchParams, body, user }
      const result = await route.handler(ctx)
      if (result instanceof RawResponse) {
        res.writeHead(result.status, { ...result.headers, ...cors, 'content-length': String(result.body.length) }).end(result.body)
        return
      }
      return result === undefined ? send(res, 204, undefined, cors) : send(res, 200, result, cors)
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message }, cors)
      // Nothing about the request (and never a token) goes into the log.
      console.error('Unexpected error:', e instanceof Error ? e.message : 'unknown')
      return send(res, 500, { error: 'Something went wrong.' }, cors)
    }
  }

  return { handler, channels }
}
