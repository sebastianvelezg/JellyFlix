package app.jellyflix.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import app.jellyflix.tv.AppViewModel
import app.jellyflix.tv.R
import org.jellyfin.sdk.model.api.BaseItemKind

/** One search box and the results in rows: movies and series, collections, albums and artists. */
@Composable
fun SearchScreen(vm: AppViewModel) {
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        OutlinedTextField(
            value = vm.query,
            onValueChange = vm::search,
            label = { androidx.compose.material3.Text(stringResource(R.string.search_hint)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            // The keyboard's Search key closes it (it covers half of the results) and moves on to the results.
            keyboardActions = KeyboardActions(onSearch = {
                keyboard?.hide()
                focusManager.moveFocus(FocusDirection.Down)
            }),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp).focusRequester(vm.contentEntry)
                // Down on the remote goes to the results even while the text field is active (it would otherwise keep the key).
                .onPreviewKeyEvent { event ->
                    if (event.key == Key.DirectionDown && event.type == KeyEventType.KeyDown) {
                        keyboard?.hide()
                        focusManager.moveFocus(FocusDirection.Down)
                    } else {
                        false
                    }
                },
        )
        val results = vm.results
        val (albums, artists) = vm.musicResults
        val titles = results?.filter { it.kind != BaseItemKind.BOX_SET && it.kind != BaseItemKind.MUSIC_VIDEO && !it.isBook && !it.isAudiobook }.orEmpty()
        val books = results?.filter { it.isBook || it.isAudiobook }.orEmpty()
        val collections = results?.filter { it.kind == BaseItemKind.BOX_SET }.orEmpty()
        val videos = results?.filter { it.kind == BaseItemKind.MUSIC_VIDEO }.orEmpty()
        when {
            results == null -> Hint(stringResource(R.string.search_prompt))
            titles.isEmpty() && collections.isEmpty() && videos.isEmpty() && books.isEmpty() && albums.isEmpty() && artists.isEmpty() ->
                Hint(stringResource(R.string.search_none, vm.query.trim()))
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 48.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                if (titles.isNotEmpty()) item {
                    Section(stringResource(R.string.search_titles)) {
                        items(titles.size, key = { titles[it].id }) { i -> MediaCard(titles[i], landscape = false, onClick = { vm.open(titles[i]) }) }
                    }
                }
                if (collections.isNotEmpty()) item {
                    Section(stringResource(R.string.search_collections)) {
                        items(collections.size, key = { collections[it].id }) { i -> MediaCard(collections[i], landscape = false, onClick = { vm.open(collections[i]) }) }
                    }
                }
                if (videos.isNotEmpty()) item {
                    Section(stringResource(R.string.search_music_videos)) {
                        items(videos.size, key = { videos[it].id }) { i -> MediaCard(videos[i], landscape = true, onClick = { vm.open(videos[i]) }) }
                    }
                }
                if (books.isNotEmpty()) item {
                    Section(stringResource(R.string.search_books)) {
                        items(books.size, key = { books[it].id }) { i -> MediaCard(books[i], landscape = false, onClick = { vm.open(books[i]) }) }
                    }
                }
                if (albums.isNotEmpty()) item {
                    Section(stringResource(R.string.search_albums)) {
                        items(albums.size, key = { albums[it].id }) { i ->
                            val a = albums[i]
                            CoverCard(a.id, a.name, a.artist, a.coverUrl, onClick = { vm.openAlbum(a) })
                        }
                    }
                }
                if (artists.isNotEmpty()) item {
                    Section(stringResource(R.string.search_artists)) {
                        items(artists.size, key = { artists[it].id }) { i ->
                            val a = artists[i]
                            CoverCard(a.id, a.name, null, a.imageUrl, onClick = { vm.openArtist(a) }, round = true)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionTitle(title)
        LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), content = content)
    }
}
