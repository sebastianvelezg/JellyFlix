import { getPluginApi } from '@jellyfin/sdk/lib/utils/api/plugin-api'
import { getScheduledTaskApi } from '@jellyfin/sdk/lib/utils/api/scheduled-task-api'
import type { Session } from './jellyfin'
import { currentUser } from './me'

/**
 * Jellyfin plugins this app knows how to use, and the server tasks they bring. Everything here is the server's own API; the
 * plugins do the work, the app only shows them and starts what the owner asks for. Starting a task or listing plugins needs an
 * administrator account (the server answers 403 otherwise).
 */
export type SupportedPluginKind = 'intro-skipper' | 'lyrics' | 'subtitles' | 'box-sets' | 'fanart' | 'anilist' | 'playback-reporting'

export interface ServerPlugin {
  id: string
  name: string
  version: string
  /** "Active", "Disabled", "Malfunctioned"... as the server says. */
  status: string
}

export interface ServerTask {
  id: string
  name: string
  description: string
  category: string
  running: boolean
  cancelling: boolean
  /** 0-100 while running. */
  progress: number | null
  /** How the last run ended ("Completed", "Failed", "Cancelled", "Aborted"), null when it never ran. */
  lastResult: string | null
  lastEnd: Date | null
}

/** How to recognise a supported plugin and its tasks, by name (ids and task keys differ between plugin versions). */
export const SUPPORTED_PLUGINS: ReadonlyArray<{ kind: SupportedPluginKind; plugin: RegExp; task: RegExp }> = [
  { kind: 'intro-skipper', plugin: /intro\s*skipper/i, task: /intro skipper|media segments?/i },
  { kind: 'lyrics', plugin: /lyrics|lrclib/i, task: /lyrics/i },
  { kind: 'subtitles', plugin: /subtitles/i, task: /subtitles/i },
  // "TMDb" on its own is Jellyfin's metadata plugin (not listed here); only the Box Sets one brings collections.
  { kind: 'box-sets', plugin: /box\s*sets?/i, task: /box\s*sets?/i },
  { kind: 'fanart', plugin: /fanart/i, task: /fanart/i },
  { kind: 'anilist', plugin: /ani\s*list/i, task: /ani\s*list/i },
  { kind: 'playback-reporting', plugin: /playback\s*reporting/i, task: /playback\s*reporting/i },
]

/** The detected plugin of a kind, if the server has it. Pure. */
export function findPlugin(kind: SupportedPluginKind, plugins: ServerPlugin[]): ServerPlugin | undefined {
  const rule = SUPPORTED_PLUGINS.find((p) => p.kind === kind)
  return rule ? plugins.find((p) => rule.plugin.test(p.name)) : undefined
}

/** The server tasks that belong to a kind of plugin. Pure. */
export function tasksOf(kind: SupportedPluginKind, tasks: ServerTask[]): ServerTask[] {
  const rule = SUPPORTED_PLUGINS.find((p) => p.kind === kind)
  return rule ? tasks.filter((t) => rule.task.test(t.name) || rule.task.test(t.category)) : []
}

/** Whether this account is a server administrator (the plugins page only works for one). */
export async function isAdministrator(session: Session): Promise<boolean> {
  const me = await currentUser(session)
  return me.Policy?.IsAdministrator === true
}

export async function getPlugins(session: Session): Promise<ServerPlugin[]> {
  const { data } = await getPluginApi(session.api).getPlugins()
  return data.map((p) => ({ id: p.Id ?? '', name: p.Name ?? '', version: p.Version ?? '', status: p.Status ?? '' })).filter((p) => p.id && p.name)
}

export async function getTasks(session: Session): Promise<ServerTask[]> {
  const { data } = await getScheduledTaskApi(session.api).getTasks({ isHidden: false })
  return data
    .filter((t) => t.Id && t.Name)
    .map((t) => ({
      id: t.Id as string,
      name: t.Name as string,
      description: t.Description ?? '',
      category: t.Category ?? '',
      running: t.State === 'Running' || t.State === 'Cancelling',
      cancelling: t.State === 'Cancelling',
      progress: t.CurrentProgressPercentage ?? null,
      lastResult: t.LastExecutionResult?.Status ?? null,
      lastEnd: t.LastExecutionResult?.EndTimeUtc ? new Date(t.LastExecutionResult.EndTimeUtc) : null,
    }))
}

export async function startTask(session: Session, taskId: string): Promise<void> {
  await getScheduledTaskApi(session.api).startTask({ taskId })
}

export async function stopTask(session: Session, taskId: string): Promise<void> {
  await getScheduledTaskApi(session.api).stopTask({ taskId })
}

// ---- Intro Skipper's own routes (they are not in Jellyfin's API description) ---------------------------------

export interface ScanStatus {
  running: boolean
  queued: boolean
  failed: boolean
}

/** Asks Intro Skipper to look for the intro, credits and so on of one season. Returns at once; the work goes on in the server. */
export async function scanSeason(session: Session, seriesId: string, seasonId: string): Promise<void> {
  await session.api.axiosInstance.post(`${session.api.basePath}/Intros/ScanSeason/${seriesId}/${seasonId}`, null, {
    headers: { Authorization: session.api.authorizationHeader },
  })
}

export async function getScanStatus(session: Session, seasonId: string): Promise<ScanStatus> {
  const { data } = await session.api.axiosInstance.get<{ isRunning?: boolean; isQueued?: boolean; failed?: boolean }>(
    `${session.api.basePath}/Intros/ScanStatus/${seasonId}`,
    { headers: { Authorization: session.api.authorizationHeader } },
  )
  return { running: data.isRunning === true, queued: data.isQueued === true, failed: data.failed === true }
}
