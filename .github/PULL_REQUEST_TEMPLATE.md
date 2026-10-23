## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## App

- [ ] Web
- [ ] TV
- [ ] Docs / tooling only

## How I tested it

<!-- Commands you ran, and for screens, the device or browser you tried. Say what you could NOT test. -->

## Checklist

- [ ] `npm run typecheck && npm run lint && npx vitest run && npm run build` pass (web) / `./gradlew testDebugUnitTest assembleDebug` passes (TV)
- [ ] New behaviour has a test (or I explain why it cannot)
- [ ] User-visible text exists in English and Spanish
- [ ] If this changes a rule shared by both apps, I changed (or checked) the other one
- [ ] No credentials, tokens, server addresses or personal data, and no new calls to anything but the user's own Jellyfin server
