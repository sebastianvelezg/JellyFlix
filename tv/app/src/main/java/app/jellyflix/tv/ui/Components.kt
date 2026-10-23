package app.jellyflix.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.basicMarquee
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Glow
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.jellyflix.tv.R
import app.jellyflix.tv.data.MediaItem
import coil3.compose.AsyncImage
import org.jellyfin.sdk.model.api.BaseItemKind
import java.util.UUID

/**
 * Asks for focus, trying again for a moment: right after a screen appears the target may not be laid out yet, and on a
 * fast TV a single request made too early is lost (the remote then ends up on the top bar).
 */
suspend fun FocusRequester.requestFocusSoon(): Boolean {
    repeat(20) {
        if (runCatching { requestFocus() }.getOrDefault(false)) return true
        kotlinx.coroutines.delay(50)
    }
    return false
}

/** A section title with the accent bar the web client uses. */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, inset: Boolean = true) {
    Row(
        modifier = modifier.padding(horizontal = if (inset) 48.dp else 0.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(width = 4.dp, height = 20.dp).clip(RoundedCornerShape(2.dp)).background(Palette.Accent))
        Text(text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
    }
}

/** A small accent label, like the web client's `chip-accent`. */
@Composable
fun Chip(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.sp,
        color = Palette.Accent,
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(Palette.Accent.copy(alpha = 0.14f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

@Composable
private fun defaultSubtitle(item: MediaItem): String? =
    if (item.kind == BaseItemKind.BOX_SET) item.childCount?.let { stringResource(R.string.library_count, it) } else item.subtitle

/** "1 title" or "5 titles". */
@Composable
fun titlesLabel(count: Int): String =
    if (count == 1) stringResource(R.string.playlist_title_one) else stringResource(R.string.playlist_titles, count)

/** What long-pressing OK on a title does; the main activity sets it to open the card menu. */
val LocalCardMenu = androidx.compose.runtime.staticCompositionLocalOf<(MediaItem) -> Unit> { {} }

/**
 * A poster or a landscape still with its title below. When [restoreFocusTo] is this card's title it takes the
 * remote's focus once, so coming back from a title page lands where you left.
 */
@OptIn(ExperimentalTvMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun MediaCard(
    item: MediaItem,
    landscape: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    restoreFocusTo: UUID? = null,
    onFocused: (UUID) -> Unit = {},
    onRestored: () -> Unit = {},
    /** Fill the width of the grid cell instead of a fixed size. */
    fillWidth: Boolean = false,
    title: String = item.title,
    subtitle: String? = defaultSubtitle(item),
    /** Long-press OK: by default the card menu (open, watched, favorite, Watch later, playlists). */
    onLongClick: (() -> Unit)? = null,
) {
    val cardMenu = LocalCardMenu.current
    val width = (if (landscape) 250.dp else 150.dp) * Posters.scale
    val height = (if (landscape) 141.dp else 225.dp) * Posters.scale
    val requester = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(restoreFocusTo, item.id) {
        if (restoreFocusTo != null && restoreFocusTo == item.id) {
            requester.requestFocusSoon()
            onRestored()
        }
    }
    Column(
        modifier = if (fillWidth) Modifier.fillMaxWidth() else Modifier.width(width),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Card(
            onClick = onClick,
            onLongClick = onLongClick ?: { cardMenu(item) },
            modifier = modifier
                .then(
                    if (fillWidth) Modifier.fillMaxWidth().aspectRatio(if (landscape) 16f / 9f else 2f / 3f)
                    else Modifier.size(width, height),
                )
                .focusRequester(requester)
                .onFocusChanged {
                    focused = it.hasFocus
                    if (it.hasFocus) onFocused(item.id)
                },
            shape = CardDefaults.shape(RoundedCornerShape(12.dp)),
            scale = CardDefaults.scale(focusedScale = 1.08f),
            border = CardDefaults.border(
                focusedBorder = Border(BorderStroke(3.dp, Palette.Accent), shape = RoundedCornerShape(12.dp)),
            ),
            glow = CardDefaults.glow(focusedGlow = Glow(elevationColor = Palette.Accent.copy(alpha = 0.45f), elevation = 18.dp)),
        ) {
            Box(Modifier.fillMaxSize().background(Palette.Surface)) {
                val image = if (landscape) item.landscapeUrl else item.posterUrl
                if (image == null) {
                    Text(
                        item.title,
                        color = Palette.TextDim,
                        fontSize = 14.sp,
                        modifier = Modifier.align(Alignment.Center).padding(12.dp),
                    )
                }
                AsyncImage(
                    model = image,
                    contentDescription = item.title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                if (item.played) {
                    Text(
                        stringResource(R.string.watched_badge),
                        fontSize = 11.sp,
                        color = Color.White,
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(6.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xCC000000))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
                val progress = item.progress
                if (progress != null && progress > 0f && progress < 1f) {
                    Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(Color(0x99000000))) {
                        Box(Modifier.fillMaxWidth(progress).height(4.dp).background(Palette.Accent))
                    }
                }
            }
        }
        // A long title is cut with an ellipsis, but scrolls by itself while the card has the remote so it can be read whole.
        Text(
            title,
            color = Color.White,
            maxLines = 1,
            overflow = if (focused) TextOverflow.Clip else TextOverflow.Ellipsis,
            fontSize = 15.sp,
            modifier = if (focused) Modifier.basicMarquee(iterations = Int.MAX_VALUE, initialDelayMillis = 500) else Modifier,
        )
        subtitle?.let {
            Text(it, color = Palette.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
        }
    }
}

/** A rounded button used for tabs, sort choices and track lists; [selected] marks the current choice. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun Pill(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    accent: Boolean = false,
    /** The text fills the button and sits in the middle: for a button that is given a width of its own. */
    centered: Boolean = false,
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(50)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = when {
                accent -> Palette.Accent
                selected -> Palette.Accent.copy(alpha = 0.28f)
                else -> Palette.Surface3
            },
            contentColor = if (accent) Palette.AccentInk else Color.White,
            focusedContainerColor = Color.White,
            focusedContentColor = Color.Black,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.05f),
    ) {
        Text(
            text,
            fontSize = 15.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = if (centered) androidx.compose.ui.text.style.TextAlign.Center else null,
            modifier = (if (centered) Modifier.fillMaxWidth() else Modifier).padding(horizontal = 18.dp, vertical = 9.dp),
        )
    }
}

/** A round button with just a picture (like "another one"); [description] is what a screen reader says. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun IconPill(icon: Int, description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(androidx.compose.foundation.shape.CircleShape),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Palette.Surface3,
            contentColor = Color.White,
            focusedContainerColor = Color.White,
            focusedContentColor = Color.Black,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
    ) {
        Box(Modifier.size(38.dp), contentAlignment = Alignment.Center) {
            androidx.tv.material3.Icon(
                painter = painterResource(icon),
                contentDescription = description,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

/**
 * A square cover (album, playlist) or a round picture (artist) with its name below, like [MediaCard] but for music.
 * Focus restoring works the same way: the card whose id is [restoreFocusTo] takes the remote's focus once.
 */
@OptIn(ExperimentalTvMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun CoverCard(
    id: UUID,
    title: String,
    subtitle: String?,
    imageUrl: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    round: Boolean = false,
    fillWidth: Boolean = false,
    size: androidx.compose.ui.unit.Dp = 150.dp * Posters.scale,
    restoreFocusTo: UUID? = null,
    onFocused: (UUID) -> Unit = {},
    onRestored: () -> Unit = {},
) {
    val shape = if (round) androidx.compose.foundation.shape.CircleShape else RoundedCornerShape(12.dp)
    val requester = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(restoreFocusTo, id) {
        if (restoreFocusTo != null && restoreFocusTo == id) {
            requester.requestFocusSoon()
            onRestored()
        }
    }
    Column(
        modifier = if (fillWidth) Modifier.fillMaxWidth() else Modifier.width(size),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Card(
            onClick = onClick,
            modifier = modifier
                .then(if (fillWidth) Modifier.fillMaxWidth().aspectRatio(1f) else Modifier.size(size))
                .focusRequester(requester)
                .onFocusChanged {
                    focused = it.hasFocus
                    if (it.hasFocus) onFocused(id)
                },
            shape = CardDefaults.shape(shape),
            scale = CardDefaults.scale(focusedScale = 1.08f),
            border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, Palette.Accent), shape = shape)),
            glow = CardDefaults.glow(focusedGlow = Glow(elevationColor = Palette.Accent.copy(alpha = 0.45f), elevation = 18.dp)),
        ) {
            Box(Modifier.fillMaxSize().background(Palette.Surface)) {
                if (imageUrl == null) {
                    Text(title.take(2).uppercase(), color = Palette.TextDim, fontSize = 22.sp, modifier = Modifier.align(Alignment.Center))
                }
                AsyncImage(model = imageUrl, contentDescription = title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
        }
        Text(
            title,
            color = Color.White,
            maxLines = 1,
            overflow = if (focused) TextOverflow.Clip else TextOverflow.Ellipsis,
            fontSize = 15.sp,
            textAlign = if (round && !focused) androidx.compose.ui.text.style.TextAlign.Center else null,
            modifier = Modifier.fillMaxWidth().then(
                if (focused) Modifier.basicMarquee(iterations = Int.MAX_VALUE, initialDelayMillis = 500) else Modifier,
            ),
        )
        subtitle?.let {
            Text(
                it,
                color = Palette.TextDim,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontSize = 13.sp,
                textAlign = if (round) androidx.compose.ui.text.style.TextAlign.Center else null,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
