import { PlaybackOrder } from '@jellyfin/sdk/lib/generated-client/models/playback-order'
import type { PlaybackProgressInfo } from '@jellyfin/sdk/lib/generated-client/models/playback-progress-info'
import { RepeatMode } from '@jellyfin/sdk/lib/generated-client/models/repeat-mode'
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api'
import type { Session } from './jellyfin'
import type { PlaybackPlan } from './playback'
import { secondsToTicks } from './ticks'

export interface PlayerState {
  positionSeconds: number
  paused: boolean
  muted: boolean
  /** 0..1 */
  volume: number
}

export interface StreamSelection {
  audioIndex?: number
  /** -1 / undefined = subtitles off */
  subtitleIndex?: number
}

/** The body shared by /Sessions/Playing, /Progress and /Stopped. */
export function buildReportBody(
  plan: PlaybackPlan,
  state: PlayerState,
  selection: StreamSelection,
): PlaybackProgressInfo {
  return {
    ItemId: plan.itemId,
    MediaSourceId: plan.mediaSourceId,
    PlaySessionId: plan.playSessionId,
    PlayMethod: plan.playMethod,
    PositionTicks: secondsToTicks(state.positionSeconds),
    IsPaused: state.paused,
    IsMuted: state.muted,
    VolumeLevel: Math.round(state.volume * 100),
    CanSeek: plan.liveStreamId === undefined,
    LiveStreamId: plan.liveStreamId,
    AudioStreamIndex: selection.audioIndex,
    SubtitleStreamIndex: selection.subtitleIndex ?? -1,
    RepeatMode: RepeatMode.RepeatNone,
    PlaybackOrder: PlaybackOrder.Default,
  }
}

/**
 * Reports playback to Jellyfin: start (`POST /Sessions/Playing`), periodic progress
 * (`/Sessions/Playing/Progress`) and stop (`/Sessions/Playing/Stopped`). The server uses
 * the stop position as the resume point and marks the movie watched near the end.
 * Reporting must never disturb playback, so every failure is swallowed.
 */
export class PlaybackReporter {
  private stopped = false
  private inFlight = false

  private subtitleIndex: number | undefined

  constructor(
    private readonly session: Session,
    private readonly plan: PlaybackPlan,
  ) {}

  /** Tells the server which text subtitle (if any) is showing; sent with every later report. */
  setSubtitleIndex(index: number | null): void {
    this.subtitleIndex = index ?? undefined
  }

  private get selection(): StreamSelection {
    return { audioIndex: this.plan.audioIndex, subtitleIndex: this.subtitleIndex }
  }

  async start(state: PlayerState): Promise<void> {
    await this.send(() =>
      getSessionApi(this.session.api).reportPlaybackStart({
        playbackStartInfo: buildReportBody(this.plan, state, this.selection),
      }),
    )
  }

  async progress(state: PlayerState): Promise<void> {
    if (this.stopped || this.inFlight) return
    this.inFlight = true
    try {
      await this.send(() =>
        getSessionApi(this.session.api).reportPlaybackProgress({
          playbackProgressInfo: buildReportBody(this.plan, state, this.selection),
        }),
      )
    } finally {
      this.inFlight = false
    }
  }

  async stop(state: PlayerState): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    await this.send(() =>
      getSessionApi(this.session.api).reportPlaybackStopped({
        playbackStopInfo: buildReportBody(this.plan, state, this.selection),
      }),
    )
  }

  /**
   * For platforms that must send the final report themselves while the app is closing (the web's
   * `pagehide`, where only a `keepalive` fetch survives). Marks the reporter stopped and returns a
   * ready-to-send request; the platform performs the actual HTTP call.
   */
  takeStopRequest(state: PlayerState): { url: string; headers: Record<string, string>; body: string } | null {
    if (this.stopped) return null
    this.stopped = true
    return {
      url: `${this.session.serverUrl}/Sessions/Playing/Stopped`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.session.api.authorizationHeader,
      },
      body: JSON.stringify(buildReportBody(this.plan, state, this.selection)),
    }
  }

  private async send(call: () => Promise<unknown>): Promise<void> {
    try {
      await call()
    } catch {
      // A temporary network or server problem must not interrupt the movie.
    }
  }
}
