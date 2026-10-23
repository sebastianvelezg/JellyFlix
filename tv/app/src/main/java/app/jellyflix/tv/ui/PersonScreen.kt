package app.jellyflix.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.PersonState
import app.jellyflix.tv.R
import coil3.compose.AsyncImage

/** A person (an actor) and the movies and series they are credited in. */
@Composable
fun PersonScreen(vm: AppViewModel, state: PersonState) {
    val person = state.person
    val items = state.items
    Row(Modifier.fillMaxSize().padding(start = 48.dp), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        Column(Modifier.width(260.dp).padding(top = 56.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.width(200.dp).aspectRatio(1f).clip(CircleShape).background(Palette.Surface)) {
                AsyncImage(model = person.imageUrl, contentDescription = person.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Text(person.name, fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Text(stringResource(R.string.person_known_for), fontSize = 14.sp, color = Palette.TextDim)
        }
        when {
            items == null -> Hint(stringResource(R.string.loading), Modifier.padding(top = 56.dp))
            items.isEmpty() -> Hint(stringResource(R.string.library_empty), Modifier.padding(top = 56.dp))
            else -> LazyVerticalGrid(
                columns = GridCells.Fixed(Posters.columns(4)),
                contentPadding = PaddingValues(top = 56.dp, end = 48.dp, bottom = 40.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
                modifier = Modifier.weight(1f).fillMaxSize(),
            ) {
                items(items.size, key = { items[it].id }) { index ->
                    val item = items[index]
                    MediaCard(item = item, landscape = false, fillWidth = true, onClick = { vm.open(item) })
                }
            }
        }
    }
}
