# Roadmap: three phases after the interface polish

The interface polish is done (see the changelog). The next work is about **function and experience**: what the app can do and how well it connects, plays and remembers. Everything below works with a plain Jellyfin server, with no plugin and no extra service.

How we work: one branch per phase, small commits while building, **one commit per phase** at the end (squashed if needed), then a release when the three phases are in. Each item ships with unit tests (pure logic), an end-to-end test against the mock server, Spanish texts (`web/src/i18n/es.ts`, a test fails without them) and a check with the axe accessibility spec. An item marked **TV** also gets its Android TV version.

Legend: **S** a day or less, **M** a few days, **L** about a week or more.

---

## Phase 1: the player and the way a title starts

Goal: playing a title is more flexible and more predictable.

| # | Item | Size | Where | Notes |
|---|------|------|-------|-------|
| 1.1 | **Two subtitles at once** (a second track, for learning a language or for dubs) | M | Web, TV | A second overlay under the first; its own colour and position; the choice is remembered per language. |
| 1.2 | **Episodes button in the player**, with a tab per season | S | Web, TV | Change episode without leaving the player; the current one is marked. |
| 1.3 | **Chapter marks on the seek bar** (off by default) | S | Web | The chapters are already in the menu; draw their start on the bar and in the trickplay preview. |
| 1.4 | **Choose the version and the tracks before playing** (4K or 1080p, audio, subtitle) | M | Web, TV | A small panel on the title page when a title has more than one version or track; the last choice is the default. |
| 1.5 | **Time labels you can choose** (elapsed, remaining, total, the time it ends) for the left and right of the bar | S | Web | Separate choice for video and music. |
| 1.6 | **Pause while scrubbing** (on or off) | S | Web | A setting in Playback. |
| 1.7 | **Skip by kind** (intro, recap, credits, preview): ask, skip by itself, or do nothing; the button hides after a few seconds | S | Web, TV | Replaces the single switch we have on TV. |
| 1.8 | **Convert only some audio codecs** (for example DTS) and leave the video alone | S | Web, TV | A list in Playback that feeds the device profile (`core/deviceProfile.ts`). |

Done when: all eight work on the mock server and on a real one, the tests pass, and the changelog lists them.

**Status: built** (see the changelog). How it ended up differs a little from the table:

- 1.3: the chapter marks were already on the seek bar; it is now a setting (on by default).
- 1.4: the TV app already chose the version, so it was built for the web only (version, audio and subtitle on the title page; the choice is read once by the player).
- 1.1: web only. ExoPlayer on the TV shows one text track at a time, so two lines would need its own subtitle renderer: left for later.
- 1.2, 1.7, 1.8: web and TV. On the TV the old "skip automatically" switch became one choice per kind (the old value still counts until a new choice is saved), and the sound list offers AC-3, E-AC-3, DTS and TrueHD.
- 1.5 and 1.6 are web only (the TV bar is different). The skip button's ten-second timeout is web only too: a remote needs longer.
- Not checked on a real server: playing with the new options (playing writes the watch state, so it was only tried against the mock server). The TV Settings screen was seen on the emulator; its player was not.

Risks: 1.1 and 1.4 touch the playback profile and the subtitle overlay (the most delicate code of the player). Do them first, with tests, and check subtitles in direct play and in HLS.

---

## Phase 2: home, libraries and the household

Goal: the app is easier to set up, to browse and to share at home.

| # | Item | Size | Where | Notes |
|---|------|------|-------|-------|
| 2.1 | **Search inside Settings** | S | Web | Finds a setting by its name and jumps to its tab. |
| 2.2 | **Default action of Continue watching and Next up** (open, or start playing) and **how many days back** Next up looks | S | Web, TV | Settings in Appearance. |
| 2.3 | **Titles under the posters** on or off, and **library order** saved in the server's display preferences | S | Web, TV | The order then follows the account on every device. |
| 2.4 | **My rating**: like or dislike on a title, and filter the libraries by liked or disliked | M | Web, TV | Uses the server's own `Likes` value and filters, so no plugin. No star scale (Jellyfin has none). |
| 2.5 | **Parental controls and Kids mode with a PIN** | L | Web, TV | A kids profile that hides what is above an age rating everywhere (home, search, libraries, suggestions) and leaves a minimal app; leaving it asks for a PIN. The PIN is kept on the device and guards the app, not the server: for real protection the administrator also sets the account's maximum rating in Administration. We say so in the screen. |
| 2.6 | **Trailers inside the app**, with a picker when there are several | M | Web | Local trailers play in our player; remote ones (YouTube) open in an embedded player. Check what the server gives first. |
| 2.7 | **First-run setup** (language, theme, the audio and subtitle languages, the home rows) with a preview | M | Web | Short, skippable, and it can be run again from Settings → About. |

Done when: a kids profile cannot see a blocked title by any route (a test visits every page), and the rest work as described.

**Status: built on the web** (see the changelog). How it ended up differs a little from the table:

- 2.3: the titles under the posters have a switch; the library order saved on the server was left out (the top menu can already be ordered on each device, and writing the order to the account's configuration is a change to the server we did not want to make unasked).
- 2.4: like and dislike on the title page (the SDK has no stars); the filters *Liked by me* and *Disliked by me* use the server's own `Likes` and `Dislikes`.
- 2.5: one feature, *Kids mode*: a highest age rating and a PIN, for the whole device. The request layer asks the server to leave out what is above the rating (where the list is made of titles that carry a rating) and checks every answer again; a title with no rating is hidden. Before turning it on, the app checks the server says the rating of its titles. Not checked on a real server (only on the mock): that the lists of a real Jellyfin carry `OfficialRating`.
- 2.6: the trailer opens on YouTube in a new tab, not inside the app: an embedded player would load Google's scripts, and the app promises to load nothing but your server. Local trailer files were left out.
- 2.7: three questions (language, look, subtitles), asked only on a device that has never saved a preference.
- 2.2, 2.3, 2.4, 2.5 and 2.7 are web only for now; the TV catch-up of phase 3 picks up what is missing.

Risks: 2.5 touches every list, so build one filter in `core/` and call it from everywhere. 2.6 depends on what the server returns for trailers.

---

## Phase 3: the bigger pieces

Goal: things that make the app feel like a complete service. Each one can be shipped alone.

| # | Item | Size | Where | Notes |
|---|------|------|-------|-------|
| 3.1 | **Live TV: faster channels**: a strip of channels to change with Up during playback, the guide opens on the last channel, and filters by category (movies, series, sports, news, kids, favourites) | M | Web, TV | Our Live TV only shows channels today. |
| 3.2 | **DVR**: a record button for a programme or a whole series, and a page for the schedule and the recordings | L | Web, TV | Only offered when the server has a tuner and a recording path. Uses the server's timers API. |
| 3.3 | **Watch together (SyncPlay)** | L | Web | Create or join a group, with play, pause and seek kept in step by the server's own SyncPlay. Needs clock sync and care with reconnects. Start with web; TV later. |
| 3.4 | **Screensaver on the TV** with art from the library | S | TV | Optional, off by default; filters by library and by rating. |
| 3.5 | **TV catch-up** with whatever of phases 1 and 2 is missing there | M | TV | One pass at the end so TV and web say the same things. |

Done when: 3.1 to 3.4 are on a real server with a tuner (if there is one) and on the mock server otherwise.

Risks: 3.2 and 3.3 cannot be fully tested without a tuner and a second person; the mock server will cover the calls and a manual test the rest.

**Status: built, except 3.2** (the DVR was left out on purpose; it is not planned yet). How it ended up differs a little from the table:

- 3.1: web and TV have the categories (the server's own `isMovie`, `isSports`...), the last channel and the neighbours in the player. On the web the strip of channels is a row under the picture; on the TV, where up and down already change channel, the controls say what each leads to instead of drawing a strip.
- 3.3: web only. The mock server keeps groups, a queue and the commands, and waits for every member to be ready before it starts, as the real one does in outline; two browsers are used in the tests. Not seen with a real server and two people. Left out: correcting drift while playing (a device that falls behind is only brought back at the next pause, seek or buffering), the queue of several titles (each title is its own queue) and the TV.
- 3.4: an idle screensaver inside the app (not Android's system screensaver, which a TV lists under its own settings). It filters by movies or series and by a highest age rating; "by library" is by kind, not by each library.
- 3.5: the TV got *Titles under posters*, the days of *Next up* and the thumbs of my rating. Still missing on the TV from phases 1 and 2: the second subtitle line (the TV player shows one text track at a time), Kids mode (the TV client has no single request layer to put the filter in), trailers (a TV has no browser), the first-run setup and the settings search. None of the TV changes was run on a device; they build and their pure parts have unit tests.

---

## Release

After the three phases: update the version (web and TV together, as always), the changelog and the README, run all the checks, and publish with the existing release workflow.

## Left for after the plugin

These need something running on the server, or have problems from a browser (CORS), so they wait:

- **Seerr / Jellyseerr**: requests, discovery rows and request status inside the title page.
- **Settings sync** between web and TV (theme, home rows, language).
- **External ratings** (MDBList, TMDB, Rotten Tomatoes), which need an API key.
- **Anime markers** (filler, recap, canon) and **messages from the administrator**.
- Ordering and filtering by *my rating* on the server.

## Not planned

Retro games, achievement badges and chat, seasonal effects, many layouts for the same page, a theme store, Plex and Emby, several servers at once, Chromecast and offline downloads. They are large, and the app already covers their use cases some other way (Play on…, the TV app) or not at all for our users. They can come back if that changes.
