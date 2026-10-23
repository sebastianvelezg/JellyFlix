package app.jellyflix.tv.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.R
import app.jellyflix.tv.data.HomeRow
import app.jellyflix.tv.data.MediaItem
import app.jellyflix.tv.data.UpcomingEpisode
import app.jellyflix.tv.data.VideoPlaylist
import app.jellyflix.tv.data.daysUntil
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The main page, in the order of the web client: the banner, a random pick of something new, what you were watching,
 * and the latest of every library. Parts that the account does not have are left out; each appears as it loads.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HomeScreen(vm: AppViewModel) {
    val home = vm.home
    val libs = vm.libs
    val lineup = home.lineup
    val layout = vm.appearance.home

    // Rows that scroll into view stop below the top bar instead of sliding under it.
    val density = LocalDensity.current
    val spec = remember(density) { KeepBelowTopBar(with(density) { (TopBarHeight + 64.dp).toPx() }, with(density) { 88.dp.toPx() }) }
    CompositionLocalProvider(LocalBringIntoViewSpec provides spec) {
    LazyColumn(
        state = home.list,
        // Without the banner the top bar's Down enters the list: the first card on screen takes the focus.
        modifier = Modifier.fillMaxSize().then(if (vm.homeHasBanner) Modifier else Modifier.focusRequester(vm.contentEntry).focusGroup()),
        contentPadding = PaddingValues(bottom = 48.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        when {
            libs == null || lineup == null -> item { Column(Modifier.fillMaxWidth().height(400.dp)) {} }
            libs.isEmpty -> item { Hint(stringResource(R.string.no_libraries), Modifier.padding(top = 96.dp)) }
            lineup.isNotEmpty() && layout.banner -> item { Hero(vm, lineup) }
            // No banner: leave room for the top bar.
            else -> item { Column(Modifier.fillMaxWidth().height(if (layout.banner) 80.dp else 104.dp)) {} }
        }
        if (libs != null && libs.hasVideo) {
            // The rows come in the order chosen in Settings, Appearance; the ones turned off are not drawn.
            for (id in layout.visible) when (id) {
                HomeRow.Discover -> item(key = "discover") { Discover(vm) }
                HomeRow.Continue -> row(vm, R.string.row_continue, home.continueRow, landscape = true)
                HomeRow.NextUp -> row(vm, R.string.row_next_up, home.nextUp, landscape = true)
                HomeRow.NewSinceVisit -> row(vm, R.string.row_since_visit, home.sinceVisit)
                HomeRow.Upcoming -> if (home.upcoming.isNotEmpty()) item(key = "upcoming") { UpcomingRow(vm, home.upcoming) }
                HomeRow.WatchLater -> row(vm, R.string.row_watch_later, home.watchLater)
                HomeRow.Playlists -> if (home.playlists.isNotEmpty()) item(key = "playlists") { PlaylistsRow(vm, home.playlists) }
                HomeRow.Because -> home.because?.let { (seed, similar) ->
                    item(key = "because") { MediaRow(vm, stringResource(R.string.row_because, seed), similar, landscape = false) }
                }
                HomeRow.LatestMovies -> row(vm, R.string.row_new_movies, home.newMovies)
                HomeRow.Favorites -> row(vm, R.string.row_favorites, home.favorites)
                HomeRow.Collections -> row(vm, R.string.row_collections, home.collections)
                HomeRow.NewSeries -> row(vm, R.string.row_new_series, home.newSeries)
                HomeRow.NewAnime -> row(vm, R.string.row_new_anime, home.newAnime)
                HomeRow.NewMusicVideos -> row(vm, R.string.row_new_music_videos, home.newMusicVideos, landscape = true)
            }
        }
    }
    }
}

/** Keeps whatever takes the remote's focus inside the part of the list that is not under the top bar. */
@OptIn(ExperimentalFoundationApi::class)
private class KeepBelowTopBar(private val top: Float, private val bottomMargin: Float) : BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float {
        val bottom = containerSize - bottomMargin
        val trailing = offset + size
        return when {
            offset < top && trailing <= bottom -> offset - top
            trailing > bottom && offset >= top -> minOf(trailing - bottom, offset - top)
            else -> 0f
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.row(
    vm: AppViewModel,
    title: Int,
    items: List<MediaItem>,
    landscape: Boolean = false,
) {
    if (items.isEmpty()) return
    item(key = title) { MediaRow(vm, stringResource(title), items, landscape) }
}

/** Episodes of the series you follow that are about to air, soonest first; choosing one opens its series. */
@Composable
private fun UpcomingRow(vm: AppViewModel, upcoming: List<UpcomingEpisode>) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(stringResource(R.string.row_coming_up))
        LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(upcoming.size, key = { upcoming[it].item.id }) { index ->
                val episode = upcoming[index]
                val item = episode.item
                val code = if (item.seasonNumber != null && item.episodeNumber != null) "S${item.seasonNumber} E${item.episodeNumber}" else null
                val open: () -> Unit = { item.seriesId?.let { vm.openById(it) } }
                MediaCard(
                    item = item,
                    landscape = true,
                    onClick = open,
                    // An episode that has not aired has nothing to mark or queue: the menu would only get in the way.
                    onLongClick = open,
                    subtitle = listOfNotNull(code, airsLabel(episode.airsAt)).joinToString(" · ").ifBlank { null },
                    restoreFocusTo = vm.restoreTarget,
                    onRestored = { vm.restoreTarget = null },
                    onFocused = { vm.lastFocused = it },
                )
            }
        }
    }
}

/** "Today", "Tomorrow" or "Tue 14 Oct". An air date is a day, so it is shown as that day wherever the TV is. */
@Composable
private fun airsLabel(airsAt: Long?): String? {
    if (airsAt == null) return null
    return when (daysUntil(airsAt, System.currentTimeMillis())) {
        0 -> stringResource(R.string.day_today)
        1 -> stringResource(R.string.day_tomorrow)
        else -> SimpleDateFormat("EEE d MMM", Locale.getDefault()).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(airsAt))
    }
}

/** The user's own playlists of movies and episodes, as covers; choosing one opens it. */
@Composable
private fun PlaylistsRow(vm: AppViewModel, playlists: List<VideoPlaylist>) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(stringResource(R.string.row_playlists))
        LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(playlists.size, key = { playlists[it].id }) { index ->
                val list = playlists[index]
                CoverCard(
                    id = list.id,
                    title = list.name,
                    subtitle = list.itemCount?.let { titlesLabel(it) },
                    imageUrl = list.imageUrl,
                    onClick = { vm.openVideoPlaylist(list) },
                    restoreFocusTo = vm.restoreTarget,
                    onRestored = { vm.restoreTarget = null },
                    onFocused = { vm.lastFocused = it },
                )
            }
        }
    }
}

@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier.padding(horizontal = 48.dp), color = Palette.TextDim, fontSize = 16.sp)
}

@Composable
private fun MediaRow(vm: AppViewModel, title: String, items: List<MediaItem>, landscape: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(title)
        LazyRow(
            contentPadding = PaddingValues(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(items.size, key = { items[it].id }) { index ->
                val item = items[index]
                MediaCard(
                    item = item,
                    landscape = landscape,
                    onClick = { vm.open(item) },
                    restoreFocusTo = vm.restoreTarget,
                    onRestored = { vm.restoreTarget = null },
                    onFocused = { vm.lastFocused = it },
                )
            }
        }
    }
}
