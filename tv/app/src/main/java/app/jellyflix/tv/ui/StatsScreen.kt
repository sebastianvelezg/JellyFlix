package app.jellyflix.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.R
import app.jellyflix.tv.StatsState
import app.jellyflix.tv.data.PlayHistory
import app.jellyflix.tv.data.WatchedStats
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

/**
 * What the viewer has watched: time, movies and episodes, the months watched most, favourite genres and what was watched more than
 * once. It is worked out on the TV from what the server already knows; nothing is sent anywhere, and the page says so.
 */
@Composable
fun StatsScreen(vm: AppViewModel, state: StatsState) {
    val back = remember { FocusRequester() }
    val focus = LocalFocusManager.current
    // The page that was left may hand the focus on by itself, and a pill that got it that way is not drawn as focused: start again.
    LaunchedEffect(state) {
        focus.clearFocus()
        back.requestFocusSoon()
    }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 48.dp, end = 48.dp, top = 32.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Pill(stringResource(R.string.stats_back), onClick = { vm.back() }, modifier = Modifier.focusRequester(back))
            Text(stringResource(R.string.stats_title), fontSize = 34.sp, fontWeight = FontWeight.Bold, color = Color.White)
        }
        val result = state.stats
        when {
            state.failed -> Text(stringResource(R.string.stats_failed), color = Palette.TextDim, fontSize = 16.sp)
            result == null -> Text(stringResource(R.string.loading), color = Palette.TextDim, fontSize = 16.sp)
            result.stats.isEmpty -> Text(stringResource(R.string.stats_empty), color = Palette.TextDim, fontSize = 16.sp)
            else -> StatsBody(vm, result)
        }
        state.history?.let { RecordedCard(it) }
        Text(stringResource(R.string.stats_note), color = Palette.TextDim, fontSize = 13.sp)
    }
}

@Composable
private fun StatsBody(vm: AppViewModel, result: WatchedStats) {
    val stats = result.stats
    Row(horizontalArrangement = Arrangement.spacedBy(40.dp)) {
        Column(Modifier.width(330.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.stats_hours, stats.hours), fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Text(
                if (stats.movies == 1) stringResource(R.string.stats_movie_one) else stringResource(R.string.stats_movies, stats.movies),
                fontSize = 18.sp,
                color = Color(0xFFDDDDDD),
            )
            Text(
                if (stats.episodes == 1) stringResource(R.string.stats_episode_one) else stringResource(R.string.stats_episodes, stats.episodes),
                fontSize = 18.sp,
                color = Color(0xFFDDDDDD),
            )
            if (stats.topGenres.isNotEmpty()) {
                SectionTitle(stringResource(R.string.stats_genres), Modifier.padding(top = 14.dp, bottom = 4.dp), inset = false)
                val most = stats.topGenres.maxOf { it.count }
                stats.topGenres.forEach { genre ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(genre.name, fontSize = 15.sp, color = Color.White, maxLines = 1, modifier = Modifier.width(110.dp))
                        Box(Modifier.width(150.dp * genre.count / most).height(10.dp).clip(RoundedCornerShape(5.dp)).background(Palette.Accent))
                        Text("${genre.count}", fontSize = 13.sp, color = Palette.TextDim)
                    }
                }
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionTitle(stringResource(R.string.stats_months), inset = false)
            val busiest = stats.months.maxOf { it.count }.coerceAtLeast(1)
            Row(Modifier.height(130.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                stats.months.forEach { month ->
                    Column(Modifier.width(30.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                        if (month.count > 0) Text("${month.count}", fontSize = 11.sp, color = Palette.TextDim)
                        Box(
                            Modifier
                                .width(22.dp)
                                .height((84.dp * month.count / busiest).coerceAtLeast(3.dp))
                                .clip(RoundedCornerShape(4.dp))
                                .background(if (month.count == busiest) Palette.Accent else Palette.Accent.copy(alpha = 0.45f)),
                        )
                        Text(monthName(month.key), fontSize = 11.sp, color = Palette.TextDim, maxLines = 1, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
            if (stats.rewatched.isNotEmpty()) {
                SectionTitle(stringResource(R.string.stats_rewatched), Modifier.padding(top = 10.dp), inset = false)
                stats.rewatched.forEach { title ->
                    Pill("${title.name} · ${stringResource(R.string.stats_plays, title.plays)}", onClick = { vm.openById(title.id) })
                }
            }
        }
    }
    if (result.capped) Text(stringResource(R.string.stats_capped, stats.movies + stats.episodes), color = Palette.TextDim, fontSize = 13.sp)
}

/** "45 min" below an hour, "3.5 h" above. */
@Composable
private fun playedText(seconds: Long): String =
    if (seconds < 3600) stringResource(R.string.stats_rec_min, (seconds / 60).toInt()) else stringResource(R.string.stats_rec_h, seconds / 3600.0)

/**
 * What the Playback Reporting plugin of the server recorded: real time played, the hours of the day and the devices. A card the remote
 * can stop on, so the page scrolls down to it.
 */
@OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)
@Composable
private fun RecordedCard(history: PlayHistory) {
    androidx.tv.material3.Surface(
        onClick = {},
        modifier = Modifier.fillMaxWidth(),
        shape = androidx.tv.material3.ClickableSurfaceDefaults.shape(RoundedCornerShape(16.dp)),
        colors = androidx.tv.material3.ClickableSurfaceDefaults.colors(
            containerColor = Palette.Surface2,
            contentColor = Color.White,
            focusedContainerColor = Palette.Surface3,
            focusedContentColor = Color.White,
        ),
        scale = androidx.tv.material3.ClickableSurfaceDefaults.scale(focusedScale = 1.0f),
    ) {
        Column(Modifier.padding(horizontal = 24.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle(stringResource(R.string.stats_rec_title), inset = false)
            if (history.isEmpty) {
                Text(stringResource(R.string.stats_rec_empty), fontSize = 15.sp, color = Palette.TextDim)
                return@Column
            }
            history.since?.let { day ->
                val shown = runCatching { java.time.LocalDate.parse(day).format(java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)) }.getOrDefault(day)
                Text(stringResource(R.string.stats_rec_since, shown), fontSize = 13.sp, color = Palette.TextDim)
            }
            Text(
                stringResource(R.string.stats_rec_figures, playedText(history.seconds), history.plays, history.directPercent),
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.White,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(40.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(stringResource(R.string.stats_rec_when), fontSize = 15.sp, color = Palette.TextDim)
                    val peak = history.hours.maxOrNull()?.coerceAtLeast(1L) ?: 1L
                    Row(Modifier.height(78.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
                        history.hours.forEachIndexed { hour, seconds ->
                            Column(Modifier.width(14.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                                Box(
                                    Modifier
                                        .width(12.dp)
                                        .height((56.dp * (seconds.toFloat() / peak.toFloat())).coerceAtLeast(2.dp))
                                        .clip(RoundedCornerShape(3.dp))
                                        .background(Palette.Accent.copy(alpha = if (seconds > 0) 1f else 0.25f)),
                                )
                                Text(if (hour % 6 == 0) "%02d".format(hour) else "", fontSize = 9.sp, color = Palette.TextDim, maxLines = 1, modifier = Modifier.height(14.dp))
                            }
                        }
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(stringResource(R.string.stats_rec_devices), fontSize = 15.sp, color = Palette.TextDim)
                    history.devices.take(4).forEach { device ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(device.name.ifEmpty { device.client }, fontSize = 15.sp, color = Color.White, maxLines = 1, modifier = Modifier.weight(1f))
                            Text(playedText(device.seconds), fontSize = 14.sp, color = Palette.TextDim)
                        }
                    }
                }
            }
        }
    }
}

/** "Oct" for "2026-10". */
private fun monthName(key: String): String =
    runCatching { YearMonth.parse(key).month.getDisplayName(TextStyle.SHORT, Locale.getDefault()).take(3) }.getOrDefault(key)
