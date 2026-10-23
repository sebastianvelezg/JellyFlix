# Third-party software

Jellyflix is MIT licensed (see [LICENSE](LICENSE)). It is built on the open-source libraries below, each under its own license. The exact versions are
pinned in `web/package-lock.json` and in `tv/gradle/libs.versions.toml`; the full license texts ship with each library.

This list names the main direct dependencies. It is a courtesy summary, not a legal opinion: check the license of any library before you redistribute a build.

## Web (`web/`)

| Library | License |
|---|---|
| [React](https://react.dev) and React DOM | MIT |
| [@jellyfin/sdk](https://github.com/jellyfin/jellyfin-sdk-typescript) (Jellyfin API client) | MPL-2.0 |
| [axios](https://github.com/axios/axios) | MIT |
| [hls.js](https://github.com/video-dev/hls.js) | Apache-2.0 |
| [Inter](https://rsms.me/inter/) font, through `@fontsource-variable/inter` | SIL Open Font License 1.1 |
| [Tailwind CSS](https://tailwindcss.com) (build time) | MIT |
| [Vite](https://vite.dev), [Vitest](https://vitest.dev), [Testing Library](https://testing-library.com), ESLint, TypeScript (development only) | MIT / Apache-2.0 |
| [Playwright](https://playwright.dev) and [axe-core](https://github.com/dequelabs/axe-core) (development only) | Apache-2.0 / MPL-2.0 |

The Docker image serves the build with [nginx](https://nginx.org) (BSD-2-Clause).

## TV (`tv/`)

| Library | License |
|---|---|
| AndroidX (Core, Activity, Lifecycle, TV Provider), Jetpack Compose and TV Material | Apache-2.0 |
| [Media3](https://github.com/androidx/media) (ExoPlayer, HLS, UI) | Apache-2.0 |
| [Coil](https://github.com/coil-kt/coil) | Apache-2.0 |
| [Jellyfin Kotlin SDK](https://github.com/jellyfin/jellyfin-sdk-kotlin) | MPL-2.0 |
| [OkHttp](https://square.github.io/okhttp/) (through Coil and the Jellyfin SDK) | Apache-2.0 |
| [kotlinx.coroutines](https://github.com/Kotlin/kotlinx.coroutines) | Apache-2.0 |
| [SLF4J](https://www.slf4j.org) | MIT |
| [logback-android](https://github.com/tony19/logback-android) | EPL-1.0 or LGPL-2.1 (dual) |

## Artwork

The logo and wordmark in `branding/` identify the Jellyflix project and are not covered by the MIT license; see [branding/README.md](branding/README.md).

## Jellyfin

Jellyflix is an independent client for the [Jellyfin](https://jellyfin.org) media server and is not affiliated with the Jellyfin project.
