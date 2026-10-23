package app.jellyflix.tv.music

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import app.jellyflix.tv.data.SleepChoice
import app.jellyflix.tv.data.Song
import app.jellyflix.tv.data.moved

/** What the music player tells the app, so the server learns what was played (and "recently played" works). */
interface MusicReporter {
    fun started(song: Song)
    fun stopped(song: Song, positionMs: Long)
    fun progress(song: Song, positionMs: Long, paused: Boolean)
}

/**
 * The music queue and its player. It lives as long as the app does, so music keeps playing while you browse; its state is
 * observable by the screens. Audio focus is handled by the player: starting a video pauses the music.
 */
class MusicPlayer(
    context: Context,
    token: String,
    private val urlFor: (Song) -> String,
    private val reporter: MusicReporter,
) {
    private val http = DefaultHttpDataSource.Factory()
        .setDefaultRequestProperties(mapOf("Authorization" to "MediaBrowser Token=\"$token\""))
        .setAllowCrossProtocolRedirects(true)

    val player: ExoPlayer = ExoPlayer.Builder(context)
        .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(http))
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
            /* handleAudioFocus = */ true,
        )
        .setHandleAudioBecomingNoisy(true)
        .build()

    var queue by mutableStateOf<List<Song>>(emptyList())
        private set
    var index by mutableIntStateOf(0)
        private set
    var playing by mutableStateOf(false)
        private set
    var positionMs by mutableLongStateOf(0L)
        private set
    var durationMs by mutableLongStateOf(0L)
        private set
    var shuffled by mutableStateOf(false)
        private set

    /** The sleep timer: off, a number of minutes, or after the song that is playing. */
    var sleep by mutableStateOf(SleepChoice.Off)
        private set

    /** When a timed sleep ends, on the same clock as [SystemClock.elapsedRealtime] (meaningless unless the timer is timed). */
    var sleepEndsAt by mutableLongStateOf(0L)
        private set

    val current: Song? get() = queue.getOrNull(index)
    val hasQueue: Boolean get() = queue.isNotEmpty()

    private var reported: Song? = null
    private var lastProgressAt = 0L
    private val handler = Handler(Looper.getMainLooper())
    private val sleepNow = Runnable {
        player.pause()
        applySleep(SleepChoice.Off)
    }

    private companion object {
        const val PROGRESS_EVERY_MS = 10_000L
    }

    init {
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                playing = isPlaying
                // Pausing or resuming is worth telling the server at once (a remote shows it).
                reported?.let { reporter.progress(it, player.currentPosition, !isPlaying) }
                lastProgressAt = SystemClock.elapsedRealtime()
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                // The previous song ended (or was skipped): tell the server, then start the next one.
                reported?.let { reporter.stopped(it, if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) it.durationMs ?: 0L else positionMs) }
                index = player.currentMediaItemIndex
                reported = current?.also { reporter.started(it) }
                durationMs = current?.durationMs ?: 0L
                positionMs = 0L
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                // "After this song": the player stopped at the end of it by itself, so the timer has done its job.
                if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM && sleep == SleepChoice.AfterSong) applySleep(SleepChoice.Off)
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) {
                    reported?.let { reporter.stopped(it, it.durationMs ?: 0L) }
                    reported = null
                    playing = false
                }
            }
        })
    }

    /** Starts [songs] from [start] (the first one from [startMs], to go on with an audiobook); replaces whatever was queued. */
    fun play(songs: List<Song>, start: Int = 0, shuffle: Boolean = false, startMs: Long = 0L) {
        if (songs.isEmpty()) return
        reported?.let { reporter.stopped(it, positionMs) }
        reported = null
        val ordered = if (shuffle) songs.shuffled() else songs
        queue = ordered
        shuffled = shuffle
        val first = start.coerceIn(0, ordered.lastIndex)
        index = first
        player.setMediaItems(ordered.map { MediaItem.Builder().setUri(urlFor(it)).setMediaId(it.id.toString()).build() }, first, startMs.coerceAtLeast(0L))
        player.prepare()
        player.play()
        durationMs = ordered[first].durationMs ?: 0L
        positionMs = startMs.coerceAtLeast(0L)
        reported = ordered[first].also { reporter.started(it) }
    }

    fun toggle() {
        if (player.isPlaying) player.pause() else player.play()
    }

    fun next() {
        if (player.hasNextMediaItem()) player.seekToNextMediaItem()
    }

    /** A second press (or a press early in the song) goes to the previous song; otherwise the song starts over. */
    fun previous() {
        if (player.currentPosition > 3_000 || !player.hasPreviousMediaItem()) player.seekTo(0) else player.seekToPreviousMediaItem()
    }

    fun playAt(position: Int) {
        if (position in queue.indices) {
            player.seekTo(position, 0L)
            player.play()
        }
    }

    /** Puts the song at [from] at [to] in the queue; what is playing keeps playing. */
    fun move(from: Int, to: Int) {
        if (from !in queue.indices || to !in queue.indices || from == to) return
        player.moveMediaItem(from, to)
        queue = queue.moved(from, to)
        index = player.currentMediaItemIndex
    }

    /** One press of the sleep button: the next choice (see [SleepChoice]). */
    fun cycleSleep() = applySleep(sleep.next())

    private fun applySleep(choice: SleepChoice) {
        handler.removeCallbacks(sleepNow)
        sleep = choice
        // The player itself stops at the end of the song, so the next one does not start.
        player.pauseAtEndOfMediaItems = choice == SleepChoice.AfterSong
        choice.minutes?.let {
            sleepEndsAt = SystemClock.elapsedRealtime() + it * 60_000L
            handler.postDelayed(sleepNow, it * 60_000L)
        }
    }

    fun seekBy(deltaMs: Long) {
        player.seekTo((player.currentPosition + deltaMs).coerceIn(0L, if (player.duration > 0) player.duration else Long.MAX_VALUE))
    }

    /** Called a few times a second while the app is in front. */
    fun tick() {
        positionMs = player.currentPosition
        if (player.duration > 0) durationMs = player.duration
        // Every ten seconds while playing, as the video player does.
        val now = SystemClock.elapsedRealtime()
        if (playing && now - lastProgressAt >= PROGRESS_EVERY_MS) {
            lastProgressAt = now
            reported?.let { reporter.progress(it, positionMs, false) }
        }
    }

    /** Jumps to a position in the song (a remote asked for it). */
    fun seekTo(ms: Long) {
        player.seekTo(ms.coerceIn(0L, if (player.duration > 0) player.duration else Long.MAX_VALUE))
        positionMs = player.currentPosition
        reported?.let { reporter.progress(it, positionMs, !player.isPlaying) }
    }

    fun stop() {
        applySleep(SleepChoice.Off)
        reported?.let { reporter.stopped(it, positionMs) }
        reported = null
        player.stop()
        player.clearMediaItems()
        queue = emptyList()
        playing = false
    }

    fun release() {
        handler.removeCallbacks(sleepNow)
        reported?.let { reporter.stopped(it, positionMs) }
        player.release()
    }
}
