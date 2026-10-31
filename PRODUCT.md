# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The self-hoster who runs their own Jellyfin server (NAS, Unraid, Docker, Raspberry Pi) and the household that uses it. Most use is browsing and watching from the sofa on a TV with a remote, and from a phone or laptop elsewhere in the house. The self-hoster is also the administrator, doing everyday upkeep from the web app. Everyone else signs in as a normal Jellyfin user, without an API key or admin rights.

## Product Purpose

Jellyflix is an independent, open-source client for Jellyfin. It makes the front door to a personal library feel like a streaming service, and stays out of the way once something is playing. It ships as two apps: Jellyflix Web (React + TypeScript + Vite, installable as a PWA, hosted by the user) and Jellyflix TV (native Kotlin + Compose for TV, sideloaded APK for Google TV / Android TV). Success is a household that opens it instead of the stock client, finds something to watch quickly, and never has to think about the server.

## Positioning

A streaming-service experience (mixed banner, Discover, rows that follow what you watch, a random pick when you cannot decide) delivered as a pure client with no backend of its own. Web and TV are kept feature-equivalent and share one look and the same rules, and server administrators get management tools built into the web app. Neighbouring Jellyfin clients (stock web, stock Android TV, Streamyfin, the other "Jellyflix") do not combine these.

## Operating Context

- The user's own Jellyfin server (developed against 12.x, expected to work on 10.10+). The server does all transcoding; the apps declare device capability and use what it answers.
- The user supplies the server address as the device reaches it (never `localhost`). The web app is hosted by the user (Docker image for amd64/arm64, compose, plain Node, or any static server); the TV app is sideloaded (adb over Wi-Fi, USB stick, Downloader).
- Sign-in is by password or Quick Connect (a code approved from another device, so no password on a TV remote). Only a revocable session token is stored.
- TV use is D-pad and remote driven, seen from a distance, on screens that may crop the picture. Web use is mouse, touch and keyboard, including phones.
- Jellyfin plugins are optional enhancements: Intro Skipper, Lyrics (LrcLib), Open Subtitles, TMDb Box Sets, Fanart, AniList, Playback Reporting. Everything must work, and say so plainly, when a plugin is absent.
- Libraries covered: Movies, Series, Anime, Music videos, Music (with lyrics, mixes, queue), Collections, Books and audiobooks, Live TV, playlists and Watch later. Administration and the title editor are web only; reading books (EPUB, PDF, CBZ) is web only.

## Capabilities and Constraints

- Hard rules of the project (a contribution that breaks one is not merged): talks only to the user's Jellyfin server; no analytics, telemetry, crash reporting, ads or unrequested third-party calls; no credentials or server addresses in source; no backend of ours; the apps never transcode; both apps stay equivalent where the platform allows; every user-facing text exists in English and Spanish (a test enforces it).
- Core Jellyfin API logic is kept independent of UI and platform (`web/src/core`, no DOM or React); the two apps share no code, only design, rules and API behaviour.
- Administration is safe by construction: nothing changes without a review, destructive actions need a typed name, anything that would lock the admin out is refused, API keys show only their last four characters, and the server stays the authority. Restart/shutdown, plugin install and account deletion are deliberately left out.
- Appearance is user-owned and applies to both apps: backgrounds, accent colours (text on the accent is derived to stay readable), poster size, the top menu (icons and/or names, order, hide) and the Home rows (show/hide/reorder), with an optional backup to the user's own server.
- Real-server facts to preserve: some libraries contain untagged or misnamed items, so titles are cleaned client-side; some WebP images return empty bodies and need fallback; TV must send the `Authorization: MediaBrowser Token=...` header on every request.
- Not available: Play Store / App Store distribution, Plex/Emby/Kodi support, Fire TV (idea only), SyncPlay and live-TV recording (ideas only), a public demo. The TV app has not been tested on a physical TV; it is verified on an emulator.
- Undecided: which of the "what could come next" ideas in the README ships first.

## Brand Commitments

- Name: **Jellyflix**. The name, logo and wordmark (in `branding/`, made from the owner's PNGs, art made with AI) identify this project only and are not covered by the MIT license; forks must use their own.
- It is independent and **not affiliated with, endorsed by or sponsored by the Jellyfin project**, and says so. An unrelated Jellyfin client also called "Jellyflix" exists; the owner chose the name knowingly.
- Voice in the READMEs is plain, friendly and direct, written for people who run their own media server, with no marketing hype.

## Evidence on Hand

- Real screenshots of both apps against the author's own library in `docs/screenshots/` (web and TV). Some earlier mock-server shots show black placeholder posters and are not real-library evidence.
- Published releases (web zip, multi-arch Docker image, signed TV APK) on GitHub, CI and release workflows green, MIT license, CHANGELOG, SECURITY and CONTRIBUTING docs.
- Automated checks: unit tests (Vitest, JVM), Playwright e2e, axe accessibility spec, i18n completeness test, a mock Jellyfin server (`npm run mock`).
- Not on hand and must not be invented: user counts, testimonials, benchmarks, physical-TV compatibility results, store ratings.

## Product Principles

1. **The server is the authority, the client is the front door.** Do the minimum on the client; trust Jellyfin for transcoding, permissions and data, and never change the server without a review.
2. **Private by construction.** No accounts, no telemetry, no third-party calls unless the user turns on something that needs one.
3. **One product on two screens.** Web and TV share sections, rules and look; a feature that exists on one should exist on the other unless the platform makes it senseless, and the gap is stated.
4. **Degrade honestly.** Missing plugins, absent segments, empty libraries and flaky servers produce clear, translated states, never broken or invented content.
5. **The user's library, the user's look.** Presentation (backgrounds, accents, rows, menu) belongs to the viewer; content and playback come first.

## Accessibility & Inclusion

- Target WCAG 2.1 A and AA, checked automatically (axe in Playwright); accent and background combinations are tested for contrast.
- Bilingual UI (English and Spanish) with switching in Settings; any new text must be translatable.
- Touch targets are enlarged on coarse pointers; TV is fully operable with a D-pad and a screen margin and text size setting for TVs that crop the picture.
