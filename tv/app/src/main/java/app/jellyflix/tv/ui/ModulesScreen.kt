package app.jellyflix.tv.ui

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.ModulesPage
import app.jellyflix.tv.R
import app.jellyflix.tv.data.MatchCard
import app.jellyflix.tv.data.MatchFilters
import app.jellyflix.tv.data.MatchRoom
import app.jellyflix.tv.data.ModuleChannel
import app.jellyflix.tv.data.ModuleProgram
import app.jellyflix.tv.data.matchJoinLink
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import java.util.Date

/** "9:30 PM" or "21:30": a moment (seconds since the epoch) as the TV's own clock would show it. */
@Composable
internal fun clockOf(seconds: Long): String = DateFormat.getTimeFormat(LocalContext.current).format(Date(seconds * 1000))

/**
 * The Modules section: the extras that run on the optional modules container. Only there when a container answers. It is a page of its
 * own, so it does not touch Home, Movies or any other section.
 */
@Composable
fun ModulesScreen(vm: AppViewModel) {
    // Going from one page of the section to the next replaces what was focused: the focus goes back to the page's first control
    // (not to the top bar). The first time, the focus is the top bar's: the person is still choosing the section.
    val match = vm.modules.match
    val where = listOf(vm.modules.page, match.setup, match.room?.phase, match.room?.round)
    var opened by remember { mutableStateOf(false) }
    LaunchedEffect(where) {
        if (!opened) {
            opened = true
            return@LaunchedEffect
        }
        delay(200)
        runCatching { vm.contentEntry.requestFocus() }
    }
    when (vm.modules.page) {
        ModulesPage.Home -> ModulesHome(vm)
        ModulesPage.Channels -> ChannelsPage(vm)
        ModulesPage.Match -> MatchPage(vm)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ModulesHome(vm: AppViewModel) {
    Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text(stringResource(R.string.nav_modules), fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        Text(stringResource(R.string.modules_subtitle), fontSize = 16.sp, color = Palette.TextDim)
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp), modifier = Modifier.padding(top = 8.dp)) {
            ModuleCard(
                title = stringResource(R.string.modules_retro_title),
                text = stringResource(R.string.modules_retro_text),
                action = stringResource(R.string.modules_retro_action),
                onClick = { vm.modules.page = ModulesPage.Channels; vm.modules.loadChannels() },
                modifier = Modifier.focusRequester(vm.contentEntry),
            )
            ModuleCard(
                title = stringResource(R.string.modules_match_title),
                text = stringResource(R.string.modules_match_text),
                action = stringResource(R.string.modules_match_action),
                onClick = { vm.modules.openMatch() },
            )
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ModuleCard(title: String, text: String, action: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        modifier = modifier.width(480.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(20.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Palette.Surface3,
            contentColor = Color.White,
            focusedContainerColor = Palette.Surface4,
            focusedContentColor = Color.White,
        ),
        border = ClickableSurfaceDefaults.border(
            focusedBorder = androidx.tv.material3.Border(androidx.compose.foundation.BorderStroke(3.dp, Color.White), shape = RoundedCornerShape(20.dp)),
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.04f),
    ) {
        Column(Modifier.padding(26.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Text(text, fontSize = 16.sp, color = Palette.TextDim, maxLines = 4, overflow = TextOverflow.Ellipsis)
            Text(action, fontSize = 17.sp, color = Palette.Accent, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

// ---- Retro TV ---------------------------------------------------------------------------------------------------------

@Composable
private fun ChannelsPage(vm: AppViewModel) {
    val modules = vm.modules
    // What is "on now" is worked out from the clock, and the list is asked for again every minute while the page is open.
    var now by remember { mutableLongStateOf(System.currentTimeMillis() / 1000) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            now = System.currentTimeMillis() / 1000
            modules.loadChannels()
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 48.dp, end = 48.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Pill(stringResource(R.string.modules_on_now), onClick = { modules.guide = false }, selected = !modules.guide, modifier = Modifier.focusRequester(vm.contentEntry))
            Pill(stringResource(R.string.live_guide), onClick = { modules.guide = true }, selected = modules.guide)
        }
        when {
            !modules.channelsLoaded -> Hint(stringResource(R.string.loading))
            modules.channelsError != null -> Hint(modules.channelsError.orEmpty())
            modules.channels.isEmpty() -> Hint(stringResource(R.string.modules_channels_empty))
            modules.guide -> ChannelGuide(vm, now)
            else -> ChannelGrid(vm, now)
        }
    }
}

@Composable
private fun ChannelGrid(vm: AppViewModel, now: Long) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(Posters.columns(3)),
        contentPadding = PaddingValues(start = 48.dp, end = 48.dp, bottom = 40.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(vm.modules.channels, key = { it.id }) { channel -> ChannelCard(channel, now, onClick = { vm.modules.tune(channel) }) }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ChannelCard(channel: ModuleChannel, now: Long, onClick: () -> Unit) {
    val on = channel.now
    Surface(
        onClick = onClick,
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(18.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Palette.Surface3,
            contentColor = Color.White,
            focusedContainerColor = Palette.Surface4,
            focusedContentColor = Color.White,
        ),
        border = ClickableSurfaceDefaults.border(
            focusedBorder = androidx.tv.material3.Border(androidx.compose.foundation.BorderStroke(3.dp, Color.White), shape = RoundedCornerShape(18.dp)),
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.04f),
    ) {
        Column(Modifier.padding(18.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ChannelBadge(channel.number, channel.color)
                Text(channel.name, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (on != null) {
                Text(on.title, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                on.subtitle?.let { Text(it, fontSize = 13.sp, color = Palette.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                val progress = ((now - on.start).toFloat() / (on.end - on.start).coerceAtLeast(1)).coerceIn(0f, 1f)
                Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(Color(0x33FFFFFF))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(progress).background(Palette.Accent))
                }
                Text("${clockOf(on.start)} – ${clockOf(on.end)}", fontSize = 13.sp, color = Palette.TextDim)
            } else {
                Text(stringResource(R.string.modules_nothing_on), fontSize = 15.sp, color = Palette.TextDim)
            }
            channel.next?.let { Text(stringResource(R.string.modules_next_at, clockOf(it.start), it.title), fontSize = 13.sp, color = Palette.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
internal fun ChannelBadge(number: Int, color: Int, size: androidx.compose.ui.unit.Dp = 44.dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(10.dp)).background(Color(color)), contentAlignment = Alignment.Center) {
        Text(number.toString(), fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.Black, color = Color.White)
    }
}

@Composable
private fun ChannelGuide(vm: AppViewModel, now: Long) {
    LazyColumn(
        contentPadding = PaddingValues(start = 48.dp, end = 48.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(vm.modules.channels, key = { it.id }) { channel ->
            Pill(
                text = guideLine(channel),
                onClick = { vm.modules.tune(channel) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun guideLine(channel: ModuleChannel): String {
    val now = channel.now?.let { "${clockOf(it.start)} ${it.title}" } ?: stringResource(R.string.modules_nothing_on)
    val next = channel.next?.let { "   ›   ${clockOf(it.start)} ${it.title}" }.orEmpty()
    return "${channel.number}  ${channel.name}   —   $now$next"
}

// ---- Match: the TV is the screen -------------------------------------------------------------------------------------

private val DECADES = listOf(2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950)

@Composable
private fun MatchPage(vm: AppViewModel) {
    val room = vm.modules.match.room
    when {
        room != null -> {
            LaunchedEffect(room.id) { vm.modules.followRoom(room.id) }
            MatchRoomScreen(vm, room)
        }
        vm.modules.match.setup -> MatchSetup(vm)
        else -> MatchStart(vm)
    }
}

@Composable
private fun MatchStart(vm: AppViewModel) {
    val match = vm.modules.match
    Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.match_title), fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        Text(stringResource(R.string.match_intro), fontSize = 16.sp, color = Palette.TextDim, modifier = Modifier.width(900.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
            Pill(stringResource(R.string.match_choose), onClick = { match.setup = true }, accent = true, modifier = Modifier.focusRequester(vm.contentEntry))
            match.rooms.forEach { room ->
                Pill(stringResource(R.string.match_resume, room.code), onClick = { vm.modules.resumeMatch(room.id) })
            }
        }
        match.error?.let { Text(it, fontSize = 15.sp, color = Color(0xFFFFB4B4)) }
    }
}

@Composable
private fun MatchSetup(vm: AppViewModel) {
    val match = vm.modules.match
    val f = match.filters
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 48.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(stringResource(R.string.match_feel), fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        ChoiceRow(stringResource(R.string.match_genre)) {
            item { Pill(stringResource(R.string.match_any_genre), { match.filters = f.copy(genre = null) }, selected = f.genre == null, modifier = Modifier.focusRequester(vm.contentEntry)) }
            items(match.genres) { g -> Pill(g, { match.filters = f.copy(genre = g) }, selected = f.genre == g) }
        }
        ChoiceRow(stringResource(R.string.match_decade)) {
            item { Pill(stringResource(R.string.match_any_decade), { match.filters = f.copy(decade = null) }, selected = f.decade == null) }
            items(DECADES) { d -> Pill(stringResource(R.string.match_decade_fmt, d), { match.filters = f.copy(decade = d) }, selected = f.decade == d) }
        }
        ChoiceRow(stringResource(R.string.match_length)) {
            item { Pill(stringResource(R.string.match_any_length), { match.filters = f.copy(length = null) }, selected = f.length == null) }
            item { Pill(stringResource(R.string.match_short), { match.filters = f.copy(length = "short") }, selected = f.length == "short") }
            item { Pill(stringResource(R.string.match_medium), { match.filters = f.copy(length = "medium") }, selected = f.length == "medium") }
            item { Pill(stringResource(R.string.match_long), { match.filters = f.copy(length = "long") }, selected = f.length == "long") }
        }
        ChoiceRow(stringResource(R.string.match_include)) {
            item { Pill(stringResource(R.string.match_films_only), { match.filters = f.copy(series = false) }, selected = !f.series) }
            item { Pill(stringResource(R.string.match_films_series), { match.filters = f.copy(series = true) }, selected = f.series) }
        }
        ChoiceRow(stringResource(R.string.match_size)) {
            items(listOf(6, 10, 16)) { n -> Pill(n.toString(), { match.deckSize = n }, selected = match.deckSize == n) }
        }
        match.error?.let { Text(it, fontSize = 15.sp, color = Color(0xFFFFB4B4)) }
        Pill(
            stringResource(if (match.working) R.string.modules_working else R.string.match_open_lobby),
            onClick = vm.modules::createMatch,
            accent = true,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

@Composable
private fun ChoiceRow(label: String, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontSize = 15.sp, color = Palette.TextDim)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 4.dp)) { content() }
    }
}

@Composable
private fun MatchRoomScreen(vm: AppViewModel, room: MatchRoom) {
    when (room.phase) {
        "lobby" -> MatchLobby(vm, room)
        "done" -> MatchDone(vm, room)
        else -> MatchRound(vm, room)
    }
}

/** What the cards are limited to, in words. */
@Composable
private fun filterWords(filters: MatchFilters): String {
    val parts = listOfNotNull(
        filters.genre,
        filters.decade?.let { stringResource(R.string.match_decade_fmt, it) },
        filters.length?.let { stringResource(when (it) { "short" -> R.string.match_short; "medium" -> R.string.match_medium; else -> R.string.match_long }) },
        if (filters.series) stringResource(R.string.match_films_series) else null,
    )
    return parts.joinToString(" · ")
}

@Composable
private fun MatchLobby(vm: AppViewModel, room: MatchRoom) {
    val modules = vm.modules
    val web = modules.webAddress
    val link = if (web.isNotEmpty()) matchJoinLink(web, modules.address, room.code) else null
    Row(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(48.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (link != null) {
                QrImage(link, stringResource(R.string.match_qr), size = 300.dp)
                Text(stringResource(R.string.match_scan), fontSize = 17.sp, color = Color.White)
            } else {
                Text(stringResource(R.string.match_need_web), fontSize = 16.sp, color = Palette.TextDim, textAlign = TextAlign.Center, modifier = Modifier.width(360.dp))
            }
            Text(stringResource(R.string.match_or_code), fontSize = 14.sp, color = Palette.TextDim, textAlign = TextAlign.Center, modifier = Modifier.width(380.dp))
            Text(room.code, fontSize = 40.sp, fontWeight = FontWeight.Bold, letterSpacing = 8.sp, color = Color.White)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.match_who_in), fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
            if (room.members.isEmpty()) Text(stringResource(R.string.match_nobody), fontSize = 16.sp, color = Palette.TextDim)
            else MemberChips(room)
            val words = filterWords(room.filters)
            if (words.isNotEmpty()) Text(words, fontSize = 14.sp, color = Palette.TextDim)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 10.dp)) {
                Pill(
                    stringResource(if (room.members.isEmpty()) R.string.match_waiting_people else R.string.match_start, room.members.size),
                    onClick = { if (room.members.isNotEmpty()) modules.startSwiping() },
                    accent = room.members.isNotEmpty(),
                    modifier = Modifier.focusRequester(vm.contentEntry),
                )
                Pill(stringResource(R.string.match_close), onClick = modules::closeMatch)
            }
            modules.match.error?.let { Text(it, fontSize = 15.sp, color = Color(0xFFFFB4B4)) }
        }
    }
}

@Composable
private fun MemberChips(room: MatchRoom, marks: Boolean = false) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        room.members.forEach { m ->
            val done = marks && m.done
            Text(
                (if (done) "✓ " else "") + m.name,
                fontSize = 17.sp,
                color = if (done) Palette.AccentInk else Color.White,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (done) Palette.Accent else Palette.Surface3)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun MatchRound(vm: AppViewModel, room: MatchRoom) {
    val modules = vm.modules
    Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            stringResource(if (room.phase == "pick") R.string.match_choosing_title else R.string.match_round, room.round),
            fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Color.White,
        )
        Text(stringResource(if (room.phase == "pick") R.string.match_choosing else R.string.match_everybody_swipes), fontSize = 17.sp, color = Palette.TextDim)
        val words = filterWords(room.filters)
        if (words.isNotEmpty()) Text(words, fontSize = 14.sp, color = Palette.TextDim)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 8.dp)) {
            items(room.deck, key = { it.id }) { card -> Poster(vm, card, Modifier.width(150.dp).height(225.dp)) }
        }
        MemberChips(room, marks = true)
        Pill(stringResource(R.string.match_close), onClick = modules::closeMatch, modifier = Modifier.focusRequester(vm.contentEntry))
    }
}

@Composable
private fun Poster(vm: AppViewModel, card: MatchCard, modifier: Modifier) {
    Box(modifier.clip(RoundedCornerShape(12.dp)).background(Palette.Surface3), contentAlignment = Alignment.Center) {
        // The title is under the picture: it is what shows while the picture loads, and when a film has none.
        Text(card.name, fontSize = 14.sp, color = Color.White, textAlign = TextAlign.Center, modifier = Modifier.padding(8.dp))
        val url = vm.modules.posterUrl(card.id)
        if (url != null) AsyncImage(url, contentDescription = card.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

@Composable
private fun MatchDone(vm: AppViewModel, room: MatchRoom) {
    val modules = vm.modules
    val winner = room.winner
    Row(
        Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(40.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (winner != null) Poster(vm, winner, Modifier.width(280.dp).height(420.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                stringResource(if (room.winnerBy == "coin") R.string.match_chance else R.string.match_it_is),
                fontSize = 16.sp, fontWeight = FontWeight.Bold, letterSpacing = 4.sp, color = Palette.Accent,
            )
            if (winner != null) {
                Text(winner.name, fontSize = 34.sp, fontWeight = FontWeight.SemiBold, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(if (winner.isSeries) stringResource(R.string.match_series) else null, winner.year?.toString(), winner.runtimeMinutes?.let { "$it min" }).joinToString(" · "),
                    fontSize = 16.sp, color = Palette.TextDim,
                )
            }
            room.summary?.let { summary ->
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (summary.total != null && summary.both != null) {
                        Text(stringResource(R.string.match_agreed, summary.both, summary.total, summary.percent ?: 0), fontSize = 16.sp, color = Color.White)
                        val context = LocalContext.current
                        Text(summary.liked.joinToString("   ") { (name, count) -> context.getString(R.string.match_liked, name, count) }, fontSize = 14.sp, color = Palette.TextDim)
                    }
                    if (summary.picks.isNotEmpty()) {
                        Text(summary.picks.joinToString("   ") { (name, card) -> "$name: $card" }, fontSize = 14.sp, color = Palette.TextDim)
                        if (room.winnerBy == "coin") Text(stringResource(R.string.match_chance_note), fontSize = 13.sp, color = Palette.TextDim)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 14.dp)) {
                Pill(
                    stringResource(if (winner?.isSeries == true) R.string.match_open_series else R.string.match_play),
                    onClick = { modules.playWinner(room) },
                    accent = true,
                    modifier = Modifier.focusRequester(vm.contentEntry),
                )
                Pill(stringResource(R.string.match_another), onClick = modules::anotherRound)
                Pill(stringResource(R.string.match_close), onClick = modules::closeMatch)
            }
            modules.match.error?.let { Text(it, fontSize = 15.sp, color = Color(0xFFFFB4B4)) }
        }
    }
}
