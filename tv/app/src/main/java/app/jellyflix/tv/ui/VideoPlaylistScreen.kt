package app.jellyflix.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.PlaylistContext
import app.jellyflix.tv.R
import app.jellyflix.tv.VideoPlaylistState
import coil3.compose.AsyncImage

/**
 * A playlist of movies and episodes: its titles in order. Play all starts the first and goes on to the next one when each ends.
 * Long-pressing OK on a title offers to remove it or move it earlier or later.
 */
@Composable
fun VideoPlaylistScreen(vm: AppViewModel, state: VideoPlaylistState) {
    val entries = state.entries
    val play = remember { FocusRequester() }
    LaunchedEffect(state, entries?.isNotEmpty()) { if (entries?.isNotEmpty() == true) play.requestFocusSoon() }
    Row(Modifier.fillMaxSize().padding(start = 48.dp), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        Column(Modifier.width(280.dp).padding(top = 56.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.width(200.dp).aspectRatio(1f).clip(RoundedCornerShape(16.dp)).background(Palette.Surface)) {
                AsyncImage(
                    model = state.playlist.imageUrl ?: entries?.firstOrNull()?.item?.posterUrl,
                    contentDescription = state.playlist.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Text(state.playlist.name, fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 3)
            (entries?.size ?: state.playlist.itemCount)?.let { Text(titlesLabel(it), fontSize = 14.sp, color = Palette.TextDim) }
            Pill(
                stringResource(R.string.playlist_play_all),
                onClick = { vm.playPlaylist(state) },
                accent = true,
                modifier = Modifier.padding(top = 8.dp).focusRequester(play),
            )
            Pill(stringResource(R.string.playlist_delete), onClick = { vm.confirmDeletePlaylist(state) })
        }
        when {
            entries == null -> Hint(stringResource(R.string.loading), Modifier.padding(top = 56.dp))
            entries.isEmpty() -> Hint(stringResource(R.string.playlist_empty), Modifier.padding(top = 56.dp))
            else -> LazyVerticalGrid(
                columns = GridCells.Fixed(Posters.columns(4)),
                contentPadding = PaddingValues(top = 56.dp, end = 48.dp, bottom = 40.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
                modifier = Modifier.weight(1f).fillMaxSize(),
            ) {
                items(entries.size, key = { entries[it].entryId }) { index ->
                    val entry = entries[index]
                    MediaCard(
                        item = entry.item,
                        landscape = false,
                        fillWidth = true,
                        onClick = { vm.open(entry.item) },
                        onLongClick = { vm.openCardMenu(entry.item, PlaylistContext(state, entry)) },
                    )
                }
            }
        }
    }
}
