package app.jellyflix.tv.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme
import app.jellyflix.tv.data.PosterSize
import app.jellyflix.tv.data.ThemeChoice
import app.jellyflix.tv.data.ThemeColors
import app.jellyflix.tv.data.resolveTheme

private fun String.toColor(): Color = Color((0xFF000000 or substring(1).toLong(16)).toInt())

/**
 * Every colour the screens draw with, from the background and accent chosen in Settings (the default is the TV's original look: pure
 * black, one blue accent). The values are state, so a screen that reads them redraws when the choice changes.
 */
object Palette {
    private var current by mutableStateOf(resolveTheme(ThemeChoice()))

    fun apply(colors: ThemeColors) {
        current = colors
    }

    /** Text, icons, the focus ring and filled things. */
    val Accent get() = current.accent.toColor()
    /** Text and icons drawn on a filled [Accent]. */
    val AccentInk get() = current.ink.toColor()
    /** The canvas behind everything. */
    val Black get() = current.bg.toColor()
    val Surface get() = current.surface.toColor()
    val Surface2 get() = current.surface2.toColor()
    /** Buttons, rows and panels. */
    val Surface3 get() = current.surface3.toColor()
    /** A surface that has the focus or is lifted. */
    val Surface4 get() = current.surface4.toColor()
    val TextDim get() = current.muted.toColor()
}

/** How big the posters are (Settings, Appearance); the grids fit the columns that leaves room for. */
object Posters {
    var size by mutableStateOf(PosterSize.Comfortable)
    val scale: Float get() = size.scale

    /** Whether the cards carry their titles (Settings, Appearance). */
    var titles by mutableStateOf(true)

    /** [base] columns at the comfortable size, one more at the compact size, one fewer at the large one. */
    fun columns(base: Int): Int = (base + size.columnsOffset).coerceAtLeast(2)
}

/** How much the texts were scaled by Settings, so a bar with a fixed height can undo it for itself. */
val LocalTextScale = staticCompositionLocalOf { 1f }

/** Draws [content] with the texts at their normal size even when Settings made them bigger (the top bar has a fixed height). */
@Composable
fun NormalTextSize(content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val scale = LocalTextScale.current
    CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale / scale), content = content)
}

/** [textScale] makes every text bigger or smaller (Settings, Display) without touching the layout sizes. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun AppTheme(textScale: Float = 1f, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    CompositionLocalProvider(
        LocalDensity provides Density(density.density, density.fontScale * textScale),
        LocalTextScale provides textScale,
    ) {
        ThemeBody(content)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ThemeBody(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.Accent,
            onPrimary = Color.Black,
            background = Palette.Black,
            surface = Palette.Surface,
            onSurface = Color.White,
            onBackground = Color.White,
        ),
        content = {
            // Material 3 supplies the text fields, which TV Material does not have.
            androidx.compose.material3.MaterialTheme(
                colorScheme = androidx.compose.material3.darkColorScheme(
                    primary = Palette.Accent,
                    background = Palette.Black,
                    surface = Palette.Surface,
                ),
                content = content,
            )
        },
    )
}
