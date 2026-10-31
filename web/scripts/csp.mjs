// The Content-Security-Policy the app is served with (nginx in the Docker image, `npm run serve`, and `vite preview` for the tests).
//
// The app runs only its own scripts: nothing inline, nothing from another site. The Jellyfin server can be anywhere, so pictures, media
// and requests may go to any address (the app still only ever talks to the server you signed in to). `docker/nginx.conf` repeats the
// same text; src/test/csp.test.ts fails when the two drift apart.
export const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval': the PDF reader's decoders are WebAssembly. No 'unsafe-inline' and no 'unsafe-eval' for scripts.
  "script-src 'self' 'wasm-unsafe-eval'",
  // React sets style attributes on elements, which needs 'unsafe-inline' for styles (never for scripts).
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  'media-src * data: blob:',
  'connect-src * data: blob:',
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  // The PDF viewer of the browser is shown in a frame from a blob; a book chapter is a srcdoc frame with its own policy.
  "frame-src 'self' blob:",
  'object-src blob:',
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ')
