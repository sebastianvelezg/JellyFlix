# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting: on the repository open the **Security** tab and choose
**Report a vulnerability**. Include what you found, how to reproduce it and which app (web or TV) and version are affected.

You can expect an answer within about a week. This is a volunteer project, so there is no bounty, but a fix and a thank-you in the release notes are certain.

## What is in scope

- Anything that could leak a user's session token, password or server address (logs, URLs, storage, the service worker, the Docker image).
- Cross-site scripting or injection in the web app, including through titles, subtitles or other data a Jellyfin server returns.
- The web app or TV app contacting anything other than the user's own Jellyfin server.
- Problems in the Docker image or `npm run serve` (path traversal, wrong headers).

## How the apps handle secrets

- The password is sent to the user's server while signing in and is never stored. Only a revocable session token is kept: in `sessionStorage` by default, in
  `localStorage` if the user ticks "Keep me signed in", and in the app's private storage on the TV.
- Tokens are sent in the `Authorization` header. The only places a token is put in a URL are a media request that cannot carry headers (a `<video src>`) and the address of the
  server's WebSocket (a browser cannot add headers to a socket), which is how Jellyfin's own web client works.
- There is no telemetry and no server of ours to receive anything.

## Hosting advice

The web app is static files and adds no accounts of its own. If you expose it, or your Jellyfin server, to the internet, use HTTPS, keep Jellyfin updated and use strong
passwords. See the [hosting guide](web/README.md#host-it-for-your-devices).

## Supported versions

Only the latest release receives fixes.
