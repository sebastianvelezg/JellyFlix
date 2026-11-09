/**
 * Public API of the platform-independent Jellyfin core.
 *
 * Rules for everything under `src/core`:
 *  - No React, no DOM, no browser globals, no UI state. (Enforced by ESLint.)
 *  - Plain async functions and data in/out, so the same code can run in the web app, in Node
 *    tests, and in a future Android TV app written in TypeScript (React Native / Capacitor).
 *  - Anything platform-specific (decoding capabilities, attaching a stream to a player, blob URLs,
 *    storage, unload handling) lives in `src/platform/<name>` and is passed in as plain data.
 *
 * UI and platform code should import from here, not from the individual files.
 *
 * Everything this file exports (as a value) is loaded with the first screen, with the parts of the Jellyfin API client it uses. What
 * only some screens need (administration, Live TV, plugins, statistics, the comic reader) exports its values from `core/extra.ts`
 * instead; their types stay here. `npm run size` fails if that part reaches the first screen.
 */
export { connect, logout, ConnectionError, type ConnectOptions } from './auth'
export {
  controlDevice,
  deviceKindOf,
  getRemoteDevices,
  playOnDevice,
  seekDevice,
  type DeviceKind,
  type RemoteCommand,
  type RemoteDevice,
} from './remote'
export {
  announceRemoteControl,
  KEEP_ALIVE,
  parseRemoteMessage,
  remoteSocketUrl,
  resolvePlayTarget,
  type PlayTarget,
  type RemoteMessage,
} from './remoteControl'
export {
  authorizeQuickConnect,
  completeQuickConnect,
  isQuickConnectApproved,
  startQuickConnect,
  type QuickConnectRequest,
} from './quickConnect'
export { itemImageUrl, type ImageKind } from './images'
export { CLIENT_NAME, CLIENT_VERSION, setDefaultDeviceName, type Session } from './jellyfin'
export { restoreSession, resumeSession, toStoredSession, verifySession, type SessionStore, type StoredSession } from './sessionStore'
export { isPrivateHost, isUnencryptedPublic, normalizeServerUrl, ServerUrlError, tidyServerAddress } from './serverUrl'

export {
  FILTER_LABELS,
  getContinueWatching,
  getLibrarySections,
  getMovie,
  getMovieGenres,
  getMovieLibraries,
  getMoviePage,
  getRandomMovie,
  getRandomTitle,
  getRandomTitles,
  getRecentlyAdded,
  getRecentTitles,
  getShowPage,
  getTitleFacets,
  getTitleFilterOptions,
  getTitleGenres,
  getTitlePage,
  isAnimeLibraryName,
  PAGE_SIZE,
  buildLineup,
  getFeaturedPool,
  titleKey,
  shuffle,
  posterUrl,
  searchMovies,
  searchBooks,
  searchMusicVideos,
  searchShows,
  searchTitles,
  SORT_LABELS,
  wideImageUrl,
  type BrowseOptions,
  type LibrarySections,
  type Movie,
  type MovieLibrary,
  type MoviePage,
  type Section,
  type VideoSection,
  type SortKey,
  type TitleKind,
  type WatchFilter,
} from './library'
export {
  episodeCode,
  getContinueEpisodes,
  getEpisodes,
  getNextEpisode,
  getNextUp,
  getPlayable,
  getSeasons,
  getSeriesPlayTarget,
  getSimilarShows,
  getUpcomingEpisodes,
  isEpisode,
  playbackTitle,
  searchEpisodes,
  type Episode,
  type Season,
  type UpcomingEpisode,
} from './shows'
export {
  backdropImageUrl,
  getMovieDetails,
  getShowDetails,
  getSimilarMovies,
  personImageUrl,
  setFavorite,
  trailerLinks,
  type TrailerLink,
  setRating,
  setWatched,
  type MediaInfo,
  type MediaTrackInfo,
  type MovieDetails,
  type Person,
  type UserState,
} from './details'

export type { DeviceCapabilities } from './deviceProfile'
export { withoutAudioCodecs } from './deviceProfile'
export {
  describePlayback,
  closeLiveStream,
  negotiatePlayback,
  PlaybackError,
  TRANSCODE_REASONS,
  transcodeReasonText,
  withApiKey,
  type MediaType,
  type NegotiateOptions,
  type PlaybackPlan,
  type PlaybackProtocol,
  type TrackOption,
} from './playback'
export { PlayMethod } from '@jellyfin/sdk/lib/generated-client/models/play-method'
export { fetchSubtitleVtt } from './subtitles'
export {
  describeOffset,
  MAX_SUBTITLE_OFFSET,
  srtToVtt,
  stepOffset,
  SUBTITLE_FILE_EXTENSIONS,
  subtitleFileToVtt,
  SYNC_STEP,
  SYNC_STEP_LARGE,
} from './subtitleSync'
export { languageName, pickAudio, pickSubtitle } from './tracks'
export { PlaybackSession, type DeviceState } from './playbackSession'
export type { PlayerState } from './reporting'
export {
  audioChangeRequest,
  retryRequest,
  transcodeFallbackRequest,
  type StreamContext,
  type StreamRequest,
} from './streamRequest'

export { defaultVersion, setPlayChoice, takePlayChoice, type PlayChoice, type VersionRef } from './playChoice'
export {
  FREE_TRIES,
  getKidsGuard,
  hashPin,
  isBlocked,
  isValidPin,
  PIN_MAX,
  PIN_MIN,
  ratingValue,
  setKidsGuard,
  verifyPin,
  waitAfterFailures,
  type KidsGuard,
} from './parental'
export { timeLabelText, type TimeLabelKind, type TimeLabelState } from './timeLabels'
export { formatRuntime, formatTime, secondsToTicks, ticksToSeconds, TICKS_PER_SECOND } from './ticks'
export {
  activeSegment,
  chapterAt,
  getPlaybackExtras,
  NO_EXTRAS,
  type Chapter,
  type PlaybackExtras,
  type Segment,
} from './extras'
export {
  albumsOfTracks,
  ALBUM_SORT_LABELS,
  ARTIST_SORT_LABELS,
  coverUrl,
  getAlbum,
  getAlbumPage,
  getAlbumTracks,
  getArtist,
  getArtistPage,
  getFavoriteTracks,
  getMusicGenres,
  getPlaylist,
  getPlaylists,
  getPlaylistTracks,
  getPopularTracks,
  getRandomAlbums,
  getRandomTracks,
  getRecentAlbums,
  getRecentlyPlayedTracks,
  getTrackPage,
  searchMusic,
  totalTicks,
  TRACK_SORT_LABELS,
  UNKNOWN_ARTIST,
  type Album,
  type AlbumSort,
  type Artist,
  type ArtistSort,
  type MusicFilter,
  type MusicSearchResults,
  type Page,
  type Playlist,
  type Track,
  type TrackSort,
} from './music'
export {
  advance,
  back,
  currentItem,
  currentTrack,
  cycleRepeat,
  enqueue,
  hasNext,
  jumpTo,
  playNext,
  moveItem,
  removeAt,
  setRepeat,
  setShuffle,
  startQueue,
  upcoming,
  type PlayQueue,
  type QueueItem,
  type RepeatMode,
} from './queue'
export {
  collectionBackdropUrl,
  collectionPlayTarget,
  nextInCollection,
  COLLECTION_SORT_LABELS,
  collectionPosterUrl,
  getCollection,
  getCollectionItems,
  getCollectionPage,
  searchCollections,
  sortByYear,
  type Collection,
  type CollectionDetails,
  type CollectionSort,
} from './collections'
export {
  buildHomeLineup,
  distinctSeeds,
  getAddedSince,
  getBecauseYouWatched,
  getRecommendations,
  RECOMMENDATION_ROWS,
  getContinueAll,
  getFreshSeries,
  getHomePool,
  getLatestTitles,
  getRandomMovieAcross,
  interleave,
  newestFirst,
  type BecauseYouWatched,
  type FreshSeries,
  type Recommendation,
  type RecommendationKind,
} from './home'
export * from './lyrics'
export * from './subtitleSearch'
export * from './upNext'
export * from './mixes'
export type {
  ScanStatus,
  ServerPlugin,
  ServerTask,
  SupportedPluginKind,
} from './plugins'
export {
  isAdministrator,
} from './me'
export type {
  ActivityLine,
  AdminDevice,
  AdminKey,
  AdminSession,
  AdminUser,
  BatchAction,
  BatchProgress,
  BatchResult,
  LibraryInfo,
  ParentalRatingOption,
  PolicyChange,
  PolicyFields,
  ServerSummary,
  TitleQuery,
  TitleRow,
} from './adminServer'
export {
  getParentalRatingOptions,
} from './parentalServer'
export type {
  EditableItem,
  EditableType,
  FieldChange,
  FieldErrors,
  IdentityCandidate,
  LockableField,
  MetadataFields,
  PictureChoice,
  PictureSlot,
  PictureType,
  RefreshMode,
} from './admin'
export {
  ADMIN_TEXTS,
  EDITABLE_TYPES,
  FIELD_LABELS,
  FIELD_LIMITS,
  IDENTIFIABLE_TYPES,
  LOCKABLE_FIELDS,
  applyFields,
  canAdminister,
  canIdentify,
  diffFields,
  fieldsOf,
  formatList,
  isEditableType,
  parseList,
  restoreFields,
  validateFields,
} from './adminFields'
export { MAX_SETTINGS_CHARS, loadSettingsFromServer, saveSettingsToServer } from './displayPrefs'
export {
  MIN_RATINGS,
  NO_FILTERS,
  QUALITIES,
  countActiveFilters,
  decadeLabel,
  decadeYears,
  filterQuery,
  sanitizeFilters,
  toFacets,
  type AdvancedFilters,
  type FilterFacets,
  type Quality,
} from './filters'
export {
  DEFAULT_HOME_LAYOUT,
  HOME_ROW_IDS,
  HOME_ROW_LABEL,
  isDefaultHomeLayout,
  isRowVisible,
  moveRow,
  sanitizeHomeLayout,
  toggleRow,
  visibleRows,
  type HomeLayout,
  type HomeRowId,
} from './homeLayout'
export {
  arrangeMenu,
  DEFAULT_MENU_LAYOUT,
  isDefaultMenuLayout,
  isMenuItemVisible,
  MENU_IDS,
  moveMenuItem,
  sanitizeMenuLayout,
  toggleMenuItem,
  type MenuId,
  type MenuLayout,
} from './menuLayout'
export {
  WATCH_LATER_NAMES,
  addToPlaylist,
  addToWatchLater,
  createVideoPlaylist,
  deletePlaylist,
  findWatchLater,
  getPlaylistEntries,
  getVideoPlaylist,
  getVideoPlaylists,
  isWatchLater,
  moveInPlaylist,
  removeFromPlaylist,
  renamePlaylist,
  reorder,
  targetIndex,
  type PlaylistEntry,
  type VideoPlaylist,
} from './playlists'
export type {
  PlayHistory,
  PlayHistoryTables,
  QueryTable,
  RecordedDevice,
  RecordedMonth,
} from './playbackReporting'
export type {
  MonthStat,
  WatchStats,
  WatchedTitle,
  WatchedTitles,
} from './stats'
export { getTrickplay, pickTrickplay, trickplaySheetUrl, trickplayTile, type TrickplayInfo, type TrickplayTile } from './trickplay'
export {
  audiobookStart,
  audiobookTrack,
  bookCoverUrl,
  bookKindLabel,
  getBooks,
  downloadBookFile,
  readableFormat,
  type ReadableFormat,
} from './books'
export type {
  ComicPage,
} from './comic'
export {
  bestOffset,
  createGroup,
  currentItemId,
  groupPause,
  groupSeek,
  groupStop,
  groupUnpause,
  joinGroup,
  leaveGroup,
  listGroups,
  localToServerMs,
  measureClock,
  NO_GROUP,
  offsetOf,
  parseSyncMessage,
  planCommand,
  reportBuffering,
  reportReady,
  sendPing,
  serverToLocalMs,
  setGroupQueue,
  setIgnoreWait,
  SyncPlayDenied,
  syncReducer,
  type GroupState,
  type PlayerReport,
  type SyncAction,
  type SyncCommandName,
  type SyncGroup,
  type SyncMessage,
  type SyncQueue,
  type SyncState,
  type TimeSample,
} from './syncplay'
export type {
  ChannelCategory,
  Channel,
  ChannelName,
  ChannelPage,
  GuideBlock,
  Program,
} from './liveTv'
export {
  CHANNEL_CATEGORIES,
  isChannelCategory,
} from './channelCategories'
export * from './musicVideos'
export { checkKidsSetup, getAllowedSeries, getRatingTable, type KidsCheck } from './parentalServer'
