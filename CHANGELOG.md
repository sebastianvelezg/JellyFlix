# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
Jellyflix Web and Jellyflix TV are released together and share one version number.

## [Unreleased]

A better video player, music that flows from one song to the next, mixes made for you, and more varied suggestions.

### Web app
- **Subtitles from the internet:** the subtitle menu has a *Search online…* button. It asks the subtitle plugin of your server (Open Subtitles and the like) in a language you choose, lists what it found (matches for your exact file first, machine translations last) and saves the one you pick on the server, next to the video. The video starts again where you were with the new subtitle on. Needs an account that may manage subtitles.
- **Cinema mode** (Settings -> Playback, or in the player's menu): the picture fades in from black and out at the very end, and the controls leave sooner, also while paused.
- **Up next:** the card now shows in the last 20 seconds of a long title (so you can jump straight to the next one during the credits), the countdown after a title has a bar and its length (3 to 15 seconds) is chosen in Settings.
- **Collections play through:** the Play button of a collection goes on to the next film of the saga, like a playlist does.
- **Gapless playback and crossfade for music** (Settings -> Playback -> Music): the next song is made ready before the one playing ends, so there is no pause between songs (also when the server converts them), and with a crossfade length chosen the old song fades out while the new one fades in.
- **Mix of the day and radio:** the music home has a *Made for you* row with a mix of the day (your favourites, the radios of the artists you play most and a few surprises; the same all day, with a button to make another) and the radio of your top artists. Artist and album pages have a *Radio* button and every song a *Start a radio* action, all from the server's instant mix.
- **Visualizer:** a button in the full-screen player draws bars that move with the real sound over the cover. While it is on, songs are loaded in a way that lets the browser read their sound; where that is not possible the bars move to a made-up rhythm. They stand still when paused or when the system asks for less motion.
- **More varied suggestions:** up to three rows on the main page, each from a different starting point (a few of the titles you finished lately, and one favourite: *Because you liked X*), alternating, with no title in two rows.

- **Music videos by folder, played one after the other:**
  - The Music videos section has two views, like Jellyfin: *Suggestions* (the usual page with all the videos) and *Folders*.
  - **Folders** shows the folders of the library; a folder opens with a way back up (a breadcrumb), and has **Play folder** and **Shuffle**, which play every video inside it, including the folders inside it. A folder card plays its folder without opening it. With one library, **Play all** and **Shuffle** play the whole library.
  - **Videos follow each other:** when a music video ends the next one of its queue starts after a short countdown (3 seconds at most). A video played on its own goes on with the others of its folder. **Repeat the list** (in the player's menu, for any queue: folder, library, playlist, collection) starts again from the first video after the last one.
  - A playlist page has **Shuffle** too. A shuffled queue keeps one random order from the first video to the last.

- **The full-screen music player takes its colours from the cover:** the blur behind the cover, the bars of the visualizer (a gradient between the cover's two main colours), the glow and the accent of that screen (seek bar, buttons) follow the song that is playing and fade into the next song's colours. A cover with no colour of its own (black and white), or one the browser cannot read, keeps the accent chosen in Appearance.

### TV app
- The same more varied suggestions on Home: *Because you watched X* for several recent titles and *Because you liked X* for a favourite.

## [1.1.0] - 2026-10-23

Three new kinds of library (music videos, books and Live TV), a menu you can arrange, and a tidier look. Web and TV get all of it together.

### Both apps
- **Music videos:** a library of type "Music videos" gets its own tab with wide cards (the artist under the title), a title page with the artist, playback with the usual player, search, a "New music videos" row on Home (which can be moved or hidden in Appearance) and a place in "Continue watching".
- **Books:** a library of type "Books" gets its own tab (books and audiobooks together, with the same sort, filters and A-Z jump), a page for each book, "New books" on Home and in search. **Audiobooks** play in the music player and go on from where they were left. On the TV, books to read are for the web app or a phone, and the TV says so.
- **Live TV:** the Live TV tab lists your channels with what is on each, and a guide (a time grid of the next hours on the web, "now and next" for each channel on the TV). Choosing a channel opens the stream the server provides: no seek bar (it is live), the channel before and after on the arrow keys (the TV remote's channel keys too), favorites, and the usual reports to the server.
  Playlist names like "Canal 1 (Colombia) (1080p) [Not 24/7]" show the name and keep the quality and notes as small tags, logos are shown whole, and "no programme information" is said once when the server has no guide. A channel that cannot be played says so.
- **Menu buttons:** Appearance has a new choice for the buttons at the top: icons and names, icons only, or names only. With both, the names give way to the icons by themselves when they do not fit. On the TV the bar scrolls with the remote and Search and Settings stay at the right end; on a phone the bottom bar does the same.
- **Top menu order:** Appearance -> Top menu lets you move the buttons at the top and turn some off. Home always stays; a button for a library you do not have is left out anyway.
  Both choices go into the look backup, so it can be loaded on the other app.
- **Maximum quality** in Settings -> Playback (the same limit as in the player), with more steps than before (up to 40 Mbps).

### Web app
- **A reader for books:** **EPUB** (chapter by chapter, with a table of contents, text size and three page colours; the book runs no scripts and reaches no network), **comics (CBZ)** (page by page, fit width or height, right to left for manga) and **PDF** (drawn by the reader itself on dark, light or sepia pages with zoom, a table of contents and a jump to any page; the browser's own viewer is one click away for searching, selecting text and printing).
  Where you stopped is remembered in this browser ("Continue reading"). Other formats (Mobi, RAR comics) can be downloaded. Reading and downloading need an account that may download files.
- **Live TV on the web:** look for a channel by name or number, and choose the quality while you watch.
- **Settings look:** Layout is chosen from drawn cards like Theme and Posters, and the tabs of Settings and of Administration take the accent of the theme.

### Fixed
- A library toolbar (sort, filters, Surprise me) no longer makes the page wider than the screen on medium widths.
- The PDF reader lets go of its worker when closed before the file opened or when the file cannot be opened; a channel left before it was tuned no longer keeps a stream open on the server; a contents entry inside the open EPUB chapter scrolls to it.
- Hosting with `npm run serve` or Docker: the PDF reader's worker and decoders are sent with the file types browsers require, so the reader does not fall back to the browser's viewer.
- Smaller: the web service worker no longer downloads the PDF library when it installs, book downloads need less memory, and the channel list does not poll while a channel is being watched.

## [1.0.0] - 2026-10-23

The first public release: a web app and a Google TV / Android TV app for your own Jellyfin server, with the same sections, the same look and the same rules.

### Both apps
- **Home** with a rotating banner that mixes movies and series (the newest titles, then random picks from your whole library), **Discover something new** (a random movie, a series you never started, an album),
  Continue watching, Next up, the latest movies, collections, new series, new anime, new music and "Because you watched…".
- **Libraries:** Movies, Series, Anime (a TV library whose name says so), Music and Collections, with a banner, sort, filters (watched, favorites, genre, decade, rating, age rating, 4K) and an A–Z jump.
- **Titles:** artwork, cast (and what else they are in), "Plays as" summary (what Play will give), Play / Resume / Start over, watched and favorite toggles, similar titles, the collection a movie belongs to.
- **Player:** direct play or the server's HLS conversion, audio tracks, subtitles with their own look, skip intro / recap / credits / preview, chapters, next episode, a quality limit, an explanation of why the server converts a video, seek-bar pictures (trickplay) and progress synced to Jellyfin.
- **Music:** albums, artists, songs and playlists, a player that keeps playing while you browse, a full-screen player with the queue (reorderable), a sleep timer and **lyrics** (timed ones follow the song; "Find timed lyrics" asks your server's lyrics plugin).
- **Organise:** playlists of movies and episodes that play through, **Watch later**, favorites, "New since your last visit" and "Coming up".
- **Appearance:** six backgrounds and eight accent colours (the web app also takes any colour), poster size, and which Home rows exist and in what order. Every combination is tested for readable contrast. The look can be backed up on your own server and loaded on another device.
- **Your stats:** hours watched, the months, the genres and what you watched twice, worked out on the device; with the Playback Reporting plugin (administrators) also the real time played, the hours of the day you watch at and your devices.
- **Play on…:** start a title on another of your devices, control it from this one and hand over what is playing without losing your place.
- **Sign in with a code (Quick Connect)** or with a user and password; the password is never stored and nothing but a revocable session token is kept.
- **Plugins:** Intro Skipper, Lyrics, Open Subtitles, TMDb Box Sets, Fanart.tv, AniList and Playback Reporting are recognised; the web app can also run their scheduled tasks.
- **English and Spanish**, following the device's language.
- **Private by design:** it talks only to your Jellyfin server. No analytics, no crash reporting, no ads, no server of ours.

### Web
- A static single-page app (React, TypeScript, Vite), installable as an app (PWA), hosted with Docker (`amd64` and `arm64`), Node or any web server; the Jellyfin address is a setting, not a rebuild.
- **Administration for server administrators:** libraries (scan, find the titles the server could not recognise, change up to 100 titles at once after a preview), accounts and their allowances, devices and API keys, the server's health, tasks and activity, and an **editor** for one title (details with a review of what changes, locks, identify, refresh, pictures, and a local history). Nothing changes without a review, and the page refuses anything that could lock you out.
- Settings you can export, import or keep on the server; keyboard shortcuts (`?`); recent searches and result filters; a bottom section bar on phones.
- Player extras: subtitle files from your own device, subtitle timing, picture-in-picture, the full keyboard map.
- Checked with unit, component and browser tests (including an automatic accessibility check, WCAG 2.1 A and AA) against a mock Jellyfin server.

### TV
- A native Kotlin app (Jetpack Compose for TV, Media3), built for a remote control: predictable focus, a banner you can skim with the D-pad, a menu on every title (hold OK).
- A **version picker** for titles that have several files (1080p and 4K merged in Jellyfin).
- Plays at the picture's own size: the app asks the TV what it can decode (video, 10-bit, HDR, audio) and only what it cannot play is converted by the server; frame-rate matching, an Info panel, screen margin and text size for TVs that crop the picture.
- Google TV **Continue watching** row on the home screen, and an "Instant Home" that paints the last Home straight away.
- Settings in tabs: Playback, Subtitles, Display, Appearance, Plugins (read only) and Account.

### Known limits
- The TV app has been checked on an Android TV emulator and not yet on many physical TVs: HDR, 4K and automatic frame-rate switching depend on the model. Reports are welcome.
- Not built: live TV, several saved servers or users, subtitle search and download, SyncPlay, casting, offline mode, styled `.ass` subtitles, image subtitles on the web app (PGS, VobSub).
- Administration tools are on the web app only, on purpose.
