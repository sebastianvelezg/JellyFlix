import type { Session } from './jellyfin'
import { lastMonths, MONTHS_SHOWN } from './stats'

/**
 * What the Playback Reporting plugin of the server has noted about the signed-in user: every play with when it began, how long it
 * lasted and on what device. It is richer than what Jellyfin itself keeps (only the last play date and a count per title), so the
 * stats page adds real watch time, the hours of the day, the weekdays, the devices and how much was converted by the server.
 *
 * The plugin has no route for this, but it lets an administrator run a read-only query on its own table (`PlaybackActivity`),
 * which gives small, exact answers in one place instead of several reports. The queries are fixed here; the only thing put in
 * them is the user's id, checked to be 32 hexadecimal digits. Without the plugin, or for an account that is not an administrator,
 * the server refuses and nothing is shown.
 */

/** The table a query answered: column names and rows of text (the plugin answers every value as text, empty for none). */
export interface QueryTable {
  columns: string[]
  rows: string[][]
}

export interface RecordedMonth {
  /** "2026-10". */
  key: string
  plays: number
  seconds: number
}

export interface RecordedDevice {
  name: string
  client: string
  plays: number
  seconds: number
}

export interface PlayHistory {
  /** The day of the first play on record for this user ("2026-10-23"), when there is one. */
  since?: string
  plays: number
  seconds: number
  /** The last twelve months, oldest first, with the months nothing was played in. */
  months: RecordedMonth[]
  /** Seconds played in each hour of the day (24 entries, from 00 to 23), by the server's clock. */
  hours: number[]
  /** Seconds played on each day of the week (7 entries, from Sunday). */
  weekdays: number[]
  /** The devices played on, the most used first. */
  devices: RecordedDevice[]
  /** Seconds played as they are (direct play and direct stream), and converted by the server. */
  direct: number
  converted: number
}

/** The user's id as the plugin stores it: 32 lowercase hexadecimal digits. Throws for anything else, so nothing else reaches a query. */
export function cleanUserId(id: string): string {
  const plain = id.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(plain)) throw new Error('Not a user id')
  return plain
}

const two = (n: number) => String(n).padStart(2, '0')

/** The first day of the oldest month shown ("2025-11-01"), by the local calendar. */
export function windowStart(now: number, months = MONTHS_SHOWN): string {
  const d = new Date(now)
  const first = new Date(d.getFullYear(), d.getMonth() - (months - 1), 1)
  return `${first.getFullYear()}-${two(first.getMonth() + 1)}-01`
}

export interface PlaybackQueries {
  totals: string
  since: string
  months: string
  hours: string
  weekdays: string
  devices: string
  methods: string
}

/** The fixed read-only queries, for one user and the last twelve months (`since` looks at all of the user's history). */
export function playbackQueries(userId: string, now: number): PlaybackQueries {
  const id = cleanUserId(userId)
  const from = windowStart(now)
  const mine = `FROM PlaybackActivity WHERE UserId = '${id}'`
  const recent = `${mine} AND DateCreated >= '${from}'`
  return {
    totals: `SELECT COUNT(*), SUM(PlayDuration) ${recent}`,
    since: `SELECT MIN(DateCreated) ${mine}`,
    months: `SELECT substr(DateCreated, 1, 7) AS m, COUNT(*), SUM(PlayDuration) ${recent} GROUP BY m`,
    hours: `SELECT substr(DateCreated, 12, 2) AS h, SUM(PlayDuration) ${recent} GROUP BY h`,
    weekdays: `SELECT strftime('%w', DateCreated) AS d, SUM(PlayDuration) ${recent} GROUP BY d`,
    devices: `SELECT DeviceName, ClientName, COUNT(*), SUM(PlayDuration) ${recent} GROUP BY DeviceName, ClientName ORDER BY 4 DESC LIMIT 6`,
    methods: `SELECT PlaybackMethod, SUM(PlayDuration) ${recent} GROUP BY PlaybackMethod`,
  }
}

/** Reads the plugin's answer: `{ colums, results, message }` (the plugin spells it "colums"). Anything else is an empty table. */
export function parseTable(data: unknown): QueryTable {
  const answer = (data && typeof data === 'object' ? data : {}) as { colums?: unknown; columns?: unknown; results?: unknown }
  const names = Array.isArray(answer.colums) ? answer.colums : Array.isArray(answer.columns) ? answer.columns : []
  const rows = Array.isArray(answer.results) ? answer.results : []
  return {
    columns: names.map((c) => String(c)),
    rows: rows.filter((r): r is unknown[] => Array.isArray(r)).map((r) => r.map((cell) => (cell === null || cell === undefined ? '' : String(cell)))),
  }
}

const count = (text: string | undefined) => {
  const n = Number(text)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** A transcode is a conversion by the server; direct play and direct stream leave the file alone. */
export function isConverted(method: string): boolean {
  return /^transcod/i.test(method.trim())
}

export interface PlayHistoryTables {
  totals: QueryTable
  since: QueryTable
  months: QueryTable
  hours: QueryTable
  weekdays: QueryTable
  devices: QueryTable
  methods: QueryTable
}

/** Pure: the numbers of the page from the plugin's answers. */
export function buildPlayHistory(tables: PlayHistoryTables, now: number): PlayHistory {
  const total = tables.totals.rows[0] ?? []
  const first = tables.since.rows[0]?.[0] ?? ''
  const perMonth = new Map(tables.months.rows.map((r) => [r[0] ?? '', { plays: count(r[1]), seconds: count(r[2]) }]))
  const hours = Array.from({ length: 24 }, () => 0)
  for (const r of tables.hours.rows) {
    const h = Number(r[0])
    if (Number.isInteger(h) && h >= 0 && h < 24) hours[h] = (hours[h] ?? 0) + count(r[1])
  }
  const weekdays = Array.from({ length: 7 }, () => 0)
  for (const r of tables.weekdays.rows) {
    const d = Number(r[0])
    if (Number.isInteger(d) && d >= 0 && d < 7) weekdays[d] = (weekdays[d] ?? 0) + count(r[1])
  }
  let direct = 0
  let converted = 0
  for (const r of tables.methods.rows) {
    if (isConverted(r[0] ?? '')) converted += count(r[1])
    else direct += count(r[1])
  }
  return {
    since: /^\d{4}-\d{2}-\d{2}/.test(first) ? first.slice(0, 10) : undefined,
    plays: count(total[0]),
    seconds: count(total[1]),
    months: lastMonths(now).map((key) => ({ key, plays: perMonth.get(key)?.plays ?? 0, seconds: perMonth.get(key)?.seconds ?? 0 })),
    hours,
    weekdays,
    devices: tables.devices.rows
      .map((r) => ({ name: (r[0] ?? '').trim(), client: (r[1] ?? '').trim(), plays: count(r[2]), seconds: count(r[3]) }))
      .filter((d) => d.name || d.client)
      .sort((a, b) => b.seconds - a.seconds),
    direct,
    converted,
  }
}

async function runQuery(session: Session, sql: string): Promise<QueryTable> {
  const { data } = await session.api.axiosInstance.post(
    `${session.api.basePath}/user_usage_stats/submit_custom_query`,
    { CustomQueryString: sql, ReplaceUserId: false },
    { headers: { Authorization: session.api.authorizationHeader } },
  )
  return parseTable(data)
}

/**
 * The user's play history from Playback Reporting, or null when it cannot be had: the plugin is not installed (404), or the
 * account is not an administrator (401 or 403), or the server cannot be reached. One failed part leaves that part empty.
 */
export async function getPlayHistory(session: Session, now = Date.now()): Promise<PlayHistory | null> {
  let q: PlaybackQueries
  let totals: QueryTable
  try {
    q = playbackQueries(session.userId, now)
    totals = await runQuery(session, q.totals)
  } catch {
    return null
  }
  const part = (sql: string) => runQuery(session, sql).catch((): QueryTable => ({ columns: [], rows: [] }))
  const [since, months, hours, weekdays, devices, methods] = await Promise.all([q.since, q.months, q.hours, q.weekdays, q.devices, q.methods].map(part))
  const empty: QueryTable = { columns: [], rows: [] }
  return buildPlayHistory(
    { totals, since: since ?? empty, months: months ?? empty, hours: hours ?? empty, weekdays: weekdays ?? empty, devices: devices ?? empty, methods: methods ?? empty },
    now,
  )
}
