package app.jellyflix.tv.ui

import android.net.Uri
import android.view.KeyEvent
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.style.TextAlign
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
import app.jellyflix.tv.PlayerCommand
import app.jellyflix.tv.R
import app.jellyflix.tv.data.Chapter
import app.jellyflix.tv.data.PlaybackPlan
import app.jellyflix.tv.data.FrameRateMode
import app.jellyflix.tv.data.TvSettings
import app.jellyflix.tv.data.Segment
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
)

/**
 * Full-screen video with our own controls. With the controls hidden the remote works like a TV remote: OK pauses,
 * left and right skip, up and down show the controls. With them shown, the D-pad moves between the buttons.
 */
@Composable
fun PlayerScreen(
    plan: PlaybackPlan,
    accessToken: String,
    autoSkip: Boolean,
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
    // Which side panel is open: audio and subtitles, or chapters.
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
    val activeSegment by remember { derivedStateOf { segments.firstOrNull { position >= it.startMs - 250 && position < it.endMs - 1000 } } }
    val active = activeSegment
    // The last stretch of an episode (when the server has no credits marker) offers the next one.
    val nearEnd by remember { derivedStateOf { plan.item.isEpisodeLike() && duration > 0 && duration - position in 0L..NEXT_EPISODE_MS } }
    val nextShown = nearEnd && active == null

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
    LaunchedEffect(active?.startMs, autoSkip) {
        val segment = active ?: return@LaunchedEffect
        if (autoSkip) {
            delay(500)
            player.seekTo(segment.endMs)
        }
    }
    LaunchedEffect(controlsVisible, panelOpen, active?.startMs, nextShown) {
        when {
            controlsVisible && !panelOpen -> playPause.requestFocusSoon()
            !controlsVisible && !panelOpen && (active != null || nextShown) -> skipFocus.requestFocusSoon()
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
                        if (active != null || nextShown) return@onPreviewKeyEvent false
                        if (player.isPlaying) player.pause() else player.play()
                        showControls()
                        true
                    }
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                        if (player.isPlaying) player.pause() else player.play()
                        showControls()
                        true
                    }
                    // Holding the key skips in bigger and bigger steps, so a long film is crossed in a few seconds.
                    KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> { seekBy(-seekStep(event.nativeKeyEvent.repeatCount)); true }
                    KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seekBy(seekStep(event.nativeKeyEvent.repeatCount)); true }
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_MENU -> { showControls(); true }
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
        if ((active != null || nextShown) && !panelOpen) {
            Pill(
                stringResource(
                    when (active?.kind) {
                        SegmentKind.Intro -> R.string.skip_intro
                        SegmentKind.Recap -> R.string.skip_recap
                        SegmentKind.Outro -> R.string.skip_credits
                        SegmentKind.Preview -> R.string.skip_preview
                        null -> R.string.next_episode
                    },
                ),
                onClick = { if (active != null) { player.seekTo(active.endMs); poke() } else actions.onNextEpisode() },
                accent = true,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 48.dp, bottom = if (controlsVisible) 150.dp else 48.dp)
                    .focusRequester(skipFocus),
            )
        }
        if (controlsVisible && !panelOpen) {
            Controls(
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
                showInfo = showInfo,
                onInfo = { showInfo = !showInfo },
                picture = picture,
                pictureRatio = pictures?.info?.let { it.height.toFloat() / it.width } ?: (9f / 16f),
            )
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
            Panel.None -> Unit
        }
        }
    }
}

private enum class Panel { None, Tracks, Chapters }

/** The time labels on both sides of the seek bar have one width, so a picture above the bar lines up with it. */
private val TIME_LABEL_WIDTH = 64.dp
private val BAR_GAP = 14.dp

@Composable
private fun Controls(
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
    showInfo: Boolean,
    onInfo: () -> Unit,
    picture: ImageBitmap?,
    pictureRatio: Float,
) {
    // Only the controls follow the clock; the rest of the screen is not redrawn twice a second.
    val position = position()
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(300.dp).background(
                Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000))),
            ),
        )
        Column(
            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 48.dp, vertical = 36.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(plan.item.title, fontSize = 24.sp, color = Color.White)
            plan.item.subtitle?.takeIf { plan.item.isEpisodeLike() }?.let { Text(it, fontSize = 15.sp, color = Palette.TextDim) }
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
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(BAR_GAP)) {
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
                Pill(stringResource(R.string.player_back_10), onClick = onBack)
                Pill(stringResource(R.string.player_forward_10), onClick = onForward)
                Pill(stringResource(R.string.player_audio_subtitles), onClick = onTracks)
                if (chapters.size > 1) Pill(stringResource(R.string.player_chapters), onClick = onChapters)
                Pill(stringResource(R.string.player_info), onClick = onInfo, selected = showInfo)
            }
        }
    }
}

/** Audio and subtitle choices. Picking one asks the server for a stream with it and carries on from the same moment. */
@Composable
private fun TracksPanel(plan: PlaybackPlan, onChoose: (audio: Int?, subtitle: Int?) -> Unit, onClose: () -> Unit) {
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
