import { negotiatePlayback, withoutAudioCodecs, type PlaybackPlan, type Session } from '../../core'
import { detectCapabilities } from '../../platform/web/capabilities'
import { readPlayerPrefs } from '../../platform/web/prefs'

/** What this browser and these settings ask the server when a title starts: the same for the player and for getting ready ahead of it. */
export function firstStreamOptions() {
  const prefs = readPlayerPrefs()
  return {
    // Audio codecs chosen in Settings are converted by the server even though this browser could play them.
    capabilities: withoutAudioCodecs(detectCapabilities(), prefs.convertAudio),
    maxBitrate: prefs.maxBitrateMbps * 1_000_000,
  }
}

/**
 * Asks the server how to play a title before it is needed (the program that follows on a retro TV channel), so that when it starts the
 * player does not have to wait for the answer. The player takes the answer for the first stream it opens.
 */
export function prepareStream(session: Session, itemId: string): Promise<PlaybackPlan> {
  return negotiatePlayback(session, itemId, firstStreamOptions())
}
