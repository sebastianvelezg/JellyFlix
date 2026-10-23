/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_SERVER_URL?: string
}

interface Window {
  /** Set by `config.js`, which whoever hosts the app writes at start (Docker image, `npm run serve`); absent when it is not served. */
  JELLYFLIX_CONFIG?: { serverUrl?: string }
}
