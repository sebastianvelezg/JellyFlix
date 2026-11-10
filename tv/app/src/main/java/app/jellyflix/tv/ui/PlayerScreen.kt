package app.jellyflix.tv.ui

import android.net.Uri
import android.view.KeyEvent
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import app.jellyflix.tv.data.splitChannelName
import app.jellyflix.tv.data.TrickplayPictures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem as PlayerMediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Text
import app.jellyflix.tv.ChannelUi
import app.jellyflix.tv.PlayerCommand
import app.jellyflix.tv.data.ModuleProgram
import app.jellyflix.tv.data.isLive
import app.jellyflix.tv.R
import app.jellyflix.tv.data.Chapter
import app.jellyflix.tv.data.PlaybackPlan
import app.jellyflix.tv.data.FrameRateMode
import app.jellyflix.tv.data.TvSettings
import app.jellyflix.tv.data.MediaItem
import app.jellyflix.tv.data.Segment
import app.jellyflix.tv.data.SkipAction
import app.jellyflix.tv.data.SegmentKind
import app.jellyflix.tv.data.Track
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow

private const val SEEK_MS = 10_000L
private const val NEXT_EPISODE_MS = 25_000L

/** How far one press of left or right goes; [repeat] counts the key repeats while it is held down. */
private fun seekStep(repeat: Int): Long = when {
    repeat >= 20 -> 60_000L
    repeat >= 6 -> 30_000L
    else -> SEEK_MS
}
private const val HIDE_AFTER_MS = 4_000L
private const val REPORT_EVERY_MS = 10_000L

/** What the player asks of the app around it. */
class PlayerActions(
    val onStart: (positionMs: Long) -> Unit,
    val onProgress: (positionMs: Long, paused: Boolean) -> Unit,
    val onStopped: (positionMs: Long) -> Unit,
    val onChangeTracks: (audio: Int?, subtitle: Int?, positionMs: Long) -> Unit,
    /** The stream could not be played as it is: ask the server for a converted one, from this position. */
    val onFallback: (positionMs: Long) -> Unit,
    /** Intro, recap and credits of the title, when the server knows them. */
    val loadSegments: suspend () -> List<Segment>,
    /** The chapters of the title, when the file has them. */
    val loadChapters: suspend () -> List<Chapter>,
    /** The small pictures for the seek bar, when the server has made them; asked for once, when the controls first show. */
    val loadTrickplay: suspend () -> TrickplayPictures?,
    /** The title played to its end. */
    val onEnded: () -> Unit,
    /** The "Next episode" button, shown in the last stretch of an episode. */
    val onNextEpisode: () -> Unit,
    val onExit: () -> Unit,
    /** A live channel: change to the one before (-1) or after (+1) this one. */
    val onChannelStep: (Int) -> Unit = {},
    /** A live channel: the names of the channels before and after it, for the hint that says what up and down do. */
    val liveNeighbours: () -> Pair<String, String>? = { null },
    /** "Search online…" in the subtitle menu: look for subtitles on the server's plugin, from this position. */
    val onSearchSubtitles: (positionMs: Long) -> Unit = {},
    /** The seasons of the series (an episode), and the episodes of one of them: the list that changes episode. */
    val loadSeasons: suspend () -> List<MediaItem> = { emptyList() },
    val loadEpisodes: suspend (seasonId: java.util.UUID) -> List<MediaItem> = { emptyList() },
    /** An episode was picked from that list. */
    val onPlayEpisode: (MediaItem) -> Unit = {},
    /** The sleep timer now set (null: off), and how to change it. */
    val sleepTimer: app.jellyflix.tv.data.SleepTimer? = null,
    val onSleep: (app.jellyflix.tv.data.SleepTimer?) -> Unit = {},
    /** Present when the video is a program of a retro TV channel: the channel's own controls, guide and on-screen graphics are added. */
    val channel: ChannelUi? = null,
)

/**
 * Full-screen video with our own controls. With the controls hidden the remote works like a TV remote: OK pauses,
 * left and right skip, up and down show the controls. With them shown, the D-pad moves between the buttons.
 */
@Composable
fun PlayerScreen(
    plan: PlaybackPlan,
    accessToken: String,
    settings: TvSettings,
    insetX: Dp,
    insetY: Dp,
    commands: Flow<PlayerCommand>,
    actions: PlayerActions,
) {
    val context = LocalContext.current
    val player = remember(plan) {
        val http = DefaultHttpDataSource.Factory()
            .setDefaultRequestProperties(mapOf("Authorization" to "MediaBrowser Token=\"$accessToken\""))
            .setAllowCrossProtocolRedirects(true)
        val item = PlayerMediaItem.Builder().setUri(plan.url).apply {
            plan.subtitleUrl?.let { url ->
                setSubtitleConfigurations(
                    listOf(
                        PlayerMediaItem.SubtitleConfiguration.Builder(Uri.parse(url))
                            .setMimeType(MimeTypes.TEXT_VTT)
                            .setLanguage(plan.subtitleLanguage)
                            .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                            .build(),
                    ),
                )
            }
        }.build()
        // Start sooner than the defaults (a home network is fast) while still keeping a minute ahead for big files.
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(30_000, 60_000, 1_500, 3_000)
            .build()
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(http))
            .setLoadControl(loadControl)
            // A video takes the audio away from the music (which pauses), and pauses itself if the sound output is unplugged.
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .build()
            .apply {
                // "Seamless only" lets the player ask the screen for the video's rate when that does not blink; "Off" never asks.
                setVideoChangeFrameRateStrategy(
                    if (settings.frameRate == FrameRateMode.Off) C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF else C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS,
                )
                // Subtitles are chosen in our own menu: show only the file we attached, never one embedded in the video.
                trackSelectionParameters = trackSelectionParameters.buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, plan.subtitleUrl == null)
                    .build()
                // A converted stream is a full-length playlist too: the server converts from wherever we seek to.
                setMediaItem(item, plan.startMs)
                prepare()
                playWhenReady = true
            }
    }

    val density = LocalDensity.current
    val insetXPx = with(density) { insetX.roundToPx() }
    val insetYPx = with(density) { insetY.roundToPx() }
    var controlsVisible by remember { mutableStateOf(false) }
    // Which side panel is open: audio and subtitles, chapters, or the episodes.
    var panel by remember { mutableStateOf(Panel.None) }
    val panelOpen = panel != Panel.None
    var showInfo by remember { mutableStateOf(false) }
    // The video's frame rate: what the server said, then what the player found in the stream.
    var fps by remember { mutableStateOf(plan.info.fps) }
    MatchDisplayRate(settings.frameRate, fps)
    var playing by remember { mutableStateOf(true) }
    var buffering by remember { mutableStateOf(true) }
    var position by remember { mutableLongStateOf(plan.startMs) }
    var duration by remember { mutableLongStateOf(0L) }
    var interaction by remember { mutableLongStateOf(0L) }
    val root = remember { FocusRequester() }
    val playPause = remember { FocusRequester() }
    val skipFocus = remember { FocusRequester() }
    val joinFocus = remember { FocusRequester() }
    // A retro TV channel: what it is showing for a moment (now and next, and the offer to start over when the viewer joined late).
    val channel = actions.channel
    val osd = channel?.view?.osd
    var osdShown by remember { mutableStateOf(osd != null) }
    LaunchedEffect(osd?.key) {
        if (osd != null) {
            osdShown = true
            delay(if (osd.joinedMinute != null) 10_000L else 6_000L)
            osdShown = false
        }
    }
    val joinShown = osdShown && osd?.joinedMinute != null
    // Up and down change channel on a live channel and on a retro TV channel.
    val zap: ((Int) -> Unit)? = when {
        plan.liveStreamId != null -> actions.onChannelStep
        channel != null -> channel.onStep
        else -> null
    }
    var segments by remember { mutableStateOf<List<Segment>>(emptyList()) }
    LaunchedEffect(plan.item.id) { segments = actions.loadSegments() }
    var chapters by remember { mutableStateOf<List<Chapter>>(emptyList()) }
    LaunchedEffect(plan.item.id) { chapters = actions.loadChapters() }
    val currentChapter by remember { derivedStateOf { chapters.lastOrNull { it.startMs <= position } } }
    // Pictures on the seek bar: nothing is asked of the server until the bar first shows, and only the sheet being looked at is fetched.
    var pictures by remember { mutableStateOf<TrickplayPictures?>(null) }
    var picturesAsked by remember { mutableStateOf(false) }
    var picture by remember { mutableStateOf<ImageBitmap?>(null) }
    val pictureIndex by remember { derivedStateOf { pictures?.indexAt(position) } }
    // The stretch the playhead is in (the last second of it does not count, so a skip does not re-trigger).
    // Read through derivedStateOf: the clock ticks twice a second, but this only changes when a stretch starts or ends.
    // A kind set to "do nothing" in Settings is never active: no button, no skipping.
    val activeSegment by remember {
        derivedStateOf {
            segments.firstOrNull { position >= it.startMs - 250 && position < it.endMs - 1000 && settings.skipFor(it.kind) != SkipAction.Off }
        }
    }
    val active = activeSegment
    // Only a kind set to "ask" draws the button; one set to "skip" is gone in half a second.
    val askActive = active?.takeIf { settings.skipFor(it.kind) == SkipAction.Ask }
    // The last stretch of an episode (when the server has no credits marker) offers the next one.
    val nearEnd by remember { derivedStateOf { plan.item.isEpisodeLike() && duration > 0 && duration - position in 0L..NEXT_EPISODE_MS } }
    val nextShown = nearEnd && askActive == null

    fun now() = player.currentPosition
    fun poke() {
        interaction = System.nanoTime()
    }
    fun showControls() {
        controlsVisible = true
        poke()
    }
    /** The chapter after the playhead, or before the one it is in (a press shortly after a chapter began goes to the one before). */
    fun jumpChapter(forward: Boolean) {
        if (chapters.isEmpty()) return
        val here = player.currentPosition
        val target = if (forward) chapters.firstOrNull { it.startMs > here + 1_000 }
        else chapters.lastOrNull { it.startMs < here - 3_000 } ?: chapters.first()
        if (target != null) {
            player.seekTo(target.startMs)
            showControls()
        }
    }
    fun seekBy(deltaMs: Long) {
        player.seekTo((player.currentPosition + deltaMs).coerceAtLeast(0))
        showControls()
    }

    DisposableEffect(player) {
        var audioApplied = false
        val listener = object : Player.Listener {
            /**
             * A file played as it is carries all its audio tracks and the player would pick one on its own, so choose the
             * one the menu shows. (A converted stream already holds only the chosen one.)
             */
            override fun onTracksChanged(tracks: Tracks) {
                if (plan.transcoding || audioApplied) return
                val position = plan.audioTracks.indexOfFirst { it.index == plan.audioIndex }
                val group = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.getOrNull(position) ?: return
                audioApplied = true
                // This TV cannot decode that audio (for example Dolby on a box without the licence): let the server convert it.
                if (!group.isTrackSupported(0)) {
                    actions.onFallback(now())
                    return
                }
                player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                    .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, 0))
                    .build()
            }

            override fun onVideoSizeChanged(size: androidx.media3.common.VideoSize) {
                // The server did not say how fast the picture runs: take it from the stream.
                if (fps == null) fps = player.videoFormat?.frameRate?.takeIf { it > 0f }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                playing = isPlaying
            }

            override fun onPlaybackStateChanged(state: Int) {
                buffering = state == Player.STATE_BUFFERING || state == Player.STATE_IDLE
                if (state == Player.STATE_READY && duration == 0L) actions.onStart(now())
                if (state == Player.STATE_ENDED) actions.onEnded()
            }

            override fun onPlayerError(error: PlaybackException) {
                if (!plan.transcoding) actions.onFallback(now()) else actions.onExit()
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            actions.onStopped(player.currentPosition)
            player.release()
        }
    }

    // What another Jellyfin app asks of this video ("Play on the TV" from the web: pause, resume, seek, stop, next).
    LaunchedEffect(player) {
        commands.collect { command ->
            when (command) {
                PlayerCommand.Pause -> player.pause()
                PlayerCommand.Resume -> player.play()
                PlayerCommand.Toggle -> if (player.isPlaying) player.pause() else player.play()
                PlayerCommand.Stop -> actions.onExit()
                PlayerCommand.Next -> actions.onNextEpisode()
                is PlayerCommand.SeekTo -> player.seekTo(command.ms.coerceAtLeast(0))
                is PlayerCommand.SeekBy -> player.seekTo((player.currentPosition + command.ms).coerceAtLeast(0))
            }
            showControls()
        }
    }

    // Keep the clock and the server in step.
    LaunchedEffect(player) {
        var sinceReport = 0L
        while (true) {
            delay(500)
            position = player.currentPosition
            duration = if (player.duration > 0) player.duration else duration
            sinceReport += 500
            channel?.onTick?.invoke(position, duration)
            if (sinceReport >= REPORT_EVERY_MS) {
                sinceReport = 0
                actions.onProgress(position, !player.isPlaying)
            }
        }
    }
    LaunchedEffect(controlsVisible) {
        if (controlsVisible && !picturesAsked) {
            picturesAsked = true
            pictures = actions.loadTrickplay()
        }
    }
    LaunchedEffect(pictures, pictureIndex, controlsVisible) {
        val source = pictures ?: return@LaunchedEffect
        if (controlsVisible) picture = source.pictureAt(position)?.asImageBitmap()
    }
    LaunchedEffect(controlsVisible, interaction, playing, panelOpen) {
        if (controlsVisible && playing && !panelOpen) {
            delay(HIDE_AFTER_MS)
            controlsVisible = false
        }
    }
    LaunchedEffect(Unit) { root.requestFocusSoon() }
    LaunchedEffect(active?.startMs, active?.kind) {
        val segment = active ?: return@LaunchedEffect
        if (settings.skipFor(segment.kind) == SkipAction.Auto) {
            delay(500)
            player.seekTo(segment.endMs)
        }
    }
    LaunchedEffect(controlsVisible, panelOpen, askActive?.startMs, nextShown, joinShown) {
        when {
            controlsVisible && !panelOpen -> playPause.requestFocusSoon()
            !controlsVisible && !panelOpen && joinShown && askActive == null && !nextShown -> joinFocus.requestFocusSoon()
            !controlsVisible && !panelOpen && (askActive != null || nextShown) -> skipFocus.requestFocusSoon()
            !controlsVisible && !panelOpen -> root.requestFocusSoon()
        }
    }

    BackHandler {
        when {
            panelOpen -> panel = Panel.None
            showInfo -> showInfo = false
            controlsVisible -> controlsVisible = false
            else -> actions.onExit()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(root)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                poke()
                // These work with or without the controls: chapters on the remote's next and previous keys, Info on its own key.
                when (event.nativeKeyEvent.keyCode) {
                    KeyEvent.KEYCODE_MEDIA_NEXT -> if (chapters.isNotEmpty()) { jumpChapter(true); return@onPreviewKeyEvent true }
                    KeyEvent.KEYCODE_MEDIA_PREVIOUS -> if (chapters.isNotEmpty()) { jumpChapter(false); return@onPreviewKeyEvent true }
                    KeyEvent.KEYCODE_INFO -> { showInfo = !showInfo; return@onPreviewKeyEvent true }
                }
                if (controlsVisible || panelOpen) return@onPreviewKeyEvent false
                when (event.nativeKeyEvent.keyCode) {
                    // With a "Skip" button on screen, OK presses it.
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                        if (active != null || nextShown || joinShown) return@onPreviewKeyEvent false
                        // OK on a live channel only shows the controls (pausing live TV by accident leaves the picture behind); the Pause button pauses.
                        if (plan.liveStreamId == null) {
                            if (player.isPlaying) player.pause() else player.play()
                        }
                        showControls()
                        true
                    }
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                        if (player.isPlaying) player.pause() else player.play()
                        showControls()
                        true
                    }
                    // A live channel cannot be skipped through; up and down (or the remote's channel keys) change channel.
                    KeyEvent.KEYCODE_CHANNEL_UP -> { zap?.invoke(1); zap != null }
                    KeyEvent.KEYCODE_CHANNEL_DOWN -> { zap?.invoke(-1); zap != null }
                    KeyEvent.KEYCODE_DPAD_UP -> { if (zap != null) zap(-1) else showControls(); true }
                    KeyEvent.KEYCODE_DPAD_DOWN -> { if (zap != null) zap(1) else showControls(); true }
                    KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                        if (plan.liveStreamId != null) showControls()
                        else {
                            // Holding the key skips in bigger and bigger steps, so a long film is crossed in a few seconds.
                            val forward = event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT || event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
                            seekBy((if (forward) 1 else -1) * seekStep(event.nativeKeyEvent.repeatCount))
                        }
                        true
                    }
                    KeyEvent.KEYCODE_MENU -> { showControls(); true }
                    else -> false
                }
            },
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                PlayerView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    useController = false
                    isFocusable = false
                    this.player = player
                }
            },
            update = {
                it.player = player
                it.applySubtitleStyle(settings, insetXPx, insetYPx)
            },
        )

        // Everything the viewer presses sits inside the screen margin, in case the TV cuts the edges off.
        Box(Modifier.fillMaxSize().padding(horizontal = insetX, vertical = insetY)) {
        // Starting a stream, or waiting for data after a seek: say so instead of leaving a black screen.
        if (buffering) {
            androidx.compose.material3.CircularProgressIndicator(
                color = Palette.Accent,
                strokeWidth = 5.dp,
                modifier = Modifier.align(Alignment.Center).size(56.dp),
            )
        }
        if ((askActive != null || nextShown) && !panelOpen) {
            Pill(
                stringResource(
                    when (askActive?.kind) {
                        SegmentKind.Intro -> R.string.skip_intro
                        SegmentKind.Recap -> R.string.skip_recap
                        SegmentKind.Outro -> R.string.skip_credits
                        SegmentKind.Preview -> R.string.skip_preview
                        null -> R.string.next_episode
                    },
                ),
                onClick = { if (askActive != null) { player.seekTo(askActive.endMs); poke() } else actions.onNextEpisode() },
                accent = true,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 48.dp, bottom = if (controlsVisible) 150.dp else 48.dp)
                    .focusRequester(skipFocus),
            )
        }
        if (osdShown && osd != null && !controlsVisible && !panelOpen) {
            ChannelOsdCard(
                osd = osd,
                onStartOver = { osdShown = false; channel?.onStartOver?.invoke() },
                joinFocus = joinFocus,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 28.dp),
            )
        }
        if (channel != null && !panelOpen) {
            // The number of the channel in a corner, like the logo of a television channel.
            Text(
                channel.view.number.toString(),
                fontSize = 26.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.Black,
                color = Color(0x99FFFFFF),
                modifier = Modifier.align(Alignment.TopEnd).padding(end = 48.dp, top = 28.dp),
            )
        }
        if (controlsVisible && !panelOpen) {
            Controls(
                channel = channel,
                onGuide = { panel = Panel.Guide },
                plan = plan,
                position = { position },
                duration = duration,
                playing = playing,
                playPause = playPause,
                onTogglePlay = {
                    if (player.isPlaying) player.pause() else player.play()
                    poke()
                },
                onBack = { seekBy(-SEEK_MS) },
                onForward = { seekBy(SEEK_MS) },
                onTracks = { panel = Panel.Tracks },
                chapters = chapters,
                currentChapter = currentChapter,
                onChapters = { panel = Panel.Chapters },
                onSleep = { panel = Panel.Sleep },
                onEpisodes = if (plan.item.isEpisodeLike() && plan.item.seriesId != null) ({ panel = Panel.Episodes }) else null,
                showInfo = showInfo,
                onInfo = { showInfo = !showInfo },
                picture = picture,
                pictureRatio = pictures?.info?.let { it.height.toFloat() / it.width } ?: (9f / 16f),
            )
        }
        if (controlsVisible && !panelOpen && plan.liveStreamId != null) {
            actions.liveNeighbours()?.let { (before, after) ->
                Text(
                    stringResource(R.string.live_neighbours, before, after),
                    fontSize = 15.sp,
                    color = Palette.TextDim,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.align(Alignment.TopEnd).padding(end = 48.dp, top = 32.dp).fillMaxWidth(0.5f),
                    textAlign = TextAlign.End,
                )
            }
        }
        if (showInfo && !panelOpen) {
            InfoOverlay(plan, player, tick = position, modifier = Modifier.align(Alignment.TopStart).padding(start = 48.dp, top = 32.dp))
        }
        when (panel) {
            Panel.Tracks -> TracksPanel(
                plan = plan,
                onChoose = { audio, subtitle ->
                    panel = Panel.None
                    controlsVisible = false
                    actions.onChangeTracks(audio, subtitle, now())
                },
                onSearch = {
                    panel = Panel.None
                    controlsVisible = false
                    actions.onSearchSubtitles(now())
                },
                onClose = { panel = Panel.None },
            )
            Panel.Chapters -> ChaptersPanel(
                chapters = chapters,
                current = currentChapter,
                onChoose = { chapter ->
                    panel = Panel.None
                    controlsVisible = false
                    player.seekTo(chapter.startMs)
                },
                onClose = { panel = Panel.None },
            )
            Panel.Episodes -> EpisodesPanel(
                current = plan.item,
                loadSeasons = actions.loadSeasons,
                loadEpisodes = actions.loadEpisodes,
                onChoose = { episode ->
                    panel = Panel.None
                    controlsVisible = false
                    if (episode.id != plan.item.id) actions.onPlayEpisode(episode)
                },
                onClose = { panel = Panel.None },
            )
            Panel.Guide -> if (channel != null) ChannelGuidePanel(
                channel = channel,
                onPick = { program ->
                    panel = Panel.None
                    controlsVisible = false
                    channel.onPick(program)
                },
                onAll = channel.onAllChannels,
                onClose = { panel = Panel.None },
            )
            Panel.Sleep -> SleepPanel(
                current = actions.sleepTimer,
                onChoose = { timer ->
                    panel = Panel.None
                    controlsVisible = false
                    actions.onSleep(timer)
                },
                onClose = { panel = Panel.None },
            )
            Panel.None -> Unit
        }
        }
    }
}

private enum class Panel { None, Tracks, Chapters, Episodes, Guide, Sleep }

/** The time labels on both sides of the seek bar have one width, so a picture above the bar lines up with it. */
private val TIME_LABEL_WIDTH = 64.dp
private val BAR_GAP = 14.dp

@Composable
private fun Controls(
    channel: ChannelUi?,
    onGuide: () -> Unit,
    plan: PlaybackPlan,
    position: () -> Long,
    duration: Long,
    playing: Boolean,
    playPause: FocusRequester,
    onTogglePlay: () -> Unit,
    onBack: () -> Unit,
    onForward: () -> Unit,
    onTracks: () -> Unit,
    chapters: List<Chapter>,
    currentChapter: Chapter?,
    onChapters: () -> Unit,
    onSleep: () -> Unit,
    /** Present for an episode: opens the list of the series' seasons and episodes. */
    onEpisodes: (() -> Unit)?,
    showInfo: Boolean,
    onInfo: () -> Unit,
    picture: ImageBitmap?,
    pictureRatio: Float,
) {
    // Only the controls follow the clock; the rest of the screen is not redrawn twice a second.
    val position = position()
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(260.dp).background(
                Brush.verticalGradient(listOf(Color.Transparent, Color(0x99000000))),
            ),
        )
        Column(
            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 48.dp, vertical = 28.dp),
        ) {
            // One panel of glass: what is playing, the bar and the buttons.
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color(0x99101418))
                    .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(24.dp))
                    .padding(horizontal = 28.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (channel != null) {
                    ChannelInfo(channel, position)
                } else {
                    // A channel is named without the quality and notes playlists put in its name; those go beneath.
                    val channelName = remember(plan.item.id) { if (plan.item.isChannel) splitChannelName(plan.item.title) else null }
                    Text(channelName?.title ?: plan.item.title, fontSize = 24.sp, color = Color.White)
                    channelName?.tags?.takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" · "), fontSize = 15.sp, color = Palette.TextDim) }
                    plan.item.subtitle?.takeIf { plan.item.isEpisodeLike() }?.let { Text(it, fontSize = 15.sp, color = Palette.TextDim) }
                }
                if (plan.transcoding) Text(stringResource(R.string.player_converting), fontSize = 13.sp, color = Palette.TextDim)
                currentChapter?.let { chapter ->
                    Text(chapterName(chapters.indexOf(chapter), chapter), fontSize = 14.sp, color = Palette.TextDim)
                }

                // Where the playhead is, pictured: on the same line as the bar (the time labels have a fixed width on both sides).
                if (picture != null) {
                    val pictureWidth = 200.dp
                    Row(Modifier.fillMaxWidth().height(pictureWidth * pictureRatio)) {
                        Spacer(Modifier.width(TIME_LABEL_WIDTH + BAR_GAP))
                        BoxWithConstraints(Modifier.weight(1f).fillMaxHeight()) {
                            val fraction = if (duration > 0) (position.toFloat() / duration).coerceIn(0f, 1f) else 0f
                            val x = (maxWidth * fraction - pictureWidth / 2).coerceIn(0.dp, (maxWidth - pictureWidth).coerceAtLeast(0.dp))
                            Image(
                                bitmap = picture,
                                contentDescription = null,
                                modifier = Modifier
                                    .offset(x = x)
                                    .width(pictureWidth)
                                    .fillMaxHeight()
                                    .clip(RoundedCornerShape(8.dp))
                                    .border(2.dp, Color.White, RoundedCornerShape(8.dp)),
                            )
                        }
                        Spacer(Modifier.width(TIME_LABEL_WIDTH + BAR_GAP))
                    }
                }
                if (plan.liveStreamId != null) {
                    // A live channel has no length: say so instead of a bar.
                    Text(stringResource(R.string.player_live), fontSize = 14.sp, color = Color.White)
                } else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(BAR_GAP)) {
                    Text(formatTime(position), fontSize = 14.sp, color = Color.White, modifier = Modifier.width(TIME_LABEL_WIDTH))
                    Box(
                        Modifier.weight(1f).height(5.dp).background(Color(0x55FFFFFF)).drawBehind {
                            // A thin gap in the bar at every chapter.
                            if (duration > 0) chapters.drop(1).forEach {
                                val x = size.width * (it.startMs.toFloat() / duration).coerceIn(0f, 1f)
                                drawRect(Color.Black, Offset(x - 1.5f, 0f), Size(3f, size.height))
                            }
                        },
                    ) {
                        val fraction = if (duration > 0) (position.toFloat() / duration).coerceIn(0f, 1f) else 0f
                        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction).background(Palette.Accent))
                    }
                    Text(formatTime(duration), fontSize = 14.sp, color = Color.White, textAlign = TextAlign.End, modifier = Modifier.width(TIME_LABEL_WIDTH))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Pill(
                        stringResource(if (playing) R.string.player_pause else R.string.player_play),
                        onClick = onTogglePlay,
                        modifier = Modifier.focusRequester(playPause),
                    )
                    if (channel != null) {
                        Pill(stringResource(R.string.modules_player_previous), onClick = channel.onPrevious)
                        Pill(stringResource(R.string.modules_player_start_over), onClick = channel.onStartOver)
                        Pill(stringResource(R.string.modules_player_next), onClick = channel.onNext)
                        if (!isLive(channel.behindSeconds(position))) Pill(stringResource(R.string.modules_player_go_live), onClick = channel.onLive, accent = true)
                        Pill(stringResource(R.string.modules_player_channel_down), onClick = { channel.onStep(-1) })
                        Pill(stringResource(R.string.modules_player_channel_up), onClick = { channel.onStep(1) })
                        Pill(stringResource(R.string.modules_player_guide), onClick = onGuide)
                    } else if (plan.liveStreamId == null) {
                        Pill(stringResource(R.string.player_back_10), onClick = onBack)
                        Pill(stringResource(R.string.player_forward_10), onClick = onForward)
                    }
                    Pill(stringResource(R.string.player_audio_subtitles), onClick = onTracks)
                    if (chapters.size > 1) Pill(stringResource(R.string.player_chapters), onClick = onChapters)
                    if (channel == null && plan.liveStreamId == null) Pill(stringResource(R.string.player_sleep), onClick = onSleep)
                    if (onEpisodes != null) Pill(stringResource(R.string.player_episodes), onClick = onEpisodes)
                    Pill(stringResource(R.string.player_info), onClick = onInfo, selected = showInfo)
                }
            }
        }
    }
}

/** "5 min", "1 h 05 min": a distance in time, from a number of seconds. */
@Composable
private fun spanText(seconds: Long): String {
    val minutes = (kotlin.math.abs(seconds) / 60).coerceAtLeast(1)
    return if (minutes < 60) stringResource(R.string.modules_minutes, minutes.toInt()) else "${minutes / 60} h ${"%02d".format(minutes % 60)} min"
}

/** The line a retro TV channel adds to the controls: its number and name, whether the viewer is live, what is on and what comes next. */
@Composable
private fun ChannelInfo(channel: ChannelUi, positionMs: Long) {
    val view = channel.view
    val current = view.current
    val behind = channel.behindSeconds(positionMs)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ChannelBadge(view.number, view.color, size = 34.dp)
            Text(view.name, fontSize = 18.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, color = Color.White)
            val live = isLive(behind)
            Text(
                if (live) stringResource(R.string.player_live) else stringResource(if (behind > 0) R.string.modules_behind else R.string.modules_ahead, spanText(behind)),
                fontSize = 13.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                color = Color.White,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (live) Color(0xFFDC2626) else Color(0x40FFFFFF))
                    .padding(horizontal = 12.dp, vertical = 4.dp),
            )
            Spacer(Modifier.weight(1f))
            view.upNext?.let {
                Text(stringResource(R.string.modules_next_at, clockOf(it.start), it.shownTitle()), fontSize = 14.sp, color = Palette.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth(0.45f), textAlign = TextAlign.End)
            }
        }
        if (current != null) {
            Text(current.title, fontSize = 26.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(current.subtitle, "${clockOf(current.start)} – ${clockOf(current.end)}").joinToString(" · "),
                fontSize = 15.sp, color = Palette.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** What a television shows for a moment when the program changes: what is on now and what comes next, and, when the viewer joined late, an offer to start over. */
@Composable
private fun ChannelOsdCard(osd: app.jellyflix.tv.ChannelOsdState, onStartOver: () -> Unit, joinFocus: FocusRequester, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .width(720.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(Color(0xB3101418))
            .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(20.dp))
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.modules_osd_now), fontSize = 12.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, color = Color.White, modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Color(0xFFDC2626)).padding(horizontal = 8.dp, vertical = 3.dp))
            Text(osd.now.shownTitle(), fontSize = 22.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        osd.next?.let {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.modules_osd_next), fontSize = 12.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, color = Color(0xCCFFFFFF), modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Color(0x33FFFFFF)).padding(horizontal = 8.dp, vertical = 3.dp))
                Text("${clockOf(it.start)}  ${it.shownTitle()}", fontSize = 17.sp, color = Palette.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        osd.joinedMinute?.let { minute ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(top = 4.dp)) {
                Text(stringResource(R.string.modules_joined_minute, minute), fontSize = 16.sp, color = Color.White)
                Pill(stringResource(R.string.modules_start_beginning), onClick = onStartOver, accent = true, modifier = Modifier.focusRequester(joinFocus))
            }
        }
    }
}

/** The guide of the channel being watched, over the picture: what was on, what is on and what comes next. Picking a program goes to it. */
@Composable
private fun ChannelGuidePanel(channel: ChannelUi, onPick: (ModuleProgram) -> Unit, onAll: () -> Unit, onClose: () -> Unit) {
    val view = channel.view
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { channel.loadGuide() }
    val live = channel.liveSeconds()
    val liveStart = view.programs.firstOrNull { it.start <= live && live < it.end }?.start
    val shown = view.programs.filter { liveStart == null || it.start >= liveStart - 3 * 3600 }
    LaunchedEffect(shown.size) { first.requestFocusSoon() }
    Box(Modifier.fillMaxSize().background(Color(0x99000000))) {
        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .width(620.dp)
                .fillMaxHeight()
                .background(Palette.Surface.copy(alpha = 0.95f))
                .verticalScroll(rememberScrollState())
                .padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(stringResource(R.string.modules_guide_title, view.name), fontSize = 20.sp, color = Color.White)
            shown.forEach { program ->
                val isLiveNow = program.start == liveStart
                val viewing = program.start == view.currentStart
                val mark = when {
                    isLiveNow -> "  ·  " + stringResource(R.string.modules_guide_live)
                    viewing -> "  ·  " + stringResource(R.string.modules_guide_watching)
                    else -> ""
                }
                TrackPill(
                    "${clockOf(program.start)}  ${program.shownTitle()}$mark",
                    selected = viewing,
                    onClick = { onPick(program) },
                    modifier = if (viewing || (isLiveNow && view.programs.none { it.start == view.currentStart })) Modifier.focusRequester(first) else Modifier,
                )
            }
            Pill(stringResource(R.string.modules_player_all_channels), onClick = onAll, modifier = Modifier.padding(top = 16.dp))
            Pill(stringResource(R.string.player_close), onClick = onClose)
        }
    }
}

/** Audio and subtitle choices. Picking one asks the server for a stream with it and carries on from the same moment. */
@Composable
private fun TracksPanel(plan: PlaybackPlan, onChoose: (audio: Int?, subtitle: Int?) -> Unit, onSearch: () -> Unit, onClose: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocusSoon() }
    Box(Modifier.fillMaxSize().background(Color(0x99000000))) {
        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .width(520.dp)
                .fillMaxHeight()
                .background(Palette.Surface.copy(alpha = 0.95f))
                .verticalScroll(rememberScrollState())
                .padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(stringResource(R.string.player_audio), fontSize = 20.sp, color = Color.White)
            plan.audioTracks.forEachIndexed { i, track ->
                TrackPill(
                    track.label,
                    selected = track.index == plan.audioIndex,
                    onClick = { onChoose(track.index, null) },
                    modifier = if (track.index == plan.audioIndex || (plan.audioIndex == null && i == 0)) Modifier.focusRequester(first) else Modifier,
                )
            }
            Text(stringResource(R.string.player_subtitles), fontSize = 20.sp, color = Color.White, modifier = Modifier.padding(top = 16.dp))
            TrackPill(stringResource(R.string.player_subtitles_off), selected = plan.subtitleIndex == null, onClick = { onChoose(null, -1) })
            plan.subtitleTracks.forEach { track ->
                TrackPill(track.label, selected = track.index == plan.subtitleIndex, onClick = { onChoose(null, track.index) })
            }
            if (!plan.item.isChannel) Pill(stringResource(R.string.player_subtitles_search), onClick = onSearch)
            Pill(stringResource(R.string.player_close), onClick = onClose, modifier = Modifier.padding(top = 16.dp))
        }
    }
}

/** The series' seasons as a row of buttons, and the episodes of the chosen season below: picking one plays it in place of this one. */
@Composable
private fun EpisodesPanel(
    current: MediaItem,
    loadSeasons: suspend () -> List<MediaItem>,
    loadEpisodes: suspend (java.util.UUID) -> List<MediaItem>,
    onChoose: (MediaItem) -> Unit,
    onClose: () -> Unit,
) {
    val first = remember { FocusRequester() }
    var seasons by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var seasonId by remember { mutableStateOf(current.seasonId) }
    var episodes by remember { mutableStateOf<List<MediaItem>?>(null) }
    LaunchedEffect(current.id) {
        seasons = loadSeasons()
        if (seasonId == null) seasonId = seasons.firstOrNull { it.seasonNumber == current.seasonNumber }?.id ?: seasons.firstOrNull()?.id
    }
    LaunchedEffect(seasonId) {
        val id = seasonId ?: return@LaunchedEffect
        episodes = null
        episodes = loadEpisodes(id)
    }
    // The focus goes to the episode on, once the list is there.
    LaunchedEffect(episodes) { if (episodes != null) first.requestFocusSoon() }
    Box(Modifier.fillMaxSize().background(Color(0x99000000))) {
        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .width(520.dp)
                .fillMaxHeight()
                .background(Palette.Surface.copy(alpha = 0.95f))
                .verticalScroll(rememberScrollState())
                .padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(current.title, fontSize = 20.sp, color = Color.White)
            if (seasons.size > 1) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    seasons.forEach { season ->
                        Pill(season.name, onClick = { seasonId = season.id }, selected = season.id == seasonId)
                    }
                }
            }
            val list = episodes
            if (list == null) {
                Text(stringResource(R.string.loading), fontSize = 15.sp, color = Palette.TextDim)
            } else {
                list.forEachIndexed { i, episode ->
                    val label = listOfNotNull(episode.episodeNumber?.let { "E$it" }, episode.name).joinToString(" · ") + if (episode.played) "  ✓" else ""
                    val isCurrent = episode.id == current.id
                    TrackPill(
                        label,
                        selected = isCurrent,
                        onClick = { onChoose(episode) },
                        modifier = if (isCurrent || (i == 0 && list.none { it.id == current.id })) Modifier.focusRequester(first) else Modifier,
                    )
                }
            }
            Pill(stringResource(R.string.player_close), onClick = onClose, modifier = Modifier.padding(top = 16.dp))
        }
    }
}

@Composable
private fun TrackPill(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Pill(text = (if (selected) "✓ " else "") + label, onClick = onClick, modifier = modifier, selected = selected)
}

private fun app.jellyflix.tv.data.MediaItem.isEpisodeLike() =
    kind == org.jellyfin.sdk.model.api.BaseItemKind.EPISODE
