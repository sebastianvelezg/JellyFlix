import { useSyncExternalStore } from 'react'
import { FIELD_LABELS, LOCKABLE_FIELDS, type FieldChange, type LockableField, type MetadataFields } from '../../core'

/**
 * What an administrator changed from this browser: a short list kept on this device only (never sent anywhere, never part of
 * the settings backup, forgotten on sign-out). For an edit it holds the details as they were, so the edit can be undone.
 */
export const ACTIVITY_KEY = 'jellyflix.admin.activity'
export const ACTIVITY_LIMIT = 40

export type ActivityKind = 'edit' | 'identify' | 'refresh' | 'picture'

export interface ActivityEntry {
  id: string
  at: number
  itemId: string
  itemName: string
  kind: ActivityKind
  /** A line saying what was done, in the language it was done in. */
  summary: string
  /** Edits and identifications: what changed, and the details before and after. */
  changes?: FieldChange[]
  before?: MetadataFields
  after?: MetadataFields
}

const KINDS: readonly ActivityKind[] = ['edit', 'identify', 'refresh', 'picture']

const text = (v: unknown, max = 8000): v is string => typeof v === 'string' && v.length <= max
const list = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 200 && v.every((x) => text(x, 200))

function isFields(v: unknown): v is MetadataFields {
  if (!v || typeof v !== 'object') return false
  const f = v as Record<string, unknown>
  return (
    text(f.name, 500) &&
    text(f.originalTitle, 500) &&
    text(f.sortName, 500) &&
    text(f.overview) &&
    text(f.year, 10) &&
    text(f.officialRating, 60) &&
    text(f.communityRating, 20) &&
    list(f.genres) &&
    list(f.studios) &&
    list(f.tags) &&
    typeof f.lockedAll === 'boolean' &&
    list(f.lockedFields)
  )
}

function isChange(v: unknown): v is FieldChange {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return typeof c.key === 'string' && c.key in FIELD_LABELS && text(c.label, 100) && text(c.before) && text(c.after)
}

/** Reads what was stored, keeping only entries of the right shape (the storage is not trusted). Pure. */
export function sanitizeActivity(raw: unknown): ActivityEntry[] {
  if (!Array.isArray(raw)) return []
  const out: ActivityEntry[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const e = value as Record<string, unknown>
    if (!text(e.id, 80) || typeof e.at !== 'number' || !text(e.itemId, 80) || !text(e.itemName, 500) || !text(e.summary, 500)) continue
    if (!KINDS.includes(e.kind as ActivityKind)) continue
    const entry: ActivityEntry = { id: e.id, at: e.at, itemId: e.itemId, itemName: e.itemName, kind: e.kind as ActivityKind, summary: e.summary }
    if ((e.kind === 'edit' || e.kind === 'identify') && Array.isArray(e.changes) && e.changes.every(isChange) && isFields(e.before) && isFields(e.after)) {
      entry.changes = e.changes as FieldChange[]
      entry.before = { ...e.before, lockedFields: e.before.lockedFields.filter((f): f is LockableField => (LOCKABLE_FIELDS as readonly string[]).includes(f)) }
      entry.after = e.after
    }
    out.push(entry)
    if (out.length >= ACTIVITY_LIMIT) break
  }
  return out
}

/** Adds an entry at the top and drops the oldest past the limit. Pure. */
export function withEntry(entries: readonly ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  return [entry, ...entries].slice(0, ACTIVITY_LIMIT)
}

let cache: { raw: string | null; entries: ActivityEntry[] } = { raw: null, entries: [] }
const listeners = new Set<() => void>()

function parseStored(raw: string | null): ActivityEntry[] {
  try {
    return sanitizeActivity(raw ? (JSON.parse(raw) as unknown) : [])
  } catch {
    return []
  }
}

function readRaw(): string | null | undefined {
  try {
    return localStorage.getItem(ACTIVITY_KEY)
  } catch {
    return undefined // storage is not available
  }
}

export function readActivity(): ActivityEntry[] {
  const raw = readRaw()
  if (raw === undefined || raw === cache.raw) return cache.entries
  cache = { raw, entries: parseStored(raw) }
  return cache.entries
}

function write(entries: ActivityEntry[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(ACTIVITY_KEY)
    else localStorage.setItem(ACTIVITY_KEY, JSON.stringify(entries))
  } catch {
    // A note for the person only: losing it is not worth an error.
    cache = { raw: null, entries }
  }
  listeners.forEach((l) => l())
}

let counter = 0

export function recordActivity(entry: Omit<ActivityEntry, 'id' | 'at'>): void {
  counter += 1
  write(withEntry(readActivity(), { ...entry, id: `${Date.now().toString(36)}-${counter}`, at: Date.now() }))
}

export function clearActivity(): void {
  write([])
}

/** The edits of one title, newest first. Pure. */
export const activityOf = (entries: readonly ActivityEntry[], itemId: string): ActivityEntry[] => entries.filter((e) => e.itemId === itemId)

export function useActivity(): ActivityEntry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    readActivity,
    () => [],
  )
}
