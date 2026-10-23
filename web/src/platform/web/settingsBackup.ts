import { MAX_SETTINGS_CHARS } from '../../core'
import { KEY as APPEARANCE_KEY, sanitizeAppearance } from './appearance'

/**
 * Your settings as one small file, to keep, to move to another browser, or to put on the server. Only the preferences of this app
 * are in it (look, interface, player, library sort and filter choices): never the session, a password or the server address.
 * Whatever is read back is checked, so a file that was edited or is not one of ours cannot put anything else in storage.
 */
const ALLOWED = [APPEARANCE_KEY, 'jellyflix.ui', 'jellyflix.player', 'jellyflix.browse', 'jellyflix.browse.series', 'jellyflix.browse.anime'] as const

export interface SettingsFile {
  app: 'jellyflix'
  version: 1
  exportedAt: string
  /** Each preference as the object it is stored as. */
  settings: Record<string, object>
}

export function exportSettings(now = new Date()): SettingsFile {
  const settings: Record<string, object> = {}
  for (const key of ALLOWED) {
    try {
      const raw = localStorage.getItem(key)
      const value: unknown = raw ? JSON.parse(raw) : undefined
      if (value && typeof value === 'object' && !Array.isArray(value)) settings[key] = value
    } catch {
      // A broken entry is simply left out.
    }
  }
  return { app: 'jellyflix', version: 1, exportedAt: now.toISOString(), settings }
}

export type ParsedSettings = { ok: true; settings: Record<string, object> } | { ok: false; error: string }

/** Reads and checks the text of a settings file. */
export function parseSettings(text: string): ParsedSettings {
  if (text.length > MAX_SETTINGS_CHARS) return { ok: false, error: 'That file is too big to be a settings file.' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not a settings file from Jellyflix.' }
  }
  const file = data as Partial<SettingsFile> | null
  if (!file || typeof file !== 'object' || file.app !== 'jellyflix' || file.version !== 1 || !file.settings || typeof file.settings !== 'object') {
    return { ok: false, error: 'That file is not a settings file from Jellyflix.' }
  }
  const settings: Record<string, object> = {}
  for (const key of ALLOWED) {
    const value = (file.settings as Record<string, unknown>)[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) settings[key] = key === APPEARANCE_KEY ? sanitizeAppearance(value) : value
  }
  return Object.keys(settings).length === 0 ? { ok: false, error: 'That file has no settings in it.' } : { ok: true, settings }
}

/** Puts checked settings in storage; returns how many preferences were set. */
export function applySettings(settings: Record<string, object>): number {
  let count = 0
  for (const [key, value] of Object.entries(settings)) {
    if (!(ALLOWED as readonly string[]).includes(key)) continue
    try {
      localStorage.setItem(key, JSON.stringify(value))
      count += 1
    } catch {
      // Storage full or blocked: what could not be written is skipped.
    }
  }
  // The painted-before-load copy of the look is made again from the new settings at the next start.
  try {
    localStorage.removeItem('jellyflix.appearance.css')
  } catch {
    // A convenience only.
  }
  return count
}
