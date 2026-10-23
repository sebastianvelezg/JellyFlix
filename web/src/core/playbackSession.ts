import type { Session } from './jellyfin'
import type { PlaybackPlan } from './playback'
import { PlaybackReporter, type PlayerState } from './reporting'

/** The parts of player state that do not include the position (tracked by the session itself). */
export type DeviceState = Omit<PlayerState, 'positionSeconds'>

/**
 * Owns the lifecycle of one playing stream from the server's point of view: when to send
 * start / progress / stop, and which position to trust. A platform (web `<video>`, an Android TV
 * player, ...) just forwards its player events here; it never builds report payloads itself.
 *
 * Key rule: the position is only trusted after playback has really begun (`playing`). Before
 * that, players report 0 while loading, which would overwrite the saved resume position if
 * reported as "stopped".
 */
export class PlaybackSession {
  private readonly reporter: PlaybackReporter
  private lastPosition: number
  private started = false
  private startReported = false

  constructor(session: Session, plan: PlaybackPlan, startSeconds: number) {
    this.reporter = new PlaybackReporter(session, plan)
    this.lastPosition = startSeconds
  }

  /** Last trusted position, in seconds. Use it to resume after replacing the stream. */
  get position(): number {
    return this.lastPosition
  }

  get hasStarted(): boolean {
    return this.started
  }

  /** The player is now actually rendering. Sends the one-time "playback started" report. */
  playing(positionSeconds: number, device: DeviceState): void {
    this.started = true
    this.lastPosition = positionSeconds
    if (!this.startReported) {
      this.startReported = true
      void this.reporter.start(this.state(device))
    }
  }

  /** Time moved (e.g. `timeupdate`). Ignored until playback has started. */
  moved(positionSeconds: number): void {
    if (this.started) this.lastPosition = positionSeconds
  }

  /** The user paused, resumed or sought: tell the server right away. */
  stateChanged(positionSeconds: number, device: DeviceState): void {
    this.moved(positionSeconds)
    if (this.started && this.startReported) void this.reporter.progress(this.state(device))
  }

  /** Call every ~10 s. Reports only while actually playing. */
  tick(device: DeviceState): void {
    if (this.started && !device.paused) void this.reporter.progress(this.state(device))
  }

  /** Played to the end. Resolves once the report has been sent (or failed quietly). */
  ended(durationSeconds: number, device: DeviceState): Promise<void> {
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) this.lastPosition = durationSeconds
    return this.stop(device)
  }

  /** Reports "stopped" at the last trusted position. Does nothing if playback never started. */
  stop(device: DeviceState): Promise<void> {
    return this.started ? this.reporter.stop(this.state(device)) : Promise.resolve()
  }

  /** For platforms that must send the last report themselves while closing (see `takeStopRequest`). */
  stopRequestOnUnload(device: DeviceState) {
    return this.started ? this.reporter.takeStopRequest(this.state(device)) : null
  }

  setSubtitleIndex(index: number | null): void {
    this.reporter.setSubtitleIndex(index)
  }

  private state(device: DeviceState): PlayerState {
    return { positionSeconds: this.lastPosition, ...device }
  }
}
