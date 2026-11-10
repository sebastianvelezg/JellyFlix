import { useSyncExternalStore } from 'react'
import {
  hasNewerSection,
  loadSyncText,
  parseSyncFile,
  parseSyncState,
  planFirstActivation,
  planSection,
  pushStamp,
  readableSection,
  saveSyncText,
  serializeSyncFile,
  SYNC_OFF,
  SYNC_SECTIONS,
  withSection,
  type FirstActivation,
  type Session,
  type SyncFile,
  type SyncSectionName,
  type PrefsSyncState,
} from '../../core'
import { ownedKey, storageOwner } from './owner'
import { PREFS_CHANGED_EVENT } from './prefsEvents'
import { applySection, canonicalLocal, canonicalOfRemote, dataToPush } from './syncData'

/**
 * The optional sync of a few preferences with the account's other devices (the rules are in core/syncPrefs.ts, what is synced in
 * syncData.ts). Off until it is turned on, for each account on each device. It runs when the app opens, when the page comes back to
 * the front, a few seconds after a synced preference changes, and when the connection returns; nothing runs on a timer.
 */
const STATE_BASE = 'jellyflix.sync'
const BY = 'web'
/** A change is sent this long after the last one, so dragging through choices does not make a request for each. */
const SETTLE_MS = 4000

export interface SyncReport {
  /** Sections sent to the account, taken from it, and taken from it although a change of this device was waiting. */
  pushed: SyncSectionName[]
  applied: SyncSectionName[]
  conflicts: SyncSectionName[]
  /** Why it could not sync (the server could not be reached...); null when it did. */
  error: string | null
  /** When it ended (this device's clock). */
  at: number
}

// ---- The state this device keeps -----------------------------------------------------------------------------------------------

export function readSyncState(): PrefsSyncState {
  const key = ownedKey(STATE_BASE)
  if (!key) return SYNC_OFF
  try {
    return parseSyncState(JSON.parse(localStorage.getItem(key) ?? 'null'))
  } catch {
    return SYNC_OFF
  }
}

function writeSyncState(state: PrefsSyncState): void {
  const key = ownedKey(STATE_BASE)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Without storage the sync still works for this visit.
  }
  emit()
}

// ---- What the screen watches ---------------------------------------------------------------------------------------------------

let lastReport: SyncReport | null = null
/** Whose run `lastReport` is: another account signing in on this browser must not read it. */
let lastReportOwner: string | null = null
let busy = false

function remember(report: SyncReport): SyncReport {
  lastReport = report
  lastReportOwner = storageOwner()
  return report
}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export interface SyncStatus {
  enabled: boolean
  busy: boolean
  report: SyncReport | null
}

let statusCache: { key: string; value: SyncStatus } | null = null
function status(): SyncStatus {
  const enabled = readSyncState().enabled
  const report = lastReportOwner === storageOwner() ? lastReport : null
  const key = `${enabled}|${busy}|${report?.at ?? 0}`
  if (!statusCache || statusCache.key !== key) statusCache = { key, value: { enabled, busy, report } }
  return statusCache.value
}

/** Whether it is on, whether it is running, and how the last run went. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    status,
    () => ({ enabled: false, busy: false, report: null }),
  )
}

// ---- The server's clock --------------------------------------------------------------------------------------------------------

let clockOffset = 0
const serverNow = () => Date.now() + clockOffset

async function readAccount(session: Session): Promise<SyncFile> {
  const { text, serverTime } = await loadSyncText(session)
  if (serverTime !== null) clockOffset = serverTime - Date.now()
  return parseSyncFile(text)
}

// ---- Running -------------------------------------------------------------------------------------------------------------------

let running: { owner: string; promise: Promise<SyncReport> } | null = null

/**
 * Brings this device and the account together, section by section. Only one run at a time; a call for the same account while one runs
 * waits for it, and a run of another account starts only after the previous one ended.
 */
export function runSync(session: Session): Promise<SyncReport> {
  if (running && running.owner === session.userId) return running.promise
  const before = running?.promise.catch(() => undefined)
  busy = true
  emit()
  const promise: Promise<SyncReport> = (before ? before.then(() => run(session)) : run(session)).finally(() => {
    if (running?.promise !== promise) return
    running = null
    busy = false
    emit()
  })
  running = { owner: session.userId, promise }
  return promise
}

async function run(session: Session): Promise<SyncReport> {
  const report: SyncReport = { pushed: [], applied: [], conflicts: [], error: null, at: Date.now() }
  // What is read and written here belongs to the account signed in now; if that is not this session's, nothing may be touched.
  const who = session.userId
  const left = () => storageOwner() !== who
  // Also over when sync is turned off while the server is answering: the run must not turn it back on.
  const over = () => left() || !readSyncState().enabled
  if (left()) return report
  const state = readSyncState()
  if (!state.enabled) return report
  const next: PrefsSyncState = { enabled: true, sections: { ...state.sections } }
  let file: SyncFile
  try {
    file = await readAccount(session)
  } catch (e) {
    if (over()) return report
    // The account cannot be reached: a change made here is marked with the time it was seen, to be judged by when it was made.
    const now = serverNow()
    for (const name of SYNC_SECTIONS) {
      const s = state.sections[name]
      if (s?.snapshot != null && canonicalLocal(name) !== s.snapshot && s.dirtyAt === null) next.sections[name] = { ...s, dirtyAt: now }
    }
    writeSyncState(next)
    report.error = e instanceof Error ? e.message : 'The server could not be reached.'
    return remember({ ...report, at: Date.now() })
  }

  if (over()) return report
  const now = serverNow()
  let out = file
  let toSend = false
  for (const name of SYNC_SECTIONS) {
    const remote = readableSection(file, name)
    const plan = planSection({ remote, newerFormat: hasNewerSection(file, name), local: canonicalLocal(name), state: state.sections[name], now })
    const previous = state.sections[name]
    if (plan.action === 'apply' || plan.action === 'apply-conflict') {
      if (!remote) continue
      applySection(name, remote.data)
      next.sections[name] = { applied: remote.at, snapshot: canonicalLocal(name), dirtyAt: null }
      report.applied.push(name)
      if (plan.action === 'apply-conflict') report.conflicts.push(name)
    } else if (plan.action === 'push') {
      const at = pushStamp(now, remote)
      out = withSection(out, name, { v: 1, at, by: BY, data: dataToPush(name, remote?.data) })
      next.sections[name] = { applied: at, snapshot: canonicalLocal(name), dirtyAt: null }
      report.pushed.push(name)
      toSend = true
    } else if (previous) {
      next.sections[name] = { ...previous, dirtyAt: plan.dirtyAt }
    }
  }
  if (toSend) {
    try {
      await saveSyncText(session, serializeSyncFile(out))
    } catch (e) {
      // Not sent: what was to be sent stays marked as waiting, and the rest of the run still counts.
      for (const name of report.pushed) next.sections[name] = state.sections[name] ?? { applied: 0, snapshot: null, dirtyAt: null }
      for (const name of report.pushed) {
        const s = next.sections[name]
        if (s?.snapshot != null && s.dirtyAt === null) next.sections[name] = { ...s, dirtyAt: now }
      }
      report.pushed = []
      report.error = e instanceof Error ? e.message : 'The server could not be reached.'
    }
  }
  // Another account signed in while the server was answering: what this run learned is not theirs to keep.
  if (over()) return report
  writeSyncState(next)
  return remember({ ...report, at: Date.now() })
}

// ---- Turning it on and off -----------------------------------------------------------------------------------------------------

export type ActivationPreview = FirstActivation

/** What turning sync on would find in the account, to show the choice (when there is one) before anything is changed. */
export async function previewActivation(session: Session): Promise<ActivationPreview> {
  const file = await readAccount(session)
  const locals = Object.fromEntries(SYNC_SECTIONS.map((name) => [name, canonicalLocal(name)])) as Record<SyncSectionName, string>
  return planFirstActivation(file, locals, canonicalOfRemote)
}

/**
 * Turns it on. `use-account`: take what the account has; `upload`: send this device's choices (over what the account has). With
 * nothing to choose from (the account has nothing, or the same) either one simply starts.
 */
export async function enableSync(session: Session, choice: 'use-account' | 'upload'): Promise<SyncReport> {
  const file = await readAccount(session)
  const sections: PrefsSyncState['sections'] = {}
  for (const name of SYNC_SECTIONS) {
    const remote = readableSection(file, name)
    if (choice === 'use-account' && remote) {
      applySection(name, remote.data)
      sections[name] = { applied: remote.at, snapshot: canonicalLocal(name), dirtyAt: null }
    } else if (remote && canonicalOfRemote(name, remote) === canonicalLocal(name)) {
      // The same on both sides: nothing to send, and nothing waits.
      sections[name] = { applied: remote.at, snapshot: canonicalLocal(name), dirtyAt: null }
    } else {
      // Not on the account yet, or this device's choices are to go over it: mark them as waiting, and send them below.
      sections[name] = { applied: remote?.at ?? 0, snapshot: null, dirtyAt: null }
    }
  }
  // A section that has to go up is sent by the next run: with no snapshot it counts as new, so it is pushed when the account has none
  // and, when the account has one, because "upload" says so. Start from a snapshot that differs, so the plan sees a waiting change.
  for (const name of SYNC_SECTIONS) {
    const s = sections[name]
    if (s && s.snapshot === null) sections[name] = { ...s, snapshot: '', dirtyAt: serverNow() }
  }
  writeSyncState({ enabled: true, sections })
  return runSync(session)
}

export function disableSync(): void {
  writeSyncState(SYNC_OFF)
}

// ---- Watching ------------------------------------------------------------------------------------------------------------------

/** Runs the sync when the app opens, when the page comes back, when the connection returns and after a synced preference changes. */
export function startSyncWatcher(session: Session, onReport?: (report: SyncReport) => void): () => void {
  let timer: number | undefined
  const soon = (delay: number) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (readSyncState().enabled) void runSync(session).then((report) => onReport?.(report))
    }, delay)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') soon(500)
  }
  const onChange = () => soon(SETTLE_MS)
  const onOnline = () => soon(500)
  soon(300)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener(PREFS_CHANGED_EVENT, onChange)
  window.addEventListener('online', onOnline)
  return () => {
    window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener(PREFS_CHANGED_EVENT, onChange)
    window.removeEventListener('online', onOnline)
  }
}
