import { HttpError, RawResponse, type Router } from '../../http/router.ts'
import { parseChannelDef } from './def.ts'
import { parseImage } from './image.ts'
import type { ChannelsService } from './service.ts'

const MAX_AHEAD_SECONDS = 48 * 3600

function number(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) throw new HttpError(400, 'A number in the address is not valid.')
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function registerChannelRoutes(router: Router, service: ChannelsService, clock: () => number): void {
  router.get('/v1/channels', 'user', (ctx) => service.list(ctx.user!, clock()))
  router.get('/v1/channels/suggestions', 'admin', (ctx) => service.suggestions(ctx.user!))
  router.post('/v1/channels/preview', 'admin', (ctx) => service.preview(ctx.user!, parseChannelDef(ctx.body), clock()))
  router.post('/v1/channels/auto', 'admin', async (ctx) => {
    const o = (ctx.body ?? {}) as Record<string, unknown>
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    const types = strings(o.types).filter((x): x is 'Movie' | 'Episode' => x === 'Movie' || x === 'Episode')
    const created = await service.auto(ctx.user!, { genres: strings(o.genres), collectionIds: strings(o.collectionIds).filter((x) => /^[A-Za-z0-9-]+$/.test(x)), types }, clock())
    return { created }
  })
  // The definition of a channel (its sources, and what they are called) is for the people who set channels up.
  router.get('/v1/channels/:id', 'admin', (ctx) => service.get(ctx.params.id as string))
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
  // A favourite is the person's own: any signed-in person keeps their channels first.
  router.post('/v1/channels/:id/favorite', 'user', (ctx) => {
    const favorite = (ctx.body as { favorite?: unknown } | undefined)?.favorite
    if (typeof favorite !== 'boolean') throw new HttpError(400, 'favorite must be true or false.')
    return service.setFavorite(ctx.user!, ctx.params.id as string, favorite)
  })
  // The picture of a channel: seen by everybody, set by the administrators. It is sent as it is, with nothing that could run in it.
  router.get('/v1/channels/:id/image', 'user', (ctx) => {
    const { mime, data } = service.image(ctx.params.id as string)
    return new RawResponse(
      200,
      {
        'content-type': mime,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        // With the version in the address the picture never changes, so it can be kept; without it, it is asked for again.
        'cache-control': ctx.query.get('v') ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      },
      data,
    )
  })
  router.put('/v1/channels/:id/image', 'admin', (ctx) => {
    const { mime, bytes } = parseImage(ctx.body)
    return service.setImage(ctx.params.id as string, mime, bytes, clock())
  })
  router.delete('/v1/channels/:id/image', 'admin', (ctx) => {
    service.removeImage(ctx.params.id as string)
    return { ok: true }
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
    return service.window(ctx.user!, ctx.params.id as string, at, number(ctx.query.get('before'), 2, 0, 20), number(ctx.query.get('after'), 6, 0, 30), now)
  })
  router.get('/v1/guide', 'user', (ctx) => {
    const now = clock()
    const from = number(ctx.query.get('from'), now - 1800, now - 86400, now + MAX_AHEAD_SECONDS)
    const to = number(ctx.query.get('to'), from + 6 * 3600, from + 60, from + MAX_AHEAD_SECONDS)
    return service.guide(ctx.user!, from, to, now)
  })
}
