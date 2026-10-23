package app.jellyflix.tv.ui

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.R
import app.jellyflix.tv.data.MediaItem
import androidx.compose.ui.platform.LocalContext
import coil3.SingletonImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jellyfin.sdk.model.api.BaseItemKind

private const val ROTATE_MS = 10_000L

/**
 * The banner at the top of Home: the newest titles and some random picks, one at a time with their backdrop. It turns
 * to the next one every ten seconds, unless the remote is on one of its buttons.
 */
@Composable
fun Hero(vm: AppViewModel, items: List<MediaItem>, modifier: Modifier = Modifier) {
    val state = vm.home
    HeroBanner(
        vm = vm,
        items = items,
        index = state.heroIndex.coerceIn(0, items.lastIndex),
        onIndex = { state.heroIndex = it },
        height = 400.dp,
        scrollToTop = { state.list.animateScrollToItem(0) },
        takesFirstFocus = true,
        modifier = modifier,
    )
}

/**
 * One banner: a title at a time with its backdrop, turning every ten seconds unless the remote is on one of its buttons. Home uses it
 * at 400 dp; Movies, Series and Anime use a lower one with the newest titles of their own. Its Play button is where the top bar's
 * Down goes. [takesFirstFocus]: the remote starts on it when the app opens (Home only).
 */
@Composable
fun HeroBanner(
    vm: AppViewModel,
    items: List<MediaItem>,
    index: Int,
    onIndex: (Int) -> Unit,
    height: Dp,
    scrollToTop: suspend () -> Unit,
    takesFirstFocus: Boolean,
    modifier: Modifier = Modifier,
    bottomPadding: Dp = 56.dp,
) {
    var focused by remember { mutableStateOf(false) }
    val playFocus = vm.contentEntry
    val scope = rememberCoroutineScope()

    // The remote starts on the banner's Play button (or where it was before a title page was opened from here).
    LaunchedEffect(items.size) {
        if (takesFirstFocus && !vm.initialFocusDone && vm.restoreTarget == null) {
            if (playFocus.requestFocusSoon()) vm.initialFocusDone = true
        }
    }
    LaunchedEffect(vm.restoreTarget, index) {
        val target = vm.restoreTarget
        if (target != null && target == items[index].id) {
            playFocus.requestFocusSoon()
            vm.restoreTarget = null
        }
    }
    // Load the next banner picture ahead of time so the slide changes without a blank moment.
    val context = LocalContext.current
    LaunchedEffect(index, items) {
        val next = items.getOrNull((index + 1) % items.size)?.backdropUrl ?: return@LaunchedEffect
        SingletonImageLoader.get(context).enqueue(ImageRequest.Builder(context).data(next).build())
    }
    LaunchedEffect(index, focused, items.size) {
        if (!focused && items.size > 1) {
            delay(ROTATE_MS)
            onIndex((index + 1) % items.size)
        }
    }

    Box(modifier.fillMaxWidth().height(height)) {
        Crossfade(targetState = index, label = "hero") { i ->
            val item = items[i]
            Box(Modifier.fillMaxSize()) {
                AsyncImage(
                    model = item.backdropUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                // Left to right so the text reads, bottom to top so the rows below blend in.
                Box(
                    Modifier.fillMaxSize().background(
                        Brush.horizontalGradient(listOf(Color(0xF2000000), Color(0x99000000), Color.Transparent), endX = 1500f),
                    ),
                )
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Transparent, Palette.Black))))
                // A long title takes two lines: then the label goes and the description gets two lines, so the text never grows up under the top bar.
                var titleLines by remember(item.id) { mutableStateOf(1) }
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 48.dp, top = ContentTop, bottom = bottomPadding)
                        .width(560.dp)
                        .onFocusChanged {
                            focused = it.hasFocus
                            // The banner is always shown whole when the remote is on it (the list would otherwise scroll it away).
                            if (it.hasFocus) scope.launch { delay(16); scrollToTop() }
                        },
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (titleLines == 1) Chip(stringResource(if (item.kind == BaseItemKind.SERIES) R.string.hero_kind_series else R.string.hero_kind_movie))
                    Text(
                        item.title, fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 2,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        onTextLayout = { titleLines = it.lineCount },
                    )
                    factsLine(item)?.let { Text(it, fontSize = 14.sp, color = Color(0xFFD0D0D0)) }
                    item.overview?.takeIf { it.isNotBlank() }?.let {
                        Text(it, fontSize = 14.sp, color = Color(0xFFDDDDDD), maxLines = if (titleLines > 1) 2 else 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    }
                    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Pill(
                            stringResource(R.string.play),
                            onClick = { vm.lastFocused = item.id; vm.play(item) },
                            accent = true,
                            modifier = Modifier.focusRequester(playFocus).onFocusChanged { if (it.isFocused) vm.lastFocused = item.id },
                        )
                        Pill(
                            stringResource(R.string.hero_more_info),
                            onClick = { vm.lastFocused = item.id; vm.open(item) },
                            modifier = Modifier.onFocusChanged { if (it.isFocused) vm.lastFocused = item.id },
                        )
                    }
                }
            }
        }
        // Which of the titles is showing.
        if (items.size > 1) {
            Row(
                Modifier.align(Alignment.BottomEnd).padding(end = 48.dp, bottom = 62.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items.indices.forEach { i ->
                    Box(
                        Modifier
                            .size(width = if (i == index) 22.dp else 8.dp, height = 8.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (i == index) Palette.Accent else Color(0x66FFFFFF)),
                    )
                }
            }
        }
    }
}

/** "2019 · 1 h 45 min · NC-17 · ★ 8.2 · Animation, Adventure" from whatever the server knows. */
@Composable
fun factsLine(item: MediaItem): String? {
    val parts = buildList {
        if (item.kind != BaseItemKind.EPISODE) item.year?.let { add(it.toString()) }
        item.runtimeMinutes?.let { minutes ->
            add(
                if (minutes >= 60) stringResource(R.string.hours_minutes, minutes / 60, minutes % 60)
                else stringResource(R.string.minutes, minutes),
            )
        }
        item.officialRating?.let { add(it) }
        item.rating?.let { add("★ " + "%.1f".format(it)) }
        if (item.genres.isNotEmpty()) add(item.genres.take(3).joinToString(", "))
    }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}
