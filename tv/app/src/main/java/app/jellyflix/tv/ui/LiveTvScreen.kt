package app.jellyflix.tv.ui

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.R
import app.jellyflix.tv.data.TvChannel
import app.jellyflix.tv.data.TvProgram
import kotlinx.coroutines.delay
import java.util.Date

/** "9:30 PM" or "21:30": a moment as the TV's own clock would show it. */
@Composable
private fun clock(ms: Long): String = DateFormat.getTimeFormat(LocalContext.current).format(Date(ms))

/**
 * Live TV: the channels as cards with what is on each (OK watches), or the guide, a list of channels with what is on now and what
 * comes next. A page of channels is read at a time, and the next one when the end is near.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun LiveTvScreen(vm: AppViewModel) {
    val state = vm.liveTv
    // What is "on now" is worked out from the clock, which moves on while the page is open.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    LaunchedEffect(state.guide) {
        snapshotFlow {
            if (state.guide) state.list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            else state.grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
        }.collect { last -> if (last >= state.channels.size - 8) vm.loadLiveTv() }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 48.dp, end = 48.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Pill(
                stringResource(R.string.live_channels),
                onClick = { vm.showGuide(false) },
                selected = !state.guide,
                modifier = Modifier.focusRequester(vm.contentEntry),
            )
            Pill(stringResource(R.string.live_guide), onClick = { vm.showGuide(true) }, selected = state.guide)
            Pill(stringResource(R.string.live_favorites), onClick = { vm.toggleLiveFavorites() }, selected = state.favoritesOnly)
        }
        when {
            !state.loaded && state.loading -> Hint(stringResource(R.string.loading))
            state.loaded && state.channels.isEmpty() -> Hint(stringResource(if (state.favoritesOnly) R.string.live_no_favorites else R.string.live_empty))
            state.guide -> GuideList(vm, now)
            else -> ChannelGrid(vm, now)
        }
    }
}

@Composable
private fun ChannelGrid(vm: AppViewModel, now: Long) {
    val state = vm.liveTv
    LazyVerticalGrid(
        columns = GridCells.Fixed(Posters.columns(4)),
        state = state.grid,
        contentPadding = PaddingValues(start = 48.dp, end = 48.dp, bottom = 40.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(state.channels.size, key = { state.channels[it].id }) { index ->
            val channel = state.channels[index]
            val program = channel.onAt(now)
            MediaCard(
                item = channel.item,
                landscape = true,
                fillWidth = true,
                title = channel.label,
                subtitle = program?.let { "${it.title} · ${clock(it.startMs)} – ${clock(it.endMs)}" } ?: stringResource(R.string.live_no_info),
                onClick = { vm.watch(channel) },
                restoreFocusTo = vm.restoreTarget,
                onRestored = { vm.restoreTarget = null },
                onFocused = { vm.lastFocused = it },
            )
        }
        if (state.loading) item(span = { GridItemSpan(maxLineSpan) }) { Hint(stringResource(R.string.loading)) }
    }
}

/** A row for each channel: its name, what is on with how far it is, and what comes next. OK watches the channel. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun GuideList(vm: AppViewModel, now: Long) {
    val state = vm.liveTv
    LazyColumn(
        state = state.list,
        contentPadding = PaddingValues(start = 48.dp, end = 48.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(state.channels, key = { it.id }) { channel ->
            GuideRow(channel, channel.onAt(now), state.upNext[channel.id], now, onClick = { vm.watch(channel) })
        }
        if (state.loading) item { Hint(stringResource(R.string.loading)) }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun GuideRow(channel: TvChannel, current: TvProgram?, next: TvProgram?, now: Long, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(12.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Palette.Surface,
            contentColor = Color.White,
            focusedContainerColor = Palette.Surface3,
            focusedContentColor = Color.White,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(channel.label, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(240.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (current != null) {
                    Text(
                        "${current.title} · ${clock(current.startMs)} – ${clock(current.endMs)}",
                        fontSize = 16.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Box(Modifier.fillMaxWidth().height(4.dp).background(Color(0x55FFFFFF))) {
                        Box(Modifier.fillMaxWidth(current.progressAt(now)).height(4.dp).background(Palette.Accent))
                    }
                } else {
                    Text(stringResource(R.string.live_no_info), fontSize = 15.sp, color = Palette.TextDim)
                }
            }
            Text(
                next?.let { stringResource(R.string.live_next, it.title, clock(it.startMs)) }.orEmpty(),
                fontSize = 14.sp,
                color = Palette.TextDim,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.width(300.dp),
            )
        }
    }
}
