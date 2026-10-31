package app.jellyflix.tv.ui

import android.text.format.DateFormat
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.data.MediaItem
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import java.util.Date

private const val SHOW_MS = 12_000L
private const val FADE_MS = 1_500

/**
 * The screensaver: backdrops from the library, one after the other, each drifting slowly closer, with the title and the time in a
 * corner that changes with every picture (so no part of the screen holds the same thing for long). Any key ends it (see the activity).
 */
@Composable
fun Screensaver(pictures: List<MediaItem>) {
    if (pictures.isEmpty()) return
    var index by remember(pictures) { mutableIntStateOf(0) }
    LaunchedEffect(pictures) {
        while (true) {
            delay(SHOW_MS)
            index = (index + 1) % pictures.size
        }
    }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(15_000)
            now = System.currentTimeMillis()
        }
    }
    val context = LocalContext.current
    Box(Modifier.fillMaxSize().background(Color.Black).clipToBounds()) {
        Crossfade(targetState = index, animationSpec = tween(FADE_MS), label = "screensaver") { shown ->
            val picture = pictures[shown % pictures.size]
            val zoom = remember { Animatable(1f) }
            LaunchedEffect(shown) { zoom.animateTo(1.08f, tween((SHOW_MS + FADE_MS).toInt(), easing = LinearEasing)) }
            Box(Modifier.fillMaxSize()) {
                AsyncImage(
                    model = picture.backdropUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom.value; scaleY = zoom.value },
                )
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xAA000000)))))
                // The caption moves between the four corners as the pictures change.
                Column(
                    modifier = Modifier
                        .align(
                            when (shown % 4) {
                                0 -> Alignment.BottomStart
                                1 -> Alignment.BottomEnd
                                2 -> Alignment.TopEnd
                                else -> Alignment.TopStart
                            },
                        )
                        .padding(horizontal = 64.dp, vertical = 48.dp)
                        .alpha(0.9f),
                ) {
                    Text(picture.title, fontSize = 30.sp, color = Color.White)
                    Text(DateFormat.getTimeFormat(context).format(Date(now)), fontSize = 20.sp, color = Color(0xCCFFFFFF))
                }
            }
        }
    }
}
