import type { SeerrDetail, SeerrMe, SeerrMediaType, SeerrRequestInput, SeerrRequestResult, SeerrRequests, SeerrSearch } from '../../../../contract/index.ts'
import { HttpError, type AuthUser } from '../../http/router.ts'
import type { SeerrClient } from './client.ts'
import { canRequest, detailOf, quotaOf, requestOf, requestStatusOf, titleOf } from './normalize.ts'

/** The oldest Seerr that can be asked who a Jellyfin account is (`GET /user/jellyfin/{id}`, from 3.3.0). */
export const MIN_SEERR = [3, 3, 0] as const

const IDENTITY_MS = 10 * 60_000
/** How long "this account is not in Seerr" is remembered. */
const UNKNOWN_MS = 60_000
const NOT_IN_SEERR = 'Your Jellyfin account is not in Seerr yet. Ask an administrator to import you.'
const HEALTH_MS = 60_000
/** The app asks the manifest with a short patience, and the other modules must not disappear because Seerr is slow. */
const HEALTH_TIMEOUT_MS = 1500
const MAX_PEOPLE = 500
const MAX_TITLES = 1000
const TITLE_MS = 60 * 60_000
const REQUEST_LIMIT = { count: 10, windowMs: 60_000 }
const SEARCH_LIMIT = { count: 60, windowMs: 60_000 }
/** Looking at a title, at one's own requests or quota: each is a question to Seerr too, so they are counted (a screen makes a few of them). */
const READ_LIMIT = { count: 180, windowMs: 60_000 }

export type SeerrHealth = { ok: true; version: string } | { ok: false; detail: string }

export interface SeerrService {
  /** Whether Seerr answers and is new enough; remembered for a minute. */
  health(): Promise<SeerrHealth>
  me(user: AuthUser): Promise<SeerrMe>
  search(user: AuthUser, query: string, page: number): Promise<SeerrSearch>
  title(user: AuthUser, type: SeerrMediaType, id: number): Promise<SeerrDetail>
  request(user: AuthUser, input: SeerrRequestInput): Promise<SeerrRequestResult>
  requests(user: AuthUser, page: number): Promise<SeerrRequests>
}

interface Account {
  seerrId: number
  permissions: number
  expires: number
}

/** A count of calls per person in a window of time; the oldest calls are forgotten as time passes. */
function limiter(config: { count: number; windowMs: number }, now: () => number) {
  const seen = new Map<string, number[]>()
  return (who: string): void => {
    const t = now()
    const recent = (seen.get(who) ?? []).filter((at) => t - at < config.windowMs)
    if (recent.length >= config.count) throw new HttpError(429, 'Slow down a little and try again in a minute.')
    recent.push(t)
    seen.delete(who)
    while (seen.size >= MAX_PEOPLE) seen.delete(seen.keys().next().value as string)
    seen.set(who, recent)
  }
}

export function parseVersion(text: unknown): [number, number, number] | null {
  const m = typeof text === 'string' ? /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim()) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const older = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < 3; i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0)
  return false
}

export function createSeerrService(client: SeerrClient, now: () => number = Date.now): SeerrService {
  const accounts = new Map<string, Account>()
  const unknown = new Map<string, number>()
  const titles = new Map<string, { title: string; posterPath?: string; expires: number }>()
  const askedToRequest = limiter(REQUEST_LIMIT, now)
  const askedToSearch = limiter(SEARCH_LIMIT, now)
  const askedToRead = limiter(READ_LIMIT, now)
  let health: { value: SeerrHealth; expires: number } | null = null
  let checking: Promise<SeerrHealth> | null = null

  /** Asks Seerr which version it is (one question at a time, and a short wait). */
  function checkHealth(): Promise<SeerrHealth> {
    if (checking) return checking
    checking = (async (): Promise<SeerrHealth> => {
      let value: SeerrHealth
      try {
        const status = await client.get<{ version?: unknown }>('/status', { query: { checkUpdateAvailable: 'false' }, timeoutMs: HEALTH_TIMEOUT_MS })
        const version = parseVersion(status.version)
        if (!version) value = { ok: false, detail: 'Seerr did not say which version it is.' }
        else if (older(version, MIN_SEERR)) value = { ok: false, detail: `Seerr ${version.join('.')} is too old: ${MIN_SEERR.join('.')} or later is needed.` }
        else value = { ok: true, version: version.join('.') }
      } catch (e) {
        value = { ok: false, detail: e instanceof HttpError ? e.message : 'Seerr did not answer.' }
      }
      health = { value, expires: now() + HEALTH_MS }
      return value
    })().finally(() => {
      checking = null
    })
    return checking
  }

  /**
   * Who this Jellyfin account is in Seerr. The Jellyfin id comes from the verified session (never from the request), and the Seerr
   * id it maps to is the only one this person's calls are ever made as. An account Seerr does not know is told so: it is not
   * created here, and the administrator's account is never used instead.
   */
  async function accountOf(user: AuthUser): Promise<Account> {
    const hit = accounts.get(user.id)
    if (hit && hit.expires > now()) return hit
    // An account Seerr does not know is remembered for a minute, so typing a search does not ask Seerr again with every key.
    const unknownUntil = unknown.get(user.id)
    if (unknownUntil !== undefined && unknownUntil > now()) throw new HttpError(403, NOT_IN_SEERR)
    let found: { id?: unknown; permissions?: unknown }
    try {
      found = await client.get(`/user/jellyfin/${encodeURIComponent(user.id)}`)
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        unknown.delete(user.id)
        while (unknown.size >= MAX_PEOPLE) unknown.delete(unknown.keys().next().value as string)
        unknown.set(user.id, now() + UNKNOWN_MS)
        throw new HttpError(403, NOT_IN_SEERR)
      }
      throw e
    }
    const seerrId = typeof found.id === 'number' && Number.isInteger(found.id) && found.id > 0 ? found.id : 0
    if (!seerrId) throw new HttpError(502, 'Seerr did not say who this is.')
    const account = { seerrId, permissions: typeof found.permissions === 'number' ? found.permissions : 0, expires: now() + IDENTITY_MS }
    accounts.delete(user.id)
    while (accounts.size >= MAX_PEOPLE) accounts.delete(accounts.keys().next().value as string)
    accounts.set(user.id, account)
    return account
  }

  /** The title and picture of a TMDb id, remembered for an hour (a request only holds the id). */
  async function titleName(seerrId: number, type: SeerrMediaType, id: number): Promise<{ title: string; posterPath?: string } | undefined> {
    const key = `${type}:${id}`
    const hit = titles.get(key)
    if (hit && hit.expires > now()) return hit
    try {
      const raw = await client.get(`/${type}/${id}`, { asUser: seerrId })
      const found = titleOf({ ...(raw as object), mediaType: type }, type)
      if (!found) return undefined
      const value = { title: found.title, ...(found.posterPath ? { posterPath: found.posterPath } : {}), expires: now() + TITLE_MS }
      titles.delete(key)
      while (titles.size >= MAX_TITLES) titles.delete(titles.keys().next().value as string)
      titles.set(key, value)
      return value
    } catch {
      return undefined
    }
  }

  return {
    async health() {
      if (health && health.expires > now()) return health.value
      // An answer that is a little old is given at once (and renewed behind it), so the manifest never waits on a slow Seerr twice.
      if (health) {
        void checkHealth()
        return health.value
      }
      return checkHealth()
    },

    async me(user) {
      askedToRead(user.id)
      const account = await accountOf(user)
      const quota = await client.get<{ movie?: unknown; tv?: unknown }>(`/user/${account.seerrId}/quota`, { asUser: account.seerrId }).catch(() => ({}) as { movie?: unknown; tv?: unknown })
      const movie = quotaOf(quota.movie)
      const tv = quotaOf(quota.tv)
      return { canRequest: canRequest(account.permissions), quota: { ...(movie ? { movie } : {}), ...(tv ? { tv } : {}) } }
    },

    async search(user, query, page) {
      // (The limit comes first: a search that is going to be refused costs Seerr nothing.)
      askedToSearch(user.id)
      const account = await accountOf(user)
      const answer = await client.get<{ page?: unknown; totalPages?: unknown; results?: unknown }>('/search', { asUser: account.seerrId, query: { query, page } })
      const results = (Array.isArray(answer.results) ? answer.results : []).slice(0, 40).map((r) => titleOf(r)).filter((t) => t !== null)
      const pages = typeof answer.totalPages === 'number' && Number.isInteger(answer.totalPages) ? Math.min(Math.max(answer.totalPages, 1), 1000) : 1
      return { page, totalPages: pages, results }
    },

    async title(user, type, id) {
      askedToRead(user.id)
      const account = await accountOf(user)
      const raw = await client.get(`/${type}/${id}`, { asUser: account.seerrId })
      const detail = detailOf(raw, type)
      if (!detail) throw new HttpError(502, 'Seerr sent a title that could not be read.')
      return detail
    },

    async request(user, input) {
      const account = await accountOf(user)
      if (!canRequest(account.permissions)[input.mediaType]) throw new HttpError(403, 'Your Seerr account may not request this kind of title.')
      askedToRequest(user.id)
      // Only these four things go to Seerr, and the request is made as this person.
      const body = { mediaType: input.mediaType, mediaId: input.mediaId, ...(input.mediaType === 'tv' && input.seasons ? { seasons: input.seasons } : {}) }
      const made = await client.post<{ id?: unknown; status?: unknown }>('/request', body, { asUser: account.seerrId })
      const requestId = typeof made.id === 'number' && Number.isInteger(made.id) && made.id > 0 ? made.id : 0
      // Seerr answers "ok" without a request when everything asked for was already requested (seen with a series' seasons): nothing was made.
      if (!requestId) throw new HttpError(409, 'That has already been requested.')
      return { requestId, status: requestStatusOf(made.status) }
    },

    async requests(user, page) {
      askedToRead(user.id)
      const account = await accountOf(user)
      const take = 10
      // Always only this person's own requests, even for an administrator (who would otherwise get everybody's).
      const answer = await client.get<{ pageInfo?: { pages?: unknown }; results?: unknown }>('/request', {
        asUser: account.seerrId,
        query: { take, skip: (page - 1) * take, sort: 'added', requestedBy: account.seerrId },
      })
      const rows = (Array.isArray(answer.results) ? answer.results : []).slice(0, take)
      // The titles are looked up a few at a time, so a page of requests does not become a burst of calls.
      const known = new Map<string, { title: string; posterPath?: string }>()
      const wanted: Array<[SeerrMediaType, number]> = []
      for (const row of rows) {
        const media = (row as { media?: { mediaType?: unknown; tmdbId?: unknown } }).media
        if ((media?.mediaType === 'movie' || media?.mediaType === 'tv') && typeof media.tmdbId === 'number' && !wanted.some(([t, i]) => t === media.mediaType && i === media.tmdbId)) wanted.push([media.mediaType, media.tmdbId])
      }
      for (let i = 0; i < wanted.length; i += 5) {
        await Promise.all(
          wanted.slice(i, i + 5).map(async ([type, id]) => {
            const found = await titleName(account.seerrId, type, id)
            if (found) known.set(`${type}:${id}`, found)
          }),
        )
      }
      const results = rows.map((row) => requestOf(row, (type, id) => known.get(`${type}:${id}`))).filter((r) => r !== null)
      const pages = typeof answer.pageInfo?.pages === 'number' && Number.isInteger(answer.pageInfo.pages) ? Math.min(Math.max(answer.pageInfo.pages, 1), 1000) : 1
      return { page, totalPages: pages, results }
    },
  }
}
