# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting: on the repository open the **Security** tab and choose
**Report a vulnerability**. Include what you found, how to reproduce it and which app (web or TV) and version are affected.

You can expect an answer within about a week. This is a volunteer project, so there is no bounty, but a fix and a thank-you in the release notes are certain.

## What is in scope

- Anything that could leak a user's session token, password or server address (logs, URLs, storage, the service worker, the Docker image).
- Cross-site scripting or injection in the web app, including through titles, subtitles, books (EPUB, PDF, comic archives) or other data a Jellyfin server returns.
- The book reader: a book is untrusted data. EPUB chapters are shown in a frame without scripts and with a policy that blocks the network, and a file that unpacks to something absurdly big is refused; pdf.js runs without `eval` and in a worker made from the app's own files.
- The web app or TV app contacting anything other than the user's own Jellyfin server.
- Problems in the Docker image or `npm run serve` (path traversal, wrong headers).

## How the apps handle secrets

- The password is sent to the user's server while signing in and is never stored. Only a revocable session token is kept: in `sessionStorage` by default, in
  `localStorage` if the user ticks "Keep me signed in", and in the app's private storage on the TV.
- Tokens are sent in the `Authorization` header. The only places a token is put in a URL are a media request that cannot carry headers (a `<video src>`) and the address of the
  server's WebSocket (a browser cannot add headers to a socket), which is how Jellyfin's own web client works.
- The web app is served with a strict Content-Security-Policy (only its own scripts run: no inline script, no `eval`, nothing from another site), and signing out also forgets
  the recent searches and the last Live TV channel kept in the browser.
- On the TV the session is excluded from Android's cloud backup and from device-to-device transfer.
- There is no telemetry and no server of ours to receive anything.

## Hosting advice

The web app is static files and adds no accounts of its own. If you expose it, or your Jellyfin server, to the internet, use HTTPS, keep Jellyfin updated and use strong
passwords. See the [hosting guide](web/README.md#host-it-for-your-devices).

## Supported versions

Only the latest release receives fixes.
