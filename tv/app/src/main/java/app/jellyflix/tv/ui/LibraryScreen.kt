package app.jellyflix.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.LibraryState
import app.jellyflix.tv.R
import app.jellyflix.tv.data.Section
import app.jellyflix.tv.data.SortOption

/** The height of the banner at the top of Movies, Series and Anime (music videos have none). */
private val SectionBannerHeight = 380.dp

/** Draws a child [by] wider than the cell on each side, so a banner can reach the edges of a grid that has side padding. */
private fun Modifier.bleed(by: Dp) = layout { measurable, constraints ->
    val extra = by.roundToPx()
    val wide = constraints.maxWidth + extra * 2
    val placeable = measurable.measure(constraints.copy(minWidth = wide, maxWidth = wide))
    layout(constraints.maxWidth, placeable.height) { placeable.place(-extra, 0) }
}

/** [Hint] has side padding of its own; inside the padded grid it would be indented twice. */
private fun Modifier.offsetBack() = layout { measurable, constraints ->
    val back = 48.dp.roundToPx()
    val placeable = measurable.measure(constraints.copy(maxWidth = constraints.maxWidth + back))
    layout(constraints.maxWidth, placeable.height) { placeable.place(-back, 0) }
}

/**
 * Every movie, series, anime, music video or collection: a banner with the newest titles (not in Collections, nor while a filter is on), the
 * sort and filter choices, and the poster grid, all in one page that scrolls together; more load as the grid is scrolled.
 */
@Composable
fun LibraryScreen(vm: AppViewModel, lib: LibraryState) {
    // Ask for the next page when the last visible poster is close to the end of what is loaded (up to three header items come first).
    LaunchedEffect(lib) {
        snapshotFlow { lib.grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .collect { last -> if (last >= lib.items.size - 15) vm.loadMore(lib) }
    }
    val options = if (lib.section == Section.Collections) listOf(SortOption.Added, SortOption.Name) else SortOption.entries
    val banner = vm.sectionBanner(lib)
    val hasBanner = banner.isNotEmpty()
    // A music video's picture is a wide frame: fewer, larger cards.
    val wide = lib.section == Section.MusicVideos

    LazyVerticalGrid(
        columns = GridCells.Fixed(Posters.columns(if (wide) 4 else 6)),
        state = lib.grid,
        // Under the top bar, unless the banner takes its place there.
        contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = if (hasBanner) 0.dp else ContentTop, bottom = 40.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        if (hasBanner) item(key = "banner", span = { GridItemSpan(maxLineSpan) }) {
            HeroBanner(
                vm = vm,
                items = banner,
                index = lib.bannerIndex.coerceIn(0, banner.lastIndex),
                onIndex = { lib.bannerIndex = it },
                height = SectionBannerHeight,
                scrollToTop = { lib.grid.animateScrollToItem(0) },
                takesFirstFocus = false,
                modifier = Modifier.bleed(48.dp),
                bottomPadding = 40.dp,
            )
        }
        item(key = "sort", span = { GridItemSpan(maxLineSpan) }) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = if (hasBanner) 4.dp else 0.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                options.forEach { option ->
                    Pill(
                        stringResource(option.label),
                        onClick = { vm.sortBy(lib, option) },
                        selected = lib.sort == option,
                        // With a banner, the top bar's Down goes to its Play button; the sort choices take it only when there is none.
                        modifier = if (!hasBanner && lib.sort == option) Modifier.focusRequester(vm.contentEntry) else Modifier,
                    )
                }
                Pill(
                    if (lib.filters.isActive) stringResource(R.string.filters_button_count, lib.filters.count) else stringResource(R.string.filters_button),
                    onClick = { vm.openFilters(lib) },
                    selected = lib.filters.isActive,
                )
                if (lib.total > 0) {
                    Text(
                        stringResource(R.string.library_count, lib.total),
                        color = Palette.TextDim,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(start = 12.dp),
                    )
                }
            }
        }
        if (lib.sort == SortOption.Name) {
            item(key = "letters", span = { GridItemSpan(maxLineSpan) }) {
                LetterRail(selected = lib.letter, onPick = { vm.jumpToLetter(lib, it) }, inset = 0.dp)
            }
        }
        when {
            !lib.loaded && lib.loading -> item(key = "hint", span = { GridItemSpan(maxLineSpan) }) { Hint(stringResource(R.string.loading), Modifier.offsetBack()) }
            lib.loaded && lib.items.isEmpty() -> item(key = "hint", span = { GridItemSpan(maxLineSpan) }) {
                Hint(stringResource(if (lib.filters.isActive) R.string.filters_no_match else R.string.library_empty), Modifier.offsetBack())
            }
            else -> items(lib.items.size, key = { lib.items[it].id }) { index ->
                val item = lib.items[index]
                MediaCard(
                    item = item,
                    landscape = wide,
                    fillWidth = true,
                    onClick = { vm.open(item) },
                    restoreFocusTo = vm.restoreTarget,
                    onRestored = { vm.restoreTarget = null },
                    onFocused = { vm.lastFocused = it },
                )
            }
        }
    }
}
