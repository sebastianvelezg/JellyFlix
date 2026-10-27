package app.jellyflix.tv.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import coil3.compose.AsyncImage
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.MusicView
import app.jellyflix.tv.PagedList
import app.jellyflix.tv.Pick
import app.jellyflix.tv.R
import app.jellyflix.tv.data.Album
import app.jellyflix.tv.data.AlbumSort

/** The Music section: an overview with rows, and the full lists of albums, artists and playlists. */
@Composable
fun MusicScreen(vm: AppViewModel) {
    LaunchedEffect(Unit) { vm.loadMusic() }
    // Going back up (to this row or the top bar) shows the first card whole, not cut off at the top.
    var choicesFocused by remember { mutableStateOf(false) }
    LaunchedEffect(vm.topBarFocused, choicesFocused) {
        if (vm.musicView == MusicView.Overview && (vm.topBarFocused || choicesFocused)) vm.musicHome.list.animateScrollToItem(0)
    }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp).onFocusChanged { choicesFocused = it.hasFocus },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            MusicView.entries.forEach { view ->
                Pill(
                    stringResource(view.label),
                    onClick = { vm.selectMusicView(view) },
                    selected = vm.musicView == view,
                    modifier = if (vm.musicView == view) Modifier.focusRequester(vm.contentEntry) else Modifier,
                )
            }
            Spacer(Modifier.weight(1f))
            Pill(stringResource(R.string.music_mix_day), onClick = vm::playDayMix)
            Pill(stringResource(R.string.music_shuffle_all), onClick = vm::shuffleEverything, accent = true)
        }
        when (vm.musicView) {
            MusicView.Overview -> Overview(vm)
            MusicView.Albums -> AlbumGrid(vm)
            MusicView.Artists -> ArtistGrid(vm)
            MusicView.Playlists -> PlaylistGrid(vm)
        }
    }
}

@Composable
private fun Overview(vm: AppViewModel) {
    val home = vm.musicHome
    LazyColumn(
        state = home.list,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 48.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        item(key = "hero") { MusicHero(vm, home.pick) }
        albumRow(vm, R.string.music_jump_back, home.jumpBack)
        albumRow(vm, R.string.music_new, home.newAlbums)
        albumRow(vm, R.string.music_try, home.tryThese)
    }
}

/**
 * The top of the music overview: a random album across the width, with its cover large and the cover itself, darkened, as the
 * background. Play album, Details and "another one" sit in a row.
 */
@Composable
private fun MusicHero(vm: AppViewModel, pick: Pick<Album>) {
    val album = (pick as? Pick.Ready)?.value
    Box(
        Modifier
            .padding(horizontal = 48.dp)
            .fillMaxWidth()
            .height(250.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.Surface2),
    ) {
        if (album?.coverUrl != null) {
            AsyncImage(
                model = album.coverUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().alpha(0.35f).blur(24.dp),
            )
            Box(
                Modifier.fillMaxSize().background(
                    Brush.horizontalGradient(listOf(Palette.Surface2.copy(alpha = 0.55f), Palette.Surface2.copy(alpha = 0.92f))),
                ),
            )
        }
        Row(Modifier.fillMaxSize().padding(20.dp), horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
            if (album != null) {
                AsyncImage(
                    model = album.coverUrl,
                    contentDescription = album.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxHeight().aspectRatio(1f).clip(RoundedCornerShape(14.dp)).background(Palette.Surface),
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip(stringResource(R.string.pick_music))
                when {
                    album != null -> {
                        Text(album.name, fontSize = 28.sp, lineHeight = 33.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(
                            listOfNotNull(album.artist, album.year?.toString()).joinToString(" · "),
                            fontSize = 15.sp,
                            color = Palette.TextDim,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Pill(stringResource(R.string.music_play_album), onClick = { vm.playAlbum(album) }, accent = true, centered = true, modifier = Modifier.width(190.dp))
                            Pill(stringResource(R.string.pick_details), onClick = { vm.openAlbum(album) }, centered = true, modifier = Modifier.width(130.dp))
                            IconPill(R.drawable.ic_refresh, stringResource(R.string.pick_another), onClick = vm::pickAlbum)
                        }
                    }
                    pick is Pick.Loading -> Text(stringResource(R.string.loading), fontSize = 15.sp, color = Palette.TextDim)
                    else -> {
                        Text(stringResource(R.string.library_empty), fontSize = 15.sp, color = Palette.TextDim)
                        Pill(stringResource(R.string.pick_another), onClick = vm::pickAlbum)
                    }
                }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.albumRow(vm: AppViewModel, title: Int, albums: List<Album>) {
    if (albums.isEmpty()) return
    item(key = title) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionTitle(stringResource(title))
            LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                items(albums.size, key = { albums[it].id }) { index ->
                    val album = albums[index]
                    CoverCard(
                        id = album.id,
                        title = album.name,
                        subtitle = album.artist,
                        imageUrl = album.coverUrl,
                        onClick = { vm.openAlbum(album) },
                        restoreFocusTo = vm.restoreTarget,
                        onRestored = { vm.restoreTarget = null },
                        onFocused = { vm.lastFocused = it },
                    )
                }
            }
        }
    }
}

/** Asks for the next page of a list when the last visible item is close to the end of what is loaded. */
@Composable
private fun <T> LoadMoreNear(list: PagedList<T>, loadMore: () -> Unit) {
    LaunchedEffect(list) {
        snapshotFlow { list.grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .collect { last -> if (last >= list.items.size - 18) loadMore() }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AlbumGrid(vm: AppViewModel) {
    val list = vm.albumList
    LoadMoreNear(list, vm::loadMoreAlbums)
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.padding(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            AlbumSort.entries.forEach { sort ->
                Pill(stringResource(sort.label), onClick = { vm.sortAlbums(sort) }, selected = vm.albumSort == sort)
            }
            if (list.total > 0) Text(titlesLabel(list.total), color = Palette.TextDim, fontSize = 14.sp, modifier = Modifier.padding(start = 12.dp))
        }
        ListBody(list) {
            LazyVerticalGrid(
                columns = GridCells.Fixed(Posters.columns(6)),
                state = list.grid,
                contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 8.dp, bottom = 48.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(list.items.size, key = { list.items[it].id }) { index ->
                    val album = list.items[index]
                    CoverCard(
                        id = album.id,
                        title = album.name,
                        subtitle = album.artist,
                        imageUrl = album.coverUrl,
                        onClick = { vm.openAlbum(album) },
                        fillWidth = true,
                        restoreFocusTo = vm.restoreTarget,
                        onRestored = { vm.restoreTarget = null },
                        onFocused = { vm.lastFocused = it },
                    )
                }
            }
        }
    }
}

@Composable
private fun ArtistGrid(vm: AppViewModel) {
    val list = vm.artistList
    LoadMoreNear(list, vm::loadMoreArtists)
    ListBody(list) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(Posters.columns(6)),
            state = list.grid,
            contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 8.dp, bottom = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(list.items.size, key = { list.items[it].id }) { index ->
                val artist = list.items[index]
                CoverCard(
                    id = artist.id,
                    title = artist.name,
                    subtitle = null,
                    imageUrl = artist.imageUrl,
                    onClick = { vm.openArtist(artist) },
                    round = true,
                    fillWidth = true,
                    restoreFocusTo = vm.restoreTarget,
                    onRestored = { vm.restoreTarget = null },
                    onFocused = { vm.lastFocused = it },
                )
            }
        }
    }
}

@Composable
private fun PlaylistGrid(vm: AppViewModel) {
    val list = vm.playlistList
    ListBody(list) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(Posters.columns(6)),
            state = list.grid,
            contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 8.dp, bottom = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(list.items.size, key = { list.items[it].id }) { index ->
                val playlist = list.items[index]
                CoverCard(
                    id = playlist.id,
                    title = playlist.name,
                    subtitle = playlist.trackCount?.let { stringResource(R.string.music_songs, it) },
                    imageUrl = playlist.coverUrl,
                    onClick = { vm.openPlaylist(playlist) },
                    fillWidth = true,
                    restoreFocusTo = vm.restoreTarget,
                    onRestored = { vm.restoreTarget = null },
                    onFocused = { vm.lastFocused = it },
                )
            }
        }
    }
}

/** A list's loading and empty states around its grid. */
@Composable
private fun <T> ListBody(list: PagedList<T>, content: @Composable () -> Unit) {
    when {
        !list.loaded && list.loading -> Hint(stringResource(R.string.loading))
        list.loaded && list.items.isEmpty() -> Hint(stringResource(R.string.library_empty))
        else -> content()
    }
}
