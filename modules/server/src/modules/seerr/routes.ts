import type { SeerrMediaType, SeerrRequestInput } from '../../../../contract/index.ts'
import { HttpError, type Router } from '../../http/router.ts'
import type { SeerrService } from './service.ts'

/** Everything a person sends is checked here, before anything is asked of Seerr. */
const mediaType = (value: unknown): SeerrMediaType => {
  if (value === 'movie' || value === 'tv') return value
  throw new HttpError(400, 'The kind of title must be movie or tv.')
}

const tmdbId = (value: unknown): number => {
  const n = typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 999_999_999) return n
  throw new HttpError(400, 'That is not a title number.')
}

const pageNumber = (value: string | null): number => {
  if (value === null || value === '') return 1
  const n = Number(value)
  if (Number.isInteger(n) && n >= 1 && n <= 1000) return n
  throw new HttpError(400, 'The page must be a number from 1 to 1000.')
}

function requestInput(body: unknown): SeerrRequestInput {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const type = mediaType(o.mediaType)
  const id = tmdbId(o.mediaId)
  if (type === 'movie') return { mediaType: type, mediaId: id }
  const seasons = o.seasons
  if (seasons === undefined || seasons === 'all') return { mediaType: type, mediaId: id, seasons: 'all' }
  if (!Array.isArray(seasons) || seasons.length < 1 || seasons.length > 100) throw new HttpError(400, 'Choose which seasons, or all of them.')
  const numbers = seasons.map((s) => {
    if (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s <= 100) return s
    throw new HttpError(400, 'A season must be a number from 0 to 100.')
  })
  return { mediaType: type, mediaId: id, seasons: [...new Set(numbers)].sort((a, b) => a - b) }
}

export function registerSeerrRoutes(router: Router, service: SeerrService): void {
  router.get('/v1/seerr/me', 'user', (ctx) => service.me(ctx.user!))
  router.get('/v1/seerr/search', 'user', (ctx) => {
    const query = (ctx.query.get('query') ?? '').trim()
    if (!query) throw new HttpError(400, 'Type something to search for.')
    if (query.length > 200) throw new HttpError(400, 'That search is too long.')
    return service.search(ctx.user!, query, pageNumber(ctx.query.get('page')))
  })
  router.get('/v1/seerr/title/:type/:id', 'user', (ctx) => service.title(ctx.user!, mediaType(ctx.params.type), tmdbId(ctx.params.id)))
  router.post('/v1/seerr/requests', 'user', (ctx) => service.request(ctx.user!, requestInput(ctx.body)))
  router.get('/v1/seerr/requests', 'user', (ctx) => service.requests(ctx.user!, pageNumber(ctx.query.get('page'))))
}
