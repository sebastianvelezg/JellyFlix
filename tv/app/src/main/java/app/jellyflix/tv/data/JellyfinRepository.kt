package app.jellyflix.tv.data

import android.content.Context
import android.util.Log
import app.jellyflix.tv.R
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import org.jellyfin.sdk.api.client.ApiClient
import org.jellyfin.sdk.api.client.extensions.artistApi
import org.jellyfin.sdk.api.client.extensions.authenticationApi
import org.jellyfin.sdk.api.client.extensions.displayPreferenceApi
import org.jellyfin.sdk.api.client.extensions.filterApi
import org.jellyfin.sdk.api.client.extensions.imageApi
import org.jellyfin.sdk.api.client.extensions.libraryApi
import org.jellyfin.sdk.api.client.extensions.lyricApi
import org.jellyfin.sdk.api.client.extensions.mediaInfoApi
import org.jellyfin.sdk.api.client.extensions.mediaSegmentApi
import org.jellyfin.sdk.api.client.extensions.playlistApi
import org.jellyfin.sdk.api.client.extensions.pluginApi
import org.jellyfin.sdk.api.client.extensions.scheduledTaskApi
import org.jellyfin.sdk.api.client.extensions.userApi
import org.jellyfin.sdk.api.client.extensions.sessionApi
import org.jellyfin.sdk.api.client.extensions.showApi
import org.jellyfin.sdk.api.client.extensions.trickPlayApi
import kotlinx.coroutines.sync.withLock
import org.jellyfin.sdk.api.client.extensions.userDataApi
import org.jellyfin.sdk.api.client.extensions.userViewApi
import org.jellyfin.sdk.api.okhttp.OkHttpFactory
import org.jellyfin.sdk.createJellyfin
import org.jellyfin.sdk.model.ClientInfo
import org.jellyfin.sdk.model.api.AuthenticateUserByName
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.BaseItemKind
import org.jellyfin.sdk.model.api.CollectionType
import org.jellyfin.sdk.model.api.CreatePlaylistDto
import org.jellyfin.sdk.model.api.CodecProfile
import org.jellyfin.sdk.model.api.CodecType
import org.jellyfin.sdk.model.api.DeviceProfile
import org.jellyfin.sdk.model.api.DirectPlayProfile
import org.jellyfin.sdk.model.api.DlnaProfileType
import org.jellyfin.sdk.model.api.EncodingContext
import org.jellyfin.sdk.model.api.ImageType
import org.jellyfin.sdk.model.api.ItemFields
import org.jellyfin.sdk.model.api.ItemFilter
import org.jellyfin.sdk.model.api.ItemSortBy
import org.jellyfin.sdk.model.api.MediaSegmentType
import org.jellyfin.sdk.model.api.MediaType
import org.jellyfin.sdk.model.api.MediaSourceInfo
import org.jellyfin.sdk.model.api.MediaStream
import org.jellyfin.sdk.model.api.MediaStreamProtocol
import org.jellyfin.sdk.model.api.MediaStreamType
import org.jellyfin.sdk.model.api.PersonKind
import org.jellyfin.sdk.api.sockets.subscribe
import org.jellyfin.sdk.model.api.ClientCapabilitiesDto
import org.jellyfin.sdk.model.api.PlayCommand
import org.jellyfin.sdk.model.api.PlayMessage
import org.jellyfin.sdk.model.api.PlayMethod
import org.jellyfin.sdk.model.api.PlaystateCommand
import org.jellyfin.sdk.model.api.PlaystateMessage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import org.jellyfin.sdk.model.api.QuickConnectDto
import org.jellyfin.sdk.model.api.PlaybackOrder
import org.jellyfin.sdk.model.api.PlaybackInfoDto
import org.jellyfin.sdk.model.api.PlaybackProgressInfo
import org.jellyfin.sdk.model.api.PlaybackStartInfo
import org.jellyfin.sdk.model.api.PlaybackStopInfo
import org.jellyfin.sdk.model.api.RepeatMode
import org.jellyfin.sdk.model.api.SortOrder
import org.jellyfin.sdk.model.api.SubtitleDeliveryMethod
import org.jellyfin.sdk.model.api.ProfileCondition
import org.jellyfin.sdk.model.api.ProfileConditionType
import org.jellyfin.sdk.model.api.ProfileConditionValue
import org.jellyfin.sdk.model.api.SubtitleProfile
import org.jellyfin.sdk.model.api.TaskState
import org.jellyfin.sdk.model.api.TranscodingProfile
import java.util.UUID
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

private const val TAG = "JellyfinRepo"

/**
 * How many reads of the API may be on their way at once. A screen asks for many lists together and a small server answers all of them
 * more slowly than a few; the web client's number is the same.
 */
const val MAX_READS_AT_ONCE = 4

/** How many of the newest titles of a kind are read (the banner shows 16 of them, the row 20). */
private const val RECENT_LIMIT = 20

/** The most collections listed to find which one holds a title (one request; a big library has a few hundred). */
private const val MAX_COLLECTIONS_INDEXED = 1000

/** A position under this is "not started", so a stray click does not force a resume. */
const val MIN_RESUME_MS = 10_000L

class JellyfinRepository(context: Context) {
    private val appContext: Context = context.applicationContext

    // Every read of the API goes through one gate (see RequestGate); the web socket shares the same client.
    private val http = OkHttpFactory(
        okhttp3.OkHttpClient.Builder()
            // Let every waiting read in: the gate, not the dispatcher's per-host limit, decides who goes first.
            .dispatcher(okhttp3.Dispatcher().apply { maxRequests = 64; maxRequestsPerHost = 32 })
            .addInterceptor(
                ReadGateInterceptor(
                    RequestGate(MAX_READS_AT_ONCE),
                    debug = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0,
                ),
            )
            .build(),
    )

    private val jellyfin = createJellyfin {
        this.context = context.applicationContext
        clientInfo = ClientInfo(name = "Jellyflix TV", version = "1.0.0")
        apiClientFactory = http
        socketConnectionFactory = http
    }

    // One client per session, so a screen's dozen requests share the same connections instead of building a client each.
    private var cachedApi: Triple<String, String, ApiClient>? = null

    @Synchronized
    private fun api(session: Session): ApiClient {
        cachedApi?.let { (url, token, client) -> if (url == session.serverUrl && token == session.accessToken) return client }
        return jellyfin.createApi(baseUrl = session.serverUrl, accessToken = session.accessToken).also {
            cachedApi = Triple(session.serverUrl, session.accessToken, it)
        }
    }

    private fun userId(session: Session): UUID = UUID.fromString(session.userId)

    /** "jellyfin.local:8096" becomes "http://jellyfin.local:8096". */
    fun normalizeServer(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "http://$trimmed"
    }

    suspend fun signIn(server: String, user: String, password: String): Session {
        val url = normalizeServer(server)
        val api = jellyfin.createApi(baseUrl = url)
        val result = api.authenticationApi.authenticateUserByName(AuthenticateUserByName(username = user, pw = password)).content
        val token = result.accessToken ?: error("The server did not return a session")
        val userDto = result.user ?: error("The server did not return a user")
        return Session(url, token, userDto.id.toString(), userDto.name ?: user)
    }

    // ---- Quick Connect: sign in with a code approved from another device -----------------------------------------------

    /** The code to show and the secret that proves it is ours. */
    class QuickConnectStart(val serverUrl: String, val code: String, val secret: String)

    suspend fun quickConnectStart(server: String): QuickConnectStart {
        val url = normalizeServer(server)
        val api = jellyfin.createApi(baseUrl = url)
        if (!api.authenticationApi.getQuickConnectEnabled().content) throw QuickConnectOff()
        val result = api.authenticationApi.initiateQuickConnect().content
        return QuickConnectStart(url, result.code, result.secret)
    }

    /** True once somebody entered the code on a signed-in device. */
    suspend fun quickConnectApproved(start: QuickConnectStart): Boolean =
        jellyfin.createApi(baseUrl = start.serverUrl).authenticationApi.getQuickConnectState(start.secret).content.authenticated

    suspend fun quickConnectFinish(start: QuickConnectStart): Session {
        val api = jellyfin.createApi(baseUrl = start.serverUrl)
        val result = api.authenticationApi.authenticateWithQuickConnect(QuickConnectDto(secret = start.secret)).content
        val token = result.accessToken ?: error("The server did not return a session")
        val user = result.user ?: error("The server did not return a user")
        return Session(start.serverUrl, token, user.id.toString(), user.name.orEmpty())
    }

    /** The server has Quick Connect switched off (Dashboard, General). */
    class QuickConnectOff : Exception("Quick Connect is off")

    // ---- Being controlled from another device ("Play on the TV") -----------------------------------------------------

    /** What another Jellyfin app asked this TV to do. */
    sealed interface RemoteMessage {
        class Play(val itemIds: List<UUID>, val startMs: Long, val command: PlayCommand) : RemoteMessage
        class State(val command: PlaystateCommand, val seekMs: Long?) : RemoteMessage
    }

    /** Tells the server this TV can be controlled and what it can play, so it shows up in other apps' "Play on" list. */
    suspend fun registerRemote(session: Session) {
        api(session).sessionApi.postFullCapabilities(
            data = ClientCapabilitiesDto(
                playableMediaTypes = listOf(MediaType.VIDEO, MediaType.AUDIO),
                supportedCommands = emptyList(),
                supportsMediaControl = true,
                supportsPersistentIdentifier = true,
            ),
        )
    }

    /** Play and playback-state requests arriving over the server's web socket; the socket reconnects by itself. */
    fun remoteMessages(session: Session): Flow<RemoteMessage> {
        val socket = api(session).webSocket
        val plays = socket.subscribe<PlayMessage>().map { message ->
            val data = message.data
            RemoteMessage.Play(data?.itemIds.orEmpty(), (data?.startPositionTicks ?: 0L) / 10_000, data?.playCommand ?: PlayCommand.PLAY_NOW)
        }
        val states = socket.subscribe<PlaystateMessage>().map { message ->
            RemoteMessage.State(message.data?.command ?: PlaystateCommand.PLAY_PAUSE, message.data?.seekPositionTicks?.let { it / 10_000 })
        }
        return merge(plays, states)
    }

    // ---- Browsing ---------------------------------------------------------------------------------------------

    private val animeName = Regex("anim[eé]s?(?![a-z])", RegexOption.IGNORE_CASE)

    suspend fun libraries(session: Session): Libraries {
        val api = api(session)
        val views = api.userViewApi.getUserViews(userId = userId(session)).content.items
        val movies = ArrayList<Lib>()
        val series = ArrayList<Lib>()
        val anime = ArrayList<Lib>()
        val music = ArrayList<Lib>()
        val musicVideos = ArrayList<Lib>()
        for (view in views) {
            val lib = Lib(view.id, view.name.orEmpty())
            when (view.collectionType) {
                CollectionType.MOVIES -> movies.add(lib)
                CollectionType.MUSIC -> music.add(lib)
                CollectionType.MUSICVIDEOS -> musicVideos.add(lib)
                CollectionType.TVSHOWS -> if (animeName.containsMatchIn(lib.name)) anime.add(lib) else series.add(lib)
                else -> Unit
            }
        }
        return Libraries(movies, series, anime, music, musicVideos)
    }

    private val richFields = listOf(ItemFields.OVERVIEW, ItemFields.GENRES)

    private suspend fun listRecent(api: ApiClient, userId: UUID, kind: BaseItemKind, libs: List<Lib>, limit: Int, rich: Boolean) =
        interleave(
            coroutineScope {
                libs.map { lib ->
                    async {
                        runCatching {
                            api.libraryApi.getItems(
                                userId = userId,
                                parentId = lib.id,
                                includeItemTypes = listOf(kind),
                                recursive = true,
                                sortBy = listOf(ItemSortBy.DATE_CREATED),
                                sortOrder = listOf(SortOrder.DESCENDING),
                                limit = limit,
                                fields = if (rich) richFields else null,
                                enableTotalRecordCount = false,
                            ).content.items.map { toItem(api, it) }
                        }.onFailure { Log.w(TAG, "Could not load the newest $kind", it) }.getOrDefault(emptyList())
                    }
                }.map { it.await() }
            },
        ).take(limit)

    /** Random titles with a backdrop worth featuring: unseen and decently rated first, relaxed when that is too strict. */
    private suspend fun listFeatured(api: ApiClient, userId: UUID, kind: BaseItemKind, libs: List<Lib>): List<MediaItem> =
        interleave(
            coroutineScope {
                libs.map { lib ->
                    async {
                        runCatching {
                            suspend fun ask(strict: Boolean) = api.libraryApi.getItems(
                                userId = userId,
                                parentId = lib.id,
                                includeItemTypes = listOf(kind),
                                recursive = true,
                                sortBy = listOf(ItemSortBy.RANDOM),
                                imageTypes = listOf(ImageType.BACKDROP),
                                filters = if (strict) listOf(ItemFilter.IS_UNPLAYED) else null,
                                minCommunityRating = if (strict) 6.0 else null,
                                limit = 20,
                                fields = richFields,
                                enableTotalRecordCount = false,
                            ).content.items.map { toItem(api, it) }.filter { it.backdropUrl != null }
                            val strict = ask(true)
                            if (strict.size >= 8) strict else strict + ask(false)
                        }.onFailure { Log.w(TAG, "Could not load featured $kind", it) }.getOrDefault(emptyList())
                    }
                }.map { it.await() }
            },
        )

    /** The Home banner: movies and series in turns, newest first then random picks (see [buildHomeLineup]). */
    suspend fun homeLineup(session: Session, libs: Libraries): List<MediaItem> = coroutineScope {
        val api = api(session)
        val userId = userId(session)
        val movieRecent = async { recent(api, userId, BaseItemKind.MOVIE, libs.movies).take(16) }
        val showRecent = async { recent(api, userId, BaseItemKind.SERIES, libs.shows).take(16) }
        val moviePool = async { listFeatured(api, userId, BaseItemKind.MOVIE, libs.movies) }
        val showPool = async { listFeatured(api, userId, BaseItemKind.SERIES, libs.shows) }
        buildHomeLineup(movieRecent.await() to moviePool.await(), showRecent.await() to showPool.await())
    }

    // The banner and the "Latest" row both want the newest titles of a kind: one request, with the detail the banner needs.
    private val recents = InFlight<Triple<UUID, BaseItemKind, List<Lib>>, List<MediaItem>>()

    private suspend fun recent(api: ApiClient, userId: UUID, kind: BaseItemKind, libs: List<Lib>): List<MediaItem> =
        recents.share(Triple(userId, kind, libs)) { listRecent(api, userId, kind, libs, RECENT_LIMIT, rich = true) }

    suspend fun latest(session: Session, kind: BaseItemKind, libs: List<Lib>, limit: Int = RECENT_LIMIT): List<MediaItem> =
        if (limit <= RECENT_LIMIT) recent(api(session), userId(session), kind, libs).take(limit)
        else listRecent(api(session), userId(session), kind, libs, limit, rich = false)

    /**
     * Movies and episodes (and music videos, when the account has a library of them) you stopped half-way, most recently watched
     * first. Asked for separately and at the same time:
     * on a real server one request for both took several seconds, each alone a fraction of that.
     */
    suspend fun continueAll(session: Session, withMusicVideos: Boolean = false): List<MediaItem> = coroutineScope {
        val api = api(session)
        val userId = userId(session)
        fun read(kind: BaseItemKind) = async {
            runCatching {
                api.libraryApi.getResumeItems(userId = userId, limit = 16, includeItemTypes = listOf(kind), enableTotalRecordCount = false).content.items
                    .map { toItem(api, it) }
            }.onFailure { Log.w(TAG, "Could not load resume items", it) }.getOrDefault(emptyList())
        }
        val movies = read(BaseItemKind.MOVIE)
        val episodes = read(BaseItemKind.EPISODE)
        val videos = if (withMusicVideos) read(BaseItemKind.MUSIC_VIDEO) else null
        newestFirst(movies.await() + episodes.await() + videos?.await().orEmpty()).filter { it.resumeMs >= MIN_RESUME_MS }.take(16)
    }

    suspend fun nextUp(session: Session): List<MediaItem> {
        val api = api(session)
        return runCatching {
            api.showApi.getNextUp(userId = userId(session), limit = 20, enableTotalRecordCount = false).content.items.map { toItem(api, it) }
        }.onFailure { Log.w(TAG, "Could not load next up", it) }.getOrDefault(emptyList())
    }

    /** A random movie, unwatched if there is one, from any movie library. */
    suspend fun randomMovie(session: Session, libs: List<Lib>): MediaItem? {
        val api = api(session)
        for (lib in libs.shuffled()) for (unwatched in listOf(true, false)) {
            val item = api.libraryApi.getItems(
                userId = userId(session),
                parentId = lib.id,
                includeItemTypes = listOf(BaseItemKind.MOVIE),
                recursive = true,
                sortBy = listOf(ItemSortBy.RANDOM),
                filters = if (unwatched) listOf(ItemFilter.IS_UNPLAYED) else null,
                limit = 1,
                fields = richFields,
                enableTotalRecordCount = false,
            ).content.items.firstOrNull()
            if (item != null) return toItem(api, item)
        }
        return null
    }

    /** A random series none of whose episodes you have watched, with its first real episode. */
    suspend fun freshSeries(session: Session, libs: List<Lib>): FreshSeries? {
        val api = api(session)
        for (lib in libs.shuffled()) {
            val candidates = api.libraryApi.getItems(
                userId = userId(session),
                parentId = lib.id,
                includeItemTypes = listOf(BaseItemKind.SERIES),
                recursive = true,
                sortBy = listOf(ItemSortBy.RANDOM),
                filters = listOf(ItemFilter.IS_UNPLAYED),
                limit = 8,
                fields = richFields,
                enableTotalRecordCount = false,
            ).content.items
            for (dto in candidates) {
                val episodes = runCatching {
                    api.showApi.getEpisodes(seriesId = dto.id, userId = userId(session), limit = 30).content.items
                        .map { toItem(api, it) }.filter { it.seasonNumber != 0 }
                }.getOrDefault(emptyList())
                val first = episodes.firstOrNull() ?: continue
                if (episodes.none { it.played || it.resumeMs > 0 }) return FreshSeries(toItem(api, dto), first)
            }
        }
        return null
    }

    /** One page of a library list (movies, series, anime or collections) in the chosen order. */
    suspend fun library(
        session: Session,
        section: Section,
        libs: List<Lib>,
        sort: SortOption,
        startIndex: Int,
        limit: Int,
        withTotal: Boolean = startIndex == 0,
        narrowedBy: LibraryFilters = LibraryFilters(),
    ): Page<MediaItem> {
        val api = api(session)
        val (sortBy, order) = when (sort) {
            SortOption.Added -> listOf(ItemSortBy.DATE_CREATED, ItemSortBy.SORT_NAME) to SortOrder.DESCENDING
            SortOption.Name -> listOf(ItemSortBy.SORT_NAME) to SortOrder.ASCENDING
            SortOption.Year -> listOf(ItemSortBy.PRODUCTION_YEAR, ItemSortBy.SORT_NAME) to SortOrder.DESCENDING
            SortOption.Rating -> listOf(ItemSortBy.COMMUNITY_RATING, ItemSortBy.SORT_NAME) to SortOrder.DESCENDING
        }
        val kind = when (section) {
            Section.Movies -> BaseItemKind.MOVIE
            Section.Collections -> BaseItemKind.BOX_SET
            Section.MusicVideos -> BaseItemKind.MUSIC_VIDEO
            else -> BaseItemKind.SERIES
        }
        val result = api.libraryApi.getItems(
            userId = userId(session),
            // With one library of this kind ask for it; with several (or collections, which have a hidden library) ask everywhere.
            parentId = libs.singleOrNull()?.id,
            includeItemTypes = listOf(kind),
            recursive = true,
            sortBy = sortBy,
            sortOrder = listOf(order),
            startIndex = startIndex,
            limit = limit,
            fields = if (section == Section.Collections) listOf(ItemFields.CHILD_COUNT) else null,
            filters = itemFilters(narrowedBy),
            genres = narrowedBy.genre?.let { listOf(it) },
            officialRatings = narrowedBy.ageRating?.let { listOf(it) },
            years = narrowedBy.years,
            minCommunityRating = narrowedBy.minRating?.toDouble(),
            is4k = narrowedBy.only4k.takeIf { it },
            enableTotalRecordCount = withTotal,
        ).content
        return Page(result.items.map { toItem(api, it) }, result.totalRecordCount.takeIf { withTotal })
    }

    /** How many titles sort before [letter] ("B" counts every title that starts with A, a digit or a symbol): where that letter starts. */
    suspend fun libraryCountBefore(session: Session, section: Section, libs: List<Lib>, letter: String, narrowedBy: LibraryFilters = LibraryFilters()): Int {
        val kind = when (section) {
            Section.Movies -> BaseItemKind.MOVIE
            Section.Collections -> BaseItemKind.BOX_SET
            Section.MusicVideos -> BaseItemKind.MUSIC_VIDEO
            else -> BaseItemKind.SERIES
        }
        return api(session).libraryApi.getItems(
            userId = userId(session),
            parentId = libs.singleOrNull()?.id,
            includeItemTypes = listOf(kind),
            recursive = true,
            nameLessThan = letter,
            limit = 0,
            filters = itemFilters(narrowedBy),
            genres = narrowedBy.genre?.let { listOf(it) },
            officialRatings = narrowedBy.ageRating?.let { listOf(it) },
            years = narrowedBy.years,
            minCommunityRating = narrowedBy.minRating?.toDouble(),
            is4k = narrowedBy.only4k.takeIf { it },
            enableTotalRecordCount = true,
        ).content.totalRecordCount
    }

    private fun itemFilters(f: LibraryFilters): List<ItemFilter>? = buildList {
        when (f.watched) {
            WatchedFilter.Unwatched -> add(ItemFilter.IS_UNPLAYED)
            WatchedFilter.Watched -> add(ItemFilter.IS_PLAYED)
            WatchedFilter.All -> Unit
        }
        if (f.favoritesOnly) add(ItemFilter.IS_FAVORITE)
    }.ifEmpty { null }

    /** The genres and age ratings the titles of a library have, from one scan of the library (slow on a big one, so asked for last). */
    suspend fun filterOptions(session: Session, section: Section, libs: List<Lib>): FilterOptions {
        val kind = when (section) {
            Section.Movies -> BaseItemKind.MOVIE
            Section.Collections -> BaseItemKind.BOX_SET
            Section.MusicVideos -> BaseItemKind.MUSIC_VIDEO
            else -> BaseItemKind.SERIES
        }
        val found = api(session).filterApi.getQueryFiltersLegacy(
            userId = userId(session),
            parentId = libs.singleOrNull()?.id,
            includeItemTypes = listOf(kind),
        ).content
        return FilterOptions(
            genres = found.genres.orEmpty().filter { it.isNotBlank() }.sortedBy { it.lowercase() },
            ageRatings = found.officialRatings.orEmpty().filter { it.isNotBlank() }.sorted(),
        )
    }

    /** Movies and series marked as favourites, for the Home row. */
    suspend fun favorites(session: Session, limit: Int = 20): List<MediaItem> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            includeItemTypes = listOf(BaseItemKind.MOVIE, BaseItemKind.SERIES),
            recursive = true,
            filters = listOf(ItemFilter.IS_FAVORITE),
            sortBy = listOf(ItemSortBy.SORT_NAME),
            sortOrder = listOf(SortOrder.ASCENDING),
            limit = limit,
            enableTotalRecordCount = false,
        ).content.items.map { toItem(api, it) }
    }

    // ---- Playlists of movies and episodes and "Watch later" -------------------------------------------------------

    private val playlistReads = InFlight<UUID, List<VideoPlaylist>>()

    /** The playlists of videos. Readers asking together (the Home rows) share one request. */
    suspend fun videoPlaylists(session: Session): List<VideoPlaylist> {
        val api = api(session)
        val userId = userId(session)
        return playlistReads.share(userId) {
            api.libraryApi.getItems(
                userId = userId,
                includeItemTypes = listOf(BaseItemKind.PLAYLIST),
                mediaTypes = listOf(MediaType.VIDEO),
                recursive = true,
                sortBy = listOf(ItemSortBy.SORT_NAME),
                sortOrder = listOf(SortOrder.ASCENDING),
                fields = listOf(ItemFields.CHILD_COUNT),
                enableTotalRecordCount = false,
            ).content.items.map { VideoPlaylist(it.id, it.name.orEmpty(), cover(api, it.id, it.imageTags?.get(ImageType.PRIMARY)), it.childCount) }
        }
    }

    suspend fun playlistEntries(session: Session, playlistId: UUID): List<PlaylistEntry> {
        val api = api(session)
        return api.playlistApi.getPlaylistItems(playlistId = playlistId, userId = userId(session), limit = 500).content.items
            .mapNotNull { dto -> dto.playlistItemId?.let { PlaylistEntry(it, toItem(api, dto)) } }
    }

    /** Makes a playlist (with these titles in it) and returns the id the server gave it (as it wrote it: without dashes). */
    suspend fun createVideoPlaylist(session: Session, name: String, itemIds: List<UUID>): String =
        api(session).playlistApi.createPlaylist(
            CreatePlaylistDto(name = name.trim(), ids = itemIds, userId = userId(session), mediaType = MediaType.VIDEO, users = emptyList(), isPublic = false),
        ).content.id

    suspend fun addToPlaylist(session: Session, playlistId: UUID, itemIds: List<UUID>) {
        api(session).playlistApi.addItemToPlaylist(playlistId = playlistId, ids = itemIds, userId = userId(session))
    }

    /**
     * Puts a title in the "Watch later" playlist, making the playlist first when there is none (named [name], in the language of the
     * app). A title that is already there is not added twice.
     */
    suspend fun addToWatchLater(session: Session, itemId: UUID, name: String): WatchLaterResult {
        val existing = findWatchLater(videoPlaylists(session))
            ?: run {
                createVideoPlaylist(session, name, listOf(itemId))
                return WatchLaterResult.Created
            }
        if (playlistEntries(session, existing.id).any { it.item.id == itemId }) return WatchLaterResult.AlreadyThere
        addToPlaylist(session, existing.id, listOf(itemId))
        return WatchLaterResult.Added
    }

    /** Takes a title out of "Watch later" (every place it has there). False when it was not there. */
    suspend fun removeFromWatchLater(session: Session, itemId: UUID): Boolean {
        val list = findWatchLater(videoPlaylists(session)) ?: return false
        val places = playlistEntries(session, list.id).filter { it.item.id == itemId }.map { it.entryId }
        if (places.isEmpty()) return false
        removeFromPlaylist(session, list.id, places)
        return true
    }

    /** Takes places out of a playlist (the entry ids, not the titles' ids). */
    suspend fun removeFromPlaylist(session: Session, playlistId: UUID, entryIds: List<String>) {
        api(session).playlistApi.removeItemFromPlaylist(playlistId = playlistId.toString(), entryIds = entryIds)
    }

    /** Moves one place of a playlist to another position (0 is the first). */
    suspend fun moveInPlaylist(session: Session, playlistId: UUID, entryId: String, newIndex: Int) {
        api(session).playlistApi.moveItem(playlistId = playlistId.toString(), itemId = entryId, newIndex = newIndex)
    }

    suspend fun deletePlaylist(session: Session, playlistId: UUID) {
        api(session).libraryApi.deleteItem(itemId = playlistId)
    }

    /** A random handful of collections (servers often give every collection the same added date). */
    suspend fun randomCollections(session: Session, limit: Int = 16): List<MediaItem> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            includeItemTypes = listOf(BaseItemKind.BOX_SET),
            recursive = true,
            sortBy = listOf(ItemSortBy.RANDOM),
            limit = limit,
            fields = listOf(ItemFields.CHILD_COUNT),
            enableTotalRecordCount = false,
        ).content.items.map { toItem(api, it) }
    }

    /**
     * "Because you watched X": the title you finished most recently (a series, when it was an episode) and what the server finds
     * similar to it that you have not seen. Null when there is nothing worth a row.
     */
    suspend fun becauseYouWatched(session: Session): Pair<MediaItem, List<MediaItem>>? {
        val api = api(session)
        val userId = userId(session)
        val last = api.libraryApi.getItems(
            userId = userId,
            includeItemTypes = listOf(BaseItemKind.MOVIE, BaseItemKind.EPISODE),
            recursive = true,
            filters = listOf(ItemFilter.IS_PLAYED),
            sortBy = listOf(ItemSortBy.DATE_PLAYED),
            sortOrder = listOf(SortOrder.DESCENDING),
            limit = 1,
            enableTotalRecordCount = false,
        ).content.items.firstOrNull() ?: return null
        val seedId = if (last.type == BaseItemKind.EPISODE) last.seriesId ?: return null else last.id
        val similar = api.libraryApi.getSimilarItems(itemId = seedId, userId = userId, limit = 24).content.items
            .filter { it.userData?.played != true }
            .map { toItem(api, it) }
            .take(16)
        if (similar.size < 4) return null
        val seed = if (last.type == BaseItemKind.EPISODE) last.seriesName.orEmpty() else last.name.orEmpty()
        return toItem(api, last).copy(title = seed) to similar
    }

    /** The lyrics the server has for a song (its own tags or a lyrics plugin); null when it has none. */
    suspend fun lyrics(session: Session, songId: UUID): Lyrics? = try {
        val dto = api(session).lyricApi.getLyrics(songId).content
        Lyrics.parse(dto.lyrics.map { it.start to it.text }, dto.metadata.offset ?: 0)
    } catch (e: org.jellyfin.sdk.api.client.exception.InvalidStatusException) {
        // 404: no lyrics for this song.
        if (e.status == 404) null else throw e
    }

    /**
     * Asks the server's lyrics plugin (LrcLib and the like) for timed lyrics of a song and saves the best one beside the song, where
     * the server serves it from then on. Null when no source has timed ones. Only an administrator may save lyrics (a 403 is thrown).
     */
    suspend fun findTimedLyrics(session: Session, songId: UUID): Lyrics? {
        val api = api(session).lyricApi
        val best = api.searchRemoteLyrics(songId).content.firstOrNull { remote ->
            Lyrics.parse(remote.lyrics.lyrics.map { it.start to it.text }, remote.lyrics.metadata.offset ?: 0)?.synced == true
        } ?: return null
        val saved = api.downloadRemoteLyrics(songId, best.id).content
        return Lyrics.parse(saved.lyrics.map { it.start to it.text }, saved.metadata.offset ?: 0)
            ?: Lyrics.parse(best.lyrics.lyrics.map { it.start to it.text }, best.lyrics.metadata.offset ?: 0)
    }

    /** What is in a collection, oldest first so a saga reads in order. */
    suspend fun collectionItems(session: Session, id: UUID): List<MediaItem> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            parentId = id,
            sortBy = listOf(ItemSortBy.PRODUCTION_YEAR, ItemSortBy.SORT_NAME),
            sortOrder = listOf(SortOrder.ASCENDING),
            enableTotalRecordCount = false,
        ).content.items.map { toItem(api, it) }.sortedBy { it.year ?: Int.MAX_VALUE }
    }

    /** Movies and series a person is credited in, newest first. */
    suspend fun personItems(session: Session, personId: UUID): List<MediaItem> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            personIds = listOf(personId),
            includeItemTypes = listOf(BaseItemKind.MOVIE, BaseItemKind.SERIES),
            recursive = true,
            sortBy = listOf(ItemSortBy.PRODUCTION_YEAR, ItemSortBy.SORT_NAME),
            sortOrder = listOf(SortOrder.DESCENDING),
            limit = 120,
            enableTotalRecordCount = false,
        ).content.items.map { toItem(api, it) }
    }

    /** Albums and artists matching the text. */
    suspend fun searchMusic(session: Session, term: String, limit: Int = 12): Pair<List<Album>, List<Artist>> = coroutineScope {
        val api = api(session)
        val albums = async {
            runCatching {
                api.libraryApi.getItems(
                    userId = userId(session), searchTerm = term, includeItemTypes = listOf(BaseItemKind.MUSIC_ALBUM),
                    recursive = true, limit = limit,
                    enableTotalRecordCount = false,
                ).content.items.map { toAlbum(api, it) }
            }.getOrDefault(emptyList())
        }
        val artists = async {
            runCatching {
                api.artistApi.getAlbumArtists(userId = userId(session), searchTerm = term, limit = limit, enableTotalRecordCount = false).content.items.map { toArtist(api, it) }
            }.getOrDefault(emptyList())
        }
        albums.await() to artists.await()
    }

    suspend fun search(session: Session, term: String): List<MediaItem> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            searchTerm = term,
            includeItemTypes = listOf(BaseItemKind.MOVIE, BaseItemKind.SERIES, BaseItemKind.BOX_SET, BaseItemKind.MUSIC_VIDEO),
            recursive = true,
            limit = 40,
            enableTotalRecordCount = false,
        ).content.items.map { toItem(api, it) }
    }

    /** The full record of one title (the lists leave out the overview and genres). */
    suspend fun details(session: Session, id: UUID): MediaItem {
        val api = api(session)
        return toItem(api, api.libraryApi.getItem(itemId = id, userId = userId(session)).content)
    }

    // ---- Playback Reporting -------------------------------------------------------------------------------------

    private val plainHttp by lazy { okhttp3.OkHttpClient() }

    /**
     * The play history the Playback Reporting plugin keeps for the signed-in user, or null when it cannot be had: the plugin is not
     * installed, the account is not an administrator, or the server cannot be reached. Read-only queries on the plugin's own table.
     */
    suspend fun playHistory(session: Session): PlayHistory? = coroutineScope {
        val queries = runCatching { playbackQueries(session.userId, todayLocal()) }.getOrNull() ?: return@coroutineScope null
        val auth = "MediaBrowser Client=\"Jellyflix TV\", Device=\"TV\", DeviceId=\"jellyflix-tv\", Version=\"1.0.0\", Token=\"${session.accessToken}\""
        fun run(sql: String): QueryTable? = runCatching {
            val body = org.json.JSONObject().put("CustomQueryString", sql).put("ReplaceUserId", false).toString()
                .toRequestBody("application/json".toMediaType())
            val request = okhttp3.Request.Builder().url(session.serverUrl + "/user_usage_stats/submit_custom_query").header("Authorization", auth).post(body).build()
            plainHttp.newCall(request).execute().use { response -> if (response.isSuccessful) parseTable(response.body?.string()) else null }
        }.getOrNull()
        val totals = run(queries.totals) ?: return@coroutineScope null
        val rest = listOf(queries.since, queries.hours, queries.devices, queries.methods).map { sql -> async { run(sql) ?: QueryTable.Empty } }.map { it.await() }
        buildPlayHistory(totals, rest[0], rest[1], rest[2], rest[3])
    }

    // ---- The look, kept on the server ---------------------------------------------------------------------------

    /**
     * Saves the look in the user's own display preferences (the entry and field the web client uses), keeping whatever else the saved
     * file holds. Only when the viewer asks.
     */
    suspend fun saveAppearance(session: Session, look: Appearance) {
        val api = api(session)
        val user = userId(session)
        val current = api.displayPreferenceApi.getDisplayPreferences(AppearanceBackup.PREFS_ID, user, AppearanceBackup.PREFS_CLIENT).content
        val text = AppearanceBackup.merge(current.customPrefs[AppearanceBackup.PREFS_FIELD], look)
        if (text.length > AppearanceBackup.MAX_CHARS) error("Those settings are too big to save on the server")
        api.displayPreferenceApi.updateDisplayPreferences(
            AppearanceBackup.PREFS_ID,
            user,
            AppearanceBackup.PREFS_CLIENT,
            current.copy(id = AppearanceBackup.PREFS_ID, client = AppearanceBackup.PREFS_CLIENT, customPrefs = current.customPrefs + (AppearanceBackup.PREFS_FIELD to text)),
        )
    }

    /** The look saved on the server, or null when there is none (or it is not one of ours). */
    suspend fun loadAppearance(session: Session): Appearance? {
        val current = api(session).displayPreferenceApi.getDisplayPreferences(AppearanceBackup.PREFS_ID, userId(session), AppearanceBackup.PREFS_CLIENT).content
        return AppearanceBackup.parse(current.customPrefs[AppearanceBackup.PREFS_FIELD])
    }

    // ---- New since your last visit, coming up, stats ------------------------------------------------------------

    /**
     * Movies and series added after [sinceMs], newest first. One read per library (the newest few), so a quiet week costs the same
     * as a busy one; a library that cannot be read is left out.
     */
    suspend fun addedSince(session: Session, sinceMs: Long, libs: List<Lib>, limit: Int = RECENT_LIMIT): List<MediaItem> {
        val api = api(session)
        val userId = userId(session)
        val found = coroutineScope {
            libs.map { lib ->
                async {
                    runCatching {
                        api.libraryApi.getItems(
                            userId = userId,
                            parentId = lib.id,
                            includeItemTypes = listOf(BaseItemKind.MOVIE, BaseItemKind.SERIES),
                            recursive = true,
                            sortBy = listOf(ItemSortBy.DATE_CREATED),
                            sortOrder = listOf(SortOrder.DESCENDING),
                            fields = listOf(ItemFields.DATE_CREATED),
                            limit = limit,
                            enableTotalRecordCount = false,
                        ).content.items
                    }.onFailure { Log.w(TAG, "Could not load what is new in ${lib.name}", it) }.getOrDefault(emptyList())
                }
            }.map { it.await() }.flatten()
        }
        return found
            .mapNotNull { dto -> dto.dateCreated?.toEpochMs()?.takeIf { it > sinceMs }?.let { it to dto } }
            .sortedByDescending { it.first }
            .take(limit)
            .map { toItem(api, it.second) }
    }

    /** Episodes of the series you follow that are about to air, soonest first. A server with nothing scheduled answers with none. */
    suspend fun upcoming(session: Session, limit: Int = 16): List<UpcomingEpisode> {
        val api = api(session)
        return runCatching {
            sortedUpcoming(
                api.showApi.getUpcomingEpisodes(userId = userId(session), limit = limit).content.items.map {
                    UpcomingEpisode(toItem(api, it), it.premiereDate?.toEpochMs())
                },
            )
        }.onFailure { Log.w(TAG, "Could not load upcoming episodes", it) }.getOrDefault(emptyList())
    }

    /**
     * What you have watched, worked out from each title's play count and last play date: the latest movies and episodes (up to
     * [STATS_MOVIES] and [STATS_EPISODES]). Read once, behind everything the screens wait for, and nothing leaves the TV.
     */
    suspend fun watchStats(session: Session): WatchedStats {
        val api = api(session)
        val userId = userId(session)
        val (movies, episodes) = coroutineScope {
            fun read(kind: BaseItemKind, limit: Int) = async {
                api.libraryApi.getItems(
                    userId = userId,
                    includeItemTypes = listOf(kind),
                    recursive = true,
                    filters = listOf(ItemFilter.IS_PLAYED),
                    sortBy = listOf(ItemSortBy.DATE_PLAYED),
                    sortOrder = listOf(SortOrder.DESCENDING),
                    fields = listOf(ItemFields.GENRES),
                    limit = limit,
                    enableImages = false,
                    enableTotalRecordCount = false,
                ).content.items
            }
            val movies = read(BaseItemKind.MOVIE, STATS_MOVIES)
            val episodes = read(BaseItemKind.EPISODE, STATS_EPISODES)
            movies.await() to episodes.await()
        }
        val titles = (movies + episodes).map { dto ->
            WatchedTitle(
                id = dto.id,
                name = dto.name.orEmpty(),
                isEpisode = dto.type == BaseItemKind.EPISODE,
                seriesName = dto.seriesName,
                runtimeSeconds = (dto.runTimeTicks ?: 0L) / 10_000_000L,
                playCount = (dto.userData?.playCount ?: 1).coerceAtLeast(1),
                lastPlayedAt = dto.userData?.lastPlayedDate?.toEpochMs(),
                genres = dto.genres.orEmpty(),
            )
        }
        return WatchedStats(buildStats(titles, System.currentTimeMillis()), capped = movies.size >= STATS_MOVIES || episodes.size >= STATS_EPISODES)
    }

    // The collections of the user, read once (one request) for the "Part of the collection" link: a title does not say which
    // collection holds it, but the server keeps the TMDb collection's id on both the title and the collection.
    private var collectionIndex: Pair<String, Map<String, MediaItem>>? = null
    private val collectionIndexLock = kotlinx.coroutines.sync.Mutex()

    /**
     * The collection (box set) a movie belongs to, found by the TMDb collection id the movie carries ([MediaItem.tmdbCollection]),
     * or null: a movie of no collection, or a hand-made collection (those have no id to match on). The collections are listed on
     * the first ask and kept until the session changes; a list that could not be read is not kept, so the next ask tries again.
     */
    suspend fun collectionOf(session: Session, tmdbCollection: String): MediaItem? {
        val key = session.serverUrl + session.userId
        val index = collectionIndexLock.withLock(null) {
            collectionIndex?.takeIf { it.first == key }?.second
                ?: buildCollectionIndex(session)?.also { collectionIndex = key to it }
        }
        return index?.get(tmdbCollection)
    }

    private suspend fun buildCollectionIndex(session: Session): Map<String, MediaItem>? {
        val api = api(session)
        val boxes = runCatching {
            api.libraryApi.getItems(
                userId = userId(session),
                includeItemTypes = listOf(BaseItemKind.BOX_SET),
                recursive = true,
                fields = listOf(ItemFields.PROVIDER_IDS),
                limit = MAX_COLLECTIONS_INDEXED,
                enableTotalRecordCount = false,
            ).content.items
        }.onFailure { Log.w(TAG, "Could not list the collections", it) }.getOrNull() ?: return null
        return boxes.mapNotNull { box ->
            box.providerIds?.get("Tmdb")?.takeIf { it.isNotBlank() }?.let { it to toItem(api, box) }
        }.toMap()
    }

    /** The seek-bar pictures of a title's file, or null when the server has made none (or cannot say). */
    suspend fun trickplay(session: Session, itemId: UUID, mediaSourceId: String): TrickplayPictures? = runCatching {
        val api = api(session)
        val offered = api.libraryApi.getItem(itemId = itemId, userId = userId(session)).content.trickplay
        val info = pickTrickplay(offered, mediaSourceId)
            ?: return@runCatching null
        val source = runCatching { uuidOf(mediaSourceId) }.getOrNull()
        TrickplayPictures(info) { sheet ->
            runCatching { api.trickPlayApi.getTrickplayTileImage(itemId, info.width, sheet, source).content }
                .onFailure { Log.w(TAG, "Could not load a seek-bar picture sheet", it) }
                .getOrNull()
        }
    }.getOrNull()

    suspend fun seasons(session: Session, seriesId: UUID): List<MediaItem> {
        val api = api(session)
        return api.showApi.getSeasons(seriesId = seriesId, userId = userId(session)).content.items.map { toItem(api, it) }
    }

    suspend fun episodes(session: Session, seriesId: UUID, seasonId: UUID): List<MediaItem> {
        val api = api(session)
        return api.showApi.getEpisodes(
            seriesId = seriesId,
            userId = userId(session),
            seasonId = seasonId,
            fields = listOf(ItemFields.OVERVIEW),
        ).content.items.map { toItem(api, it) }
    }

    /** What to play when a series is chosen: the next unwatched episode, else the first one. */
    suspend fun episodeToPlay(session: Session, seriesId: UUID): MediaItem? {
        val api = api(session)
        val next = runCatching {
            api.showApi.getNextUp(userId = userId(session), seriesId = seriesId, limit = 1, enableTotalRecordCount = false).content.items.firstOrNull()
        }.getOrNull()
        val episode = next ?: runCatching {
            api.showApi.getEpisodes(seriesId = seriesId, userId = userId(session), limit = 1).content.items.firstOrNull()
        }.getOrNull()
        return episode?.let { toItem(api, it) }
    }

    /** The episode after [episode] in its series, or null at the end. */
    suspend fun episodeAfter(session: Session, episode: MediaItem): MediaItem? {
        val seriesId = episode.seriesId ?: return null
        val api = api(session)
        return runCatching {
            api.showApi.getEpisodes(seriesId = seriesId, userId = userId(session), startItemId = episode.id, limit = 2)
                .content.items.firstOrNull { it.id != episode.id }?.let { toItem(api, it) }
        }.getOrNull()
    }

    /** Intro, recap, credits and next-episode preview stretches (Jellyfin 10.10+ with a segment provider); empty when there are none. */
    suspend fun segments(session: Session, itemId: UUID): List<Segment> = runCatching {
        api(session).mediaSegmentApi.getItemSegments(itemId = itemId).content.items.mapNotNull { dto ->
            val kind = when (dto.type) {
                MediaSegmentType.INTRO -> SegmentKind.Intro
                MediaSegmentType.RECAP -> SegmentKind.Recap
                MediaSegmentType.OUTRO -> SegmentKind.Outro
                MediaSegmentType.PREVIEW -> SegmentKind.Preview
                else -> return@mapNotNull null
            }
            if (dto.endTicks <= dto.startTicks) null else Segment(kind, dto.startTicks / 10_000, dto.endTicks / 10_000)
        }.sortedBy { it.startMs }
    }.getOrDefault(emptyList())

    suspend fun setPlayed(session: Session, id: UUID, played: Boolean) {
        val api = api(session)
        if (played) api.userDataApi.markPlayedItem(itemId = id, userId = userId(session))
        else api.userDataApi.markUnplayedItem(itemId = id, userId = userId(session))
    }

    suspend fun setFavorite(session: Session, id: UUID, favorite: Boolean) {
        val api = api(session)
        if (favorite) api.userDataApi.markFavoriteItem(itemId = id, userId = userId(session))
        else api.userDataApi.unmarkFavoriteItem(itemId = id, userId = userId(session))
    }

    // ---- Music ------------------------------------------------------------------------------------------------

    private fun cover(api: ApiClient, id: UUID, tag: String?, width: Int = 400): String? =
        tag?.let { api.imageApi.getItemImageUrl(itemId = id, imageType = ImageType.PRIMARY, maxWidth = width, tag = it) }

    private fun toAlbum(api: ApiClient, dto: BaseItemDto): Album {
        val tagged = !dto.albumArtist.isNullOrBlank() || !dto.artists.isNullOrEmpty()
        val parsed = if (tagged) CleanAlbum(dto.name.orEmpty()) else cleanAlbumName(dto.name.orEmpty())
        return Album(
            id = dto.id,
            name = parsed.name,
            artist = dto.albumArtist?.takeIf { it.isNotBlank() } ?: dto.artists?.firstOrNull() ?: parsed.artist ?: UNKNOWN_ARTIST,
            artistId = dto.albumArtists?.firstOrNull()?.id ?: dto.artistItems?.firstOrNull()?.id,
            year = dto.productionYear ?: parsed.year,
            coverUrl = cover(api, dto.id, dto.imageTags?.get(ImageType.PRIMARY)),
            trackCount = dto.childCount ?: dto.songCount,
        )
    }

    private fun toArtist(api: ApiClient, dto: BaseItemDto) = Artist(
        id = dto.id,
        name = dto.name.orEmpty(),
        imageUrl = cover(api, dto.id, dto.imageTags?.get(ImageType.PRIMARY)),
        backdropUrl = dto.backdropImageTags?.firstOrNull()?.let {
            api.imageApi.getItemImageUrl(itemId = dto.id, imageType = ImageType.BACKDROP, maxWidth = 1280, tag = it)
        },
        overview = dto.overview,
    )

    private fun toSong(api: ApiClient, dto: BaseItemDto): Song {
        val (name, number) = if (dto.indexNumber == null) cleanTrackName(dto.name.orEmpty()) else dto.name.orEmpty() to null
        val own = dto.imageTags?.get(ImageType.PRIMARY)
        return Song(
            id = dto.id,
            name = name,
            artist = dto.artists?.takeIf { it.isNotEmpty() }?.joinToString(", ") ?: dto.albumArtist ?: UNKNOWN_ARTIST,
            album = dto.album.orEmpty(),
            albumId = dto.albumId,
            trackNumber = dto.indexNumber ?: number,
            durationMs = dto.runTimeTicks?.div(10_000),
            coverUrl = if (own != null) cover(api, dto.id, own) else dto.albumId?.let { cover(api, it, dto.albumPrimaryImageTag) },
        )
    }

    private fun musicParent(libs: List<Lib>): UUID? = libs.singleOrNull()?.id

    suspend fun albums(
        session: Session,
        libs: List<Lib>,
        sort: AlbumSort,
        startIndex: Int,
        limit: Int,
        artistId: UUID? = null,
        withTotal: Boolean = startIndex == 0,
    ): Page<Album> {
        val api = api(session)
        val (by, order) = when (sort) {
            AlbumSort.Added -> listOf(ItemSortBy.DATE_CREATED, ItemSortBy.SORT_NAME) to SortOrder.DESCENDING
            AlbumSort.Name -> listOf(ItemSortBy.SORT_NAME) to SortOrder.ASCENDING
            AlbumSort.Artist -> listOf(ItemSortBy.ALBUM_ARTIST, ItemSortBy.SORT_NAME) to SortOrder.ASCENDING
            AlbumSort.Year -> listOf(ItemSortBy.PRODUCTION_YEAR, ItemSortBy.SORT_NAME) to SortOrder.DESCENDING
        }
        val result = api.libraryApi.getItems(
            userId = userId(session),
            parentId = musicParent(libs),
            includeItemTypes = listOf(BaseItemKind.MUSIC_ALBUM),
            recursive = true,
            albumArtistIds = artistId?.let { listOf(it) },
            sortBy = by,
            sortOrder = listOf(order),
            startIndex = startIndex,
            limit = limit,
            enableTotalRecordCount = withTotal,
        ).content
        return Page(result.items.map { toAlbum(api, it) }, result.totalRecordCount.takeIf { withTotal })
    }

    /** Album artists (people who have an album of their own), not every name that ever featured on a song. */
    suspend fun artists(session: Session, libs: List<Lib>, startIndex: Int, limit: Int, withTotal: Boolean = startIndex == 0): Page<Artist> {
        val api = api(session)
        val result = api.artistApi.getAlbumArtists(
            userId = userId(session),
            parentId = musicParent(libs),
            sortBy = listOf(ItemSortBy.SORT_NAME),
            sortOrder = listOf(SortOrder.ASCENDING),
            startIndex = startIndex,
            limit = limit,
            enableTotalRecordCount = withTotal,
        ).content
        return Page(result.items.map { toArtist(api, it) }, result.totalRecordCount.takeIf { withTotal })
    }

    suspend fun artist(session: Session, id: UUID): Artist {
        val api = api(session)
        return toArtist(api, api.libraryApi.getItem(itemId = id, userId = userId(session)).content)
    }

    suspend fun album(session: Session, id: UUID): Album {
        val api = api(session)
        return toAlbum(api, api.libraryApi.getItem(itemId = id, userId = userId(session)).content)
    }

    suspend fun randomAlbums(session: Session, libs: List<Lib>, limit: Int = 16): List<Album> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            parentId = musicParent(libs),
            includeItemTypes = listOf(BaseItemKind.MUSIC_ALBUM),
            recursive = true,
            sortBy = listOf(ItemSortBy.RANDOM),
            limit = limit,
            enableTotalRecordCount = false,
        ).content.items.map { toAlbum(api, it) }
    }

    /** The albums of what you played last, newest first (a slow query on a big library, so asked for apart from the rest). */
    suspend fun jumpBackAlbums(session: Session, libs: List<Lib>, limit: Int = 30): List<Album> {
        val api = api(session)
        val played = api.libraryApi.getItems(
            userId = userId(session),
            parentId = musicParent(libs),
            includeItemTypes = listOf(BaseItemKind.AUDIO),
            recursive = true,
            filters = listOf(ItemFilter.IS_PLAYED),
            sortBy = listOf(ItemSortBy.DATE_PLAYED),
            sortOrder = listOf(SortOrder.DESCENDING),
            limit = limit,
            enableTotalRecordCount = false,
        ).content.items
        val seen = HashSet<UUID>()
        return played.mapNotNull { dto ->
            val id = dto.albumId ?: return@mapNotNull null
            if (!seen.add(id)) return@mapNotNull null
            Album(
                id = id,
                name = dto.album ?: "",
                artist = dto.albumArtist ?: dto.artists?.firstOrNull() ?: UNKNOWN_ARTIST,
                artistId = null,
                year = null,
                coverUrl = cover(api, id, dto.albumPrimaryImageTag),
                trackCount = null,
            )
        }.take(16)
    }

    /** Every track of an album, in disc and track order. */
    suspend fun albumTracks(session: Session, albumId: UUID): List<Song> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            parentId = albumId,
            includeItemTypes = listOf(BaseItemKind.AUDIO),
            sortBy = listOf(ItemSortBy.PARENT_INDEX_NUMBER, ItemSortBy.INDEX_NUMBER, ItemSortBy.SORT_NAME),
            sortOrder = listOf(SortOrder.ASCENDING),
            limit = 1000,
            enableTotalRecordCount = false,
        ).content.items.map { toSong(api, it) }
    }

    /**
     * The songs behind what another app asked this TV to play: songs, an album or a playlist, in the order asked. Empty when the
     * first one is not music (a movie or an episode), so the caller plays it as a video.
     */
    suspend fun songsFor(session: Session, ids: List<UUID>): List<Song> {
        val api = api(session)
        val songs = ArrayList<Song>()
        for ((index, id) in ids.withIndex()) {
            val dto = api.libraryApi.getItem(itemId = id, userId = userId(session)).content
            when (dto.type) {
                BaseItemKind.AUDIO -> songs.add(toSong(api, dto))
                BaseItemKind.MUSIC_ALBUM -> songs.addAll(albumTracks(session, id))
                BaseItemKind.PLAYLIST -> songs.addAll(playlistTracks(session, id))
                else -> if (index == 0) return emptyList()
            }
        }
        return songs
    }

    /** An artist's songs, most played first (alphabetical for songs never played). */
    suspend fun popularSongs(session: Session, artistId: UUID, limit: Int = 10): List<Song> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            includeItemTypes = listOf(BaseItemKind.AUDIO),
            recursive = true,
            artistIds = listOf(artistId),
            sortBy = listOf(ItemSortBy.PLAY_COUNT, ItemSortBy.SORT_NAME),
            sortOrder = listOf(SortOrder.DESCENDING),
            limit = limit,
            enableTotalRecordCount = false,
        ).content.items.map { toSong(api, it) }
    }

    /** A mix of songs for "Shuffle everything". */
    suspend fun randomSongs(session: Session, libs: List<Lib>, limit: Int = 50): List<Song> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            parentId = musicParent(libs),
            includeItemTypes = listOf(BaseItemKind.AUDIO),
            recursive = true,
            sortBy = listOf(ItemSortBy.RANDOM),
            limit = limit,
            enableTotalRecordCount = false,
        ).content.items.map { toSong(api, it) }
    }

    /** Playlists of songs (video playlists are left out). They live outside the music library. */
    suspend fun playlists(session: Session): List<Playlist> {
        val api = api(session)
        return api.libraryApi.getItems(
            userId = userId(session),
            includeItemTypes = listOf(BaseItemKind.PLAYLIST),
            mediaTypes = listOf(MediaType.AUDIO),
            recursive = true,
            sortBy = listOf(ItemSortBy.SORT_NAME),
            sortOrder = listOf(SortOrder.ASCENDING),
            fields = listOf(ItemFields.CHILD_COUNT),
            enableTotalRecordCount = false,
        ).content.items.map { Playlist(it.id, it.name.orEmpty(), cover(api, it.id, it.imageTags?.get(ImageType.PRIMARY)), it.childCount) }
    }

    suspend fun playlistTracks(session: Session, playlistId: UUID): List<Song> {
        val api = api(session)
        return api.playlistApi.getPlaylistItems(playlistId = playlistId, userId = userId(session), limit = 1000).content.items
            .map { toSong(api, it) }
    }

    /**
     * Where the player loads a song from. `universal` plays the file as it is when the TV can, and otherwise has the
     * server convert it (so a rare format still plays).
     */
    fun audioUrl(session: Session, song: Song): String =
        "${session.serverUrl}/Audio/${song.id}/universal" +
            "?UserId=${session.userId}&DeviceId=jellyflix-tv&MaxStreamingBitrate=140000000" +
            "&Container=mp3,aac,m4a,m4b,flac,ogg,opus,wav,webma&TranscodingContainer=ts&TranscodingProtocol=hls&AudioCodec=aac"

    suspend fun reportSongStarted(session: Session, song: Song) {
        runCatching {
            api(session).sessionApi.reportPlaybackStart(
                PlaybackStartInfo(
                    itemId = song.id,
                    mediaSourceId = song.id.toString().replace("-", ""),
                    positionTicks = 0,
                    playMethod = PlayMethod.DIRECT_PLAY,
                    canSeek = true,
                    isPaused = false,
                    isMuted = false,
                    repeatMode = RepeatMode.REPEAT_NONE,
                    playbackOrder = PlaybackOrder.DEFAULT,
                ),
            )
        }
    }

    /** Where the song is now, so another app's remote (the web client) shows the position and whether it is paused. */
    suspend fun reportSongProgress(session: Session, song: Song, positionMs: Long, paused: Boolean) {
        runCatching {
            api(session).sessionApi.reportPlaybackProgress(
                PlaybackProgressInfo(
                    itemId = song.id,
                    mediaSourceId = song.id.toString().replace("-", ""),
                    positionTicks = positionMs * 10_000,
                    playMethod = PlayMethod.DIRECT_PLAY,
                    canSeek = true,
                    isPaused = paused,
                    isMuted = false,
                    repeatMode = RepeatMode.REPEAT_NONE,
                    playbackOrder = PlaybackOrder.DEFAULT,
                ),
            )
        }
    }

    suspend fun reportSongStopped(session: Session, song: Song, positionMs: Long) {
        runCatching {
            api(session).sessionApi.reportPlaybackStopped(
                PlaybackStopInfo(
                    itemId = song.id,
                    mediaSourceId = song.id.toString().replace("-", ""),
                    positionTicks = positionMs * 10_000,
                    failed = false,
                ),
            )
        }
    }

    // ---- Playback ---------------------------------------------------------------------------------------------

    /**
     * Asks the server how to play [item] for this TV. [audioIndex] and [subtitleIndex] are stream numbers from an earlier
     * plan (null leaves the choice to the server, -1 turns subtitles off). The server answers with a direct file when the
     * TV can play it as it is, otherwise with an HLS stream it converts on the fly.
     */
    suspend fun plan(
        session: Session,
        item: MediaItem,
        audioIndex: Int?,
        subtitleIndex: Int?,
        startMs: Long,
        directAllowed: Boolean = true,
        mediaSourceId: String? = null,
        limits: PlayLimits = PlayLimits(),
    ): PlaybackPlan {
        var response = requestPlaybackInfo(session, item, audioIndex, subtitleIndex, startMs, directAllowed, mediaSourceId, limits)
        Log.i(TAG, "PlaybackInfo for ${item.id}: sources=${response.mediaSources.size} error=${response.errorCode} session=${response.playSessionId}")
        var source = response.mediaSources.firstOrNull() ?: error("This title has nothing to play")
        // First start: the server knows the user's subtitle preference, but only delivers a file once a stream is asked for.
        if (subtitleIndex == null && source.defaultSubtitleStreamIndex != null) {
            response = requestPlaybackInfo(session, item, audioIndex, source.defaultSubtitleStreamIndex, startMs, directAllowed, mediaSourceId, limits)
            source = response.mediaSources.firstOrNull() ?: source
        }
        val streams = source.mediaStreams.orEmpty()
        val chosenAudio = audioIndex ?: source.defaultAudioStreamIndex
        val chosenSubtitle = (subtitleIndex ?: source.defaultSubtitleStreamIndex)?.takeIf { it >= 0 }
        val transcodingUrl = source.transcodingUrl
        val direct = source.supportsDirectPlay
        val url = when {
            direct -> "${session.serverUrl}/Videos/${item.id}/stream?static=true&mediaSourceId=${source.id}"
            transcodingUrl != null -> session.serverUrl + transcodingUrl
            !limits.transcodeAllowed -> throw DirectOnlyException()
            else -> error("The server cannot play this title on this device")
        }
        // "Only play as they are": a stream the server would have to convert does not start.
        if (!direct && !limits.transcodeAllowed) throw DirectOnlyException()
        val subtitleStream = streams.firstOrNull { it.type == MediaStreamType.SUBTITLE && it.index == chosenSubtitle }
        val external = subtitleStream?.takeIf { it.deliveryMethod == SubtitleDeliveryMethod.EXTERNAL && it.deliveryUrl != null }
        return PlaybackPlan(
            item = item,
            url = url,
            transcoding = !direct,
            mediaSourceId = source.id ?: item.id.toString(),
            playSessionId = response.playSessionId,
            audioTracks = streams.filter { it.type == MediaStreamType.AUDIO }.map { it.toTrack() },
            subtitleTracks = streams.filter { it.type == MediaStreamType.SUBTITLE }.map { it.toTrack() },
            audioIndex = chosenAudio,
            subtitleIndex = chosenSubtitle,
            subtitleUrl = external?.deliveryUrl?.let { session.serverUrl + it },
            subtitleLanguage = external?.language,
            startMs = startMs,
            directAllowed = directAllowed,
            info = streamInfo(source, chosenAudio, if (direct) emptyList() else transcodeReasons(transcodingUrl)),
        )
    }

    /** What the Info panel shows about [source]: its container, bitrate, video and the audio track being played. */
    private fun streamInfo(source: MediaSourceInfo, audioIndex: Int?, reasons: List<String>): StreamInfo {
        val streams = source.mediaStreams.orEmpty()
        val video = streams.firstOrNull { it.type == MediaStreamType.VIDEO }
        val audio = streams.firstOrNull { it.type == MediaStreamType.AUDIO && it.index == audioIndex }
            ?: streams.firstOrNull { it.type == MediaStreamType.AUDIO }
        return StreamInfo(
            sourceName = source.name?.takeIf { it.isNotBlank() },
            container = source.container,
            totalBitrate = source.bitrate?.toLong(),
            videoCodec = video?.codec,
            width = video?.width,
            height = video?.height,
            fps = video?.realFrameRate ?: video?.averageFrameRate,
            bitDepth = video?.bitDepth,
            range = video?.videoRangeType?.serialName,
            videoBitrate = video?.bitRate?.toLong(),
            audioCodec = audio?.codec,
            channels = audio?.channels,
            audioBitrate = audio?.bitRate?.toLong(),
            reasons = reasons,
        )
    }

    /** The chapters of a title (empty when it has none, or the server cannot say). */
    suspend fun chapters(session: Session, itemId: UUID): List<Chapter> = runCatching {
        val api = api(session)
        api.libraryApi.getItem(itemId = itemId, userId = userId(session)).content.chapters.orEmpty()
            .map { Chapter(it.startPositionTicks / 10_000, it.name.orEmpty()) }
            .sortedBy { it.startMs }
    }.getOrDefault(emptyList())

    // ---- Server plugins (read only) -----------------------------------------------------------------------------

    /** The plugins and their tasks, for Settings. An account that is not an administrator cannot list them. */
    suspend fun pluginsReport(session: Session): PluginsReport {
        val api = api(session)
        if (api.userApi.getCurrentUser().content.policy?.isAdministrator != true) return PluginsReport.NotAdmin
        val plugins = api.pluginApi.getPlugins().content.map { ServerPlugin(it.name.orEmpty(), it.version, it.status.serialName) }
        val tasks = api.scheduledTaskApi.getTasks(isHidden = false).content.map { task ->
            val last = task.lastExecutionResult
            ServerTask(
                name = task.name.orEmpty(),
                category = task.category.orEmpty(),
                running = task.state == TaskState.RUNNING || task.state == TaskState.CANCELLING,
                progress = task.currentProgressPercentage,
                lastResult = last?.status?.serialName,
                lastEndMs = last?.endTimeUtc?.toEpochSecond(java.time.ZoneOffset.UTC)?.times(1000),
            )
        }
        return classifyPlugins(plugins, tasks)
    }

    private suspend fun requestPlaybackInfo(
        session: Session,
        item: MediaItem,
        audioIndex: Int?,
        subtitleIndex: Int?,
        startMs: Long,
        directAllowed: Boolean,
        mediaSourceId: String?,
        limits: PlayLimits,
    ) = api(session).mediaInfoApi.getPostedPlaybackInfo(
        item.id,
        PlaybackInfoDto(
            userId = userId(session),
            // Jellyfin compares this with its own source id, which is the id without dashes.
            mediaSourceId = mediaSourceId ?: item.id.toString().replace("-", ""),
            startTimeTicks = startMs * 10_000,
            audioStreamIndex = audioIndex,
            subtitleStreamIndex = subtitleIndex,
            maxStreamingBitrate = limits.maxBitrate,
            deviceProfile = deviceProfile(),
            enableDirectPlay = directAllowed,
            enableDirectStream = directAllowed,
            enableTranscoding = limits.transcodeAllowed,
            autoOpenLiveStream = false,
        ),
    ).content

    /**
     * What this TV can play, taken from the TV itself ([TvCapabilities]) instead of a fixed list. Whatever its decoders take is
     * played as it is, at the file's own size (a 4K file stays 4K, a 1080p file stays 1080p); the server converts only what the
     * TV cannot decode (an audio format, 10-bit video on a TV without it, HDR on a screen without it) and keeps the picture size.
     */
    private fun deviceProfile(): DeviceProfile {
        val caps = TvCapabilities.get(appContext)
        val audio = caps.audio.joinToString(",")
        val codecProfiles = caps.video.map { (codec, v) ->
            val conditions = buildList {
                add(condition(ProfileConditionValue.VIDEO_BIT_DEPTH, ProfileConditionType.LESS_THAN_EQUAL, if (v.tenBit) "10" else "8"))
                add(condition(ProfileConditionValue.WIDTH, ProfileConditionType.LESS_THAN_EQUAL, v.maxWidth.toString()))
                add(condition(ProfileConditionValue.HEIGHT, ProfileConditionType.LESS_THAN_EQUAL, v.maxHeight.toString()))
                v.maxBitrate?.let { add(condition(ProfileConditionValue.VIDEO_BITRATE, ProfileConditionType.LESS_THAN_EQUAL, it.toString())) }
                if (v.profiles.isNotEmpty()) add(condition(ProfileConditionValue.VIDEO_PROFILE, ProfileConditionType.EQUALS_ANY, v.profiles.joinToString("|")))
                // Colour range: HDR the screen cannot show is converted (tone mapped) by the server instead of looking washed out.
                add(condition(ProfileConditionValue.VIDEO_RANGE_TYPE, ProfileConditionType.EQUALS_ANY, caps.rangeTypes.joinToString("|")))
            }
            CodecProfile(type = CodecType.VIDEO, codec = codec, conditions = conditions, applyConditions = emptyList())
        }
        return DeviceProfile(
            name = "Jellyflix TV",
            directPlayProfiles = listOf(
                DirectPlayProfile(
                    container = "mp4,m4v,mkv,webm,mov,ts,m2ts",
                    type = DlnaProfileType.VIDEO,
                    videoCodec = caps.video.keys.joinToString(","),
                    audioCodec = audio,
                ),
            ),
            transcodingProfiles = listOf(
                TranscodingProfile(
                    container = "ts",
                    type = DlnaProfileType.VIDEO,
                    videoCodec = "h264",
                    audioCodec = "aac",
                    protocol = MediaStreamProtocol.HLS,
                    context = EncodingContext.STREAMING,
                    maxAudioChannels = "6",
                    minSegments = 1,
                    segmentLength = 6,
                    breakOnNonKeyFrames = true,
                    conditions = emptyList(),
                ),
            ),
            containerProfiles = emptyList(),
            codecProfiles = codecProfiles,
            // Text subtitles travel as separate WebVTT files; image ones (PGS, VobSub) make the server burn them in.
            subtitleProfiles = listOf(SubtitleProfile(format = "vtt", method = SubtitleDeliveryMethod.EXTERNAL)),
        )
    }

    private fun condition(property: ProfileConditionValue, type: ProfileConditionType, value: String) =
        ProfileCondition(condition = type, property = property, value = value, isRequired = false)

    /** Lines describing what this TV was found to play, for Settings. */
    fun capabilitySummary(): List<String> = TvCapabilities.get(appContext).summary()

    private fun playMethod(plan: PlaybackPlan) = if (plan.transcoding) PlayMethod.TRANSCODE else PlayMethod.DIRECT_PLAY

    suspend fun reportStart(session: Session, plan: PlaybackPlan, positionMs: Long) {
        runCatching {
            api(session).sessionApi.reportPlaybackStart(
                PlaybackStartInfo(
                    itemId = plan.item.id,
                    mediaSourceId = plan.mediaSourceId,
                    audioStreamIndex = plan.audioIndex,
                    subtitleStreamIndex = plan.subtitleIndex,
                    positionTicks = positionMs * 10_000,
                    playSessionId = plan.playSessionId,
                    playMethod = playMethod(plan),
                    canSeek = true,
                    isPaused = false,
                    isMuted = false,
                    repeatMode = RepeatMode.REPEAT_NONE,
                    playbackOrder = PlaybackOrder.DEFAULT,
                ),
            )
        }
    }

    suspend fun reportProgress(session: Session, plan: PlaybackPlan, positionMs: Long, paused: Boolean) {
        runCatching {
            api(session).sessionApi.reportPlaybackProgress(
                PlaybackProgressInfo(
                    itemId = plan.item.id,
                    mediaSourceId = plan.mediaSourceId,
                    audioStreamIndex = plan.audioIndex,
                    subtitleStreamIndex = plan.subtitleIndex,
                    positionTicks = positionMs * 10_000,
                    playSessionId = plan.playSessionId,
                    playMethod = playMethod(plan),
                    canSeek = true,
                    isPaused = paused,
                    isMuted = false,
                    repeatMode = RepeatMode.REPEAT_NONE,
                    playbackOrder = PlaybackOrder.DEFAULT,
                ),
            )
        }
    }

    suspend fun reportStopped(session: Session, plan: PlaybackPlan, positionMs: Long) {
        runCatching {
            api(session).sessionApi.reportPlaybackStopped(
                PlaybackStopInfo(
                    itemId = plan.item.id,
                    mediaSourceId = plan.mediaSourceId,
                    positionTicks = positionMs * 10_000,
                    playSessionId = plan.playSessionId,
                    failed = false,
                ),
            )
        }
    }

    // ---- Mapping ----------------------------------------------------------------------------------------------

    private fun MediaStream.toTrack(): Track {
        val label = displayTitle ?: listOfNotNull(language, codec).joinToString(" ").ifBlank { "Track $index" }
        return Track(index = index, label = label, language = language)
    }

    private fun toItem(api: ApiClient, dto: BaseItemDto): MediaItem {
        val isEpisode = dto.type == BaseItemKind.EPISODE
        val tags = dto.imageTags.orEmpty()
        fun image(type: ImageType, width: Int): String? {
            val tag = tags[type] ?: return null
            return api.imageApi.getItemImageUrl(itemId = dto.id, imageType = type, maxWidth = width, tag = tag)
        }
        fun backdrop(width: Int): String? = dto.backdropImageTags?.firstOrNull()?.let {
            api.imageApi.getItemImageUrl(itemId = dto.id, imageType = ImageType.BACKDROP, maxWidth = width, tag = it)
        }
        val artist = if (dto.type == BaseItemKind.MUSIC_VIDEO) dto.artists.orEmpty().filter { it.isNotBlank() }.joinToString(", ").ifBlank { null } else null
        val label = if (isEpisode) {
            val season = dto.parentIndexNumber
            val number = dto.indexNumber
            val code = if (season != null && number != null) "S$season E$number" else null
            listOfNotNull(code, dto.name).joinToString(" · ")
        } else if (artist != null) {
            listOfNotNull(artist, dto.productionYear?.toString()).joinToString(" · ")
        } else {
            dto.productionYear?.toString()
        }
        val data = dto.userData
        return MediaItem(
            id = dto.id,
            title = if (isEpisode) dto.seriesName ?: dto.name.orEmpty() else dto.name.orEmpty(),
            name = dto.name.orEmpty(),
            subtitle = label,
            kind = dto.type,
            posterUrl = image(ImageType.PRIMARY, 360),
            landscapeUrl = image(ImageType.THUMB, 640) ?: backdrop(640) ?: image(ImageType.PRIMARY, 640),
            backdropUrl = backdrop(1920) ?: image(ImageType.THUMB, 1280) ?: image(ImageType.PRIMARY, 1280),
            overview = dto.overview,
            year = dto.productionYear,
            runtimeMinutes = dto.runTimeTicks?.let { (it / 600_000_000L).toInt() }?.takeIf { it > 0 },
            genres = dto.genres.orEmpty(),
            rating = dto.communityRating,
            officialRating = dto.officialRating,
            progress = data?.playedPercentage?.let { (it / 100.0).toFloat().coerceIn(0f, 1f) },
            resumeMs = (data?.playbackPositionTicks ?: 0L) / 10_000,
            played = data?.played ?: false,
            favorite = data?.isFavorite ?: false,
            seriesId = dto.seriesId,
            seasonId = dto.seasonId,
            episodeNumber = dto.indexNumber,
            seasonNumber = dto.parentIndexNumber,
            lastPlayedAt = data?.lastPlayedDate?.toEpochSecond(java.time.ZoneOffset.UTC)?.times(1000),
            childCount = dto.childCount,
            versions = versionOptions(dto),
            playsAs = playsAsBySource(dto),
            tmdbCollection = dto.providerIds?.get("TmdbCollection")?.takeIf { it.isNotBlank() },
            artist = artist,
            cast = dto.people.orEmpty().filter { it.type == PersonKind.ACTOR || it.type == PersonKind.GUEST_STAR }.take(24).map {
                CastMember(
                    id = it.id,
                    name = it.name.orEmpty(),
                    role = it.role?.takeIf { r -> r.isNotBlank() },
                    imageUrl = cover(api, it.id, it.primaryImageTag, 300),
                )
            },
        )
    }

    /** "English" for "eng", in the TV's own language; the code itself when it is not one the system knows. */
    private fun languageName(code: String?): String? {
        if (code.isNullOrBlank() || code.equals("und", ignoreCase = true)) return null
        val name = runCatching { java.util.Locale(code).displayLanguage }.getOrNull().orEmpty()
        return name.takeIf { it.isNotBlank() && !it.equals(code, ignoreCase = true) } ?: code.uppercase()
    }

    /** What Play gives for each file of the title, by the file's id (empty for the short items of a list). */
    private fun playsAsBySource(dto: BaseItemDto): Map<String, PlaysAs> {
        val out = LinkedHashMap<String, PlaysAs>()
        for (source in dto.mediaSources.orEmpty()) {
            val id = source.id?.takeIf { it.isNotEmpty() } ?: continue
            val streams = source.mediaStreams.orEmpty()
            val video = streams.firstOrNull { it.type == MediaStreamType.VIDEO }
            val audios = streams.filter { it.type == MediaStreamType.AUDIO }
            val audio = audios.firstOrNull { it.index == source.defaultAudioStreamIndex } ?: audios.firstOrNull()
            val facts = playsAsOf(
                video?.width,
                video?.height,
                video?.codec,
                video?.videoRangeType?.serialName,
                audio?.let { audioSummary(languageName(it.language), it.codec, it.channels) },
                streams.count { it.type == MediaStreamType.SUBTITLE },
            ) ?: continue
            out[id] = facts
        }
        return out
    }

    /** The files of a title with several versions (empty when it has one). */
    private fun versionOptions(dto: BaseItemDto): List<VersionOption> = versionOptionsOf(
        dto.mediaSources.orEmpty().map { source ->
            val video = source.mediaStreams.orEmpty().firstOrNull { it.type == MediaStreamType.VIDEO }
            VersionSource(source.id, source.name, video?.height, video?.codec, video?.videoRangeType?.serialName, source.size)
        },
    )
}

/** The title cannot be played as it is on this TV, and Settings says the server must not convert it. */
class DirectOnlyException : IllegalStateException("This title cannot be played as it is on this TV")
