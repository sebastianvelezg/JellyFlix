# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
Jellyflix Web and Jellyflix TV are released together and share one version number.

## [Unreleased]

### Changed
- **Retro TV looks better, with the pictures in front.** *On now* shows each channel as a card: a banner in the colour of the channel with its picture big in the middle, its number and its star, then what is on (with how far along it is and how many minutes are left) and what comes next; the whole card tunes in. Favourites have a heading of their own. The guide and *Set up* follow the same look (bigger pictures, a mark of how far along the programme on now is, a dot where *now* crosses the time ruler, and the channels of *Set up* as cards in two columns).
- **The music page is redone, with the art in front.** A side column lists the sections (home, albums, artists, songs) and *Your mixes* (on a narrow screen the sections stay a row of pills above the page). The home opens with a big card for the mix of the day (with its covers laid out like a pile of records) and *Pick up where you left off*, then shelves of albums with *See library* links and arrows, and the most played and favourite songs as a table with the names of its columns. Albums, artists and songs have a title of their own above their controls. Only the look changes; the player and the top bar are as they were.
- **More mixes.** Besides the mix of the day there are mixes of your favourites (in a new order each day), the radio of four artists you play most (it was two), a surprise, three genres (a different three each day) and the decades from the 80s that have songs: ten or more. The big card at the top of the music home shows them one after another every six seconds (it stays while you hover over it, and with reduced motion it does not move), and the dots and arrows go to one directly. *Make another mix* is now in the side column.

### Fixed
- **The menu of a card (the "⋯" button) is no longer cut off by its row.** In rows such as *Continue watching* the menu was drawn inside the row, so it was cut at the row's edge and the row could be scrolled up and down inside itself. The menu is now drawn over the page, under the button (or over it when there is no room), always inside the window.

## [1.7.2] - 2026-11-10

The guide of Retro TV, made to be used with many channels.

### Added
- **The guide goes on as you scroll.** It shows what is on and the next six hours, and asks for more (six hours at a time, up to two days) when you scroll to the right. The channel names and the time ruler stay in view while the rest scrolls, inside the guide. *Now* takes you back to what is on, and the **−** and **+** buttons zoom the time scale (the choice is remembered). A mark with the day shows where a new day begins.
- **The column of channel names can be made wider** by dragging its edge (or with the arrow keys; double click for the usual width), and long names are given two lines. The width is remembered.
- **Favourites.** A star on each channel (in the cards and in the guide) keeps it first, always: the container remembers it for each person, on every device, and the web and the TV list favourites first.
- **Pictures for channels.** In the editor, *Choose a picture* sets one (it is shrunk in your browser to fit); it shows in the cards, the guide and the administrator's list, with the channel number in a corner. The container keeps it (up to 150 kB, checked by what is inside it, never SVG) and sends it with nothing that could run in it.
- **Tools to make many channels from your own library** (`tools/channels`): one reads the library into a file, and another creates the channels of a file (a dry run first, and it can be undone). Files with your titles are never committed.

### Changed
- Container 0.2.2: two new tables (favourites and pictures) are made by themselves when it starts. An older app shows nothing different; an older container just has no favourites or pictures.

## [1.7.1] - 2026-11-10

Filling a Retro TV channel from a wall of posters, and more ways to programme it.

### Added
- **Fill a Retro TV channel from a wall of posters.** The channel editor has a new *Browse the library* button that shows your films, series or collections as posters. Tick the ones you want (or *Pick all shown*), narrow them by genre, by name or by order (A–Z, recently added, year, rating), and load more as you go. A film that is in the library twice shows once. When a genre is chosen, *Add it as a rule* adds every film of that genre, now and whatever you add later. What was chosen is listed under the posters, so the posters do not move while you tick them. The search box by name is still there.
- **More ways to programme a channel.** Under *How it is programmed*: a new order, *Oldest first, by year of release*; *Episodes in a row* (1 to 5) for the order that mixes series in; and *Leave out titles longer than* (30 minutes to 3 hours), which is ignored if it would leave nothing to show. Each option says in a line what it does. Older channels keep working as they were.

### Changed
- **A channel can hold up to 500 titles picked one by one** (it was 60, too few for a wall of posters), and a channel keeps up to 20,000 titles in all.
- **Films picked one by one are read from Jellyfin in batches of 50** instead of one request each, so saving, previewing and the night refresh of a channel of many films are much quicker.

### Fixed
- **Lists with a scroll bar in the channel editor can be reached with the keyboard.**
- **Quick channels and the rule form listed no genres on some Jellyfin servers** (seen on 12.4): the container read them only from the query filters, which can answer with an empty list. It now joins what `/Genres` and the filters say.

## [1.7.0] - 2026-11-10

The Seerr module, and the guides of Retro TV and the cards of Match made to respect who is looking.

### Security
- **Retro TV guides respect who is looking.** The guide, the list of channels and the program on show used to name every title of a channel to everybody signed in, including titles from a library hidden from a child account or over its age limit. Now the container asks Jellyfin, with each person's own token, which titles their account may see, and a title they may not see is a *Program not available* slot (the times stay; no name, picture, id or synopsis). The apps skip those programs when tuning in. The definition of a channel (its sources and their names) is only given to administrators. Needs the modules container and the apps of this version together: an older app shows the slot with an empty id.
- **Match never deals a title hidden from somebody in the room** when the container has its Jellyfin API key: it checks what each person (and the host, whose screen shows the cards) may see, and asks to try again if Jellyfin cannot say. Without the key it only knows the library of the person asking.

### Fixed
- **Leaving a Retro TV channel no longer overwrites progress made elsewhere.** The place a title had before the channel touched it is put back only if the title is still where the channel left it; if the same title moved on in another device meanwhile, it is left alone.

### Added
- **"Search in Seerr" from the search of the library.** When there is a modules container with Seerr working, the results of a search end with a block of its own (and, when nothing matched, the block comes right under that message): "Not in your library? Search “…” in Seerr". It opens the Seerr module with that text already searched. What can be played and what can only be asked for are never mixed in one list, and without the container or without Seerr turned on there is nothing to see.
- **Seerr module** (modules container and Jellyflix Web). Look up movies and series the library does not have and ask for them, from Modules, Seerr: search with where each title stands (in your library, partly, being added, waiting for approval, cannot be requested), ask for a movie or for chosen seasons of a series, see your own requests and how many requests you have left. A title Seerr knows is in the library opens in Jellyflix. It is **off unless turned on**: add `seerr` to `JELLYFLIX_MODULES` and set `SEERR_URL` and `SEERR_API_KEY` in the container; without them the app does not offer anything about Seerr. It needs **Seerr 3.3.0 or later**, and says so when it is older or does not answer. Each person acts as their own Seerr user (the container finds them by their Jellyfin account and calls Seerr as them), so their permissions and quota apply and a request is theirs; an account Seerr does not know is asked to be imported by an administrator, never served as the administrator. The Seerr key never leaves the container, only fixed Seerr routes are called, every number and text is checked and cut to size, Seerr's own error words are not passed on, and each person is limited to 10 requests, 60 searches and 180 other questions (titles, own requests, quota) a minute. Pictures come from TMDb.

## [1.6.0] - 2026-11-10

Several accounts on the TV with PINs, signing in by QR, hiding titles from Continue watching and Next up, "Are you still watching?", a sleep timer and an optional sync of preferences between the web app and the TV.

### Added
- **Several accounts on one Jellyflix TV.** Add the other people of the house with a password or a Quick Connect code, and a "Who's watching?" screen (their pictures and names, with the remote) opens at the start. Switching stops the video or music of the account that was in use (telling Jellyfin where it stopped) and empties everything that belonged to it: Home, libraries, favorites, history, suggestions and the Google TV row. Each account can have its own PIN (4 to 6 digits, kept only as a salted hash; five wrong tries in a row start a wait of 30 seconds that doubles up to fifteen minutes) in Settings, Account. The PIN protects opening the account from this TV; what the account may watch is still decided by Jellyfin. An account locked with a PIN keeps its titles off the Google TV home row, which every person of the house sees. Hold OK on an account to remove it: the server is told to end that session and its sign-in, PIN and remembered choices are erased on the TV. When Jellyfin stops accepting one account's session only that account has to sign in again; the others stay as they are. Settings, Account also has "Switch account", "Add account" and "Ask who is watching when the app opens". The audio and subtitles remembered for each series, the last Live TV channel and "New since your last visit" now belong to each account. The single account of an earlier version becomes the first one and keeps all of that.
- **A QR code beside the Quick Connect code** on the TV. Scanning it opens a page of Jellyflix Web (`#/link?code=…`) that asks, with the code in front of you, whether to let that TV sign in as your account; nothing is approved until you press the button. The QR only holds the web app's address and the six digits (no password, no session, not even the server's address). The TV counts down to the expiry of the code and has a "New code" button; typing the code in Jellyfin still works. The address is the one set in Settings, Modules (or the usual port of the Docker image on the server's host, shown under the QR).
- **`#/link` in the web app**, also reachable with no code (it asks for it, like Settings, Account).
- **Optional sync of a few preferences between the web app and the TV app** (Settings, General on the web; Settings, Appearance on the TV). It keeps the theme, the order and visibility of the menu, the rows of the home page and a few playback choices (autoplay, "Are you still watching?", what to do with intros, recaps, credits and previews) the same on every device of an account. What depends on the screen or the connection (a TV's margin, text size, quality limit, poster size, density) is never synced. It is off until you turn it on, for each account on each device, and the first time you choose between using what the account already has and uploading this device's choices (nothing is changed before you choose). Each section is its own: the most recent change wins per section, by the server's clock; a change made offline is sent later and judged by when it was made, and when an account's newer copy replaces it the device says so. Sections this version does not understand, or has never heard of, are left exactly as they are. It is kept in a field of your Jellyfin user's display preferences of its own, apart from the manual settings file, so older versions that save that file cannot damage it. It runs when the app opens, when the page comes back, a few seconds after a synced choice changes and from a "Sync now" button; nothing runs on a timer.
- **Each account on the TV has its own look** (background, accent, poster size, Home rows, menu). A new account starts from the look the TV had before.
- **Hide a title from "Continue watching" and a series from "Next up"** (web and TV), without touching what you have watched. Jellyfin has no way to hide them (only to mark a title watched or to throw its position away), so the choice is the client's, kept for each account: the card's "⋯" menu on the web and the long-press menu on the TV offer "Hide from Continue watching" and "Hide series from Next up", with "Undo" at once. A title comes back to Continue watching by itself when it is played again after being hidden; a series stays out of Next up until it is restored. Both are still in the library and the search, and the Google TV row follows. The list of what is hidden, with "Restore" and "Restore all", is in Settings (Appearance on the web, Account on the TV). Other Jellyfin apps keep showing those titles, and web and TV do not share the list.
- **"Are you still watching?"** after a number of titles in a row that began by themselves (never by default; 2, 3, 4, 6 or 8 in Settings, Playback). At the limit the next title waits for your answer ("Keep watching" or "Stop"), and the playback stops if nobody answers in a minute, with where you stopped saved. Starting a title yourself starts the count again.
- **Sleep timer for video** in the player's settings menu on the web and in the player's buttons on the TV: stop in 15, 30, 45, 60, 90 or 120 minutes, or at the end of the episode, with a warning in the last half minute and a way to keep watching. The timer wins over the next title and over the question, it counts during the countdown to the next title, and it is forgotten on a reload or when the account changes.

## [1.5.0] - 2026-11-08

Five languages on the web, the audio and subtitles of each series remembered on the TV, the fixes of a security audit of the web app and a lighter first visit.

### Added
- **Portuguese, French and German in the web app.** The interface now speaks five languages (English, Spanish, Brazilian Portuguese, French and German). It follows the browser's languages (the first one it has texts for) and can be switched in Settings without signing out. Each language is a file of its own that is downloaded only when it is used, so the first screen does not grow. The i18n test checks that every language has exactly the same texts and placeholders as the Spanish reference, and an end-to-end test switches between them. The subtitle search also starts in the language of the interface. (The TV app stays in English and Spanish for now.)
- **Jellyflix TV remembers the audio and subtitles of each series.** Pick Japanese audio with English subtitles (or no subtitles) on one episode and the next episodes of that series start the same way, by language, like the web app already did. It also applies to an episode picked from the player's list and to the next episode of autoplay, and a subtitle saved from the internet is remembered too. The choices stay on the TV and are forgotten on sign out.
- **The web app also remembers what you pick on the title page.** The audio track or subtitle chosen there (including "no subtitles") now counts for the rest of the series, not only what is chosen while playing.
- **Ready-made image of the modules container.** `ghcr.io/sebastianvelezg/jellyflix-modules` is now published with every release (amd64 and arm64, with its build record), next to the web image and the TV APK. It can also be published by hand for an earlier tag (Actions > Modules image > Run workflow).
- **Optional strict policy for the Docker image of the web app.** With `JELLYFLIX_STRICT_CSP=1` (and `JELLYFIN_URL`), the page may reach only its own site, that server and the modules container. Signing in to another server then stops working, and the previews of pictures from the internet in Administration do not show (see "Host it" in `web/README.md`).

### Changed
- **A lighter first visit.** The first screen of the web app is 14 kB (gzip) smaller (227 kB instead of 241): the administration, Live TV, plugins, statistics and the comic reader, with the parts of the Jellyfin API client only they use, are now downloaded when one of them is opened, not with the first screen (`src/core/extra.ts`; `npm run size` fails if they come back). The app's service worker no longer downloads the texts of the four languages other than English when it installs (about 140 kB); the language in use is kept the first time it loads.

### Security
- **What one account does on a browser stays with that account.** The searches, the audio and subtitles remembered for each series, the subtitle timing, where you stopped in a book and the date of your last visit are now kept under the account that signed in, so another account on the same browser (a child, a guest) no longer sees them. With nobody signed in nothing is read or written. The copies kept before, without an owner, are dropped at the next sign-in, so those choices are asked again once.
- **The session token only ever goes to your server with a picture.** When a picture fails and is asked for again with the session (some servers need it), that only happens for a picture on the server you signed in to.
- **A `?modules=` link to another address of your network now asks first** ("Connect to the modules at this address?"), so somebody else on the same network cannot make the app send them your session. Links to this site or to your Jellyfin server's host (like the QR code of a Match) still work at once, and an address already in use is not asked about again.
- **Imported settings are checked like the look already was.** A settings file edited by hand can no longer put an unknown sort, filter, volume or player choice in storage (an unknown sort could leave a library unable to load).
- **A book's style sheet cannot close its own element** and turn the rest into markup in the reader (it could not run anything before either: the reader's frame allows no scripts).
- **Modules container:** a caller that sends more than 20 tokens Jellyfin refuses in a minute waits a minute (HTTP 429) before Jellyfin is asked about another one, while people already signed in carry on; and the least recently used sessions make room in its memory instead of all of them being forgotten at once. New setting `JELLYFLIX_TRUST_PROXY=1` for a container reached only through the web image's `/modules/` proxy.

## [1.4.0] - 2026-11-06

The first optional extras: a **modules container** with **Retro TV** channels and **Match**, on the web and on the TV. Without the container nothing changes.

### Added
- **Modules (optional).** A new, optional container, `jellyflix-modules` (folder `modules/`), adds a **Modules** tab to Jellyflix Web when it is running. Without it, or when no address is configured, the app does not look for it and is the app it was: no button, no request, no page. Settings: `JELLYFLIX_MODULES_URL` / `JELLYFLIX_MODULES_PUBLIC_URL` (Docker image, with an nginx proxy for `/modules/` generated only when asked), `JELLYFLIX_MODULES_URL` with `npm run serve`, or `?modules=<address>` once on a device. The first screen of the web app grows by about 2 kB (gzip) for everybody; the screens of the modules are only downloaded by those who have the container.
- **Retro TV (module).** Channels made from your library (a marathon of one anime, Saturdays of Marvel, horror at midnight) with a guide. Nothing is broadcast and nothing runs while nobody watches: a channel is a schedule, and tuning in plays the title that is on, at the right minute, with the normal player. The player has the controls of a television: one glass panel with what is on, the progress bar, start over, previous and next program, go live, channel up/down, the guide of the channel being watched (over the picture), volume, share and settings. Administrators set channels up in their own tab (by hand, with rules or one per genre in one click; turn them on and off); everybody watches them.
- **Match (module).** Two or more people, each on their own phone and account, swipe the same films; what everybody liked goes on to the next round until one is left, then it plays here or on the TV. It starts by asking how to play: **on this device** (one person, or everybody around one screen, swipes there) or **each on their phone** (the screen opens a lobby with a **QR code** and who has joined; each person reads it with their phone, which opens Jellyflix and joins by itself; the host starts the swiping; the screen shows the round and plays the winner). Before starting, the cards are chosen by tapping chips: genre, decade, length (under 90 minutes, 90 to 120, over 2 hours) and whether series are included; later rounds begin with a look at the films that are left. The app tells you when someone joins or finishes the round (a message, and a notification if you allow it and the page is hidden), and the end shows **how it went**: how many films you agreed on, how many each liked and what each chose as favourite.
- **Retro TV: what a television does when a program starts.** A short "Now / Next" panel appears when the program changes, and when you tune in to a program that is already well under way it says "You tuned in at minute 47" with a button to start it from the beginning. The next program is got ready while the current one ends (its title and how to play it), so it starts without the wait between titles.
- **Jellyflix TV: Modules.** The Android TV app has the same optional Modules section (a **Modules** button in the top bar that exists only when the container answers; with no address set the app asks for nothing). **Retro TV** on the TV: the channels as a grid with what is on now, a guide, and the player with a glass panel, channel up/down (also with the remote's CH keys and up/down), start over, previous and next program, go live, the "Now / Next" card, "You tuned in at minute N" and the next program prepared ahead. **Match** on the TV is the screen only: it shows a QR code and who has joined, everybody swipes on their phone, and the TV shows the rounds and plays the winner. The container and the web address are set in **Settings > Modules**. All videos on the TV now use the same glass control panel as the web player.

### Security
- A link can no longer make Jellyflix Web send your session token to another server: the address of the modules container in a `?modules=` link is only used if it is this site, your Jellyfin server's host or an address of your own network. Any other address has to be set by whoever hosts the app.
- The modules container only passes on tokens that look like Jellyfin tokens, remembers a refused token for ten seconds (so made-up tokens do not become a flood of requests to Jellyfin), refuses to join a Match that already started, makes a person wait after too many wrong room codes, and answers a broken address with an error instead of crashing the request.
- Known and documented: the guide of a channel shows its titles to every account on the server (`modules/README.md`).

## [1.3.2] - 2026-11-05

A small release: the descriptions of books and the README pictures.

### Fixed
- **Descriptions that come as HTML** (the book synopses of some metadata providers) were shown with their tags (`<p><b>…`). They are now plain text on titles, series, albums, collections and channels (web), and on titles, artists and programmes (TV).

### Documentation
- **README:** new pictures taken on a real library, each one in a different look (background and accent), with captions, a gallery of six looks and a disclaimer about the artwork the pictures show.

## [1.3.1] - 2026-11-02

No new features: the security, the speed and the structure of what already exists, and a safety net around the next releases.

### Hardening
- **TV: the session token is sealed.** It is now encrypted with a key held by the Android key store before it is written to the app's storage, so a copy of that storage does not hold a token that works. A token saved by an older version is sealed the first time the app opens and the clear copy is erased. If a device cannot do this, the app keeps working as before.
- **A server address typed without `http://` or `https://`** gets `http://` when it is clearly a home address (a private IP range, `.local`, a name with no dot, Tailscale) and `https://` for anything else, because http across the internet sends the password and the session in clear text (web and TV). A typed `http://` to somewhere that is not the home network now shows a warning (on the TV, choose Connect again to go on).
- **TV: the release app no longer writes its informational log lines.**
- **Web: the book reader** ignores more disguised script addresses (a tab or line break inside `javascript:`) and drops any reference that points outside the book, not only pictures; a test with a deliberately hostile book and a check of the reader's sandbox keep this from regressing.
- **`npm run serve`** answers only GET and HEAD.
- **Docker image and nginx:** the security headers (including the Content-Security-Policy) are written once, in `docker/security-headers.conf`, instead of three times; nginx no longer tells its version, accepts only GET and HEAD (anything else is refused), and takes no request body. The sign-in address (`config.js`) is written to `/tmp` instead of into the app's folder, so the container runs with a read-only disk. `docker-compose.yml` now starts it that way: read-only, in-memory `/tmp`, `/var/cache/nginx` and `/run`, `no-new-privileges`, and only the four capabilities nginx needs. The port stays 80, so existing `-p 8080:80` setups keep working. The base images are pinned by digest.
- **Web: a lighter first load.** The Spanish texts are a file of their own (30 kB compressed) that only Spanish readers download; English readers' first screen is about 30 kB lighter (235 kB of JavaScript in all). The logo and the wordmark are WebP: 39 kB instead of 161 kB, with the same look.
- **Web: a size budget.** `npm run size` (also in CI) fails when what the first screen downloads grows past `web/scripts/size-budget.json`, or when something only some people need (the Spanish texts, hls.js, the PDF reader) is pulled into it.
- **Inside (no change for you):** the biggest files were taken apart so each part can be read and tested on its own. Web: the video player (`PlayerStage`) is now a handful of hooks and small components, the signed-in shell (`App.tsx`) keeps its logic in hooks under `components/shell/` and the player's route in its own file, and the last `react-hooks` lint exemptions are gone. TV: the screens' state and the device profile each have their own file. Two browser tests that failed now and then (the saved volume, the hls.js music seek) were fixed, and the sign-in form's code polling has unit tests.
- **Dependencies:** the web app's packages are updated within their ranges (axios 1.21, the Jellyfin SDK 1.0.2, hls.js 1.7.4, Vite 8.3.5...); no known vulnerability remains in what ships. The Android lint check now passes and runs in CI (`tv/app/lint.xml` says which of its findings are false alarms: the Google TV row's builders and the activity's key dispatch), after fixing the one real finding (a date read without following the TV's language).
- **CI and releases:** the browser tests run in CI, code scanning (CodeQL) and a dependency check run on every change, every GitHub Action is pinned to a commit, releases use read-only permissions except where they publish, and the Docker image carries provenance and an SBOM.

## [1.3.0] - 2026-10-31

A visual polish of the whole web app, without changing its identity (calmer, simpler and more consistent), and the first three phases of the roadmap: the player and the way a title starts, the household, and the bigger pieces.

### Audit before the release: security and performance
- **A strict Content-Security-Policy (web):** the app is now served (Docker image, `npm run serve`) with a policy that runs only its own scripts: no inline script and no `eval`, no script from another site, no plug-ins except the browser's PDF viewer, no `<base>` or form sent elsewhere, and it cannot be put in a frame of another site. The pre-paint look script moved to its own file (`paint.js`) for that. A test keeps the policy of nginx and of the Node server identical. Also a `Permissions-Policy` that turns the camera, microphone, location, payment and USB off.
- **Dependencies:** `follow-redirects` (a high-severity advisory inside axios) is updated; no known vulnerability remains in what ships to users (`npm audit --omit=dev`). The ones left are in the lint tools, which are not part of the app.
- **Signing out forgets more (web):** the recent searches and the *Last watched* channel are cleared when you sign out, so the next account on the same browser does not see them.
- **Signing out forgets more (TV):** the screensaver pictures of the account that left are dropped, so the next account does not see another account's backdrops. The session is also excluded from Android's cloud backup and from device-to-device transfer.
- **Kids mode:** a title chosen by a watch-together group is ignored on a device in Kids mode.
- **Performance (web):** the page of playlists is no longer pulled into the first download by the rows that show a playlist card.

### The bigger pieces: Live TV, watching together, the TV screensaver (phase 3 of the roadmap)
- **Live TV by kind:** the channels can be narrowed to *Movies*, *Series*, *Sports*, *News*, *Kids* or *Favorites* (the server decides a channel's kind from what it broadcasts). The choice is kept, and the arrows of the player change channel inside it. (TV too.)
- **Strip of channels in the player:** a row at the bottom of the live player shows the channels around the current one, with what is on each; one click changes channel. On the TV the controls say which channel up and down lead to.
- **Back to the last channel:** a *Last watched* button on the Live TV page, and the guide lists that channel first. (TV too.)
- **Watch together:** the people icon in the header (not shown in Kids mode) starts a group or joins an open one, using Jellyfin's own SyncPlay. Press Play on a title and it opens for everyone in the group, waits until every device is ready and starts at one moment by the server's clock; pause, play and seek are shared; leaving the player does not hold the others back. The server's administrator decides which accounts may use SyncPlay; an account that may not is told so. Web only for now.
- **Screensaver on the TV:** off by default. Settings → Display chooses after how long (2 to 15 minutes), pictures from movies, series or both, and a highest age rating. It shows backdrops from the library, drifting slowly, and any key brings the app back. It does not start while a video plays.
- **TV catch-up:** *Titles under posters* can be turned off, *Next up* can look back only so far, and the title page has *I like it* and *Not for me*.

### Household: settings, cards, my rating, Kids mode (phase 2 of the roadmap)
- **Search in Settings:** a box above the tabs finds a setting by its name (or by words like "skip", "colour", "pin") and takes you to it, opening its tab.
- **Cards:** Settings → Appearance → *Cards* turns off the titles under the posters, chooses what pressing a card of *Continue watching* and *Next up* does (play, or open the page; the little button in its corner does the other), and how far back *Next up* looks.
- **My rating:** a thumb up and a thumb down on the title page, kept on your server, and two new choices in the library filter: *Liked by me* and *Disliked by me*.
- **Kids mode:** Settings → General. Choose the highest age rating to show and a PIN to leave. Titles above it, and titles with no rating, disappear from every list, search and suggestion, and opening one by its link says it cannot be loaded. Settings, Administration, the stats and Live TV are shut until the PIN is typed (wrong tries make the next one wait, up to 15 minutes). It checks first that the server tells the age rating of its titles. The PIN guards this app on this device; for a limit nobody can get round, also set the highest rating for the account in Administration.
- **Trailers:** a *Trailer* button (or a list, with several) on the title page. It opens the trailer on its own site in a new tab: the app itself still loads nothing but your server.
- **First-run setup:** the first time the app is opened on a device it asks the language, the look (background and accent) and the subtitle language, in three short steps, each applied as you choose. It can be skipped, and it comes back from Settings → About → *Run the setup again*.

### Player and the way a title starts (phase 1 of the roadmap)
- **Second subtitle:** a second track shows above the first (a step smaller, in another colour) to learn a language or to read a dub. It is chosen on a page of the player's menu, only while a first subtitle is on, and the language is remembered.
- **Episodes in the player:** a button with a tab per season lists the episodes of the series; picking one plays it without leaving the player. (TV too.)
- **Choose before you play:** under Play, a title with more than one version of the file (4K and 1080p), more than one audio track or subtitles to choose from gets three small dropdowns: version, audio and subtitle. The version you choose is offered first next time. (The TV app already chose the version.)
- **Skip by kind:** intros, recaps, credits and previews each get their own choice in Settings: show a button, skip by itself, or do nothing. A button nobody pressed goes away after ten seconds on the web. (TV too; the old single switch still decides intros, recaps and credits until you choose.)
- **The seek bar:** the labels on each side can show the time played, the time left, the total length, the time it ends, or nothing; the chapter marks can be turned off; and dragging the bar can pause the picture until you let go.
- **Converted sound:** a list in Settings of sound formats (AC-3, E-AC-3, FLAC; DTS and TrueHD on the TV) that the server converts although the device could play them, for a receiver that stays silent. The picture is not touched.

### Interface polish (web)
- **Player settings menu in pages:** the long list became a short menu (Audio, Subtitles, Quality, Speed, Subtitle look, Chapters) that opens one page at a time, with the switches (autoplay, repeat the list, cinema mode) at the bottom. Escape closes it.
- **Cleaner player bar:** the times sit on either side of the seek bar, the volume slider appears on hover, and the seek bar is a solid accent line.
- **One toolbar for every library:** Movies, Series, Anime, Books, Music videos, Music and Collections share a single row of pill filters (library, genre, sort, more filters, Surprise me) that scrolls on a phone instead of wrapping. Selected letters and filters are white pills.
- **Details and series pages:** very long audio and subtitle lists fold into two lines with *Show more*; seasons are one scrolling row; an episode's *Play on…* and *Edit* appear when the row is pointed at (always on a touchscreen).
- **Cards, header and bars:** a calmer hover (small zoom, dark shadow, white ring), white round play buttons, a thinner progress bar, and no decorative glows anywhere (heading stripes, tabs, header indicators, covers, spinners).
- **Settings and Administration:** real switches instead of check boxes, flat cards, small-caps group names in an account's permissions, and no scroll bar under the tabs on a phone.
- **Sign-in:** the grid in the background is gone. The primary button now reaches the 4.5:1 text contrast in every theme.

### TV app
- The focused card no longer draws a blue glow; the blue frame and a slightly smaller zoom remain.
- Settings → Playback has a choice per kind of skippable stretch and a list of sound formats the server should convert; the player has an *Episodes* button for episodes.

## [1.2.0] - 2026-10-27

A better video player, music that flows from one song to the next, mixes made for you, music videos you can browse by folder, play from their card and keep playing in a mini bar, and more varied suggestions. The TV app gets subtitle search, mixes and radio, and play-through.

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
  - **Videos follow each other:** the 3-2-1 countdown runs over the last 3 seconds of a music video and the next one of its queue starts the moment it ends, from its beginning (no pause in between). The next video keeps the screen as it was: in full screen it also plays in full screen, in a window it stays in a window. A video played on its own goes on with the others of its folder. **Repeat the list** (in the player's menu, for any queue: folder, library, playlist, collection) starts again from the first video after the last one.
  - A playlist page has **Shuffle** too. A shuffled queue keeps one random order from the first video to the last.
  - **Play from the card, and it goes on:** a music video's card has a round play button in the middle of its picture: it plays the video at once, and the rest of the card still opens its page (on a touch screen the button is always there). Wherever a music video is played from, the next one follows it: from a row (Recently added, New music videos, Continue watching, your favorites, top rated...) the next of that row, from the grid of all videos the next ones of the grid, from a folder the rest of that folder. A video with no list at all goes on with the others of its folder, as before. (A row's list is kept in memory: after a reload the video goes on with its folder instead.)
  - **A mini player for music videos:** leaving a music video with Back (or Esc) does not stop it: it goes on playing in a bar at the bottom of the page, like the music, with its picture as a small thumbnail, play/pause, next, a timeline, a button to open it full screen again (the same video, without a cut) and one to close it. You can browse, search and pick another video meanwhile; playing another one takes the place of the one in the bar, and the next video of its queue follows inside the bar. The video and the music take turns: a video pauses the music and holds the bar, and starting a song closes the video.

- **The full-screen music player takes its colours from the cover:** the blur behind the cover, the bars of the visualizer (a gradient between the cover's two main colours), the glow and the accent of that screen (seek bar, buttons) follow the song that is playing and fade into the next song's colours. A cover with no colour of its own (black and white), or one the browser cannot read, keeps the accent chosen in Appearance.

### TV app
- The same more varied suggestions on Home: *Because you watched X* for several recent titles and *Because you liked X* for a favourite.
- **Subtitles from the internet:** the Audio and subtitles menu has *Search online…*: pick a language, then one of what your server's subtitle plugin found (a match of your file is starred); it is saved on the server and switched on, and the video carries on from the same second. Needs an account that may manage subtitles.
- **Mix of the day and radio:** the music page has a *Mix of the day* (a few of your favourites, the radios of three of them and a few surprises; the same all day while the app is open) and album and artist pages have a *Radio* button, from the server's instant mix.
- **Play through:** the Play button of a collection goes on to the next film of the saga, and a music video played on its own goes on with the other videos of its folder (with autoplay on), like on the web.
- Left to the web app on purpose: browsing music videos by folder, repeating a list, the mini player and the play button on cards (the TV player is always full screen and the remote opens a title first), cinema mode, the Up next card with a countdown, crossfade, the visualizer and the cover colours.

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
