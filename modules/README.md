# Jellyflix Modules

An **optional** second container for [Jellyflix](../README.md). When it is running, Jellyflix Web gets a **Modules** tab; when it is not, Jellyflix and Jellyfin behave exactly as they always did: the app does not even look for it unless you give it an address.

| Module | What it does |
|---|---|
| **Retro TV** (`channels`) | Channels made from your own library, with a guide: a marathon of one anime, Saturdays of Marvel, horror at midnight. Nothing is broadcast and nothing runs while nobody watches: a channel is a schedule, and tuning in plays the title that is on, at the minute it is at, with the normal Jellyflix player. Buttons: start over, next, previous, go live, channel up/down. A channel is filled by ticking posters of your library (up to 500 picked by hand) or with a rule (a genre, a decade: it follows the library by itself), and is programmed as a marathon (series mixed in with 1 to 5 episodes in a row, as listed, shuffled, or oldest first) or as a weekly grid, with an optional longest length for a title. |
| **Match** (`match`) | Two or more people, each on their own phone with their own Jellyfin account, swipe the same films. What everybody liked goes on to the next round until one is left; then play it here or on the TV. |

| **Seerr** (`seerr`) | Look up movies and series your library does not have and ask for them, from Jellyflix Web, with **your own Seerr account** (its permissions and quota apply). Off unless you turn it on: see [Seerr](#seerr). |

Planned: YouTube channels downloaded to your library (Tube) and a "Wrapped" of what you watched. See [docs/MODULES-PLAN.md](../docs/MODULES-PLAN.md) and [docs/MODULE-CHANNELS.md](../docs/MODULE-CHANNELS.md).

## How it works, in short

- It is a small Node service (no dependencies to install) with a SQLite file in `/data`.
- It has **no accounts of its own**: Jellyflix sends the same session token Jellyfin gave it, and the container asks Jellyfin who that is. Creating channels needs a Jellyfin administrator; watching them and playing Match does not.
- Videos are never sent through it. The player always plays from Jellyfin. The container only answers "what is on now" and keeps Match rooms.
- It writes nothing to Jellyfin. (An API key is optional, see below.)

## Run it

You need Docker (or Node 24 for a quick test) and the address of your Jellyfin server.

### With Docker Compose

```bash
cd modules
cp .env.example .env     # then set JELLYFIN_URL (required) in .env
docker compose up -d --build
curl http://localhost:8097/v1/health
```

`JELLYFIN_URL` is the address of Jellyfin **as this container reaches it**: the container's name (`http://jellyfin:8096`) when both share a Docker network, otherwise the IP of the machine that runs Jellyfin.

Settings (in `.env`): `JELLYFIN_URL` (required), `JELLYFIN_API_KEY` (optional, see below), `JELLYFLIX_MODULES` (`channels,match`; add `seerr` to turn that one on), `SEERR_URL` and `SEERR_API_KEY` (only for Seerr), `MODULES_PORT` (`8097`), `JELLYFLIX_ORIGINS` (sites allowed to call it from a browser; empty means any, which is fine because it uses tokens, not cookies), `JELLYFLIX_TRUST_PROXY` (`1` only when the container is reached through the web image's `/modules/` proxy and its port is not published; see Exposure).

**API key (optional, but needed for a Match on phones).** Created in Jellyfin: *Dashboard → API keys*. With it the container refreshes each channel's list of titles by night, and a Match on phones checks what each person in the room may see and has watched. Without it Retro TV and a Match on one device work; an administrator presses *Read titles again* on a channel after adding things to the library; a Match on phones (and so the TV app's Match) is refused, because the container could not know what each account may watch. The key never leaves the container.

### Backing up

Everything the container keeps is one SQLite file, `modules.db`, in the `modules-data` volume: the channels you made, their pictures, the favourites and the Match rooms. If the volume is lost, the channels are lost with it (the lists of titles are read again from Jellyfin, but your channels' settings are not). To keep a copy, ask the running container for a consistent one (copying the file while it runs can catch it half written):

```bash
docker exec jellyflix-modules node --disable-warning=ExperimentalWarning -e "new (require('node:sqlite').DatabaseSync)('/data/modules.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker cp jellyflix-modules:/data/backup.db ./modules-backup.db
docker exec jellyflix-modules rm /data/backup.db
```

To restore it: `docker compose stop`, put the copy in the volume as `modules.db` (and delete `modules.db-wal` and `modules.db-shm` if they are there), then `docker compose up -d`. Keep the copy somewhere other than the machine that runs the container.

### Seerr

An optional module for people who run [Seerr](https://docs.seerr.dev/). It is **not** on by default: add it to the list, say where Seerr is and give it the key.

```
JELLYFLIX_MODULES=channels,match,seerr
SEERR_URL=http://seerr:5055          # Seerr as THIS container reaches it
SEERR_API_KEY=...                    # Seerr > Settings > General > API Key
```

- **Needs Seerr 3.3.0 or later** (the module asks Seerr who a Jellyfin account is with `GET /api/v1/user/jellyfin/{id}`, which older versions do not have). With an older or unreachable Seerr, the module shows what is wrong instead of working.
- **Each person acts as themselves.** The container finds the person's Seerr user from their Jellyfin account and makes every call as that user (`X-Api-User`), so their permissions and quota apply and the request is theirs. A Jellyfin account that Seerr does not know yet is told to ask an administrator to import it; it never falls back to the administrator's. People cannot choose another user: the Seerr user comes only from the verified Jellyfin session.
- **The key stays in the container.** It is never sent to the app, never logged and never in an answer. The container only calls a handful of Seerr routes that are written in its code (status, user lookup, quota, search, movie, series, requests); it is not a general proxy.
- **What it does:** search (movies and series, with where each stands), ask for a movie or for chosen seasons of a series, and see your own requests and quota. Approving, declining and Seerr's settings stay in Seerr. A title Seerr already knows is in the library opens in Jellyflix.
- **Limits:** 10 requests and 60 searches per person per minute.
- **Pictures** are loaded by the browser from TMDb (`image.tmdb.org`), like Seerr's own page does.

### Without Docker (to try it)

```bash
cd modules
JELLYFIN_URL=http://YOUR-JELLYFIN:8096 npm start      # Windows PowerShell:  $env:JELLYFIN_URL="http://YOUR-JELLYFIN:8096"; npm start
```

## Tell Jellyflix where it is

Jellyflix looks for the container **only if it has an address**. Pick one:

1. **Docker web image, recommended.** Put both containers on one Docker network and set, in the web container, `JELLYFLIX_MODULES_URL=http://jellyflix-modules:8097`. nginx then passes `/modules/` on to it: the browser needs no extra address, no CORS and no extra HTTPS. (Set in `web/.env`; see `web/.env.example`.)
2. **Web image, direct.** `JELLYFLIX_MODULES_PUBLIC_URL=http://YOUR-IP:8097` (the address your browser can reach).
3. **`npm run serve`.** `JELLYFLIX_MODULES_URL=http://YOUR-IP:8097` (the address your browser can reach).
4. **Just to try it, any web build.** Open Jellyflix once with `?modules=` and the address: `http://YOUR-JELLYFLIX/?modules=http://YOUR-IP:8097`. It is remembered on that device. `?modules=off` forgets it.

Sign in, and a **Modules** button appears at the end of the top menu. Remove the address (or stop the container) and it is gone again.

An example with the three containers together:

```yaml
services:
  jellyflix-web:
    image: ghcr.io/sebastianvelezg/jellyflix-web:latest
    ports: ["8080:80"]
    environment:
      JELLYFIN_URL: "http://YOUR-JELLYFIN-IP:8096"
      JELLYFLIX_MODULES_URL: "http://jellyflix-modules:8097"
  jellyflix-modules:
    image: ghcr.io/sebastianvelezg/jellyflix-modules:latest
    # (from a clone of the repository you can build it instead:  build: ./modules)
    environment:
      JELLYFIN_URL: "http://YOUR-JELLYFIN-IP:8096"
    volumes: ["modules-data:/data"]
volumes:
  modules-data:
```

## Try it (checklist)

1. **Retro TV.** Sign in as a Jellyfin **administrator** → Modules → Retro TV → the *Set up* tab → *Quick channels* → tick a few genres → *Make channels* (there you also edit, turn off and refresh channels). On the *On now* tab press *Watch* on one: it should open the title that is on, at the minute it is at (compare with the time on the card). The controls are one panel at the bottom: start over, previous and next program, *Go live* (it only shows when you are not live), channel down/up (also PageDown/PageUp), the guide of this channel (also `G`; Escape closes it) and *All channels* to leave for the full guide.
2. **Resting cost.** Leave the channels page and close the browser: nothing runs in the container (`docker stats` stays flat) apart from the answers to requests.
3. **Match.** It starts by asking how to play:
   - **On this device:** one person (or everybody around the screen) swipes here. Choose the genre, decade, length and whether series are included (tap the chips), and swipe. No code, nobody joins.
   - **Each on their phone:** choose what to watch, then *Open the lobby*. This screen shows a **QR code** and who has joined. Each person reads the QR with their phone (it opens Jellyflix, asks to sign in if needed, and joins by itself) and waits. When everybody is in, press *Start swiping* on the screen. Everybody swipes the same cards on their own phone; the screen shows the cards of the round and who has finished. When a round ends, what you all liked comes back for another round, until one is left; the screen then has *Play here* (the phones say the screen will play it, or can send it with *Play on…*) and a summary of how much you agreed and what each chose. The person who started it can also swipe on the screen (*I want to swipe on this device too*) or start the swiping from their own phone.
4. **Without the container.** Stop it (or open Jellyflix without the address): the Modules button disappears and nothing else changes.

Not checked yet on a real server: playing with the channel buttons (the tests ran against the mock server), that leaving a channel mid-title does not leave it in *Continue watching* (the container puts the previous position back; it was not seen against Jellyfin itself), the Docker images, and the TV app (its Modules screens compile and have unit tests, but have not been tried on a screen).

## Security and privacy

- **Who can do what.** Every route except `GET /v1/health` needs the person's own Jellyfin token; the container asks Jellyfin who it belongs to (`/Users/Me`, remembered for one minute under a hash; a refused token is remembered for ten seconds so made-up tokens do not become a flood of requests to Jellyfin). Making and changing channels is for administrators only. The token is never written to disk or to the log, and a value that does not look like a Jellyfin token is never passed on.
- **What is stored.** `/data/modules.db` holds the channels (their rules, the lists of titles and the schedule) and the Match rooms (votes, for at most 7 days). No passwords, no tokens.
- **Channels are for the whole server, but a guide is read by each person.** A channel is made by an administrator from what *that* administrator can see, and everybody who can sign in sees its guide. For each person the container asks Jellyfin, with that person's own token, which of the titles on show their account may see (a library hidden from them, an age limit). A title they may not see is a generic *Program not available* slot: the times stay (so the shape of the schedule does), but no name, picture, id or synopsis. What Jellyfin said is remembered for five minutes, so a change of rights shows up within that time; if Jellyfin cannot answer, the titles stay hidden until it can. The definition of a channel (its sources and what they are called) is only given to administrators.
- **Match only deals what everybody may see.** With the API key the container asks what each person in the room (and the host, whose screen shows the cards and plays the winner) may see, and never deals a title hidden from any of them; if Jellyfin cannot say it asks to try again instead of dealing. The ids go to Jellyfin in batches of 50. Without the key a Match on phones is not allowed (a Match on one device only shows the host's own library). When nobody agrees and no films are left, the people choose a favourite among the last cards instead of getting stuck.
- **Match rooms** are only readable by their members and host; a code opens a room only while it is in the lobby (nobody can join a Match that already started), and a person who tries too many wrong codes in a minute has to wait.
- **The optional API key** (`JELLYFIN_API_KEY`) lets the container refresh channels by night, and look at what the other people of a Match on phones may see and have watched (a Match on phones needs it). Give it a key made for this (Dashboard > API keys) and keep the container off the internet; without it the rest still works.
- **Exposure.** Keep it on your network, or behind the web image's `/modules/` proxy (one address, HTTPS from your own reverse proxy). It asks for tokens, not cookies, so by default any site may call it from a browser; `JELLYFLIX_ORIGINS` narrows that. A caller that sends more than 20 tokens Jellyfin refuses in a minute waits a minute (HTTP 429) before the container asks Jellyfin about another one; people already signed in are not affected. Callers are told apart by their address: behind the web image's proxy every request comes from that proxy, so set `JELLYFLIX_TRUST_PROXY=1` there (the proxy writes `X-Forwarded-For` itself) and do not publish the container's port, or anybody could write that header. Jellyfin's answer about a token is remembered for a minute, so a session revoked in Jellyfin, or an administrator who stops being one, keeps working here for up to a minute. The Docker image runs as a normal user, with a read-only disk and no extra privileges.

## API

All routes need `Authorization: MediaBrowser Token="<jellyfin token>"`, except `GET /v1/health`.

| Route | Who | |
|---|---|---|
| `GET /v1/manifest` | any user | modules that are on, who you are |
| `GET /v1/channels`, `GET /v1/channels/:id/window`, `GET /v1/guide` | any user | what is on (without the titles that person may not see) |
| `GET /v1/channels/:id/image` | any user | the picture of a channel (PNG, JPEG or WebP; the address carries `?v=<imageVersion>` so it can be kept) |
| `POST /v1/channels/:id/favorite` `{ favorite }` | any user | keep a channel first for the person asking; `GET /v1/channels` and `/v1/guide` list their favourites first and say `favorite` |
| `GET /v1/channels/:id` | administrator | the definition of a channel |
| `PUT /v1/channels/:id/image` `{ data: base64 }`, `DELETE /v1/channels/:id/image` | administrator | set or take away the picture (up to 150 kB and 1024 px, checked by what is inside it; never SVG) |
| `POST/PUT/DELETE /v1/channels…`, `POST /v1/channels/preview`, `/auto`, `/:id/rebuild`, `/:id/refresh`, `GET /v1/channels/suggestions` | administrator | manage channels |
| `GET /v1/seerr/me`, `GET /v1/seerr/search`, `GET /v1/seerr/title/:type/:id`, `GET/POST /v1/seerr/requests` | any user (acting as their Seerr user) | Seerr (only when turned on) |
| `GET/POST /v1/match/rooms`, `POST /v1/match/join`, `POST /v1/match/rooms/:id/{swipe,pick,again}`, `GET/DELETE /v1/match/rooms/:id` | any user | Match |

The types are in [`contract/index.ts`](contract/index.ts); the web app keeps a copy (`npm run contract:sync`, checked in CI).

## Development

```bash
npm install
npm test          # unit and API tests (Node's own test runner)
npm run typecheck
npm run dev       # restarts on changes
```

`contract/examples/` holds example answers of the container (channels, a channel's window, Match rooms). The tests compare what the container answers with them by shape, and the TV app's tests read the same files with its own parsers, so an answer that changes must be followed on the TV. After changing an answer on purpose: `UPDATE_EXAMPLES=1 npm test`, then commit the files. The container's version is the one in `package.json`.

The schedule maker is a pure function (`server/src/modules/channels/engine.ts`) and the Match rules are another (`server/src/modules/match/machine.ts`); both are tested without a database or a network.
