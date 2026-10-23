package app.jellyflix.tv.ui

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.NowPlayingPanel
import app.jellyflix.tv.R
import app.jellyflix.tv.data.Lyrics
import app.jellyflix.tv.data.SleepChoice
import app.jellyflix.tv.data.Song
import app.jellyflix.tv.data.sleepMinutesLeft
import app.jellyflix.tv.data.stepLine
import app.jellyflix.tv.music.MusicPlayer
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch

/**
 * The full-screen player for music. Three faces, chosen with the tools along the bottom: the cover and controls alone in the middle,
 * the same with the queue beside them, or the words of the song filling the screen. The top row only has Close.
 */
@Composable
fun NowPlayingScreen(vm: AppViewModel) {
    val music = vm.music ?: return
    val song = music.current
    val playPause = remember { FocusRequester() }
    LaunchedEffect(Unit) { playPause.requestFocusSoon() }

    // The lyrics of the song on now: the Lyrics tool only exists when there are some.
    var lyrics by remember(song?.id) { mutableStateOf<Lyrics?>(null) }
    var lyricsLoaded by remember(song?.id) { mutableStateOf(false) }
    LaunchedEffect(song?.id) {
        song?.let {
            lyrics = vm.lyricsFor(it.id)
            lyricsLoaded = true
        }
    }
    // A song without words cannot show the lyrics face: it falls back to where the lyrics go back to.
    val panel = if (vm.nowPlayingPanel == NowPlayingPanel.Lyrics && lyricsLoaded && lyrics == null) vm.nowPlayingHome else vm.nowPlayingPanel

    Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Pill(stringResource(R.string.music_close), onClick = { vm.back() })
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (panel) {
                NowPlayingPanel.Player -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    SongCard(music, song, playPause, centered = true, onStop = { music.stop(); vm.back() }, modifier = Modifier.width(560.dp))
                }
                NowPlayingPanel.Queue -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
                    SongCard(music, song, playPause, centered = false, onStop = { music.stop(); vm.back() }, modifier = Modifier.width(480.dp).fillMaxHeight())
                    QueueList(music, Modifier.weight(1f).fillMaxHeight())
                }
                NowPlayingPanel.Lyrics -> LyricsFace(vm, music, song, lyrics, Modifier.fillMaxSize())
            }
        }
        Footer(vm, music, song, panel, hasLyrics = lyrics != null, playPause = playPause)
    }
}

/** The cover, what is playing, the timeline and the controls. */
@Composable
private fun SongCard(music: MusicPlayer, song: Song?, playPause: FocusRequester, centered: Boolean, onStop: () -> Unit, modifier: Modifier = Modifier) {
    val align = if (centered) Alignment.CenterHorizontally else Alignment.Start
    val textAlign = if (centered) TextAlign.Center else TextAlign.Start
    // The cover gives up room before the controls do: with a long title that takes two lines the buttons would be squeezed flat.
    BoxWithConstraints(modifier, contentAlignment = if (centered) Alignment.Center else Alignment.CenterStart) {
        val cover = (maxHeight - 250.dp).coerceIn(96.dp, if (centered) 220.dp else 170.dp)
        Column(Modifier.then(if (centered) Modifier else Modifier.fillMaxHeight()), verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically), horizontalAlignment = align) {
            Box(Modifier.width(cover).aspectRatio(1f).clip(RoundedCornerShape(16.dp)).background(Palette.Surface)) {
                AsyncImage(model = song?.coverUrl, contentDescription = song?.album, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Chip(stringResource(R.string.music_now_playing))
            Text(song?.name.orEmpty(), fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = textAlign)
            Text(
                listOfNotNull(song?.artist, song?.album?.takeIf { it.isNotBlank() }).joinToString(" · "),
                fontSize = 15.sp,
                color = Palette.TextDim,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textAlign = textAlign,
            )
            Timeline(music, Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Transport(music, playPause, onStop)
            }
        }
    }
}

@Composable
private fun Timeline(music: MusicPlayer, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(formatTime(music.positionMs), fontSize = 13.sp, color = Color.White)
        Box(Modifier.weight(1f).height(5.dp).background(Color(0x55FFFFFF))) {
            val fraction = if (music.durationMs > 0) (music.positionMs.toFloat() / music.durationMs).coerceIn(0f, 1f) else 0f
            Box(Modifier.fillMaxHeight().fillMaxWidth(fraction).background(Palette.Accent))
        }
        Text(formatTime(music.durationMs), fontSize = 13.sp, color = Color.White)
    }
}

@Composable
private fun Transport(music: MusicPlayer, playPause: FocusRequester, onStop: (() -> Unit)? = null) {
    Pill(stringResource(R.string.music_previous), onClick = music::previous)
    Pill(
        stringResource(if (music.playing) R.string.player_pause else R.string.player_play),
        onClick = music::toggle,
        accent = true,
        modifier = Modifier.focusRequester(playPause),
    )
    Pill(stringResource(R.string.music_next), onClick = music::next)
    if (onStop != null) Pill(stringResource(R.string.music_stop), onClick = onStop)
}

/** The bottom of the screen: with the words showing, a slim player (cover, title, controls, timeline); always the tools at the right. */
@Composable
private fun Footer(vm: AppViewModel, music: MusicPlayer, song: Song?, panel: NowPlayingPanel, hasLyrics: Boolean, playPause: FocusRequester) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (panel == NowPlayingPanel.Lyrics) Timeline(music, Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (panel == NowPlayingPanel.Lyrics) {
                AsyncImage(
                    model = song?.coverUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(Palette.Surface),
                )
                Column(Modifier.weight(1f)) {
                    Text(song?.name.orEmpty(), fontSize = 16.sp, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(song?.artist.orEmpty(), fontSize = 13.sp, color = Palette.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Transport(music, playPause)
            } else {
                Box(Modifier.weight(1f))
            }
            Tools(vm, music, panel, hasLyrics)
        }
    }
}

/** Sleep timer, lyrics and queue: three buttons that stay where they are whichever face is showing. */
@Composable
private fun Tools(vm: AppViewModel, music: MusicPlayer, panel: NowPlayingPanel, hasLyrics: Boolean) {
    val sleepLabel = when (music.sleep) {
        SleepChoice.Off -> stringResource(R.string.music_sleep)
        SleepChoice.AfterSong -> stringResource(R.string.music_sleep_after)
        else -> stringResource(R.string.music_sleep_minutes, sleepMinutesLeft(music.sleepEndsAt, SystemClock.elapsedRealtime()))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Pill(sleepLabel, onClick = music::cycleSleep, selected = music.sleep != SleepChoice.Off)
        if (hasLyrics) {
            Pill(
                stringResource(R.string.music_lyrics),
                onClick = { vm.showNowPlayingPanel(if (panel == NowPlayingPanel.Lyrics) vm.nowPlayingHome else NowPlayingPanel.Lyrics) },
                selected = panel == NowPlayingPanel.Lyrics,
            )
        }
        Pill(
            stringResource(R.string.music_queue),
            onClick = { vm.showNowPlayingPanel(if (panel == NowPlayingPanel.Queue) NowPlayingPanel.Player else NowPlayingPanel.Queue) },
            selected = panel == NowPlayingPanel.Queue,
        )
    }
}

/** "Up next": the queue, with a Reorder mode (OK picks a song up, Up and Down move it, OK puts it down). */
@Composable
private fun QueueList(music: MusicPlayer, modifier: Modifier = Modifier) {
    var reorder by remember { mutableStateOf(false) }
    var lifted by remember { mutableStateOf<Int?>(null) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.music_up_next), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
            Pill(
                stringResource(if (reorder) R.string.music_reorder_done else R.string.music_reorder),
                onClick = { reorder = !reorder; lifted = null },
                selected = reorder,
            )
        }
        if (reorder) Text(stringResource(R.string.music_reorder_hint), fontSize = 13.sp, color = Palette.TextDim)
        val listState = rememberLazyListState()
        // Follow the song that is playing, except while a song is being carried (its place changes under the remote).
        LaunchedEffect(music.index, lifted == null) { if (lifted == null) listState.animateScrollToItem(music.index.coerceAtLeast(0)) }
        LazyColumn(
            state = listState,
            modifier = Modifier.onPreviewKeyEvent { event ->
                val from = lifted ?: return@onPreviewKeyEvent false
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                // The song moves one place and the remote's focus follows it onto its new row (the rows are keyed by place).
                val to = when (event.key) {
                    Key.DirectionUp -> from - 1
                    Key.DirectionDown -> from + 1
                    else -> return@onPreviewKeyEvent false
                }
                if (to !in music.queue.indices) return@onPreviewKeyEvent true // the end of the list: stay on the song
                music.move(from, to)
                lifted = to
                false
            },
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(music.queue.size, key = { it }) { index ->
                SongRow(
                    index + 1,
                    music.queue[index],
                    current = index == music.index,
                    lifted = lifted == index,
                    onClick = { if (reorder) lifted = if (lifted == index) null else index else music.playAt(index) },
                )
            }
        }
    }
}

/** The words of the song filling the screen (see [LyricsPanel]), and for lyrics without times a button that looks for a timed version. */
@Composable
private fun LyricsFace(vm: AppViewModel, music: MusicPlayer, song: Song?, lyrics: Lyrics?, modifier: Modifier = Modifier) {
    // Plain lyrics cannot follow the song: the server's lyrics plugin may have a timed version, which one button saves and shows.
    var found by remember(song?.id) { mutableStateOf<Lyrics?>(null) }
    var finding by remember(song?.id) { mutableStateOf(false) }
    var findNote by remember(song?.id) { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    val shown = found ?: lyrics
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LyricsPanel(
            shown,
            music.positionMs,
            onSeek = { ms ->
                music.seekTo(ms)
                if (!music.playing) music.toggle()
            },
            modifier = Modifier.weight(1f).fillMaxWidth(),
        )
        if (shown?.synced == false && song != null) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally)) {
                Text(stringResource(findNote ?: R.string.music_not_timed), fontSize = 13.sp, lineHeight = 18.sp, color = Palette.TextDim, modifier = Modifier.weight(1f, fill = false))
                Pill(
                    stringResource(if (finding) R.string.music_finding_timed else R.string.music_find_timed),
                    onClick = {
                        if (finding) return@Pill
                        finding = true
                        findNote = null
                        scope.launch {
                            when (val result = vm.findTimedLyrics(song.id)) {
                                is AppViewModel.TimedLyricsResult.Found -> found = result.lyrics
                                AppViewModel.TimedLyricsResult.None -> findNote = R.string.music_timed_none
                                AppViewModel.TimedLyricsResult.Denied -> findNote = R.string.music_timed_denied
                                AppViewModel.TimedLyricsResult.Failed -> findNote = R.string.music_timed_failed
                            }
                            finding = false
                        }
                    },
                )
            }
        }
    }
}

/**
 * The words of the song, large and centred. Timed lyrics follow the music with the line being sung in white and bigger. With the panel
 * focused, OK starts choosing a line (Up and Down move, OK jumps the song to it, Left stops choosing); up and down otherwise leave the
 * panel as usual. Plain lyrics are scrolled by Up and Down until their ends.
 */
@Composable
private fun LyricsPanel(lyrics: Lyrics?, positionMs: Long, onSeek: (Long) -> Unit, modifier: Modifier = Modifier) {
    val state = rememberLazyListState()
    if (lyrics == null) {
        Box(modifier, contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.loading), fontSize = 18.sp, color = Palette.TextDim)
        }
        return
    }
    val current = lyrics.currentAt(positionMs)
    var cursor by remember(lyrics) { mutableStateOf<Int?>(null) }
    var focused by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    if (lyrics.synced) {
        // Keep the line being sung (or the one being chosen) in the middle: the list has half a box of room above and below.
        val target = (cursor ?: current).coerceAtLeast(0)
        LaunchedEffect(target, lyrics) { state.animateScrollToItem(target) }
    }
    BoxWithConstraints(
        modifier
            .then(if (focused) Modifier.border(2.dp, Palette.Accent.copy(alpha = 0.6f), RoundedCornerShape(16.dp)) else Modifier)
            .onFocusChanged {
                focused = it.isFocused
                if (!it.isFocused) cursor = null
            }
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val choosing = cursor
                if (lyrics.synced) {
                    when (event.key) {
                        Key.DirectionCenter, Key.Enter -> {
                            if (choosing == null) cursor = current.coerceAtLeast(0)
                            else {
                                lyrics.lines[choosing].startMs?.let(onSeek)
                                cursor = null
                            }
                            true
                        }
                        Key.DirectionDown -> choosing?.let { cursor = stepLine(it, +1, lyrics.lines.size); true } ?: false
                        Key.DirectionUp -> choosing?.let { cursor = stepLine(it, -1, lyrics.lines.size); true } ?: false
                        Key.DirectionLeft -> choosing?.let { cursor = null; true } ?: false
                        else -> false
                    }
                } else {
                    when (event.key) {
                        Key.DirectionDown -> state.canScrollForward.also { if (it) scope.launch { state.animateScrollBy(280f) } }
                        Key.DirectionUp -> state.canScrollBackward.also { if (it) scope.launch { state.animateScrollBy(-280f) } }
                        else -> false
                    }
                }
            }
            .focusable(),
    ) {
        val halfBox = (maxHeight / 2 - 30.dp).coerceAtLeast(0.dp)
        Column(Modifier.fillMaxSize()) {
            LazyColumn(
                state = state,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(vertical = if (lyrics.synced) halfBox else 24.dp, horizontal = 24.dp),
                verticalArrangement = Arrangement.spacedBy(if (lyrics.synced) 10.dp else 6.dp),
            ) {
                items(lyrics.lines.size, key = { it }) { index ->
                    val line = lyrics.lines[index]
                    if (lyrics.synced) {
                        val now = index == current
                        val chosen = index == cursor
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (chosen) Color(0x33FFFFFF) else Color.Transparent)
                                .padding(horizontal = 24.dp, vertical = 6.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                line.text.ifBlank { "♪" },
                                fontSize = if (now) 36.sp else 26.sp,
                                lineHeight = if (now) 44.sp else 32.sp,
                                fontWeight = if (now) FontWeight.Bold else FontWeight.Normal,
                                color = if (now || chosen) Color.White else Palette.TextDim,
                                textAlign = TextAlign.Center,
                            )
                        }
                    } else {
                        Text(
                            line.text.ifBlank { " " },
                            fontSize = 24.sp,
                            lineHeight = 32.sp,
                            color = if (focused) Color.White else Color(0xFFD0D0D0),
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            // A line of its own under the words, so it never covers one.
            Box(Modifier.fillMaxWidth().height(26.dp), contentAlignment = Alignment.Center) {
                if (focused && lyrics.synced && cursor == null) {
                    Text(stringResource(R.string.music_lyrics_hint), fontSize = 13.sp, color = Palette.TextDim)
                }
            }
        }
    }
}

/** A thin bar at the bottom of the main screens while music is queued: what is playing, the queue and lyrics shortcuts, and play/pause. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun NowPlayingBar(vm: AppViewModel, modifier: Modifier = Modifier) {
    val music = vm.music ?: return
    val song = music.current ?: return
    var hasLyrics by remember(song.id) { mutableStateOf(false) }
    LaunchedEffect(song.id) { hasLyrics = vm.hasLyrics(song.id) }
    Surface(
        onClick = { vm.openNowPlaying() },
        modifier = modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 10.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Palette.Surface2.copy(alpha = 0.95f),
            contentColor = Color.White,
            focusedContainerColor = Palette.Surface4,
            focusedContentColor = Color.White,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.01f),
    ) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            AsyncImage(
                model = song.coverUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)).background(Palette.Surface),
            )
            Column(Modifier.weight(1f)) {
                Text(song.name, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White)
                Text(song.artist, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Palette.TextDim)
            }
            Text(
                "${formatTime(music.positionMs)} / ${formatTime(music.durationMs)}",
                fontSize = 12.sp,
                color = Palette.TextDim,
            )
            if (hasLyrics) Pill(stringResource(R.string.music_lyrics), onClick = { vm.openNowPlaying(NowPlayingPanel.Lyrics) })
            Pill(stringResource(R.string.music_queue), onClick = { vm.openNowPlaying(NowPlayingPanel.Queue) })
            Pill(stringResource(if (music.playing) R.string.player_pause else R.string.player_play), onClick = music::toggle, accent = true)
        }
    }
}
