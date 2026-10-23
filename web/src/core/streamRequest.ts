import { PlayMethod } from '@jellyfin/sdk/lib/generated-client/models/play-method'
import type { PlaybackPlan } from './playback'

/**
 * What to ask the server for next when the current stream has to be replaced (the user picked
 * another audio track, direct play failed, or they pressed retry). The UI/platform passes it to
 * `negotiatePlayback` and starts the new plan at `startSeconds`.
 */
export interface StreamRequest {
  audioIndex?: number
  /**
   * The media source being played. Jellyfin ignores `audioIndex` unless the request also names the
   * media source, so every request built from an existing plan carries it.
   */
  mediaSourceId?: string
  /** Skip direct play/stream so the server remuxes or transcodes. */
  forceTranscode: boolean
  /** True once direct play failed and transcoding was forced as a fallback (sticky across requests). */
  fallback: boolean
  startSeconds: number
}

export interface StreamContext {
  /** Whether a transcode fallback is already in force. */
  fallback: boolean
  /** Current playback position to resume from. */
  startSeconds: number
}

/**
 * Direct play always delivers the file's default audio track, so any other track
 * needs the server to remux/transcode.
 */
export function audioChangeRequest(plan: PlaybackPlan, audioIndex: number, ctx: StreamContext): StreamRequest {
  return {
    audioIndex,
    mediaSourceId: plan.mediaSourceId,
    forceTranscode: ctx.fallback || audioIndex !== plan.defaultAudioIndex,
    fallback: ctx.fallback,
    startSeconds: ctx.startSeconds,
  }
}

/**
 * The "direct play did not work, let the server transcode" request, or `null` when it would not
 * help (already transcoding, or already tried).
 */
export function transcodeFallbackRequest(plan: PlaybackPlan, ctx: StreamContext): StreamRequest | null {
  if (plan.playMethod !== PlayMethod.DirectPlay || ctx.fallback) return null
  return {
    audioIndex: plan.audioIndex,
    mediaSourceId: plan.mediaSourceId,
    forceTranscode: true,
    fallback: true,
    startSeconds: ctx.startSeconds,
  }
}

/** Same stream again (e.g. after a network error), keeping the chosen audio track. */
export function retryRequest(plan: PlaybackPlan, ctx: StreamContext): StreamRequest {
  return {
    audioIndex: plan.audioIndex,
    mediaSourceId: plan.mediaSourceId,
    forceTranscode: ctx.fallback || plan.audioIndex !== plan.defaultAudioIndex,
    fallback: ctx.fallback,
    startSeconds: ctx.startSeconds,
  }
}
