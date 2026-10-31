package app.jellyflix.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import org.jellyfin.sdk.model.api.BaseItemKind
import app.jellyflix.tv.ui.AlbumScreen
import app.jellyflix.tv.ui.AppTheme
import app.jellyflix.tv.ui.ArtistScreen
import app.jellyflix.tv.ui.CollectionScreen
import app.jellyflix.tv.ui.DetailScreen
import app.jellyflix.tv.ui.StatsScreen
import app.jellyflix.tv.ui.DialogHost
import app.jellyflix.tv.ui.LocalCardMenu
import app.jellyflix.tv.ui.VideoPlaylistScreen
import app.jellyflix.tv.ui.MainScreen
import app.jellyflix.tv.ui.NowPlayingScreen
import app.jellyflix.tv.ui.Palette
import app.jellyflix.tv.ui.PersonScreen
import app.jellyflix.tv.ui.PlayerActions
import app.jellyflix.tv.ui.PlayerScreen
import app.jellyflix.tv.ui.PlaylistScreen
import app.jellyflix.tv.ui.SignInScreen

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleLink(intent)
        // The chosen background from the first frame, also behind the window itself.
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Palette.Black.toArgb()))
        setContent {
            AppTheme(textScale = vm.settings.textSize.scale) {
                val canvas = Palette.Black
                SideEffect { window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(canvas.toArgb())) }
                // Back closes a page or goes to Home; on Home it falls through and leaves the app.
                BackHandler(enabled = vm.signedIn && (vm.pages.isNotEmpty() || vm.tab != Tab.Home)) { vm.back() }
                // The screen margin (Settings, Display) keeps everything off the edge a TV may cut off. The video fills the screen
                // anyway, so the player gets the margin to keep its own controls and subtitles inside.
                BoxWithConstraints(Modifier.fillMaxSize().background(Palette.Black)) {
                    val insetX = maxWidth * vm.settings.margin.fraction
                    val insetY = maxHeight * vm.settings.margin.fraction
                    val playing = vm.signedIn && vm.pages.lastOrNull() is Page.Player
                    Box(Modifier.fillMaxSize().then(if (playing) Modifier else Modifier.padding(horizontal = insetX, vertical = insetY))) {
                        CompositionLocalProvider(LocalCardMenu provides { item -> vm.openCardMenu(item) }) {
                            Content(insetX, insetY)
                        }
                        BusyIndicator()
                        ErrorBanner()
                        NoticeBanner()
                        DialogHost(vm)
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLink(intent)
    }

    /** `jellyflix://play/<id>` comes from the Google TV home screen row: play that title. */
    private fun handleLink(intent: android.content.Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "jellyflix" || data.host != "play") return
        val id = runCatching { java.util.UUID.fromString(data.lastPathSegment) }.getOrNull() ?: return
        intent.data = null
        vm.playFromLink(id)
    }

    /** The remote's media keys drive the music, except while a video is playing (it handles them itself). */
    override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent): Boolean {
        val music = vm.music
        if (music != null && music.hasQueue && vm.pages.lastOrNull() !is Page.Player) {
            when (keyCode) {
                android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> music.toggle()
                android.view.KeyEvent.KEYCODE_MEDIA_PLAY -> if (!music.playing) music.toggle()
                android.view.KeyEvent.KEYCODE_MEDIA_PAUSE -> if (music.playing) music.toggle()
                android.view.KeyEvent.KEYCODE_MEDIA_NEXT -> music.next()
                android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS -> music.previous()
                android.view.KeyEvent.KEYCODE_MEDIA_STOP -> music.stop()
                else -> return super.onKeyDown(keyCode, event)
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    @Composable
    private fun Content(insetX: Dp, insetY: Dp) {
        if (!vm.signedIn) {
            SignInScreen(
                initialServer = vm.lastServer,
                busy = vm.busy,
                quickCode = vm.quickCode,
                onQuickConnect = vm::startQuickConnect,
                onCancelQuickConnect = vm::cancelQuickConnect,
                error = vm.errorRes?.let { stringResource(it) } ?: vm.errorText,
                onSignIn = vm::signIn,
            )
            return
        }
        when (val page = vm.pages.lastOrNull()) {
            null -> MainScreen(vm)
            is Page.Detail -> DetailScreen(vm, page.state)
            is Page.Collection -> CollectionScreen(vm, page.state)
            is Page.Person -> PersonScreen(vm, page.state)
            is Page.Album -> AlbumScreen(vm, page.state)
            is Page.Artist -> ArtistScreen(vm, page.state)
            is Page.Playlist -> PlaylistScreen(vm, page.state)
            is Page.VideoPlaylist -> VideoPlaylistScreen(vm, page.state)
            is Page.Stats -> StatsScreen(vm, page.state)
            Page.NowPlaying -> NowPlayingScreen(vm)
            is Page.Player -> key(page.plan) {
                PlayerScreen(
                    plan = page.plan,
                    accessToken = vm.accessToken,
                    settings = vm.settings,
                    insetX = insetX,
                    insetY = insetY,
                    commands = vm.playerCommands,
                    actions = PlayerActions(
                        onStart = { vm.reportStart(page.plan, it) },
                        onProgress = { position, paused -> vm.reportProgress(page.plan, position, paused) },
                        onStopped = { vm.reportStopped(page.plan, it) },
                        onChangeTracks = { audio, subtitle, position -> vm.changeTracks(page.plan, audio, subtitle, position) },
                        onFallback = { position -> vm.changeTracks(page.plan, null, null, position, directAllowed = false) },
                        loadSegments = { vm.segments(page.plan.item) },
                        loadChapters = { vm.chapters(page.plan.item) },
                        loadTrickplay = { vm.trickplay(page.plan) },
                        onEnded = {
                            val continues = page.plan.item.kind == BaseItemKind.EPISODE || vm.hasNextInPlaylist(page.plan.item)
                            if (continues && vm.autoplayNext) vm.playNext(page.plan) else vm.back()
                        },
                        onNextEpisode = { vm.playNext(page.plan) },
                        onExit = { vm.back() },
                        onChannelStep = { vm.stepChannel(page.plan, it) },
                        onSearchSubtitles = { vm.searchSubtitles(page.plan, it) },
                        loadSeasons = { vm.seasonsOf(page.plan.item) },
                        loadEpisodes = { seasonId -> vm.episodesOf(page.plan.item, seasonId) },
                        onPlayEpisode = { vm.playEpisode(it) },
                    ),
                )
            }
        }
    }

    /** Starting a video asks the server first, which takes a moment: show that something is happening. */
    @Composable
    private fun BusyIndicator() {
        if (!vm.signedIn || !vm.busy) return
        Box(Modifier.fillMaxSize().background(Color(0x99000000)), contentAlignment = Alignment.Center) {
            androidx.compose.material3.CircularProgressIndicator(color = Palette.Accent, strokeWidth = 5.dp, modifier = Modifier.size(56.dp))
        }
    }

    /** A short confirmation over the current screen ("Added to Watch later"). */
    @Composable
    private fun NoticeBanner() {
        if (!vm.signedIn) return
        val message = vm.notice ?: return
        LaunchedEffect(message) {
            delay(3_500)
            vm.dismissNotice()
        }
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.BottomCenter) {
            Text(
                message,
                color = Color.White,
                fontSize = 16.sp,
                modifier = Modifier
                    .background(Palette.Surface3.copy(alpha = 0.95f), androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
                    .padding(horizontal = 22.dp, vertical = 12.dp),
            )
        }
    }

    /** A short message over the current screen (playback could not start, a list could not load...). */
    @Composable
    private fun ErrorBanner() {
        if (!vm.signedIn) return
        val message = vm.errorRes?.let { stringResource(it) } ?: vm.errorText ?: return
        if (message.isBlank()) return
        // It goes away on its own; the remote does not need to hunt for a button.
        LaunchedEffect(message) {
            delay(7_000)
            vm.dismissError()
        }
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.BottomCenter) {
            androidx.tv.material3.Surface(
                onClick = vm::dismissError,
                colors = androidx.tv.material3.ClickableSurfaceDefaults.colors(containerColor = Color(0xFF2A1215)),
            ) {
                Text(
                    message + "   ·   " + stringResource(R.string.dismiss),
                    color = Color(0xFFFFB4B4),
                    fontSize = 15.sp,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }
        }
    }
}
