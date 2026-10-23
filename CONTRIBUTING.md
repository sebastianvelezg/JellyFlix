# Contributing to Jellyflix

Thanks for wanting to help. Jellyflix is a small project with two apps in one repository; a good bug report, a translation or a one-line fix is as welcome as a feature.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** with the template. The most useful reports say which app, your Jellyfin version, the device or browser, and what the *Info* panel / network tab shows.
  Reports from real TVs are especially useful: HDR, 4K and frame-rate behaviour differ a lot between models.
- **Try it on your server.** Different libraries, codecs and plugin setups find different bugs.
- **Translate it.** See [Adding a language](#adding-a-language).
- **Pick an idea** from "What could come next" in the [README](README.md#%EF%B8%8F-what-could-come-next) or open an issue to talk about yours first.
  For anything bigger than a small fix, please open an issue before writing the code, so you do not build something that cannot be merged.

## Rules of the project

A change that breaks one of these will not be merged, however good it is:

1. **The apps talk only to the user's own Jellyfin server.** No analytics, crash reporting, ads or other network calls. A third-party service (for example a subtitle
   search) is acceptable only as an opt-in the user switches on, and it must say what is sent.
2. **No credentials, tokens, server addresses or personal data in the repository**, including tests, fixtures and docs. Use the mock server and obvious placeholders such as
   `jellyfin.local`.
3. **No backend of our own.** The web app stays static; the TV app stays a single APK.
4. **The apps never transcode.** They tell Jellyfin what the device can play and use what it answers.
5. **Both apps stay equivalent.** If you change a rule (how the home banner is chosen, how a stream is requested) check the other app and change both, or say in the pull
   request why not.
6. **English and Spanish together.** Every user-visible text exists in both languages.

## Setting up

### Web (`web/`)

You need Node.js 22.18 or newer.

```bash
cd web
npm install
npm run dev            # http://localhost:5173
npm run mock           # a fake Jellyfin server on a random port (prints its address; user tester, password secret)
```

Before you send a change:

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

Browser tests (`npm run e2e`) use Playwright with Google Chrome and synthetic media made with `ffmpeg` (`npm run media`); they are not required for a pull request but
please run the ones near your change if you can. Where things live is explained in [Architecture](web/README.md#architecture) in the web README; the short version is
`src/core` (Jellyfin logic, no UI and no browser APIs, enforced by lint) ← `src/platform/web` (browser glue) ← `src/components` (React).

### TV (`tv/`)

You need Java 17 or newer (Android Studio's bundled JDK works), and the Android SDK (Android Studio installs it; Gradle needs `sdk.dir` in `tv/local.properties`,
which Android Studio creates and git ignores).

```bash
cd tv
./gradlew testDebugUnitTest assembleDebug
```

Open the `tv` folder in Android Studio and run it on a *Google TV* emulator (Device Manager, TV, "Television 1080p"). In the emulator the server address is the
one your computer uses, not `localhost` (the host machine is `10.0.2.2`). The pure logic (`data/` package: stream info, settings, line-ups, lyrics, plugins) has JVM
unit tests; please add one when you change it. Screens are checked by hand, so say in your pull request what you tried and on which device.

## Where things are documented

Each app's README has its features, how to host or install it, its architecture and its development commands ([web](web/README.md), [TV](tv/README.md)); the project files
(this one, the Code of Conduct, Security, Changelog, Third-party notices, License) are at the top of the repository. If you change behavior, update the README that describes it, and add a line to the [Changelog](CHANGELOG.md), in the same pull request.

## Code style

- Match the surrounding code: naming, comment density, formatting. Comments explain *why*, in plain English, and are short.
- TypeScript is strict; no `any`. Kotlin follows the official code style (`kotlin.code.style=official`).
- Keep changes focused. A bug fix does not need a refactor next to it.
- Add or update tests with the behaviour. For the web app the mock server in `web/test/mock/mockJellyfin.ts` is the model of Jellyfin; extend it rather than faking at the call site.
- Do not add a dependency lightly. Say what it costs (size, licence, maintenance) in the pull request.

## Adding a language

- **Web:** the English text is the key. Add a file next to `web/src/i18n/es.ts` with the same shape, register it in `web/src/i18n/index.ts` (`LANGUAGES`, `dictionaries`), and
  run the tests: one checks that every text used in the code has an entry.
- **TV:** copy `tv/app/src/main/res/values/strings.xml` to `values-xx/strings.xml` (`xx` is the language code), translate the values, and add the code to `localeFilters` in
  `tv/app/build.gradle.kts`.

## Commits and pull requests

- Small, focused commits with a message that says what changed and why (`Fix resume position for episodes that were partly watched`).
- Fill in the pull request template. Say what you tested, on what, and anything you could not test.
- CI must pass (type check, lint, unit tests and a build for the web app; unit tests and a debug build for the TV app).
- Be patient and kind in reviews, in both directions.

## Licence

By contributing you agree that your contribution is licensed under the project's [MIT License](LICENSE).
