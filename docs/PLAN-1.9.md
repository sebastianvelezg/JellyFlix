# Plan for 1.9 – 2.0 (from section 9 of the audit)

Thirteen items, in three phases. Each phase ends in a release candidate that passes CI on its own, so any of them can ship alone.
Order inside a phase is by dependency, then by value.

## Phase 1 – Quick wins (1.9.0)

**Status: written and tested (unit tests, browser tests of the web app); not tried on a real TV or server.**

Low effort, mostly reuse of what the web or the TV already has.

| # | Item | App | Notes |
|---|---|---|---|
| 1 | Language parity on the TV (pt, fr, de) | TV | Add `values-pt`, `values-fr`, `values-de`; reuse the web strings where the text is the same; extend the TV string-parity test so a missing key fails CI. |
| 2 | "Continue watching" updates at once across devices | Web, TV | The web already has the server socket (`remoteSocket.ts`): refresh the row on `UserDataChanged`. The TV gets the same with a short poll fallback. |
| 3 | Trailers on the TV | TV | The web has them (`core/trailers.ts`). Button on the details screen; local trailers play in Media3, external ones are skipped (no WebView on the TV). |
| 4 | Technical details before playing ("plays as is" / "converted because the audio is DTS") | Web | The TV already computes the reason; port the same rule set to `core` and show it on the details page. |
| 5 | Last channel when Retro TV opens | Web, TV | Remember the last channel per account; open it directly. Favorites first when there is none. |

## Phase 2 – Modules and profiles (1.10.0)

**Status: written and unit-tested; not tried on a real TV. Couch mode seats are numbered ("Player 1…"), see Open questions.**

Touches the modules container and its contract, so it goes together (contract bump per module, see `MODULE_VERSIONS`).

| # | Item | App | Notes |
|---|---|---|---|
| 6 | Match: no agreement, with the finalists kept | Container, Web, TV | A room that ends with no match keeps its top three and says so, instead of a dead end (audit M1). Contract change in `match`. |
| 7 | Match: couch mode on the TV | TV, Container | One remote, turns by person, no phones. Uses the same room, with members that are local "seats". Needs a design decision on how a seat is stored (see Open questions). |
| 8 | Retro TV: time slots editor | Web | The engine already understands blocks by day and hour; build the editor in the channel form ("cartoons in the morning, films at night"). |
| 9 | Profiles on the web | Web | Same model as the TV (several accounts, optional PIN, "Who is watching?"). Reuse `core` account storage; PIN stays a device-side lock, as on the TV. |

## Phase 3 – Reach (2.0.0)

**Status: 10 and 11 are built (unit-tested, not tried on a real TV or network). 12 and 13 are not built: they wait on decisions and on devices to test with, see below.**

- 10 – done: `ServerDiscovery` (TV) and found servers on the sign-in screen.
- 11 – done: the TV can add an account on another server; the web app already kept the server with each account.
- 12 – not built. The TV asks the server for subtitles as WebVTT (`PlayerScreen.kt`), so the style of an `.ass` file is already lost on the server. Two ways: ask for the original `.ass` and let Media3's own SSA reader show colours, position and bold/italic (no new dependency, but it cannot be checked without a TV and a styled file), or add a native libass renderer (full fidelity, but APK size and a native dependency: the budget in O8 decides).
- 13 – not built. Chromecast needs Google's Cast sender script (the web app loads nothing from outside your server today, and its security policy forbids it) and a receiver id. AirPlay is a single call in Safari, but it cannot be tried without Safari and an AirPlay device.

Bigger, more platform-dependent. Each one is independent of the others.

| # | Item | App | Notes |
|---|---|---|---|
| 10 | Server discovery on the network | TV | Jellyfin answers a UDP broadcast on port 7359; show found servers on the sign-in screen. Needs the multicast lock permission. |
| 11 | Several saved servers | Web, TV | Accounts become `(server, user)` pairs; the switcher shows the server. Migration of saved accounts must be lossless. |
| 12 | `.ass` subtitles with style | TV (web later) | Media3 libass-based renderer. Adds APK size and a native dependency: measure against the size budget first (O8). |
| 13 | Cast to Chromecast (web) and AirPlay | Web | Chromecast via the Cast sender SDK; AirPlay only where the browser exposes it (Safari). Needs an HTTPS origin and a receiver app id. Native mobile casting stays with the future mobile app. |

## Open questions

- Couch mode (7): built with numbered seats ("Player 1", "Player 2"…). The container already takes any names (`players` in the create request), so naming them is only a TV screen to add.
- Cast (13): is a registered Cast receiver id acceptable (a Google developer registration), or should it use the default receiver, which cannot show our own UI?
- `.ass` (12): acceptable APK growth ceiling?

## Out of scope here

Seerr on the TV, "Novedades de mis series", downloads and the mobile app: they are in the audit but not in this plan.
