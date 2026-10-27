package app.jellyflix.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.DetailState
import app.jellyflix.tv.R
import coil3.compose.AsyncImage
import org.jellyfin.sdk.model.api.BaseItemKind

/** Artwork behind a title page, dark on the left where the text sits and at the bottom where the rows start. */
@Composable
private fun Backdrop(url: String?) {
    AsyncImage(
        model = url,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier.fillMaxSize().alpha(0.5f),
    )
    Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Palette.Black, Palette.Black.copy(alpha = 0.85f), Palette.Black.copy(alpha = 0.2f)))))
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Transparent, Palette.Black))))
}

/** A movie, an episode or a series: artwork, facts, the actions, and for a series its seasons and episodes. */
@Composable
fun DetailScreen(vm: AppViewModel, state: DetailState) {
    val item = state.full
    val playButton = remember { FocusRequester() }
    LaunchedEffect(state) { playButton.requestFocusSoon() }
    val isSeries = item.kind == BaseItemKind.SERIES

    Box(Modifier.fillMaxSize()) {
        Backdrop(item.backdropUrl ?: item.landscapeUrl)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = 56.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            item {
                Column(
                    modifier = Modifier.width(720.dp).padding(start = 48.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(item.title, fontSize = 38.sp, lineHeight = 44.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    if (item.kind == BaseItemKind.EPISODE) {
                        Text(item.subtitle.orEmpty(), fontSize = 18.sp, color = Color(0xFFDDDDDD))
                    }
                    item.artist?.let { Text(it, fontSize = 20.sp, fontWeight = FontWeight.Medium, color = Color(0xFFDDDDDD)) }
                    factsLine(item)?.let { Text(it, fontSize = 15.sp, color = Palette.TextDim) }
                    item.overview?.takeIf { it.isNotBlank() }?.let {
                        Text(it, fontSize = 16.sp, color = Color(0xFFDDDDDD), maxLines = 5, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                    }
                    Actions(vm, state, playButton)
                    state.collection?.let { collection ->
                        Pill(
                            stringResource(R.string.detail_collection, collection.title),
                            onClick = { vm.open(collection) },
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
            if (isSeries) {
                if (state.seasons.size > 1) {
                    item {
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 48.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            items(state.seasons.size) { index ->
                                val season = state.seasons[index]
                                val number = season.episodeNumber ?: (index + 1)
                                Pill(
                                    text = season.name.ifBlank { stringResource(R.string.season_number, number) },
                                    onClick = { vm.selectSeason(state, season) },
                                    selected = state.selectedSeason?.id == season.id,
                                )
                            }
                        }
                    }
                }
                item { Episodes(vm, state) }
            }
            if (item.cast.isNotEmpty()) item { CastRow(vm, item.cast) }
        }
    }
}

/** The people credited on a title; choosing one lists what else they are in. */
@Composable
private fun CastRow(vm: AppViewModel, cast: List<app.jellyflix.tv.data.CastMember>) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(stringResource(R.string.cast_title))
        LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(cast.size, key = { "${cast[it].id}-$it" }) { index ->
                val person = cast[index]
                CoverCard(person.id, person.name, person.role, person.imageUrl, onClick = { vm.openPerson(person) }, round = true, size = 120.dp)
            }
        }
    }
}

@Composable
private fun Actions(vm: AppViewModel, state: DetailState, playButton: FocusRequester) {
    val item = state.full
    val isSeries = item.kind == BaseItemKind.SERIES
    val next = state.nextEpisode
    if (item.isBook || item.isAudiobook) {
        BookActions(vm, state, playButton)
        return
    }
    val playLabel = when {
        isSeries && next != null -> stringResource(R.string.play_next, "S${next.seasonNumber ?: 1} E${next.episodeNumber ?: 1}")
        !isSeries && item.resumeMs > 0 -> stringResource(R.string.resume_from, formatTime(item.resumeMs))
        else -> stringResource(R.string.play)
    }
    // A title with several files (1080p and 4K): the one chosen below is the one that plays.
    val versions = item.versions
    val version = state.version ?: versions.firstOrNull()?.id
    Row(
        modifier = Modifier.padding(top = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Pill(playLabel, onClick = { vm.play(item, mediaSourceId = version) }, accent = true, modifier = Modifier.focusRequester(playButton))
        if (!isSeries && item.resumeMs > 0) {
            Pill(stringResource(R.string.start_over), onClick = { vm.play(item, startMs = 0, mediaSourceId = version) })
        }
        Pill(
            stringResource(if (item.played) R.string.mark_unwatched else R.string.mark_watched),
            onClick = { vm.toggleWatched(state) },
        )
        Pill(
            stringResource(if (item.favorite) R.string.remove_favorite else R.string.add_favorite),
            onClick = { vm.toggleFavorite(state) },
        )
    }
    if (versions.size > 1) {
        Row(
            modifier = Modifier.padding(top = 4.dp),
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(stringResource(R.string.version_title), fontSize = 15.sp, color = Palette.TextDim)
            versions.forEach { option ->
                Pill(option.label, onClick = { state.version = option.id }, selected = option.id == version)
            }
        }
    }
    PlaysAsLine(item, version)
}

/** A book or an audiobook: an audiobook is listened to (the music player takes it up where it was left); a book to read is for the web app or a phone. */
@Composable
private fun BookActions(vm: AppViewModel, state: DetailState, firstButton: FocusRequester) {
    val item = state.full
    Row(modifier = Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (item.isAudiobook) {
            val label = if (item.resumeMs > 0) stringResource(R.string.resume_from, formatTime(item.resumeMs)) else stringResource(R.string.listen)
            Pill(label, onClick = { vm.listen(item) }, accent = true, modifier = Modifier.focusRequester(firstButton))
            if (item.resumeMs > 0) Pill(stringResource(R.string.start_over), onClick = { vm.listen(item, 0) })
        }
        Pill(
            stringResource(
                when {
                    item.isAudiobook -> if (item.played) R.string.mark_not_listened else R.string.mark_listened
                    else -> if (item.played) R.string.mark_book_unread else R.string.mark_book_read
                },
            ),
            onClick = { vm.toggleWatched(state) },
            accent = item.isBook,
            modifier = if (item.isBook) Modifier.focusRequester(firstButton) else Modifier,
        )
        Pill(
            stringResource(if (item.favorite) R.string.remove_favorite else R.string.add_favorite),
            onClick = { vm.toggleFavorite(state) },
        )
    }
    if (item.isBook) {
        Text(
            stringResource(R.string.book_hint, item.format?.uppercase() ?: stringResource(R.string.book_kind)),
            fontSize = 15.sp,
            color = Palette.TextDim,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

/** One line under the buttons that says what Play will give: the picture, the audio it starts with and how many subtitle tracks there are. */
@Composable
private fun PlaysAsLine(item: app.jellyflix.tv.data.MediaItem, version: String?) {
    val facts = item.playsAs[version] ?: item.playsAs.values.firstOrNull() ?: return
    val subtitles = when (facts.subtitles) {
        0 -> null
        1 -> stringResource(R.string.subtitle_tracks_one)
        else -> stringResource(R.string.subtitle_tracks, facts.subtitles)
    }
    // Each fact stays on one line; the line breaks between them.
    val parts = listOfNotNull(facts.video, facts.audio, subtitles).map { it.replace(' ', ' ') }
    if (parts.isEmpty()) return
    Text(
        "${stringResource(R.string.plays_as)}  ${parts.joinToString("  ·  ")}",
        fontSize = 14.sp,
        color = Palette.TextDim,
        modifier = Modifier.padding(top = 4.dp),
    )
}

@Composable
private fun Episodes(vm: AppViewModel, state: DetailState) {
    val episodes = state.episodes
    when {
        episodes == null -> Hint(stringResource(R.string.loading))
        episodes.isEmpty() -> Hint(stringResource(R.string.library_empty))
        else -> LazyRow(
            contentPadding = PaddingValues(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(episodes.size, key = { episodes[it].id }) { index ->
                val episode = episodes[index]
                MediaCard(
                    item = episode,
                    landscape = true,
                    onClick = { vm.play(episode) },
                    title = "${episode.episodeNumber ?: index + 1}. ${episode.name}",
                    subtitle = episode.runtimeMinutes?.let { stringResource(R.string.minutes, it) },
                )
            }
        }
    }
}

/** A collection (a saga, a box set): its description and the titles inside, in release order. */
@Composable
fun CollectionScreen(vm: AppViewModel, state: DetailState) {
    val item = state.full
    val members = state.members
    val playButton = remember { FocusRequester() }
    // Play starts what you left half-way, else the first you have not watched, else the first.
    val target = members?.filter { it.isPlayable }?.let { list -> list.firstOrNull { it.resumeMs > 0 } ?: list.firstOrNull { !it.played } ?: list.firstOrNull() }
    LaunchedEffect(state) { playButton.requestFocusSoon() }

    Box(Modifier.fillMaxSize()) {
        Backdrop(item.backdropUrl ?: item.landscapeUrl)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = 56.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            item {
                Column(
                    modifier = Modifier.width(720.dp).padding(start = 48.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Chip(stringResource(R.string.nav_collections))
                    Text(item.title, fontSize = 38.sp, lineHeight = 44.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    (members?.size ?: item.childCount)?.let {
                        Text(titlesLabel(it), fontSize = 15.sp, color = Palette.TextDim)
                    }
                    item.overview?.takeIf { it.isNotBlank() }?.let {
                        Text(it, fontSize = 16.sp, color = Color(0xFFDDDDDD), maxLines = 5, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                    }
                    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Pill(
                            stringResource(R.string.collection_play),
                            // It goes on to the next title of the collection when one ends, like a playlist.
                            onClick = { target?.let { vm.playThrough(members.orEmpty(), it) } },
                            accent = true,
                            modifier = Modifier.focusRequester(playButton),
                        )
                    }
                }
            }
            item {
                when {
                    members == null -> Hint(stringResource(R.string.loading))
                    members.isEmpty() -> Hint(stringResource(R.string.library_empty))
                    else -> LazyRow(
                        contentPadding = PaddingValues(horizontal = 48.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        items(members.size, key = { members[it].id }) { index ->
                            val member = members[index]
                            MediaCard(item = member, landscape = false, onClick = { vm.open(member) })
                        }
                    }
                }
            }
        }
    }
}

fun formatTime(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
