package app.jellyflix.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.jellyflix.tv.AlbumPageState
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.ArtistPageState
import app.jellyflix.tv.PlaylistPageState
import app.jellyflix.tv.R
import app.jellyflix.tv.data.Song
import coil3.compose.AsyncImage

/** One song in a list: its number (or a note when it is the one playing), title, artist and length. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun SongRow(
    number: Int,
    song: Song,
    current: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    showAlbum: Boolean = false,
    /** Picked up to be moved (the queue's reorder mode). */
    lifted: Boolean = false,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(10.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (lifted) Palette.Accent.copy(alpha = 0.3f) else Color.Transparent,
            contentColor = Color.White,
            focusedContainerColor = if (lifted) Palette.Accent.copy(alpha = 0.45f) else Palette.Surface4,
            focusedContentColor = Color.White,
        ),
        border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(2.dp, Palette.Accent), shape = RoundedCornerShape(10.dp))),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(
                if (current) "♪" else number.toString(),
                fontSize = 15.sp,
                color = if (current) Palette.Accent else Palette.TextDim,
                modifier = Modifier.width(28.dp),
            )
            Column(Modifier.weight(1f)) {
                Text(song.name, fontSize = 16.sp, color = if (current) Palette.Accent else Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (showAlbum && song.album.isNotBlank()) "${song.artist} · ${song.album}" else song.artist,
                    fontSize = 12.sp,
                    color = Palette.TextDim,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            song.durationMs?.let { Text(formatTime(it), fontSize = 14.sp, color = Palette.TextDim) }
        }
    }
}

@Composable
private fun SongList(vm: AppViewModel, songs: List<Song>?, firstFocus: FocusRequester? = null, showAlbum: Boolean = false) {
    val music = vm.music
    when {
        songs == null -> Hint(stringResource(R.string.loading))
        songs.isEmpty() -> Hint(stringResource(R.string.library_empty))
        else -> LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = 56.dp, bottom = 40.dp, end = 48.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(songs.size, key = { songs[it].id }) { index ->
                val song = songs[index]
                SongRow(
                    number = song.trackNumber ?: (index + 1),
                    song = song,
                    current = music?.current?.id == song.id && music.playing,
                    onClick = { vm.playSongs(songs, index) },
                    showAlbum = showAlbum,
                )
            }
        }
    }
}

/** The cover and facts on the left, the songs on the right. */
@Composable
private fun CoverAndSongs(
    cover: String?,
    round: Boolean,
    title: String,
    lines: List<String>,
    actions: @Composable () -> Unit,
    songs: @Composable () -> Unit,
) {
    Row(Modifier.fillMaxSize().padding(start = 48.dp), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        Column(Modifier.width(300.dp).padding(top = 56.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier
                    .width(260.dp)
                    .aspectRatio(1f)
                    .clip(if (round) CircleShape else RoundedCornerShape(14.dp))
                    .background(Palette.Surface),
            ) {
                AsyncImage(model = cover, contentDescription = title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Text(title, fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 3, overflow = TextOverflow.Ellipsis)
            lines.forEach { Text(it, fontSize = 14.sp, color = Palette.TextDim, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) { actions() }
        }
        Box(Modifier.weight(1f)) { songs() }
    }
}

private fun Modifier.background(color: Color) = this.then(Modifier.background(color))

@Composable
fun AlbumScreen(vm: AppViewModel, state: AlbumPageState) {
    val album = state.full
    val tracks = state.tracks
    val play = remember { FocusRequester() }
    LaunchedEffect(state) { play.requestFocusSoon() }
    CoverAndSongs(
        cover = album.coverUrl,
        round = false,
        title = album.name,
        lines = listOfNotNull(album.artist, album.year?.toString(), tracks?.size?.let { stringResource(R.string.music_songs, it) }),
        actions = {
            Pill(stringResource(R.string.music_play_album), onClick = { tracks?.let { vm.playSongs(it) } }, accent = true, modifier = Modifier.focusRequester(play))
            Pill(stringResource(R.string.music_shuffle), onClick = { tracks?.let { vm.playSongs(it, shuffle = true) } })
            Pill(stringResource(R.string.music_radio), onClick = { vm.playRadio(album.id) })
        },
        songs = { SongList(vm, tracks) },
    )
}

@Composable
fun PlaylistScreen(vm: AppViewModel, state: PlaylistPageState) {
    val playlist = state.playlist
    val tracks = state.tracks
    val play = remember { FocusRequester() }
    LaunchedEffect(state) { play.requestFocusSoon() }
    CoverAndSongs(
        cover = playlist.coverUrl,
        round = false,
        title = playlist.name,
        lines = listOfNotNull((tracks?.size ?: playlist.trackCount)?.let { stringResource(R.string.music_songs, it) }),
        actions = {
            Pill(stringResource(R.string.play), onClick = { tracks?.let { vm.playSongs(it) } }, accent = true, modifier = Modifier.focusRequester(play))
            Pill(stringResource(R.string.music_shuffle), onClick = { tracks?.let { vm.playSongs(it, shuffle = true) } })
        },
        songs = { SongList(vm, tracks, showAlbum = true) },
    )
}

@Composable
fun ArtistScreen(vm: AppViewModel, state: ArtistPageState) {
    val artist = state.full
    val popular = state.popular
    val albums = state.albums
    val play = remember { FocusRequester() }
    LaunchedEffect(state) { play.requestFocusSoon() }
    Row(Modifier.fillMaxSize().padding(start = 48.dp), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        Column(Modifier.width(300.dp).padding(top = 56.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.width(220.dp).aspectRatio(1f).clip(CircleShape).background(Palette.Surface)) {
                AsyncImage(model = artist.imageUrl, contentDescription = artist.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Text(artist.name, fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 3, overflow = TextOverflow.Ellipsis)
            artist.overview?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = Palette.TextDim, maxLines = 6, overflow = TextOverflow.Ellipsis) }
            Pill(
                stringResource(R.string.music_shuffle),
                onClick = { popular?.let { vm.playSongs(it, shuffle = true) } },
                accent = true,
                modifier = Modifier.padding(top = 8.dp).focusRequester(play),
            )
            Pill(stringResource(R.string.music_radio), onClick = { vm.playRadio(artist.id) })
        }
        LazyColumn(Modifier.weight(1f).fillMaxSize(), contentPadding = PaddingValues(top = 56.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            if (!popular.isNullOrEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.music_popular), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                        popular.take(5).forEachIndexed { index, song ->
                            SongRow(index + 1, song, current = vm.music?.current?.id == song.id && vm.music?.playing == true, onClick = { vm.playSongs(popular, index) }, showAlbum = true)
                        }
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.music_albums_of), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    when {
                        albums == null -> Hint(stringResource(R.string.loading))
                        albums.isEmpty() -> Hint(stringResource(R.string.library_empty))
                        else -> LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(end = 48.dp)) {
                            items(albums, key = { it.id }) { album ->
                                CoverCard(album.id, album.name, album.year?.toString(), album.coverUrl, onClick = { vm.openAlbum(album) })
                            }
                        }
                    }
                }
            }
        }
    }
}
