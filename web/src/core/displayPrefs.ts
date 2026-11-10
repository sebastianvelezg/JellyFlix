import { getDisplayPreferenceApi } from '@jellyfin/sdk/lib/utils/api/display-preference-api'
import type { Session } from './jellyfin'
import { MAX_SYNC_CHARS, serverTimeFromHeader } from './syncPrefs'

/**
 * Your settings kept on the server, in the display preferences Jellyfin has for every user (the place its own web client keeps
 * them). Only when you ask: "save" writes them, "load" reads them back. Nothing is synced behind your back.
 */
const ID = 'jellyflix'
const CLIENT = 'jellyflix'
const FIELD = 'settings'

/** Keeps the server from being filled: far more than any settings file ever is. */
export const MAX_SETTINGS_CHARS = 200_000

export async function saveSettingsToServer(session: Session, settings: string): Promise<void> {
  if (settings.length > MAX_SETTINGS_CHARS) throw new Error('Those settings are too big to save on the server.')
  const api = getDisplayPreferenceApi(session.api)
  const { data: current } = await api.getDisplayPreferences({ displayPreferencesId: ID, client: CLIENT, userId: session.userId })
  await api.updateDisplayPreferences({
    displayPreferencesId: ID,
    client: CLIENT,
    userId: session.userId,
    displayPreferencesDto: { ...current, Id: ID, Client: CLIENT, CustomPrefs: { ...(current.CustomPrefs ?? {}), [FIELD]: settings } },
  })
}

/** The settings saved on the server, or null when there are none. */
export async function loadSettingsFromServer(session: Session): Promise<string | null> {
  const { data } = await getDisplayPreferenceApi(session.api).getDisplayPreferences({
    displayPreferencesId: ID,
    client: CLIENT,
    userId: session.userId,
  })
  const saved = data.CustomPrefs?.[FIELD]
  return typeof saved === 'string' && saved ? saved : null
}

// ---- The synced preferences (core/syncPrefs.ts), in a field of their own ---------------------------------------------------------

const SYNC_FIELD = 'sync'

/** The text of the synced preferences, and the server's clock at that moment (from the answer's Date header, null when it has none). */
export async function loadSyncText(session: Session): Promise<{ text: string | null; serverTime: number | null }> {
  const response = await getDisplayPreferenceApi(session.api).getDisplayPreferences({ displayPreferencesId: ID, client: CLIENT, userId: session.userId })
  const saved = response.data.CustomPrefs?.[SYNC_FIELD]
  const header = (response.headers as Record<string, unknown> | undefined)?.date
  return { text: typeof saved === 'string' && saved ? saved : null, serverTime: serverTimeFromHeader(typeof header === 'string' ? header : null) }
}

/** Writes the synced preferences, keeping everything else in the user's display preferences as it was. */
export async function saveSyncText(session: Session, text: string): Promise<void> {
  if (text.length > MAX_SYNC_CHARS) throw new Error('Those settings are too big to save on the server.')
  const api = getDisplayPreferenceApi(session.api)
  const { data: current } = await api.getDisplayPreferences({ displayPreferencesId: ID, client: CLIENT, userId: session.userId })
  await api.updateDisplayPreferences({
    displayPreferencesId: ID,
    client: CLIENT,
    userId: session.userId,
    displayPreferencesDto: { ...current, Id: ID, Client: CLIENT, CustomPrefs: { ...(current.CustomPrefs ?? {}), [SYNC_FIELD]: text } },
  })
}
