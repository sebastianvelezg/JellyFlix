import type { ActivityLogEntry } from '@jellyfin/sdk/lib/generated-client/models/activity-log-entry'
import type { SessionInfoDto } from '@jellyfin/sdk/lib/generated-client/models/session-info-dto'
import type { UserPolicy } from '@jellyfin/sdk/lib/generated-client/models/user-policy'
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields'
import { getAuthenticationApi } from '@jellyfin/sdk/lib/utils/api/authentication-api'
import { getDeviceApi } from '@jellyfin/sdk/lib/utils/api/device-api'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getLibraryStructureApi } from '@jellyfin/sdk/lib/utils/api/library-structure-api'
import { getLocalizationApi } from '@jellyfin/sdk/lib/utils/api/localization-api'
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api'
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api'
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api'
import { applyFields, getEditableItem, refreshItem, saveItem, type RefreshMode } from './admin'
import { setWatched } from './details'
import type { Session } from './jellyfin'
import { getTasks } from './plugins'

/**
 * Day-to-day administration: libraries, users, sessions, devices, keys, activity and server health. Everything is the
 * server's own API and the server decides who may do it (403 for anyone who is not an administrator). Nothing here is
 * destructive without the screen asking first, and nothing here ever shows or stores a secret (a key's text is only
 * kept in memory to revoke it; the screen shows its last four characters).
 */

// ---- libraries ----------------------------------------------------------------------------------------

export interface LibraryInfo {
  id: string
  name: string
  type: string
  locations: string[]
  refreshing: boolean
  /** 0-100 while a scan runs. */
  progress: number | null
}

export async function getLibraries(session: Session): Promise<LibraryInfo[]> {
  const { data } = await getLibraryStructureApi(session.api).getVirtualFolders()
  return data
    .filter((f) => f.ItemId && f.Name)
    .map((f) => ({
      id: f.ItemId as string,
      name: f.Name as string,
      type: f.CollectionType ?? 'mixed',
      locations: f.Locations ?? [],
      refreshing: !!f.RefreshStatus && f.RefreshStatus !== 'Idle',
      progress: f.RefreshProgress ?? null,
    }))
}

/** Looks for new, changed and removed files in every library. The server does it in the background. */
export async function scanAllLibraries(session: Session): Promise<void> {
  await getLibraryApi(session.api).refreshLibrary()
}

export interface TitleRow {
  id: string
  name: string
  type: 'Movie' | 'Series'
  year?: number
  /** Where the server keeps it (a path on the server's disk; for reading, not for editing). */
  path?: string
  /** The server knows which title in the providers this is. */
  identified: boolean
  tags: string[]
}

export interface TitleQuery {
  text: string
  /** One kind at a time: a server sorts movies and series together very slowly (24 s measured on a large library) and each alone quickly. */
  type: 'Movie' | 'Series'
  /** Only titles with no provider id (the ones the server could not recognise). */
  unidentified: boolean
  start: number
  limit: number
}

export const TITLE_PAGE = 50

export async function findTitles(session: Session, query: TitleQuery): Promise<{ rows: TitleRow[]; total: number }> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    recursive: true,
    includeItemTypes: [query.type],
    searchTerm: query.text.trim() || undefined,
    hasTmdbId: query.unidentified ? false : undefined,
    fields: [ItemFields.Path, ItemFields.ProviderIds, ItemFields.Tags],
    sortBy: ['SortName'],
    sortOrder: ['Ascending'],
    startIndex: query.start,
    limit: query.limit,
    enableTotalRecordCount: true,
  })
  const rows = (data.Items ?? [])
    .filter((i) => i.Id && i.Name && (i.Type === 'Movie' || i.Type === 'Series'))
    .map((i) => ({
      id: i.Id as string,
      name: i.Name as string,
      type: i.Type as 'Movie' | 'Series',
      year: i.ProductionYear ?? undefined,
      path: i.Path ?? undefined,
      identified: Object.values(i.ProviderIds ?? {}).some(Boolean),
      tags: i.Tags ?? [],
    }))
  return { rows, total: data.TotalRecordCount ?? rows.length }
}

/**
 * Deletes a title from the server's library. On a real server this also deletes its files from the disk when the account may
 * (that cannot be undone), so the screen asks for the title's name first.
 */
export async function deleteTitle(session: Session, id: string): Promise<void> {
  await getLibraryApi(session.api).deleteItem({ itemId: id })
}

/** Does what was typed match the name of the title (so a delete cannot happen by a stray click)? Pure. */
export function confirmsName(typed: string, name: string): boolean {
  return typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== ''
}

// ---- batch actions ------------------------------------------------------------------------------------

export type BatchAction =
  | { kind: 'watched'; value: boolean }
  | { kind: 'refresh'; mode: RefreshMode }
  | { kind: 'lock'; value: boolean }
  | { kind: 'tag'; tag: string; add: boolean }

/** At most this many titles per batch: a slip cannot touch the whole library. */
export const BATCH_LIMIT = 100

/** What a batch will do, as one English sentence with `{tag}` filled in by the screen after it translates the sentence. */
export function describeBatch(action: BatchAction): string {
  switch (action.kind) {
    case 'watched':
      return action.value ? 'Mark as watched (for you)' : 'Mark as not watched (for you)'
    case 'refresh':
      return action.mode === 'all' ? 'Replace the details from the providers' : action.mode === 'missing' ? 'Look for missing details' : 'Look for changed files'
    case 'lock':
      return action.value ? 'Keep everything as it is (lock)' : 'Allow the server to replace details (unlock)'
    case 'tag':
      return action.add ? 'Add the tag “{tag}”' : 'Remove the tag “{tag}”'
  }
}

export const cleanTag = (tag: string): string => tag.trim().replace(/\s+/g, ' ')

/** Why a batch cannot start, or null. Pure. */
export function batchProblem(action: BatchAction, count: number): string | null {
  if (count === 0) return 'Choose at least one title.'
  if (count > BATCH_LIMIT) return 'Choose at most 100 titles at a time.'
  if (action.kind === 'tag') {
    const tag = cleanTag(action.tag)
    if (!tag) return 'Type the tag first.'
    if (tag.length > 80 || /[,;\n]/.test(tag)) return 'A tag is short and has no commas.'
  }
  return null
}

export interface BatchResult {
  id: string
  name: string
  outcome: 'done' | 'skipped' | 'failed'
  /** English reason for skipped / failed. */
  reason?: string
}

export interface BatchProgress {
  done: number
  total: number
  results: BatchResult[]
}

/** The refusal of a server that does not let this account do it: the rest of the batch would only be refused too. */
const refused = (e: unknown): boolean => (e as { response?: { status?: number } } | null)?.response?.status === 403

/**
 * Runs `perform` for each title, a few at a time, reporting after each one. Stops starting new ones when `signal` is
 * aborted or when the server refuses (403: the rest would be refused too). One failure never stops the others. Pure apart from
 * `perform`.
 */
export async function runBatch(
  rows: ReadonlyArray<Pick<TitleRow, 'id' | 'name'>>,
  perform: (row: Pick<TitleRow, 'id' | 'name'>) => Promise<'done' | 'skipped'>,
  options: { concurrency?: number; signal?: AbortSignal; onProgress?: (progress: BatchProgress) => void } = {},
): Promise<BatchResult[]> {
  const results: BatchResult[] = []
  let next = 0
  let stopped = false
  const total = rows.length
  const report = () => options.onProgress?.({ done: results.length, total, results: [...results] })
  async function worker() {
    for (;;) {
      if (stopped || options.signal?.aborted) return
      const row = rows[next]
      next += 1
      if (!row) return
      try {
        results.push({ id: row.id, name: row.name, outcome: await perform(row) })
      } catch (e) {
        if (refused(e)) stopped = true
        results.push({ id: row.id, name: row.name, outcome: 'failed', reason: refused(e) ? 'The server refused (this account is not an administrator).' : 'The server could not do it.' })
      }
      report()
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 3, 6)) }, worker))
  // What was never started because the batch was stopped.
  for (const row of rows.slice(next)) results.push({ id: row.id, name: row.name, outcome: 'skipped', reason: 'Not started: the batch was stopped.' })
  report()
  return results
}

/** What one action does to one title on the server. */
export function performFor(session: Session, action: BatchAction): (row: Pick<TitleRow, 'id' | 'name'>) => Promise<'done' | 'skipped'> {
  return async ({ id }) => {
    if (action.kind === 'watched') {
      await setWatched(session, id, action.value)
      return 'done'
    }
    if (action.kind === 'refresh') {
      await refreshItem(session, id, action.mode)
      return 'done'
    }
    const item = await getEditableItem(session, id)
    if (action.kind === 'lock') {
      if (item.fields.lockedAll === action.value) return 'skipped'
      await saveItem(session, id, applyFields(item.dto, { ...item.fields, lockedAll: action.value }))
      return 'done'
    }
    const tag = cleanTag(action.tag)
    const has = item.fields.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
    if (action.add === has) return 'skipped'
    const tags = action.add ? [...item.fields.tags, tag] : item.fields.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
    await saveItem(session, id, applyFields(item.dto, { ...item.fields, tags }))
    return 'done'
  }
}

// ---- users --------------------------------------------------------------------------------------------

export interface AdminUser {
  id: string
  name: string
  isAdmin: boolean
  isDisabled: boolean
  hasPassword: boolean
  lastActivity?: Date
}

export async function getAdminUsers(session: Session): Promise<AdminUser[]> {
  const { data } = await getUserApi(session.api).getUsers()
  return data
    .filter((u) => u.Id && u.Name)
    .map((u) => ({
      id: u.Id as string,
      name: u.Name as string,
      isAdmin: u.Policy?.IsAdministrator === true,
      isDisabled: u.Policy?.IsDisabled === true,
      hasPassword: u.HasPassword !== false,
      lastActivity: u.LastActivityDate ? new Date(u.LastActivityDate) : u.LastLoginDate ? new Date(u.LastLoginDate) : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The allowances an administrator edits, as the screen shows them. */
export interface PolicyFields {
  isAdmin: boolean
  isDisabled: boolean
  allFolders: boolean
  folders: string[]
  mediaPlayback: boolean
  videoTranscoding: boolean
  audioTranscoding: boolean
  remuxing: boolean
  /** The value of the highest parental rating allowed, as text; empty for no limit. */
  maxRating: string
  remoteAccess: boolean
  contentDeletion: boolean
  downloading: boolean
  /** How many sessions at once, as text; "0" for no limit. */
  maxSessions: string
}

export const POLICY_LABELS: Record<keyof PolicyFields, string> = {
  isAdmin: 'Administrator',
  isDisabled: 'Account disabled',
  allFolders: 'All libraries',
  folders: 'Libraries',
  mediaPlayback: 'May play media',
  videoTranscoding: 'May have videos converted',
  audioTranscoding: 'May have audio converted',
  remuxing: 'May have the container changed (remux)',
  maxRating: 'Highest parental rating',
  remoteAccess: 'May connect from outside the home network',
  contentDeletion: 'May delete titles',
  downloading: 'May download files',
  maxSessions: 'Sessions at once',
}

export function policyFieldsOf(policy: UserPolicy): PolicyFields {
  return {
    isAdmin: policy.IsAdministrator === true,
    isDisabled: policy.IsDisabled === true,
    allFolders: policy.EnableAllFolders !== false,
    folders: [...(policy.EnabledFolders ?? [])],
    mediaPlayback: policy.EnableMediaPlayback !== false,
    videoTranscoding: policy.EnableVideoPlaybackTranscoding !== false,
    audioTranscoding: policy.EnableAudioPlaybackTranscoding !== false,
    remuxing: policy.EnablePlaybackRemuxing !== false,
    maxRating: policy.MaxParentalRating != null ? String(policy.MaxParentalRating) : '',
    remoteAccess: policy.EnableRemoteAccess !== false,
    contentDeletion: policy.EnableContentDeletion === true,
    downloading: policy.EnableContentDownloading !== false,
    maxSessions: String(policy.MaxActiveSessions ?? 0),
  }
}

/** The policy as the server should now hold it: the one it gave us with only the edited allowances replaced. Pure. */
export function applyPolicyFields(policy: UserPolicy, f: PolicyFields): UserPolicy {
  return {
    ...policy,
    IsAdministrator: f.isAdmin,
    IsDisabled: f.isDisabled,
    EnableAllFolders: f.allFolders,
    EnabledFolders: f.allFolders ? (policy.EnabledFolders ?? []) : f.folders,
    EnableMediaPlayback: f.mediaPlayback,
    EnableVideoPlaybackTranscoding: f.videoTranscoding,
    EnableAudioPlaybackTranscoding: f.audioTranscoding,
    EnablePlaybackRemuxing: f.remuxing,
    MaxParentalRating: f.maxRating.trim() === '' ? null : Number(f.maxRating),
    EnableRemoteAccess: f.remoteAccess,
    EnableContentDeletion: f.contentDeletion,
    EnableContentDownloading: f.downloading,
    MaxActiveSessions: Number(f.maxSessions) || 0,
  }
}

export interface PolicyChange {
  key: keyof PolicyFields
  label: string
  before: string
  after: string
}

const yesNo = (v: boolean) => (v ? 'yes' : 'no')

/** What differs between two versions of the allowances. `names` turns library ids and rating values into words. Pure. */
export function diffPolicy(before: PolicyFields, after: PolicyFields, names: { libraries: Record<string, string>; ratings: Record<string, string> }): PolicyChange[] {
  const show = (key: keyof PolicyFields, f: PolicyFields): string => {
    const v = f[key]
    if (typeof v === 'boolean') return yesNo(v)
    if (Array.isArray(v)) return v.map((id) => names.libraries[id] ?? id).sort().join(', ')
    if (key === 'maxRating') return v === '' ? 'No limit' : (names.ratings[v] ?? v)
    if (key === 'maxSessions') return v === '0' || v === '' ? 'No limit' : v
    return v
  }
  const changes: PolicyChange[] = []
  for (const key of Object.keys(POLICY_LABELS) as Array<keyof PolicyFields>) {
    // The list of libraries only matters while "all libraries" is off.
    if (key === 'folders' && after.allFolders && before.allFolders) continue
    const a = show(key, before)
    const b = show(key, after)
    if (a !== b) changes.push({ key, label: POLICY_LABELS[key], before: a, after: b })
  }
  return changes
}

export interface PolicyContext {
  /** Is this the account that is signed in here? */
  isSelf: boolean
  /** Is it the only enabled administrator? */
  isLastAdmin: boolean
}

/** Why these allowances cannot be saved, or an empty list. English; pure. */
export function policyProblems(f: PolicyFields, was: PolicyFields, ctx: PolicyContext): string[] {
  const problems: string[] = []
  if (ctx.isSelf && was.isAdmin && !f.isAdmin) problems.push('You cannot stop being an administrator from your own account: ask another administrator.')
  if (ctx.isSelf && !was.isDisabled && f.isDisabled) problems.push('You cannot disable the account you are signed in with.')
  if (ctx.isLastAdmin && was.isAdmin && (!f.isAdmin || f.isDisabled)) problems.push('This is the only administrator: the server would be left without one.')
  if (!f.allFolders && f.folders.length === 0) problems.push('Choose at least one library, or allow all of them.')
  if (!/^\d{1,3}$/.test(f.maxSessions.trim() || '0')) problems.push('Sessions at once is a number (0 for no limit).')
  return problems
}

/** Is `user` the only administrator that can still sign in? Pure. */
export const isLastAdmin = (users: readonly AdminUser[], user: AdminUser): boolean =>
  user.isAdmin && !user.isDisabled && users.filter((u) => u.isAdmin && !u.isDisabled).length === 1

export async function getUserPolicy(session: Session, id: string): Promise<UserPolicy> {
  const { data } = await getUserApi(session.api).getUserById({ userId: id })
  if (!data.Policy) throw new Error('The server did not send the allowances of this account.')
  return data.Policy
}

export async function savePolicy(session: Session, id: string, policy: UserPolicy): Promise<void> {
  await getUserApi(session.api).updateUserPolicy({ userId: id, userPolicy: policy })
}

export interface ParentalRatingOption {
  name: string
  value: number
}

export async function getParentalRatingOptions(session: Session): Promise<ParentalRatingOption[]> {
  const { data } = await getLocalizationApi(session.api).getParentalRatings()
  const seen = new Set<number>()
  return data
    .filter((r) => r.Name && r.Value != null)
    .map((r) => ({ name: r.Name as string, value: r.Value as number }))
    .sort((a, b) => a.value - b.value)
    .filter((r) => (seen.has(r.value) ? false : (seen.add(r.value), true)))
}

// A name Jellyfin accepts: letters, digits, spaces and - ' . _ @ +
const USER_NAME = /^[\p{L}\p{N} \-'._@+]+$/u
export const MIN_PASSWORD = 8

/** What is wrong with a new account's name and password, or an empty list. English; pure. */
export function newUserProblems(name: string, password: string, again: string, existing: readonly string[]): string[] {
  const problems: string[] = []
  const clean = name.trim()
  if (!clean) problems.push('A name is needed.')
  else if (clean.length > 60 || !USER_NAME.test(clean)) problems.push('A name has letters, digits, spaces and - \' . _ @ + only, up to 60.')
  else if (existing.some((e) => e.toLowerCase() === clean.toLowerCase())) problems.push('There is already an account with that name.')
  if (password.length < MIN_PASSWORD) problems.push('The password needs at least 8 characters.')
  else if (password !== again) problems.push('The two passwords are not the same.')
  return problems
}

/** Makes an account with a password. It starts with the server's defaults (no administrator, every library, playback allowed). */
export async function createUser(session: Session, name: string, password: string): Promise<string> {
  const { data } = await getUserApi(session.api).createUserByName({ createUserByName: { Name: name.trim(), Password: password } })
  return data.Id ?? ''
}

/** Sets a new password for another account (an administrator does not need the old one). The password is not kept anywhere. */
export async function setUserPassword(session: Session, id: string, password: string): Promise<void> {
  await getUserApi(session.api).updateUserPassword({ userId: id, updateUserPassword: { NewPw: password } })
}

// ---- sessions, devices, keys --------------------------------------------------------------------------

export interface AdminSession {
  id: string
  userName: string
  client: string
  deviceName: string
  lastActivity?: Date
  /** What is playing, if anything. */
  playing?: { title: string; paused: boolean; method: 'direct' | 'converted'; reasons: string[]; bitrate?: number }
  /** Can a message or a stop be sent (the app on the other side must support remote control). */
  controllable: boolean
  isThisDevice: boolean
}

export function toAdminSession(s: SessionInfoDto, thisDeviceId: string): AdminSession | null {
  if (!s.Id) return null
  const item = s.NowPlayingItem
  const converting = s.TranscodingInfo && (s.TranscodingInfo.IsVideoDirect === false || s.TranscodingInfo.IsAudioDirect === false)
  const title = item ? [item.SeriesName, item.Name].filter(Boolean).join(' · ') : ''
  return {
    id: s.Id,
    userName: s.UserName ?? '',
    client: s.Client ?? '',
    deviceName: s.DeviceName ?? '',
    lastActivity: s.LastActivityDate ? new Date(s.LastActivityDate) : undefined,
    playing: item
      ? {
          title: title || (item.Name ?? ''),
          paused: s.PlayState?.IsPaused === true,
          method: converting ? 'converted' : 'direct',
          reasons: (s.TranscodingInfo?.TranscodeReasons ?? []).map(String),
          bitrate: s.TranscodingInfo?.Bitrate ?? undefined,
        }
      : undefined,
    controllable: s.SupportsRemoteControl === true,
    isThisDevice: s.DeviceId === thisDeviceId,
  }
}

export async function getAdminSessions(session: Session): Promise<AdminSession[]> {
  const { data } = await getSessionApi(session.api).getSessions({ activeWithinSeconds: 960 })
  return data.map((s) => toAdminSession(s, session.deviceId)).filter((s): s is AdminSession => s !== null)
}

export const MESSAGE_LIMIT = 200

/** Shows a short message on a device that is signed in. */
export async function sendSessionMessage(session: Session, id: string, text: string, header = ''): Promise<void> {
  await getSessionApi(session.api).sendMessageCommand({ sessionId: id, messageCommand: { Header: header.trim() || undefined, Text: text.trim(), TimeoutMs: 8000 } })
}

/** Stops what a device is playing. */
export async function stopSessionPlayback(session: Session, id: string): Promise<void> {
  await getSessionApi(session.api).sendPlaystateCommand({ sessionId: id, command: 'Stop' })
}

export interface AdminDevice {
  id: string
  name: string
  app: string
  appVersion: string
  lastUser: string
  lastActivity?: Date
  isThisDevice: boolean
}

export async function getAdminDevices(session: Session): Promise<AdminDevice[]> {
  const { data } = await getDeviceApi(session.api).getDevices()
  return (data.Items ?? [])
    .filter((d) => d.Id)
    .map((d) => ({
      id: d.Id as string,
      name: d.CustomName || d.Name || '',
      app: d.AppName ?? '',
      appVersion: d.AppVersion ?? '',
      lastUser: d.LastUserName ?? '',
      lastActivity: d.DateLastActivity ? new Date(d.DateLastActivity) : undefined,
      // The device list also carries each device's access token: it is dropped here and never shown.
      isThisDevice: d.Id === session.deviceId,
    }))
    .sort((a, b) => (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0))
}

/** Signs a device out for good (its access is revoked). */
export async function removeDevice(session: Session, id: string): Promise<void> {
  // The screen does not offer it, and the core refuses too: removing this device would end this very session.
  if (id === session.deviceId) throw new Error('This device is the one you are using: use Sign out in Settings.')
  await getDeviceApi(session.api).deleteDevice({ id: [id] })
}

export interface AdminKey {
  /** The last four characters: all the screen shows. */
  hint: string
  app: string
  created?: Date
  lastUsed?: Date
  /** The key itself, only so it can be revoked. Never display, log or store it. */
  secret: string
  isThisSession: boolean
}

/** The last four characters of a secret, for telling keys apart. Pure. */
export const secretHint = (secret: string): string => (secret.length > 4 ? secret.slice(-4) : '••••')

export async function getApiKeys(session: Session): Promise<AdminKey[]> {
  const { data } = await getAuthenticationApi(session.api).getKeys()
  return (data.Items ?? [])
    .filter((k) => k.AccessToken)
    .map((k) => ({
      hint: secretHint(k.AccessToken as string),
      app: k.AppName ?? '',
      created: k.DateCreated ? new Date(k.DateCreated) : undefined,
      lastUsed: k.DateLastActivity ? new Date(k.DateLastActivity) : undefined,
      secret: k.AccessToken as string,
      isThisSession: k.AccessToken === session.accessToken,
    }))
}

export async function revokeApiKey(session: Session, key: AdminKey): Promise<void> {
  if (key.isThisSession) throw new Error('This key is the one this browser is using: use Sign out in Settings.')
  await getAuthenticationApi(session.api).revokeKey({ key: key.secret })
}

// ---- activity, tasks and health -----------------------------------------------------------------------

export interface ActivityLine {
  id: number
  name: string
  detail: string
  date: Date
  severity: string
  type: string
}

export const ACTIVITY_PAGE = 30

export async function getActivity(session: Session, start: number, limit = ACTIVITY_PAGE): Promise<{ lines: ActivityLine[]; total: number }> {
  const { data } = await getSystemApi(session.api).getLogEntries({ startIndex: start, limit })
  const lines = (data.Items ?? [])
    .filter((e: ActivityLogEntry) => e.Id !== undefined && e.Name)
    .map((e: ActivityLogEntry) => ({
      id: e.Id as number,
      name: e.Name as string,
      detail: e.ShortOverview ?? e.Overview ?? '',
      date: new Date(e.Date ?? 0),
      severity: String(e.Severity ?? 'Information'),
      type: e.Type ?? '',
    }))
  return { lines, total: data.TotalRecordCount ?? lines.length }
}

export interface ServerSummary {
  name: string
  version: string
  os: string
  hasUpdate: boolean
  pendingRestart: boolean
  shuttingDown: boolean
  sessions: number
  playing: number
  converting: number
  tasksRunning: number
  tasksFailed: number
}

export async function getServerSummary(session: Session): Promise<ServerSummary> {
  const [{ data: info }, sessions, tasks] = await Promise.all([getSystemApi(session.api).getSystemInfo(), getAdminSessions(session), getTasks(session).catch(() => [])])
  return {
    name: info.ServerName ?? '',
    version: info.Version ?? '',
    os: info.OperatingSystemDisplayName ?? info.OperatingSystem ?? '',
    hasUpdate: info.HasUpdateAvailable === true,
    pendingRestart: info.HasPendingRestart === true,
    shuttingDown: info.IsShuttingDown === true,
    sessions: sessions.length,
    playing: sessions.filter((s) => s.playing).length,
    converting: sessions.filter((s) => s.playing?.method === 'converted').length,
    tasksRunning: tasks.filter((t) => t.running).length,
    tasksFailed: tasks.filter((t) => t.lastResult === 'Failed').length,
  }
}

/** Every English sentence in this file that the screen shows through its own translation. */
export const ADMIN_SERVER_TEXTS: readonly string[] = [
  ...Object.values(POLICY_LABELS),
  'yes',
  'no',
  'No limit',
  'Mark as watched (for you)',
  'Mark as not watched (for you)',
  'Replace the details from the providers',
  'Look for missing details',
  'Look for changed files',
  'Add the tag “{tag}”',
  'Remove the tag “{tag}”',
  'Keep everything as it is (lock)',
  'Allow the server to replace details (unlock)',
  'Choose at least one title.',
  'Choose at most 100 titles at a time.',
  'Type the tag first.',
  'A tag is short and has no commas.',
  'The server refused (this account is not an administrator).',
  'The server could not do it.',
  'Not started: the batch was stopped.',
  'You cannot stop being an administrator from your own account: ask another administrator.',
  'You cannot disable the account you are signed in with.',
  'This is the only administrator: the server would be left without one.',
  'Choose at least one library, or allow all of them.',
  'Sessions at once is a number (0 for no limit).',
  'A name is needed.',
  "A name has letters, digits, spaces and - ' . _ @ + only, up to 60.",
  'There is already an account with that name.',
  'The password needs at least 8 characters.',
  'The two passwords are not the same.',
  'The server did not send the allowances of this account.',
  'This device is the one you are using: use Sign out in Settings.',
  'This key is the one this browser is using: use Sign out in Settings.',
]
