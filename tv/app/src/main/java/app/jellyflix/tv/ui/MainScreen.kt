package app.jellyflix.tv.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.R
import app.jellyflix.tv.Tab

/** The height the top bar takes; screens other than Home start below it. */
val TopBarHeight = 76.dp

/** Where a screen's own content starts when no banner reaches under the top bar: below the bar and its shade, with room for a focused button to grow. */
val ContentTop = TopBarHeight + 8.dp

/** The sections that draw under the top bar themselves (a banner at the top, or their own spacing). */
private val OwnTop = setOf(Tab.Home, Tab.Movies, Tab.Series, Tab.Anime, Tab.MusicVideos, Tab.Books, Tab.Collections)

/** The section, with the top bar floating over it (over the banner on Home, which reaches the top of the screen). */
@Composable
fun MainScreen(vm: AppViewModel) {
    Box(Modifier.fillMaxSize()) {
        val padding = if (vm.tab in OwnTop) Modifier else Modifier.padding(top = ContentTop)
        // While music is queued a bar sits at the bottom; the lists stop above it.
        val bar = if (vm.music?.hasQueue == true) Modifier.padding(bottom = 72.dp) else Modifier
        Box(Modifier.fillMaxSize().then(padding).then(bar)) {
            when (vm.tab) {
                Tab.Home -> HomeScreen(vm)
                Tab.Movies, Tab.Series, Tab.Anime, Tab.MusicVideos, Tab.Books, Tab.Collections -> vm.libraryOf(vm.tab)?.let { LibraryScreen(vm, it) }
                Tab.LiveTv -> LiveTvScreen(vm)
                Tab.Music -> MusicScreen(vm)
                Tab.Search -> SearchScreen(vm)
                Tab.Settings -> SettingsScreen(vm)
            }
        }
        NormalTextSize { TopBar(vm) }
        if (vm.music?.hasQueue == true) NowPlayingBar(vm, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun TopBar(vm: AppViewModel) {
    // Over the banner at the top of Home the bar only shades the picture; over scrolling rows it must hide them.
    // Read through derivedStateOf so scrolling recomposes the bar only when this answer changes, not on every frame.
    val tab = vm.tab
    val overBanner by remember(tab) {
        derivedStateOf {
            when (tab) {
                Tab.Home -> vm.home.list.firstVisibleItemIndex == 0 && vm.home.list.firstVisibleItemScrollOffset < 80
                Tab.Movies, Tab.Series, Tab.Anime -> vm.libraryOf(tab)?.let {
                    vm.sectionBanner(it).isNotEmpty() && it.grid.firstVisibleItemIndex == 0 && it.grid.firstVisibleItemScrollOffset < 80
                } == true
                else -> false
            }
        }
    }
    val shade = if (overBanner) Brush.verticalGradient(listOf(Color(0xB3000000), Color.Transparent))
    else Brush.verticalGradient(0f to Palette.Black, 0.78f to Palette.Black, 1f to Color.Transparent)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .onFocusChanged { vm.topBarFocused = it.hasFocus }
            .height(TopBarHeight + 20.dp)
            .background(shade)
            .padding(start = 48.dp, end = 48.dp, top = 18.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(modifier = Modifier.padding(end = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.logo), contentDescription = null, modifier = Modifier.size(40.dp))
            Image(
                painterResource(R.drawable.wordmark),
                contentDescription = stringResource(R.string.app_name),
                modifier = Modifier.height(22.dp),
            )
        }
        vm.tabs.forEach { tab ->
            Pill(
                stringResource(tab.label),
                onClick = { vm.select(tab) },
                selected = vm.tab == tab,
                // Down always lands on the section's first control (the default search skips it from some pills).
                modifier = Modifier.focusProperties { down = vm.contentEntry },
            )
        }
    }
}
