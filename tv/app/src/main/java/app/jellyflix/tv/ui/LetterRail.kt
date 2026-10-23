package app.jellyflix.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Surface
import androidx.tv.material3.Text

private val letters = listOf("#") + ('A'..'Z').map { it.toString() }

/**
 * A row of letters under the sort choices (only in A-Z order): choosing one shows the list from the first title that starts
 * with it, so a library of thousands is crossed in a few presses instead of a few hundred.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun LetterRail(selected: String?, onPick: (String) -> Unit, modifier: Modifier = Modifier, inset: androidx.compose.ui.unit.Dp = 48.dp) {
    Row(
        modifier = modifier.padding(horizontal = inset),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        letters.forEach { letter ->
            val current = letter == (selected ?: "#")
            Surface(
                onClick = { onPick(letter) },
                shape = ClickableSurfaceDefaults.shape(CircleShape),
                colors = ClickableSurfaceDefaults.colors(
                    containerColor = if (current) Palette.Accent.copy(alpha = 0.28f) else Color.Transparent,
                    contentColor = if (current) Color.White else Palette.TextDim,
                    focusedContainerColor = Color.White,
                    focusedContentColor = Color.Black,
                ),
                scale = ClickableSurfaceDefaults.scale(focusedScale = 1.15f),
            ) {
                Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
                    Text(letter, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
