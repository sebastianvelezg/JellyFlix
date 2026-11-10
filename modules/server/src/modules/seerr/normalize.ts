import type { SeerrDetail, SeerrMediaType, SeerrQuota, SeerrRequestStatus, SeerrRequestView, SeerrSeason, SeerrStatus, SeerrTitle } from '../../../../contract/index.ts'

/**
 * Seerr's answers as this container's own, smaller shapes. Nothing is passed through: every field is read, checked and cut to size here,
 * so a strange or very large answer cannot reach an app.
 */

type Raw = Record<string, unknown>
const obj = (x: unknown): Raw => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Raw) : {})
const text = (x: unknown, max: number): string | undefined => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined)
const whole = (x: unknown): number | undefined => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : undefined)

/** MediaStatus in Seerr: 1 unknown, 2 pending, 3 processing, 4 partially available, 5 available, 6 blocklisted, 7 deleted. */
export function statusOf(code: unknown): SeerrStatus {
  switch (code) {
    case 2:
      return 'pending'
    case 3:
      return 'processing'
    case 4:
      return 'partial'
    case 5:
      return 'available'
    case 6:
      return 'blocked'
    default:
      return 'none'
  }
}

/** A TMDb picture path: "/", letters, digits, dots, dashes and underscores. Anything else is dropped (the app builds the address from it). */
export function posterOf(x: unknown): string | undefined {
  return typeof x === 'string' && /^\/[A-Za-z0-9._-]{1,120}$/.test(x) ? x : undefined
}

/** The title's id in Jellyfin: only what looks like an id (letters, digits, dashes). */
function jellyfinIdOf(x: unknown): string | undefined {
  return typeof x === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(x) ? x : undefined
}

const yearOf = (x: unknown): number | undefined => {
  const m = typeof x === 'string' ? /^(\d{4})/.exec(x) : null
  return m ? Number(m[1]) : undefined
}

/** A movie or series of a search, or null for anything else (a person, a collection). */
export function titleOf(raw: unknown, fallbackType?: SeerrMediaType, overviewMax = 400): SeerrTitle | null {
  const r = obj(raw)
  const type = r.mediaType === 'movie' || r.mediaType === 'tv' ? r.mediaType : fallbackType
  const id = whole(r.id)
  if (!type || !id || id < 1) return null
  const title = text(type === 'movie' ? (r.title ?? r.originalTitle) : (r.name ?? r.originalName), 200)
  if (!title) return null
  const info = obj(r.mediaInfo)
  const year = yearOf(type === 'movie' ? r.releaseDate : r.firstAirDate)
  const overview = text(r.overview, overviewMax)
  const posterPath = posterOf(r.posterPath)
  const jellyfinId = jellyfinIdOf(info.jellyfinMediaId)
  return {
    mediaType: type,
    id,
    title,
    ...(year ? { year } : {}),
    ...(overview ? { overview } : {}),
    ...(posterPath ? { posterPath } : {}),
    status: statusOf(info.status),
    ...(jellyfinId ? { jellyfinId } : {}),
  }
}

/** The page of a series or movie: the title plus, for a series, its seasons (without the specials) and where each stands. */
export function detailOf(raw: unknown, type: SeerrMediaType): SeerrDetail | null {
  const base = titleOf({ ...obj(raw), mediaType: type }, type, 1500)
  if (!base) return null
  const r = obj(raw)
  const tagline = text(r.tagline, 200)
  const detail: SeerrDetail = { ...base, ...(tagline ? { tagline } : {}) }
  if (type === 'tv') {
    const known = new Map<number, SeerrStatus>()
    const info = obj(r.mediaInfo)
    // What the requests of this series ask for: a season asked for is on its way even though Seerr has not marked the season yet.
    // (A pending request is "waiting for approval", an approved one "being added"; a declined or failed one asks for nothing now.)
    if (Array.isArray(info.requests)) {
      for (const request of info.requests.slice(0, 200)) {
        const code = obj(request).status
        const asked: SeerrStatus | null = code === 1 ? 'pending' : code === 2 ? 'processing' : null
        const asks = obj(request).seasons
        if (!asked || !Array.isArray(asks)) continue
        for (const s of asks.slice(0, 200)) {
          const n = whole(obj(s).seasonNumber)
          if (n !== undefined && known.get(n) !== 'processing') known.set(n, asked)
        }
      }
    }
    // What Seerr says about each season itself wins over that, unless it knows nothing.
    const seasonsInfo = info.seasons
    if (Array.isArray(seasonsInfo)) {
      for (const s of seasonsInfo.slice(0, 200)) {
        const n = whole(obj(s).seasonNumber)
        const status = statusOf(obj(s).status)
        if (n !== undefined && (status !== 'none' || !known.has(n))) known.set(n, status)
      }
    }
    const seasons: SeerrSeason[] = []
    if (Array.isArray(r.seasons)) {
      for (const s of r.seasons.slice(0, 200)) {
        const number = whole(obj(s).seasonNumber)
        if (number === undefined || number < 1 || number > 100) continue
        const episodes = whole(obj(s).episodeCount)
        seasons.push({ number, name: text(obj(s).name, 120) ?? `Season ${number}`, ...(episodes !== undefined ? { episodes } : {}), status: known.get(number) ?? 'none' })
      }
    }
    detail.seasons = seasons.sort((a, b) => a.number - b.number)
  }
  return detail
}

/** MediaRequestStatus in Seerr: 1 pending, 2 approved, 3 declined, 4 failed, 5 completed. */
export function requestStatusOf(code: unknown): SeerrRequestStatus {
  switch (code) {
    case 2:
      return 'approved'
    case 3:
      return 'declined'
    case 4:
      return 'failed'
    case 5:
      return 'completed'
    default:
      return 'pending'
  }
}

/** One of the person's requests; the title and picture come from `known` (looked up apart: a request only holds the TMDb id). */
export function requestOf(raw: unknown, known: (type: SeerrMediaType, id: number) => { title: string; posterPath?: string } | undefined): SeerrRequestView | null {
  const r = obj(raw)
  const media = obj(r.media)
  const id = whole(r.id)
  const mediaId = whole(media.tmdbId)
  const type = media.mediaType === 'movie' || media.mediaType === 'tv' ? media.mediaType : undefined
  if (!id || !mediaId || !type) return null
  const info = known(type, mediaId)
  const created = text(r.createdAt, 40)
  const seasons = Array.isArray(r.seasons) ? r.seasons.map((s) => whole(obj(s).seasonNumber)).filter((n): n is number => n !== undefined && n <= 100).slice(0, 100) : []
  const jellyfinId = jellyfinIdOf(media.jellyfinMediaId)
  return {
    id,
    mediaType: type,
    mediaId,
    title: info?.title ?? `#${mediaId}`,
    ...(info?.posterPath ? { posterPath: info.posterPath } : {}),
    status: requestStatusOf(r.status),
    mediaStatus: statusOf(media.status),
    ...(type === 'tv' && seasons.length ? { seasons } : {}),
    createdAt: created && !Number.isNaN(Date.parse(created)) ? created : '',
    ...(jellyfinId ? { jellyfinId } : {}),
  }
}

/** A quota of Seerr ({days, limit, used, remaining, restricted}); a limit of 0 or none means no limit. */
export function quotaOf(raw: unknown): SeerrQuota | undefined {
  const r = obj(raw)
  if (Object.keys(r).length === 0) return undefined
  const limit = whole(r.limit)
  const days = whole(r.days)
  const remaining = whole(r.remaining)
  const used = whole(r.used) ?? 0
  return {
    ...(limit ? { limit } : {}),
    ...(limit && days ? { days } : {}),
    used,
    ...(limit && remaining !== undefined ? { remaining } : {}),
    restricted: r.restricted === true,
  }
}

// Seerr's permission bits (server/lib/permissions.ts); ADMIN allows everything.
const ADMIN = 2
const REQUEST = 32
const REQUEST_MOVIE = 262144
const REQUEST_TV = 524288

/** What a Seerr user may request, from their permission number. */
export function canRequest(permissions: unknown): { movie: boolean; tv: boolean } {
  const p = typeof permissions === 'number' && Number.isInteger(permissions) ? permissions : 0
  const admin = (p & ADMIN) !== 0
  return { movie: admin || (p & (REQUEST | REQUEST_MOVIE)) !== 0, tv: admin || (p & (REQUEST | REQUEST_TV)) !== 0 }
}
