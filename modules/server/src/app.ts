import type { IncomingMessage, ServerResponse } from 'node:http'
import { API_VERSION, type Manifest, type ModuleInfo } from '../../contract/index.ts'
import { createAuthenticator, tokenFrom } from './auth/auth.ts'
import type { Config } from './config.ts'
import type { Db } from './db/db.ts'
import { corsHeaders, HttpError, readJson, Router, send, type Ctx } from './http/router.ts'
import type { JellyfinClient } from './jellyfin/client.ts'
import { registerChannelRoutes } from './modules/channels/routes.ts'
import { createChannelsService, type ChannelsService } from './modules/channels/service.ts'
import { createMatchService } from './modules/match/service.ts'
import { registerMatchRoutes } from './modules/match/routes.ts'
import { nowSeconds } from './util.ts'

export interface AppDeps {
  config: Config
  db: Db
  jellyfin: JellyfinClient
  /** Seconds since the epoch; replaced in tests. */
  clock?: () => number
}

export interface App {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  channels: ChannelsService | undefined
}

export function createApp({ config, db, jellyfin, clock = nowSeconds }: AppDeps): App {
  const router = new Router()
  const authenticate = createAuthenticator(jellyfin)

  router.get('/v1/health', 'public', () => ({ status: 'ok', version: config.version, api: API_VERSION }))
  router.get('/v1/manifest', 'user', (ctx): Manifest => {
    const modules: ModuleInfo[] = config.modules.map((id) => ({ id, state: 'ready' }))
    return {
      api: API_VERSION,
      version: config.version,
      serverTime: clock(),
      user: { id: ctx.user!.id, name: ctx.user!.name, isAdmin: ctx.user!.isAdmin },
      modules,
      serviceKey: jellyfin.hasServiceKey,
    }
  })

  let channels: ChannelsService | undefined
  if (config.modules.includes('channels')) {
    channels = createChannelsService(db, jellyfin)
    registerChannelRoutes(router, channels, clock)
  }
  if (config.modules.includes('match')) registerMatchRoutes(router, createMatchService(db, jellyfin), clock)

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
      const user = route.access === 'public' ? undefined : await authenticate(tokenFrom(req))
      if (route.access === 'admin' && !user?.isAdmin) throw new HttpError(403, 'Only an administrator can do that.')
      const body = method === 'GET' || method === 'DELETE' ? undefined : await readJson(req)
      const ctx: Ctx = { method, path: url.pathname, params, query: url.searchParams, body, user }
      const result = await route.handler(ctx)
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
