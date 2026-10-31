package app.jellyflix.tv.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.key
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.geometry.Offset
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.R
import app.jellyflix.tv.data.ACCENTS
import app.jellyflix.tv.data.CANVASES
import app.jellyflix.tv.data.AudioFormat
import app.jellyflix.tv.data.FrameRateMode
import app.jellyflix.tv.data.SkipAction
import app.jellyflix.tv.data.HomeRow
import app.jellyflix.tv.data.MenuItem
import app.jellyflix.tv.data.MenuLayout
import app.jellyflix.tv.data.NavStyle
import app.jellyflix.tv.data.PosterSize
import app.jellyflix.tv.data.accentColor
import app.jellyflix.tv.data.PluginCard
import app.jellyflix.tv.data.QualityLimit
import app.jellyflix.tv.data.NextUpWindow
import app.jellyflix.tv.data.ScreenMargin
import app.jellyflix.tv.data.ScreensaverDelay
import app.jellyflix.tv.data.ScreensaverRating
import app.jellyflix.tv.data.ScreensaverSource
import app.jellyflix.tv.data.ServerTask
import app.jellyflix.tv.data.SubtitleBackground
import app.jellyflix.tv.data.SubtitleColor
import app.jellyflix.tv.data.SubtitlePosition
import app.jellyflix.tv.data.SubtitleSize
import app.jellyflix.tv.data.TextSize
import app.jellyflix.tv.data.TvSettings
import coil3.SingletonImageLoader
import kotlinx.coroutines.delay
import java.text.DateFormat
import java.util.Date

private enum class SettingsTab(val label: Int) {
    Playback(R.string.settings_tab_playback),
    Subtitles(R.string.settings_tab_subtitles),
    Display(R.string.settings_tab_display),
    Appearance(R.string.settings_tab_appearance),
    Plugins(R.string.settings_tab_plugins),
    Account(R.string.settings_tab_account),
}

/**
 * Settings in tabs, like the web client's: how videos behave, how subtitles look, the screen, the server's plugins (state only)
 * and the account. Left and right move between the tabs, down goes into the one that is open.
 */
@Composable
fun SettingsScreen(vm: AppViewModel) {
    var tab by remember { mutableStateOf(SettingsTab.Playback) }
    // The first control of the open tab: where Down from the tabs goes.
    val firstControl = remember { FocusRequester() }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SettingsTab.entries.forEach { entry ->
                Pill(
                    stringResource(entry.label),
                    onClick = { tab = entry },
                    selected = tab == entry,
                    modifier = Modifier
                        .focusProperties { down = firstControl }
                        .then(if (tab == entry) Modifier.focusRequester(vm.contentEntry) else Modifier),
                )
            }
        }
        when (tab) {
            SettingsTab.Playback -> PlaybackTab(vm, firstControl)
            SettingsTab.Subtitles -> SubtitlesTab(vm, firstControl)
            SettingsTab.Display -> DisplayTab(vm, firstControl)
            SettingsTab.Appearance -> AppearanceTab(vm, firstControl)
            SettingsTab.Plugins -> PluginsTab(vm, firstControl)
            SettingsTab.Account -> AccountTab(vm, firstControl)
        }
    }
}

@Composable
private fun TabBody(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) { content() }
}

@Composable
private fun PlaybackTab(vm: AppViewModel, first: FocusRequester) {
    val s = vm.settings
    TabBody {
        Toggle(stringResource(R.string.settings_autoplay_next), vm.autoplayNext, Modifier.focusRequester(first)) { vm.updateAutoplayNext(!vm.autoplayNext) }
        SkipChoice(R.string.settings_skip_intro, s.skipIntro) { v -> vm.updateSettings { it.copy(skipIntro = v) } }
        SkipChoice(R.string.settings_skip_recap, s.skipRecap) { v -> vm.updateSettings { it.copy(skipRecap = v) } }
        SkipChoice(R.string.settings_skip_credits, s.skipOutro) { v -> vm.updateSettings { it.copy(skipOutro = v) } }
        SkipChoice(R.string.settings_skip_preview, s.skipPreview) { v -> vm.updateSettings { it.copy(skipPreview = v) } }
        Note(stringResource(R.string.settings_skip_note))
        Choice(
            title = stringResource(R.string.settings_next_up),
            options = NextUpWindow.entries.map { stringResource(it.label) },
            selected = s.nextUp.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(nextUp = NextUpWindow.entries[i]) } },
            note = stringResource(R.string.settings_next_up_note),
        )

        Choice(
            title = stringResource(R.string.settings_quality),
            options = QualityLimit.entries.map { it.mbps?.let { mbps -> stringResource(R.string.settings_mbps, mbps) } ?: stringResource(R.string.settings_quality_auto) },
            selected = s.quality.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(quality = QualityLimit.entries[i]) } },
            note = stringResource(R.string.settings_quality_note),
        )
        Toggle(stringResource(R.string.settings_direct_only), s.directOnly) { vm.updateSettings { it.copy(directOnly = !it.directOnly) } }
        Note(stringResource(R.string.settings_direct_only_note))

        Text(stringResource(R.string.settings_convert_audio), fontSize = 16.sp, color = Color.White, modifier = Modifier.padding(top = 6.dp))
        AudioFormat.entries.forEach { format ->
            Toggle(stringResource(format.label), format in s.convertAudio) {
                vm.updateSettings { it.copy(convertAudio = if (format in it.convertAudio) it.convertAudio - format else it.convertAudio + format) }
            }
        }
        Note(stringResource(R.string.settings_convert_audio_note))

        Choice(
            title = stringResource(R.string.settings_frame_rate),
            options = FrameRateMode.entries.map { stringResource(it.label) },
            selected = s.frameRate.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(frameRate = FrameRateMode.entries[i]) } },
            note = stringResource(R.string.settings_frame_rate_note),
        )
    }
}

/** What to do in one kind of skippable stretch: show a button, skip by itself, or do nothing. */
@Composable
private fun SkipChoice(@androidx.annotation.StringRes title: Int, current: SkipAction, onSelect: (SkipAction) -> Unit) {
    Choice(
        title = stringResource(title),
        options = SkipAction.entries.map { stringResource(it.label) },
        selected = current.ordinal,
        onSelect = { i -> onSelect(SkipAction.entries[i]) },
    )
}

@Composable
private fun SubtitlesTab(vm: AppViewModel, first: FocusRequester) {
    val s = vm.settings
    TabBody {
        SubtitleSample(s)
        Choice(
            title = stringResource(R.string.settings_sub_size),
            options = SubtitleSize.entries.map { stringResource(it.label) },
            selected = s.subtitleSize.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(subtitleSize = SubtitleSize.entries[i]) } },
            entry = first,
        )
        Choice(
            title = stringResource(R.string.settings_sub_color),
            options = SubtitleColor.entries.map { stringResource(it.label) },
            selected = s.subtitleColor.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(subtitleColor = SubtitleColor.entries[i]) } },
        )
        Choice(
            title = stringResource(R.string.settings_sub_background),
            options = SubtitleBackground.entries.map { stringResource(it.label) },
            selected = s.subtitleBackground.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(subtitleBackground = SubtitleBackground.entries[i]) } },
        )
        Choice(
            title = stringResource(R.string.settings_sub_position),
            options = SubtitlePosition.entries.map { stringResource(it.label) },
            selected = s.subtitlePosition.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(subtitlePosition = SubtitlePosition.entries[i]) } },
            note = stringResource(R.string.settings_sub_note),
        )
    }
}

/** A line of sample text over a dim picture, drawn the way the player draws subtitles, so a choice can be judged before playing. */
@Composable
private fun SubtitleSample(s: TvSettings) {
    val density = LocalDensity.current
    val screenHeight = LocalConfiguration.current.screenHeightDp
    // The player sizes subtitles as a share of the picture's height; the sample is a strip, so it uses the screen's height.
    val size = with(density) { (s.subtitleSize.fraction * screenHeight).dp.toSp() }
    Box(
        modifier = Modifier
            .width(720.dp)
            .height(110.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Brush.verticalGradient(listOf(Color(0xFF3A4A66), Color(0xFF1B2433)))),
        contentAlignment = if (s.subtitlePosition == SubtitlePosition.High) Alignment.Center else Alignment.BottomCenter,
    ) {
        Text(
            stringResource(R.string.settings_sub_sample),
            modifier = Modifier
                .padding(bottom = if (s.subtitlePosition == SubtitlePosition.High) 0.dp else 10.dp)
                .then(if (s.subtitleBackground == SubtitleBackground.Box) Modifier.background(Color(0xCC000000)).padding(horizontal = 8.dp, vertical = 2.dp) else Modifier),
            style = TextStyle(
                color = Color(s.subtitleColor.argb),
                fontSize = size,
                shadow = if (s.subtitleBackground == SubtitleBackground.Shadow) Shadow(Color.Black, Offset(3f, 3f), 6f) else null,
            ),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun DisplayTab(vm: AppViewModel, first: FocusRequester) {
    val s = vm.settings
    TabBody {
        Choice(
            title = stringResource(R.string.settings_text_size),
            options = TextSize.entries.map { stringResource(it.label) },
            selected = s.textSize.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(textSize = TextSize.entries[i]) } },
            entry = first,
        )
        Choice(
            title = stringResource(R.string.settings_margin),
            options = ScreenMargin.entries.map { stringResource(it.label) },
            selected = s.margin.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(margin = ScreenMargin.entries[i]) } },
            note = stringResource(R.string.settings_margin_note),
        )
        Choice(
            title = stringResource(R.string.settings_screensaver),
            options = ScreensaverDelay.entries.map { stringResource(it.label) },
            selected = s.screensaver.ordinal,
            onSelect = { i -> vm.updateSettings { it.copy(screensaver = ScreensaverDelay.entries[i]) } },
            note = stringResource(R.string.settings_screensaver_note),
        )
        if (s.screensaver != ScreensaverDelay.Off) {
            Choice(
                title = stringResource(R.string.settings_screensaver_source),
                options = ScreensaverSource.entries.map { stringResource(it.label) },
                selected = s.screensaverSource.ordinal,
                onSelect = { i -> vm.updateSettings { it.copy(screensaverSource = ScreensaverSource.entries[i]) } },
            )
            Choice(
                title = stringResource(R.string.settings_screensaver_rating),
                options = ScreensaverRating.entries.map { stringResource(it.label) },
                selected = s.screensaverRating.ordinal,
                onSelect = { i -> vm.updateSettings { it.copy(screensaverRating = ScreensaverRating.entries[i]) } },
                note = stringResource(R.string.settings_screensaver_rating_note),
            )
        }
        if (vm.capabilities.isNotEmpty()) {
            SectionTitle(stringResource(R.string.settings_this_tv), Modifier.padding(top = 12.dp), inset = false)
            vm.capabilities.forEach { Text(it, fontSize = 14.sp, color = Palette.TextDim) }
        }
    }
}

private fun hexColor(hex: String): Color = Color((0xFF000000 or hex.substring(1).toLong(16)).toInt())

/**
 * The look: background, accent, poster size, and the Home (banner, rows on or off and in what order). Every choice is used and saved
 * at once; the last part keeps the look on the server, only when a button is pressed.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AppearanceTab(vm: AppViewModel, first: FocusRequester) {
    val look = vm.appearance
    TabBody {
        Text(stringResource(R.string.appearance_background), fontSize = 16.sp, color = Color.White)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CANVASES.forEach { canvas ->
                val on = look.theme.canvas == canvas.id
                SwatchPill(
                    stringResource(canvas.label),
                    hexColor(canvas.surface3),
                    selected = on,
                    onClick = { vm.chooseCanvas(canvas.id) },
                    modifier = if (on) Modifier.focusRequester(first) else Modifier,
                )
            }
        }
        Text(stringResource(R.string.appearance_accent), fontSize = 16.sp, color = Color.White, modifier = Modifier.padding(top = 8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ACCENTS.forEach { accent ->
                SwatchPill(
                    stringResource(accent.label),
                    hexColor(accent.color),
                    selected = accentColor(look.theme.accent) == accent.color,
                    onClick = { vm.chooseAccent(accent.id) },
                )
            }
        }
        Choice(
            stringResource(R.string.appearance_posters),
            PosterSize.entries.map { stringResource(it.label) },
            look.posters.ordinal,
            { vm.choosePosters(PosterSize.entries[it]) },
            note = stringResource(R.string.appearance_posters_note),
        )
        Toggle(stringResource(R.string.appearance_card_titles), look.cardTitles) { vm.chooseCardTitles(!look.cardTitles) }
        Note(stringResource(R.string.appearance_card_titles_note))
        Choice(
            stringResource(R.string.appearance_menu),
            NavStyle.entries.map { stringResource(it.label) },
            look.nav.ordinal,
            { vm.chooseNav(NavStyle.entries[it]) },
            note = stringResource(R.string.appearance_menu_note),
        )

        SectionTitle(stringResource(R.string.appearance_top_menu), Modifier.padding(top = 12.dp), inset = false)
        Note(stringResource(R.string.appearance_top_menu_note))
        look.menu.order.forEach { item ->
            key(item) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (item == MenuItem.Home) {
                        Text(stringResource(item.label), fontSize = 16.sp, color = Palette.TextDim, modifier = Modifier.width(430.dp).padding(horizontal = 20.dp))
                    } else {
                        Toggle(stringResource(item.label), item !in look.menu.hidden, Modifier.width(430.dp)) { vm.updateMenu { it.toggled(item) } }
                    }
                    Pill(stringResource(R.string.appearance_up), onClick = { vm.updateMenu { it.moved(item, -1) } })
                    Pill(stringResource(R.string.appearance_down), onClick = { vm.updateMenu { it.moved(item, 1) } })
                }
            }
        }
        Pill(stringResource(R.string.appearance_restore_menu), onClick = { vm.updateMenu { MenuLayout() } })

        SectionTitle(stringResource(R.string.appearance_home), Modifier.padding(top = 12.dp), inset = false)
        Toggle(stringResource(R.string.appearance_banner), look.home.banner) { vm.updateHome { it.copy(banner = !it.banner) } }
        Note(stringResource(R.string.appearance_rows_note))
        look.home.order.forEach { row ->
            key(row) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Toggle(stringResource(row.label), row !in look.home.hidden, Modifier.width(430.dp)) { vm.updateHome { it.toggled(row) } }
                    Pill(stringResource(R.string.appearance_up), onClick = { vm.updateHome { it.moved(row, -1) } })
                    Pill(stringResource(R.string.appearance_down), onClick = { vm.updateHome { it.moved(row, 1) } })
                }
            }
        }
        Pill(stringResource(R.string.appearance_restore_order), onClick = { vm.updateHome { it.copy(order = HomeRow.entries) } })

        SectionTitle(stringResource(R.string.backup_title), Modifier.padding(top = 12.dp), inset = false)
        Note(stringResource(R.string.backup_note))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Pill(stringResource(R.string.backup_save), onClick = vm::saveLookOnServer)
            Pill(stringResource(R.string.backup_load), onClick = vm::loadLookFromServer)
        }
    }
}

/** A choice of colour: a dot of it and its name, the chosen one marked. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun SwatchPill(label: String, color: Color, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(50)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (selected) Palette.Accent.copy(alpha = 0.28f) else Palette.Surface3,
            contentColor = Color.White,
            focusedContainerColor = Color.White,
            focusedContentColor = Color.Black,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.05f),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(18.dp).clip(CircleShape).background(color).border(1.dp, Color(0x66FFFFFF), CircleShape))
            Text(label, fontSize = 15.sp)
        }
    }
}

@Composable
private fun PluginsTab(vm: AppViewModel, first: FocusRequester) {
    val report = vm.plugins
    // Look when the tab opens, and keep looking every few seconds while a task of a plugin is running.
    LaunchedEffect(Unit) {
        vm.refreshPlugins()
        while (true) {
            delay(5_000)
            if (vm.plugins?.anyRunning == true) vm.refreshPlugins()
        }
    }
    TabBody {
        Surface(
            onClick = { vm.refreshPlugins() },
            modifier = Modifier.width(720.dp).focusRequester(first),
            shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
            colors = ClickableSurfaceDefaults.colors(
                containerColor = Palette.Surface2,
                contentColor = Palette.TextDim,
                focusedContainerColor = Palette.Surface4,
                focusedContentColor = Color.White,
            ),
            scale = ClickableSurfaceDefaults.scale(focusedScale = 1.0f),
        ) {
            Text(
                stringResource(R.string.plugins_intro) + "   ·   " + stringResource(R.string.plugins_refresh),
                fontSize = 14.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
        }
        when {
            report == null && vm.pluginsFailed -> Note(stringResource(R.string.plugins_failed))
            report == null -> Note(stringResource(R.string.plugins_loading))
            !report.admin -> Note(stringResource(R.string.plugins_admin_only))
            else -> {
                report.cards.forEach { PluginCardView(it) }
                if (report.others.isNotEmpty()) {
                    SectionTitle(stringResource(R.string.plugins_other), Modifier.padding(top = 8.dp), inset = false)
                    Text(report.others.joinToString("  ·  "), fontSize = 14.sp, color = Palette.TextDim, modifier = Modifier.width(720.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun PluginCardView(card: PluginCard) {
    // Focusable only so the remote can scroll down the list; there is nothing to press.
    Surface(
        onClick = {},
        modifier = Modifier.width(720.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Palette.Surface2,
            contentColor = Color.White,
            focusedContainerColor = Palette.Surface4,
            focusedContentColor = Color.White,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.0f),
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(card.kind.title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                val plugin = card.plugin
                Chip(
                    if (plugin == null) stringResource(R.string.plugins_not_installed)
                    else "${plugin.version} · " + if (plugin.status == "Active") stringResource(R.string.plugins_active) else plugin.status,
                )
            }
            Text(stringResource(card.kind.gives), fontSize = 13.sp, color = Palette.TextDim)
            if (card.plugin != null) {
                if (card.tasks.isEmpty()) Text(stringResource(R.string.plugins_no_tasks), fontSize = 13.sp, color = Palette.TextDim)
                card.tasks.forEach { TaskLine(it) }
            }
        }
    }
}

@Composable
private fun TaskLine(task: ServerTask) {
    val state = when {
        task.running -> stringResource(R.string.plugins_running, (task.progress ?: 0.0).toInt())
        task.lastResult != null && task.lastEndMs != null -> stringResource(
            R.string.plugins_last,
            when (task.lastResult) {
                "Completed" -> stringResource(R.string.result_completed)
                "Failed" -> stringResource(R.string.result_failed)
                "Cancelled" -> stringResource(R.string.result_cancelled)
                else -> task.lastResult.lowercase()
            },
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(task.lastEndMs)),
        )
        else -> stringResource(R.string.plugins_never)
    }
    Column(Modifier.padding(top = 6.dp)) {
        Text(task.name, fontSize = 15.sp, color = Color(0xFFE6E6E6))
        Text(state, fontSize = 13.sp, color = if (task.running) Palette.Accent else Palette.TextDim)
        if (task.running) {
            Box(Modifier.padding(top = 4.dp).fillMaxWidth().height(4.dp).background(Color(0x33FFFFFF))) {
                Box(Modifier.fillMaxWidth(((task.progress ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f)).height(4.dp).background(Palette.Accent))
            }
        }
    }
}

@Composable
private fun AccountTab(vm: AppViewModel, first: FocusRequester) {
    val context = LocalContext.current
    val version = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull().orEmpty() }
    var confirmSignOut by remember { mutableStateOf(false) }
    TabBody {
        Text(stringResource(R.string.settings_account, vm.userName), fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        Text(stringResource(R.string.settings_server, vm.serverUrl), fontSize = 15.sp, color = Palette.TextDim)

        Pill(stringResource(R.string.stats_open), onClick = vm::openStats, modifier = Modifier.padding(top = 14.dp).focusRequester(first))
        Text(stringResource(R.string.stats_open_note), fontSize = 13.sp, color = Palette.TextDim)

        SectionTitle(stringResource(R.string.settings_storage), Modifier.padding(top = 18.dp), inset = false)
        val cleared = stringResource(R.string.settings_cache_cleared)
        Pill(
            stringResource(R.string.settings_clear_cache),
            onClick = {
                val loader = SingletonImageLoader.get(context)
                loader.memoryCache?.clear()
                loader.diskCache?.clear()
                Toast.makeText(context, cleared, Toast.LENGTH_SHORT).show()
            },
        )

        // Signing out asks twice: the remote's OK is easy to press by accident.
        Pill(
            stringResource(if (confirmSignOut) R.string.settings_sign_out_confirm else R.string.settings_sign_out),
            onClick = { if (confirmSignOut) vm.signOut() else confirmSignOut = true },
            modifier = Modifier.padding(top = 18.dp).onFocusChanged { if (!it.hasFocus) confirmSignOut = false },
            accent = confirmSignOut,
        )

        Text(
            stringResource(R.string.settings_about, version),
            color = Palette.TextDim,
            fontSize = 13.sp,
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}

/**
 * A title, the choices as a row of buttons (the current one marked), and an optional explanation underneath.
 * Left and right stop at the ends of the row (they would jump to a tab); [entry] marks the choice that is on as where the tab's Down goes.
 */
@Composable
private fun Choice(title: String, options: List<String>, selected: Int, onSelect: (Int) -> Unit, note: String? = null, entry: FocusRequester? = null) {
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontSize = 16.sp, color = Color.White)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            options.forEachIndexed { i, label ->
                Pill(
                    label,
                    onClick = { onSelect(i) },
                    selected = i == selected,
                    modifier = Modifier
                        .focusProperties {
                            if (i == 0) left = FocusRequester.Cancel
                            if (i == options.lastIndex) right = FocusRequester.Cancel
                        }
                        .then(if (entry != null && i == selected) Modifier.focusRequester(entry) else Modifier),
                )
            }
        }
        note?.let { Note(it) }
    }
}

@Composable
private fun Note(text: String) {
    Text(text, fontSize = 13.sp, color = Palette.TextDim, modifier = Modifier.width(720.dp))
}

/** A switch the remote's OK flips: the label on the left, its state on the right. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Toggle(label: String, on: Boolean, modifier: Modifier = Modifier, onToggle: () -> Unit) {
    Surface(
        onClick = onToggle,
        modifier = modifier.width(720.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Palette.Surface2,
            contentColor = Color.White,
            focusedContainerColor = Color.White,
            focusedContentColor = Color.Black,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f),
    ) {
        Row(
            Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(label, fontSize = 16.sp, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                stringResource(if (on) R.string.settings_on else R.string.settings_off),
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (on) Color.White else Palette.TextDim,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (on) Palette.Accent else Palette.Surface4)
                    .padding(horizontal = 14.dp, vertical = 4.dp),
            )
        }
    }
}
