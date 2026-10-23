package app.jellyflix.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.DialogChoice

/**
 * The list of choices over the screen: the card menu (long-press OK on a title) and the filters. It is a window of its own, so the remote
 * cannot wander to what is behind it; Back goes up one level or closes it.
 */
@Composable
fun DialogHost(vm: AppViewModel) {
    val spec = vm.dialog ?: return
    Dialog(onDismissRequest = vm::closeDialog, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val first = remember(spec.title) { FocusRequester() }
        val start = spec.choices.indexOfFirst { it.selected }.coerceAtLeast(0)
        val state = rememberLazyListState()
        LaunchedEffect(spec.title) {
            state.scrollToItem((start - 2).coerceAtLeast(0))
            first.requestFocusSoon()
        }
        Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
            Column(
                Modifier.width(600.dp).clip(RoundedCornerShape(20.dp)).background(Palette.Surface2).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(spec.title, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
                LazyColumn(state = state, modifier = Modifier.heightIn(max = 400.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(spec.choices.size, key = { it }) { index ->
                        val choice = spec.choices[index]
                        DialogRow(
                            choice,
                            modifier = if (index == start) Modifier.focusRequester(first) else Modifier,
                            onClick = {
                                if (choice.closes) vm.showDialog(null)
                                choice.onPick()
                            },
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun DialogRow(choice: DialogChoice, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(12.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (choice.selected) Palette.Accent.copy(alpha = 0.22f) else Palette.Surface3,
            contentColor = Color.White,
            focusedContainerColor = Color.White,
            focusedContentColor = Color.Black,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f),
    ) {
        Row(Modifier.padding(horizontal = 18.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(choice.label, fontSize = 17.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (choice.selected) Text("✓", fontSize = 17.sp)
        }
    }
}
