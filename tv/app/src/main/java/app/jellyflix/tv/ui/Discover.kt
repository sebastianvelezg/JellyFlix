package app.jellyflix.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.Pick
import app.jellyflix.tv.R
import coil3.compose.AsyncImage

/**
 * "Discover something new": a random movie, a series you have never started and an album. A pick is shown (not opened
 * blindly) so you can play it, look at it, or ask for another.
 */
@Composable
fun Discover(vm: AppViewModel) {
    val libs = vm.libs ?: return
    val hasMovies = libs.movies.isNotEmpty()
    val hasShows = libs.shows.isNotEmpty()
    val hasMusic = libs.music.isNotEmpty()
    val count = listOf(hasMovies, hasShows, hasMusic).count { it }
    if (count == 0) return
    val compact = count > 2
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(stringResource(R.string.discover_title))
        Row(Modifier.padding(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            if (hasMovies) {
                val pick = vm.home.pickMovie
                val movie = (pick as? Pick.Ready)?.value
                PickTile(
                    label = stringResource(R.string.pick_movie),
                    pick = pick,
                    empty = stringResource(R.string.pick_empty_movies),
                    modifier = Modifier.weight(1f),
                    onAnother = vm::pickMovie,
                    title = movie?.title,
                    meta = movie?.let { m ->
                        listOfNotNull(m.year?.toString(), stringResource(if (m.played) R.string.pick_watched else R.string.pick_not_watched))
                            .joinToString(" · ")
                    },
                    image = movie?.posterUrl,
                    backdrop = movie?.backdropUrl ?: movie?.landscapeUrl,
                    primary = movie?.let { stringResource(if (it.resumeMs > 0) R.string.resume else R.string.play) to { vm.play(it) } },
                    secondary = movie?.let { stringResource(R.string.pick_details) to { vm.open(it) } },
                    compact = compact,
                )
            }
            if (hasShows) {
                val pick = vm.home.pickSeries
                val ready = (pick as? Pick.Ready)?.value
                PickTile(
                    label = stringResource(R.string.pick_series),
                    pick = pick,
                    empty = stringResource(R.string.pick_empty_series),
                    modifier = Modifier.weight(1f),
                    onAnother = vm::pickSeries,
                    title = ready?.show?.title,
                    meta = ready?.let {
                        val code = "S${it.episode.seasonNumber ?: 1} E${it.episode.episodeNumber ?: 1}"
                        listOfNotNull(it.show.year?.toString(), stringResource(R.string.pick_never_watched, code)).joinToString(" · ")
                    },
                    image = ready?.show?.posterUrl,
                    backdrop = ready?.show?.backdropUrl ?: ready?.show?.landscapeUrl,
                    primary = ready?.let {
                        stringResource(if (compact) R.string.pick_from_start else R.string.pick_start_beginning) to { vm.play(it.episode) }
                    },
                    secondary = ready?.let { stringResource(R.string.pick_details) to { vm.open(it.show) } },
                    compact = compact,
                )
            }
            if (hasMusic) {
                val pick = vm.musicHome.pick
                val album = (pick as? Pick.Ready)?.value
                PickTile(
                    label = stringResource(R.string.pick_music),
                    pick = pick,
                    empty = stringResource(R.string.library_empty),
                    modifier = Modifier.weight(1f),
                    onAnother = vm::pickAlbum,
                    title = album?.name,
                    meta = album?.let { listOfNotNull(it.artist, it.year?.toString()).joinToString(" · ") },
                    image = album?.coverUrl,
                    square = true,
                    primary = album?.let { stringResource(R.string.music_play_album) to { vm.playAlbum(it) } },
                    secondary = album?.let { stringResource(R.string.pick_details) to { vm.openAlbum(it) } },
                    compact = compact,
                )
            }
        }
    }
}

/** The card all picks share: the picture, what it is, and its actions. */
@Composable
fun PickTile(
    label: String,
    pick: Pick<Any>,
    empty: String,
    modifier: Modifier,
    onAnother: () -> Unit,
    title: String?,
    meta: String?,
    image: String?,
    backdrop: String? = null,
    square: Boolean = false,
    primary: Pair<String, () -> Unit>?,
    secondary: Pair<String, () -> Unit>?,
    compact: Boolean = false,
) {
    Box(
        modifier
            .height(if (compact) 232.dp else 200.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.Surface2),
    ) {
        if (title != null && (backdrop ?: image) != null) {
            AsyncImage(
                model = backdrop ?: image,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().alpha(0.3f),
            )
            Box(
                Modifier.fillMaxSize().background(
                    Brush.horizontalGradient(listOf(Palette.Surface2, Palette.Surface2.copy(alpha = 0.9f), Palette.Surface2.copy(alpha = 0.4f))),
                ),
            )
        }
        Row(Modifier.fillMaxSize().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            if (title != null) {
                val coverModifier = if (square) Modifier.width(if (compact) 84.dp else 110.dp).aspectRatio(1f) else Modifier.width(if (compact) 84.dp else 96.dp).fillMaxSize()
                AsyncImage(
                    model = image,
                    contentDescription = title,
                    contentScale = ContentScale.Crop,
                    modifier = coverModifier.clip(RoundedCornerShape(10.dp)).background(Palette.Surface),
                )
            }
            Column(Modifier.weight(1f).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Chip(label)
                when {
                    title != null -> {
                        Text(title, fontSize = 18.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        meta?.let { Text(it, fontSize = 12.sp, color = Palette.TextDim, maxLines = if (compact) 2 else 1, overflow = TextOverflow.Ellipsis) }
                    }
                    pick is Pick.Loading -> Text(stringResource(R.string.loading), fontSize = 14.sp, color = Palette.TextDim)
                    else -> Text(empty, fontSize = 13.sp, color = Palette.TextDim, maxLines = 4, overflow = TextOverflow.Ellipsis)
                }
                Box(Modifier.weight(1f))
                if (title != null && primary != null) {
                    // The two rows are as wide as the card's text: Play across it, then Details and "another one" sharing the line.
                    Pill(primary.first, onClick = primary.second, accent = true, centered = true, modifier = Modifier.fillMaxWidth())
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        secondary?.let { Pill(it.first, onClick = it.second, centered = true, modifier = Modifier.weight(1f)) }
                        IconPill(R.drawable.ic_refresh, stringResource(R.string.pick_another), onClick = onAnother)
                    }
                } else if (pick !is Pick.Loading) {
                    Pill(stringResource(R.string.pick_another), onClick = onAnother, modifier = Modifier.align(Alignment.Start))
                }
            }
        }
    }
}
