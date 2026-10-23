# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
Jellyflix Web and Jellyflix TV are released together and share one version number.

## [Unreleased]

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
