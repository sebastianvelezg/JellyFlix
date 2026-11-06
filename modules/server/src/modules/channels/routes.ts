import { HttpError, type Router } from '../../http/router.ts'
import { parseChannelDef } from './def.ts'
import type { ChannelsService } from './service.ts'

const MAX_AHEAD_SECONDS = 48 * 3600

function number(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) throw new HttpError(400, 'A number in the address is not valid.')
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function registerChannelRoutes(router: Router, service: ChannelsService, clock: () => number): void {
  router.get('/v1/channels', 'user', () => service.list(clock()))
  router.get('/v1/channels/suggestions', 'admin', (ctx) => service.suggestions(ctx.user!))
  router.post('/v1/channels/preview', 'admin', (ctx) => service.preview(ctx.user!, parseChannelDef(ctx.body), clock()))
  router.post('/v1/channels/auto', 'admin', async (ctx) => {
    const o = (ctx.body ?? {}) as Record<string, unknown>
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    const types = strings(o.types).filter((x): x is 'Movie' | 'Episode' => x === 'Movie' || x === 'Episode')
    const created = await service.auto(ctx.user!, { genres: strings(o.genres), collectionIds: strings(o.collectionIds).filter((x) => /^[A-Za-z0-9-]+$/.test(x)), types }, clock())
    return { created }
  })
  router.get('/v1/channels/:id', 'user', (ctx) => service.get(ctx.params.id as string))
  router.post('/v1/channels', 'admin', (ctx) => service.create(ctx.user!, parseChannelDef(ctx.body), clock()))
  router.put('/v1/channels/:id', 'admin', (ctx) => service.update(ctx.user!, ctx.params.id as string, parseChannelDef(ctx.body), clock()))
  router.delete('/v1/channels/:id', 'admin', (ctx) => {
    service.remove(ctx.params.id as string)
    return { ok: true }
  })
  router.post('/v1/channels/:id/enabled', 'admin', (ctx) => {
    const enabled = (ctx.body as { enabled?: unknown } | undefined)?.enabled
    if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false.')
    return service.setEnabled(ctx.params.id as string, enabled, clock())
  })
  // "Apply now": the schedule from this moment on is made again.
  router.post('/v1/channels/:id/rebuild', 'admin', (ctx) => {
    service.rebuild(ctx.params.id as string, clock(), 0)
    return service.get(ctx.params.id as string)
  })
  router.post('/v1/channels/:id/refresh', 'admin', (ctx) => service.refreshPool(ctx.user!, ctx.params.id as string, clock()))
  router.get('/v1/channels/:id/window', 'user', (ctx) => {
    const now = clock()
    const at = number(ctx.query.get('at'), now, now - 7 * 86400, now + MAX_AHEAD_SECONDS)
    return service.window(ctx.params.id as string, at, number(ctx.query.get('before'), 2, 0, 20), number(ctx.query.get('after'), 6, 0, 30), now)
  })
  router.get('/v1/guide', 'user', (ctx) => {
    const now = clock()
    const from = number(ctx.query.get('from'), now - 1800, now - 86400, now + MAX_AHEAD_SECONDS)
    const to = number(ctx.query.get('to'), from + 6 * 3600, from + 60, from + MAX_AHEAD_SECONDS)
    return service.guide(from, to, now)
  })
}
