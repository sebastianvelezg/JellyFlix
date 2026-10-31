# Jellyflix Web

An independent, open-source web client for your own [Jellyfin](https://jellyfin.org) server: movies, series, anime, music videos, books (with a reader), live TV, music and collections, a streaming-style home page, a full player,
tools for server administrators and an English / Spanish interface. It is a static single-page app with no backend, no database, no analytics and no cloud dependency:
your browser talks directly to the Jellyfin server you type in.

Its sibling is a native Android TV / Google TV app in [`../tv`](../tv/README.md) with the same sections, the same look and the same rules, written for a remote control.

<p align="center">
  <img src="../docs/screenshots/web-home.jpg" alt="Jellyflix Web, the home page" width="49%">
  <img src="../docs/screenshots/web-details.jpg" alt="Jellyflix Web, a movie page" width="49%">
</p>

**On this page:** [Features](#features) · [Host it](#host-it-for-your-devices) · [Connecting and security](#connecting-to-jellyfin) · [Administration](#administration) · [Plugins](#plugins-and-playback-reporting) ·
[Development](#development) · [Testing](#testing) · [Compatibility](#compatibility-and-limits)

## Features

### Home and discovery
- **Home** is the first tab when you have at least two kinds of library. One **banner** mixes movies and series: the two newest titles, then six picked at random from your whole library (unwatched, rated 6 or more, with a backdrop),
  a new one every ten seconds. It waits while you hover or focus it, and never moves with "reduce motion".
- **Discover something new**: a random movie (preferring unwatched), a series you have never started (its button plays episode 1, never a special) and a random album (or shuffle the whole library). Press **Another** for a different pick.
- Rows that follow you: **Continue watching** (movies and episodes together), **Next up**, **Because you watched…** and **Because you liked…** (several rows, each from a different title), **New since your last visit**, **Coming up** (episodes about to air), **Watch later**, your playlists and favorites,
  the latest movies, collections, new series, new anime, new music videos, new books and new music.
- **Surprise me** opens a random unwatched movie; "Top rated in *genre*" rows change on every visit.
- Search across movies, series, episodes, collections, albums, artists and songs (press `/`), with recent searches and result filters.

### Your libraries
- **Movies, Series, Anime** (a TV library whose name contains *Anime*), **Music videos**, **Books**, **Live TV**, **Music** and **Collections**, each with its own page; the tabs appear according to the libraries your account has.
- **The menu is yours:** Settings → Appearance chooses whether the buttons at the top show icons and names, only icons or only names (with both, the names give way to the icons when there is no room), their order, and which ones are shown. Home always stays.
- Poster grids with infinite scroll, sort (title, recently added, year, rating), **filters** (watched, favorites, genre, decade, minimum rating, age rating, tag, 4K) and an **A–Z jump**. Sort and filter choices are remembered.
- **Title pages** with backdrop, cast (click someone to see all their titles in your library), file info, audio and subtitle lists, similar titles, a line that says what **Play** will give ("1080p HEVC · English · AAC · 5.1"),
  Play / Resume / Start over, watched and favorite toggles that change instantly and sync with the server.
- **Series pages** with seasons, an episode list (still, runtime, progress, watched toggle), "Play / Resume S2 E5" and "Mark season watched". The audio and subtitle language you pick are remembered per series.
- **Collections** (Jellyfin box sets): a page per collection with its films oldest first, how many you have watched and Play / Resume / Play next.
- Every poster has a **"⋯" menu** (details, mark watched, favorite, add to a playlist, Watch later, and Edit for administrators).
- File-name style titles (`Escape.from.Pretoria.2020.1080p.BluRay`) are shown as readable titles.

### Player
- Direct play when the browser can decode the file, otherwise the server's HLS conversion through hls.js, with an automatic one-time fallback. Jellyflix never transcodes; it tells Jellyfin what the browser can play.
- Timeline with buffered range, hover time and **seek-bar pictures** (trickplay, when the server has made them), "ends at", speed 0.5×–2×, volume, fullscreen, picture-in-picture, a screen that stays awake.
- **Subtitles**: text subtitles with size, colour, background and position; timing you can move (−0.5 / −0.1 / +0.1 / +0.5 s, or **Z** and **X**), remembered per movie and series; **load a `.srt` or `.vtt` from your own device**
  (converted in the browser, never uploaded). **Search online…** in the subtitle menu asks the subtitle plugin of your server (Open Subtitles and the like) in a language you choose, lists what it found
  (matches for your exact file first, machine translations last) and saves the one you pick on the server, next to the video; it needs an account that may manage subtitles. Image subtitles (PGS, VobSub) and styled `.ass` are not supported.
- **Audio tracks** (switching keeps your position), **skip intro / recap / credits / preview** when the server has segments, **chapters**, **Next episode** with an *Up next* card (in the last 20 seconds of a long title, so you can jump to the next one during the credits) and autoplay, whose countdown (3 to 15 seconds, with a bar) is chosen in Settings.
- **Cinema mode** (Settings → Playback, or the player's menu): the picture fades in from black and out at the very end, and the controls leave sooner, also while paused.
- A **quality limit** and an explanation of how the video is playing and why the server converts it. Playlists and collections play through.
- Progress is reported to Jellyfin (start, every ten seconds, pause, seek, stop); resume where you left off. Reporting failures never interrupt playback.
- Keyboard: **Space/K** play/pause, **←/→ or J/L** ±10 s, **↑/↓** volume, **0–9** jump, **M** mute, **C** subtitles, **F** fullscreen, **N** next episode, **S** skip, **P** picture-in-picture, **Esc** back. Press `?` anywhere for the full list.

### Books
- A library of type **Books** (books and audiobooks together) has the same sort, filters and A–Z jump as the others, a page for each book (author, description, Read / Listen, Download, mark as read, favorite) and "New books" on Home.
- **A reader of its own**, in a full-screen layer that keeps your place in this browser ("Continue reading"):
  - **EPUB**: one chapter at a time, a table of contents, text size and dark, light or sepia pages. The chapter is shown in a frame that runs no scripts and cannot reach the network: pictures and fonts come from inside the book, links to other sites open in a new tab.
  - **PDF**: drawn by [pdf.js](https://mozilla.github.io/pdf.js/) (loaded only when a PDF is opened) on dark, light or sepia pages, with zoom, the table of contents, a jump to any page and the place you stopped; only the pages near the screen are kept in memory. A file it cannot open (a password, a damaged file) falls back to the browser's own viewer, which is also one click away for selecting text, searching and printing.
  - **Comics (CBZ)**: a page at a time, fit height or width, left to right or right to left for manga.
  - Files are unpacked in the browser with limits on their size, so a damaged or hostile file is refused instead of filling the memory of the tab. Other formats (Mobi, RAR comics) can be downloaded.
- **Audiobooks** play in the music player and go on from where they were left. Reading and downloading need an account that may download files.

### Music videos and Live TV
- **Music videos** have wide cards with the artist under the title, a page of their own, the usual player, search, a "New music videos" row on Home and a place in "Continue watching". The section has two views, like Jellyfin: *Suggestions* (rows and all the videos) and *Folders* (play a folder or shuffle it, with a way back up).
  - **Play from the card:** a round play button in the middle of a card's picture plays the video at once (the rest of the card opens its page). Whatever it is played from goes on: the next video of the row or grid, or of the folder; a video played on its own goes on with the others of its folder. **Repeat the list** is in the player's menu.
  - **Videos flow:** the 3-2-1 runs over the last 3 seconds of a video and the next one starts the moment it ends, in full screen if the one before was.
  - **A mini player:** leaving a music video with Back keeps it playing in a bar at the bottom of the page (thumbnail, play/pause, next, timeline, full screen, close) while you look for another; picking another takes its place, and a video and the music take turns.
- **Live TV** lists your channels with what is on each (their quality and notes in the name are shown as small tags), has a search by name or number, favorites, and a **guide** (a time grid of the next hours). Watching a channel opens the stream your server provides, with no seek bar (it is live), the arrow keys for the channel before and after, a quality choice, and the usual reports to the server. Recording and timers are not built.

### Music
- Its own home (Jump back in, Recently added, Playlists, Discover, Most played, Favorite songs) and **Albums, Artists and Songs** with sort, genre, favorites and search. **Shuffle all** plays a random mix.
- **Made for you:** a **mix of the day** (your favourites, the radios of the artists you play most and a few surprises; the same all day, with a button to make another) and the radio of your top artists. Artist and album pages have a **Radio** button and every song a *Start a radio* action, all from the server's instant mix.
- **Gapless and crossfade** (Settings → Playback → Music): the next song is made ready before the one playing ends, and with a crossfade length chosen the old song fades out while the new one fades in.
- A **player bar** on every page that keeps playing while you browse, and a **full-screen player**: cover, controls, an "Up next" queue you can reorder and a **sleep timer**. Media keys and lock-screen controls work. The blur behind the cover, the accent of that screen and the **visualizer** (bars that move with the real sound, drawn between the cover's two main colours) follow the cover of the song.
- **Lyrics** in a view of their own: timed lyrics follow the song and scroll to the current line (press a line to jump there); lyrics without times scroll, with a **Find timed lyrics** button that asks your server's lyrics plugin
  (for example LrcLib) and saves the result on the server (administrators only).
- Songs the browser cannot play are converted by the server; an unplayable song is reported and skipped.

### Organise
- **Playlists** of movies and episodes (they live on the server, so the TV app sees them too), a one-click **Watch later**, and favorites.
- **New since your last visit** (a pause of half an hour ends a visit; the time of the last visit stays in this browser) and **Coming up**.
- **Your stats**: hours watched, movies and episodes, the last twelve months, your most watched genres and what you watched more than once, all worked out in the browser from what the server already knows. See also [Playback Reporting](#plugins-and-playback-reporting).
- **Settings you can take with you**: export and import them as a file, or keep them on your own server (your user's display preferences, only when you press a button).

### Appearance
Settings → Appearance, all stored on this device:
- **Six backgrounds** (true black, charcoal, midnight, dusk, pine, cocoa) and an **accent colour**: eight presets or any colour you pick, adjusted automatically so text on it stays readable. Every preset is tested for WCAG contrast on every background.
- **Poster size** (compact, comfortable, large), **interface size**, space between rows, **banner height** and **the rows of the Home page**: the banner and every row on or off, in the order you want.
- The theme is a set of CSS variables painted from a small inline script before the app loads, so there is no flash of the wrong colour.

<p align="center"><img src="../docs/screenshots/web-appearance.jpg" alt="Settings, Appearance: backgrounds and accent colours" width="70%"></p>

### Devices ("Play on…")
- **Start something on another device**: a movie page, the Home banner, an episode, a series, an album and a playlist have **Play on…**: a list of your devices that the server says can be controlled (the TV app, and this web app open on a phone, a tablet or another computer).
  A small floating remote shows what is playing, with a draggable position bar, previous / next, pause, ±30 s and stop.
- **Hand over what is playing here**: the video and music players have a **Play on…** button; the movie or the songs carry on there from the same second.
- **Take it over from the other side**: when the page opens it looks for a device that is already playing and offers "On *device*: *title*"; its remote has **Play here**.
- This browser is a controllable device too, while the app is open (it listens on the server's WebSocket). Nothing is installed or woken up: the app must be open on that device.

### Sign in, language, access
- **Sign in with a code (Quick Connect)**: ask the server for a six-digit code and approve it from a device that is already signed in. The password never travels. The server needs Quick Connect on (Dashboard → General).
  **Approve a code from here** in Settings → Devices lets a TV sign in as you.
- **English and Spanish**, following your browser and switchable in Settings without signing out. A test fails if any text lacks a translation.
- Checked automatically with axe (WCAG 2.1 A and AA) on every kind of page, the player and the music player, plus a keyboard-only walk; touch targets are at least 44 px on a touchscreen.
- **Installable (PWA)**: a manifest, icons and a small service worker that keeps the app's own files so it opens with no network (the library still needs the server). It never stores anything from your Jellyfin server.
  Browsers only offer to install over `https://` or `localhost`; iPhones and iPads can still add it to the home screen from plain `http://`.
- Fast on big libraries: remembered lists drawn at once while fresh ones load behind them, the saved session opens the app straight away, rows far down load only when you scroll near them, and long grids only paint what is near the screen.
  The app asks the server for few things at once (four reads at a time, the page's own content first, random picks last) and never makes it count a whole library to draw a row.

## Host it for your devices

Jellyflix Web is a **static website**: a folder of HTML, JavaScript and CSS. "Hosting" it means putting those files on a machine that is always on (a NAS, a mini PC, a Raspberry Pi, an old laptop) so any phone, tablet or computer
on your network can open it. Your browser then talks **directly to your Jellyfin server**.

### The two addresses (read this first)

Almost every problem comes from mixing up two addresses:

| | What it is | Looks like |
|---|---|---|
| **Jellyflix address** | where you *open the app*: the machine that hosts Jellyflix, plus its port | `http://192.168.x.x:8080` |
| **Jellyfin address** | where your *Jellyfin server answers*: the machine that runs Jellyfin, plus its port | `http://192.168.x.x:8096` or `https://jellyfin.example.com` |

1. **Never use `localhost` or `127.0.0.1` as the Jellyfin address.** It always means *the device you are typing on*; on a phone it means the phone. Use the server's IP address or domain name: it is the address you already use in a browser to open Jellyfin.
2. **To open Jellyflix from another device, use the host machine's IP address**, not `localhost`.
3. **`http` and `https` must match.** If Jellyflix is served over `https://`, Jellyfin must be `https://` too: browsers block a secure page from calling an insecure one. On a home network plain `http://` for both is simplest.

Give the host machine a fixed address (a "DHCP reservation" in your router) so your bookmarks do not break. To find an address: `ipconfig` on Windows (*IPv4 Address*), `hostname -I` on Linux, `ipconfig getifaddr en0` on macOS, or your NAS's network settings.

### Docker Compose (recommended)

You need Docker with the Compose plugin (`docker compose version`).

```bash
git clone https://github.com/sebastianvelezg/JellyFlix.git
cd JellyFlix/web
cp .env.example .env          # optional: pre-fills the sign-in screen; on Windows use "copy"
docker compose up -d --build
```

In `.env` you can set `JELLYFIN_URL=http://192.168.x.x:8096` and, if 8080 is taken, `JELLYFLIX_PORT`. Then open `http://<IP address of that machine>:8080` and sign in with your normal Jellyfin user (or a code).

| What | Command |
|---|---|
| Is it healthy? | `docker compose ps` (the status says "healthy") |
| Stop / start it | `docker compose stop` / `docker compose start` |
| Change the Jellyfin address or the port | edit `.env`, then `docker compose up -d` (no rebuild) |
| Remove it, image included | `docker compose down --rmi local` |

It restarts by itself after a reboot (`restart: unless-stopped`). If other devices cannot open it, the host's firewall may be blocking TCP 8080.

### The ready-made image

Every [GitHub release](https://github.com/sebastianvelezg/JellyFlix/releases) publishes the image to the GitHub Container Registry (`amd64` and `arm64`):

```bash
docker run -d --name jellyflix --restart unless-stopped -p 8080:80 \
  -e JELLYFIN_URL=http://192.168.x.x:8096 \
  ghcr.io/sebastianvelezg/jellyflix-web:latest
```

The same four settings fit any NAS Docker app (Synology Container Manager, QNAP Container Station, Unraid, TrueNAS, Portainer): image `ghcr.io/sebastianvelezg/jellyflix-web:latest`, container port `80` mapped to a free port,
optional environment variable `JELLYFIN_URL`, restart policy "always". With no registry access, build it on your computer (`docker build -t jellyflix-web .`, then `docker save`) and import the file.

### Node, without Docker

You need Node.js 22.18 or newer.

```bash
npm ci
npm run build        # the static files, in dist/
npm run serve        # serves them on port 8080, for every device on your network
```

`npm run serve` reads the same `.env` (or the environment: `JELLYFIN_URL`, `JELLYFLIX_PORT` or `PORT`, `HOST=127.0.0.1` for this machine only). To keep it running after a reboot, use Task Scheduler on Windows or a systemd service on Linux
(`ExecStart=/usr/bin/npm run serve`, `WorkingDirectory=/opt/JellyFlix/web`).

### Any static web server

Run `npm ci && npm run build` and copy the **contents of `dist/`** (or the `jellyflix-web-<version>.zip` of a release) to the folder your nginx, Apache, Caddy or IIS serves. It works from the root of a site or from a sub-folder
(the file addresses are relative and the pages live after a `#`, so no rewrite rules are needed). To pre-fill the Jellyfin address edit `config.js` in that folder:
`window.JELLYFLIX_CONFIG = { serverUrl: 'http://192.168.x.x:8096' }`. Cache `assets/` for a long time (the file names carry a hash) but not `index.html`, `config.js` or `sw.js`.
`docker/nginx.conf` is a complete nginx example. The Docker image and `npm run serve` send a strict `Content-Security-Policy` (the text is in `scripts/csp.mjs`): the app runs only its own scripts. If you serve the files some other way, send the same header (it is a good idea, not a requirement), and keep the `<script>` files next to `index.html` (`paint.js`, `config.js`) since nothing inline is allowed.

### HTTPS, CORS and reverse proxies

You do not need HTTPS on your home network. You need it to use the app away from home, or to install it as an app from a computer other than the host. If you use it, **both** Jellyflix and Jellyfin must be HTTPS;
a reverse proxy (Caddy, Traefik, Nginx Proxy Manager, your NAS's own) puts a certificate in front of each. A reverse proxy in front of Jellyfin must pass WebSocket connections (`/socket`), which "Play on…" uses.
A page at `http://192.168.x.x:8080` calling `http://192.168.x.x:8096` is cross-origin: Jellyfin allows any origin by default; if you restricted the allowed origins (Dashboard → Networking), add the address you host Jellyflix at.
Do not expose Jellyfin to the internet without understanding the risks: keep it updated and use strong passwords.

### Updating

| How you installed it | To update |
|---|---|
| Docker Compose | `git pull`, then `docker compose up -d --build` |
| Ready-made image | `docker pull ghcr.io/sebastianvelezg/jellyflix-web:latest`, then recreate the container |
| Node | `git pull`, `npm ci && npm run build`, restart `npm run serve` |
| Static server | replace the folder's contents with the new build (keep `config.js` if you edited it) |

If you still see the old version afterwards, reload once with Ctrl+F5.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The page does not open from another device | You used `localhost`, or the firewall blocks the port. Use `http://<host IP>:8080` and allow TCP 8080. |
| "Port is already allocated" | Another program uses 8080: set `JELLYFLIX_PORT=8081` in `.env` and run `docker compose up -d`. |
| "Could not reach the server" when signing in | The Jellyfin address is wrong *for your browser*, or that machine is off. Open `http://<Jellyfin address>/System/Info/Public` in the same browser: it should show a little JSON. |
| The same, only when Jellyflix is on `https://` | Mixed content: Jellyflix is HTTPS and Jellyfin is HTTP. Serve Jellyflix over HTTP, or put Jellyfin behind HTTPS too. |
| Works on the computer, not on the phone | The Jellyfin address uses `localhost` or a name the phone cannot resolve. Use the server's IP address. |
| The Jellyfin address is not pre-filled | `JELLYFIN_URL` is not set, or the container was not recreated. Check `http://<host>:8080/config.js`. The address a person used last in that browser always wins. |
| "Play on…" does not list my other device | Both devices need Jellyflix open at the same time, with the same Jellyfin account, and any proxy in front of Jellyfin must pass WebSockets. |
| Playback stutters or "converts" | Conversion is done by Jellyfin, not Jellyflix. Look at the server's CPU and transcoding settings. |

## Connecting to Jellyfin

On the first screen enter:

- **Server URL**: the address of your Jellyfin server as your browser reaches it, for example `http://192.168.x.x:8096` or `https://jellyfin.example.com`. A missing `http://` is added, trailing slashes and a pasted `/web/index.html` are removed,
  and a base path such as `http://host:8096/jellyfin` is kept.
- **Username** and **Password** of a normal Jellyfin user, or **Sign in with a code**. No API key and no administrator account is needed.

The app checks that the address is a Jellyfin server (`GET /System/Info/Public`), signs in (`POST /Users/AuthenticateByName`) and confirms the token (`GET /Users/Me`) before showing anything. Errors are explained
(bad address, unreachable server, a CORS or mixed-content hint, wrong credentials, a disabled account, a non-Jellyfin address).

### Session and security model

- Your **password is never stored**; it is sent only to your server while signing in.
- After signing in the app keeps a revocable **session token**: in `sessionStorage` by default (ends when you close the tab), or in `localStorage` if you tick **"Keep me signed in on this device"**. Anything in web storage can be read by script
  running on this site's origin, which is why the longer-lived option is opt-in.
- **Sign out** calls `POST /Sessions/Logout` (the token stops working on the server) and clears both stores. If the server rejects the token later (revoked from the dashboard, expired), the app returns to the sign-in screen with an explanation.
- Each sign-in uses a fresh random device id, so two tabs do not sign each other out.
- API calls, HLS playlists, subtitles and image fallbacks use the `Authorization: MediaBrowser …` header. **Direct-play video is the one exception**: a `<video src>` cannot send headers, so the stream URL carries your user's
  session token (never an admin API key), as Jellyfin's own web client does; it is revoked on sign out. The same goes for the server's WebSocket address. The app does not log URLs.

## Administration

For people who run a Jellyfin server and sign in with an **administrator** account. Everything here is also in Jellyfin's own dashboard; Jellyflix puts the everyday parts one click away from where you watch.
Administrators see an **Edit** button on titles and **Settings → Open administration**; anyone else sees neither, and **the server is the authority**: it answers 403 to every request from an account that is not an administrator.

<p align="center"><img src="../docs/screenshots/web-admin.jpg" alt="Administration: devices connected now" width="70%"></p>

**The rules these tools follow**
- **Nothing changes without a review.** Every change shows what will change (before → after, or the list of titles) and waits for a button. Destructive actions need more: deleting a title asks you to type its name; making someone an administrator asks you to type their name.
- **You cannot lock yourself out.** The page refuses to disable your own account, remove your own administrator rights, or leave the server without an administrator.
- **No secrets on screen.** API keys show only their last four characters; a device's access token is dropped when the list is read; typed passwords go to your server and nowhere else.
- **No third parties unless you ask.** Pictures offered by the metadata providers are text until you tick "Show their pictures"; only then does your browser contact the provider (without a referrer).
- **Local note only.** The history of what you changed stays on this device, is never part of a settings backup and is erased when you sign out.
- A test reads the source of every administrator tool and fails if it logs to the console, stores something in the browser outside that history, shows a token or key, loads a provider's picture without asking or calls a write without a confirmation in front of it.

**The editor** (movies, series, seasons, episodes, albums, artists and collections)

| Tab | What it does |
|---|---|
| **Details** | Title, original and sort title, year, ratings, description, genres, studios and tags. "Review changes" lists exactly what changes; "Keep my changes" stops the server replacing a field (or the whole title) at the next refresh. |
| **Identify** | Look the title up in the metadata providers your server has on and choose the right match. |
| **Pictures** | Poster, backdrop, logo, thumbnail: take one the providers offer, or send your own (JPEG, PNG or WebP up to 10 MB, shown before it goes). |
| **Refresh** | Look for changed files, fill in what is missing, or replace everything (asks twice). |
| **History** | What you changed on this title from this browser; "Put the old details back…" goes through the same review. |

**The administration page**
- **Library:** the libraries with their folders and Scan (one or all); search titles, or list **only the ones the server could not recognise** (with their path on the server's disk) to see what is wrong with the file name; edit or delete a title.
  **Several at once** (up to 100): mark watched or not (for you), look for changed files, fill in missing details, replace the details, lock or unlock, add or remove a tag. A preview names the titles, nothing is written until **Start**,
  a progress bar and a report follow, one failure never stops the rest, a refusal from the server stops the batch, and **Stop** ends it.
- **Accounts:** who exists, who is an administrator or disabled; per account the allowances (libraries, playing, converting video and audio, remux, highest parental rating, sessions at once, remote access, downloads, deleting titles), always after a review; new accounts and new passwords.
  Accounts are not deleted here: disable one to stop it.
- **Devices:** who is connected now and what they play, whether the server converts it and why; send a message to a device or stop its playback; sign a device out; the API keys, and revoking one.
- **Server:** version and system, tasks that failed, notices (an update is available, a restart is pending), scheduled tasks you can start or stop, and the activity log.

Not included on purpose: restarting or shutting down the server, installing updates or plugins, changing a library's folders, deleting accounts, creating API keys, editing cast and crew. They are rare and high-impact, and best done where you can see the server.
**Try it safely first** against the mock server (`npm run mock`): every screen works there with no risk.

## Plugins and Playback Reporting

Settings → **Plugins** (administrators) lists the plugins of the server that Jellyflix knows how to use, with their version and status, and a **Run / Stop** button with progress and last result for each of their scheduled tasks. Running one asks first, in plain words,
what it does to the server.

| Plugin | What Jellyflix does with it |
|---|---|
| **Intro Skipper** (or any segment provider) | The Skip intro / recap / credits / preview buttons; "Detect and Analyze Media Segments"; **Find intros** for the season on screen |
| **Lyrics** (for example LrcLib) | Lyrics in the music player and "Find timed lyrics"; "Download and upgrade lyrics" |
| **Open Subtitles** | Shows its state and its "Download missing subtitles" task |
| **TMDb Box Sets** | "Scan library for new box sets", which builds the collections |
| **Fanart.tv**, **AniList** | They work when a title's details are refreshed; the card says they are there |
| **Playback Reporting** | Feeds the stats page, and its backup and trim tasks |

Every other installed plugin is listed by name. Supporting another plugin means adding one entry to `SUPPORTED_PLUGINS` (`src/core/plugins.ts`) and one card in `PluginsSettings.tsx`.

**Playback Reporting also feeds the stats page.** When the plugin is installed and the account is an administrator, **Your stats** adds a section "Recorded by Playback Reporting": the real time played in the last twelve months
(not the length of each title), the plays, the share played as it is, time by month, the hours of the day and days of the week you watch at, and your devices with how much the server converted. The plugin has no route for this,
so the app asks it a few fixed, read-only questions about the signed-in user (`SELECT … FROM PlaybackActivity`, through its `submit_custom_query` route); only the user's id, checked to be 32 hexadecimal digits, goes into them.
The plugin only knows what happened since it was installed, which the page says. Without the plugin, or for another account, the section is not there.

## Development

### Stack

| Piece | Choice | Why |
|---|---|---|
| UI | React 19 + TypeScript + Vite | A static client-side app; no router or state library: a small hash router and plain React state |
| Styling | Tailwind CSS 4 | Utility classes, no runtime. Inter is bundled locally; nothing is loaded from a CDN |
| Jellyfin API | [`@jellyfin/sdk`](https://github.com/jellyfin/jellyfin-sdk-typescript) (+ `axios`) | Official, typed, generated from the server's OpenAPI spec |
| HLS | [`hls.js`](https://github.com/video-dev/hls.js), loaded lazily | Chrome, Firefox and Edge cannot play HLS natively |
| Player | A plain `<video>` and an accessible control bar | The most reliable baseline |
| Tests | Vitest + Testing Library, Playwright | See [Testing](#testing) |

### Run it

You need **Node.js 22.18 or newer** (24 LTS recommended), a Jellyfin server (10.10+) and a user. Optional, for tests only: `ffmpeg` on `PATH` and Google Chrome.

```bash
cd web
npm install
npm run dev          # http://localhost:5173, only for you on this computer
npm run mock         # a fake Jellyfin server (prints its address; user tester, password secret)
```

Other scripts: `npm run build` (static files in `dist/`), `npm run preview`, `npm run serve` (for other devices). The address you type on the sign-in screen is your **Jellyfin** server, not `localhost`.
`VITE_DEFAULT_SERVER_URL` in `.env.local` pre-fills it for development; none of this is a secret, and credentials never go in a file.

### Architecture

Three layers with one-way dependencies:

```
src/components, src/App.tsx    React UI                       what the user sees
src/platform/web               browser glue                   <video>, hls.js, web storage, blob URLs, media keys
src/core                       Jellyfin logic, no UI          runs in the browser and in Node tests (public API: core/index.ts)
        │
        ▼
   Jellyfin server
```

- **`src/core`** has no React, no DOM and no UI state: plain `async` functions and plain data in and out (sign-in and Quick Connect, libraries, home and banner, shows, music and queue, collections, playback negotiation and the device profile,
  progress reporting, subtitles, trickplay, playlists, filters, stats, plugins, remote control, and the two administration modules). Lint forbids React, DOM globals and UI imports in it; `tsconfig.core.json` type-checks it without the DOM lib;
  its tests run in plain Node. `requestGate.ts` lets only four reads be on their way at once, most important first.
- **`src/platform/web`** is everything that needs a browser API: decoding capabilities, attaching a stream to `<video>` or hls.js and putting credentials in the right place, storage, appearance, media keys and the wake lock.
- **`src/components`** is presentational and glue. It holds UI state; it does **not** build API payloads, decide report timing or pick direct play versus conversion.
- The Android TV app is native Kotlin and does not import `core`; what the two share are the *rules* `core` documents and tests (device profile, stream replacement, report timing, the banner line-up, the look).

**Adding a feature:** put the Jellyfin logic in `src/core` (typed, no UI) and export it from `core/index.ts`; test it in Node against the mock server (`test/mock/mockJellyfin.ts`, extend it if needed); then build the UI on top. A new browser API goes in `src/platform/web`.
Every user-visible text goes through `t('English text')` and needs an entry in `src/i18n/es.ts`.

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # Vitest: unit, component and integration tests against an in-process mock Jellyfin
npm run build       # production bundle
npm run e2e         # Playwright in real Chrome against the mock server and real generated media
npm run smoke       # OPTIONAL live check against YOUR server (needs environment variables, see below)
```

| Layer | Tool | Environment |
|---|---|---|
| Core logic | Vitest, in-process mock Jellyfin | Node |
| UI screens | Vitest + Testing Library | jsdom |
| Real playback mechanics, accessibility, phone layouts | Playwright in Chrome + mock server + real generated media (`npm run media`, needs `ffmpeg`) | browser |
| Your real server | `npm run smoke` (opt-in, read-only) and the app itself | Node / browser |

The mock server implements only the endpoints the app uses and records requests, so tests can assert *how* the client authenticated and what it reported. Mock-based tests prove the client's logic and playback mechanics;
they cannot prove compatibility with every server, which is what the live smoke test is for:

```powershell
$env:JELLYFIN_SMOKE_URL = "http://jellyfin.local:8096"
$env:JELLYFIN_SMOKE_USER = "your-user"
$env:JELLYFIN_SMOKE_PASSWORD = "your-password"
npm run smoke
```

It signs in, lists the libraries, negotiates playback for the first movie (natural and forced conversion), downloads the first bytes with the same authentication rules as the app, and signs out. It does **not** report progress, so your watch history
is unchanged; credentials stay in your shell and nothing is written to disk.

## Compatibility and limits

- **Jellyfin:** developed against 12.x; the SDK targets 10.10 and newer. Plugin routes (Intro Skipper, Playback Reporting…) are only used when the server has them.
- **Browsers:** developed and tested in Chrome. Edge, Firefox and Safari are expected to work and are not regularly tested. HLS needs MSE (hls.js) or native HLS (Safari).
- **Media:** direct play of what the browser can decode (H.264 / AAC everywhere; HEVC where the browser supports it, and 10-bit HEVC only when it reports Main10); everything else is converted by the server. DTS and TrueHD audio and image-based subtitles are not supported.
- **Not built:** recording and timers for live TV, a reader for Mobi and RAR comics, several saved servers or users, a version picker, an equalizer, styled `.ass` subtitles, casting (Chromecast, AirPlay), offline mode.
- "Play on…" needs the other app to be open and cannot wake it; it lists any controllable device of your account, so an official Jellyfin web tab left open also appears.
- On an iPhone or iPad, Safari lets a page start sound or video only after a tap, so a title sent to it may open ready and need one tap on Play.

## License

[MIT](../LICENSE), the same as the rest of the repository. Runtime dependencies: `@jellyfin/sdk` (MPL-2.0, used unmodified as a library), `hls.js`, `pdfjs-dist` and `fflate` (Apache-2.0 / MIT), `axios`, `react`, `react-dom` (MIT), Inter (SIL OFL 1.1).
Build and test tooling (Tailwind CSS, Vite, Vitest, Playwright, ESLint) is MIT or Apache-2.0. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
