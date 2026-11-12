import { HttpError, type Router } from '../../http/router.ts'
import type { MatchVote } from '../../../../contract/index.ts'
import type { MatchService } from './service.ts'

const text = (value: unknown, what: string, max = 80): string => {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${what} is needed.`)
  return value.trim().slice(0, max)
}

export function registerMatchRoutes(router: Router, service: MatchService, clock: () => number): void {
  router.get('/v1/match/rooms', 'user', (ctx) => service.mine(ctx.user!))
  router.get('/v1/match/options', 'user', (ctx) => service.options(ctx.user!))
  router.post('/v1/match/rooms', 'user', (ctx) => {
    const o = (ctx.body ?? {}) as Record<string, unknown>
    return service.create(
      ctx.user!,
      {
        ...(typeof o.deckSize === 'number' ? { deckSize: o.deckSize } : {}),
        ...(typeof o.genre === 'string' ? { genre: o.genre } : {}),
        ...(typeof o.decade === 'number' ? { decade: o.decade } : {}),
        ...(o.length === 'short' || o.length === 'medium' || o.length === 'long' ? { length: o.length } : {}),
        ...(o.series === true ? { series: true } : {}),
        ...(o.mode === 'phones' ? { mode: 'phones' as const } : {}),
        ...(Array.isArray(o.players) ? { players: o.players.slice(0, 7) as string[] } : {}),
      },
      clock(),
    )
  })
  router.post('/v1/match/join', 'user', (ctx) => service.join(ctx.user!, text((ctx.body as Record<string, unknown> | undefined)?.code, 'The code', 12), clock()))
  router.get('/v1/match/rooms/:id', 'user', (ctx) => {
    const since = ctx.query.get('since')
    const as = ctx.query.get('as')
    return service.view(ctx.user!, ctx.params.id as string, since === null ? undefined : Number(since), as === null ? undefined : as.slice(0, 80))
  })
  router.post('/v1/match/rooms/:id/swipe', 'user', (ctx) => {
    const o = (ctx.body ?? {}) as Record<string, unknown>
    const vote = o.vote
    if (vote !== 'like' && vote !== 'pass') throw new HttpError(400, 'The vote must be like or pass.')
    return service.swipe(ctx.user!, ctx.params.id as string, text(o.cardId, 'The card', 64), vote as MatchVote, clock(), typeof o.as === 'string' ? o.as.slice(0, 80) : undefined)
  })
  router.post('/v1/match/rooms/:id/start', 'user', (ctx) => service.start(ctx.user!, ctx.params.id as string, clock()))
  router.post('/v1/match/rooms/:id/pick', 'user', (ctx) => {
    const o = (ctx.body ?? {}) as Record<string, unknown>
    return service.choose(ctx.user!, ctx.params.id as string, text(o.cardId, 'The card', 64), clock(), typeof o.as === 'string' ? o.as.slice(0, 80) : undefined)
  })
  router.post('/v1/match/rooms/:id/again', 'user', (ctx) => service.again(ctx.user!, ctx.params.id as string, clock()))
  router.post('/v1/match/rooms/:id/end', 'user', (ctx) => service.end(ctx.user!, ctx.params.id as string, clock()))
  router.delete('/v1/match/rooms/:id', 'user', (ctx) => {
    service.leave(ctx.user!, ctx.params.id as string, clock())
    return { ok: true }
  })
}
