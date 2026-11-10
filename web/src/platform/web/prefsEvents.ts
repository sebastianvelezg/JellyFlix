/**
 * Told when a preference that may be synced changes on this device, so the sync (see sync.ts) can send it a few seconds later.
 * Apart from sync.ts so that the files that write the preferences do not have to import the sync, which imports them.
 */
export const PREFS_CHANGED_EVENT = 'jellyflix:prefs-changed'

export function announcePrefsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PREFS_CHANGED_EVENT))
}
