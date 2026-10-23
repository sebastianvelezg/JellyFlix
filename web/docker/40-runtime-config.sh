#!/bin/sh
# Runs each time the container starts (the nginx image runs every script in /docker-entrypoint.d). Writes config.js from JELLYFIN_URL,
# so the same image can be pointed at any server without rebuilding it.
set -eu

url="${JELLYFIN_URL:-}"
# Only what could be an address is let through: the value ends up inside a script, so quotes and the like are refused.
case "$url" in
  *[!A-Za-z0-9:/._~%@?=\&#+,-]*)
    echo "jellyflix-web: JELLYFIN_URL has characters that are not allowed in an address; ignoring it." >&2
    url=""
    ;;
esac

# A scheme typed twice ("http://http://host") is reduced to the last one.
url=$(printf '%s' "$url" | sed -E 's#^(https?://)+(https?://)#\2#')

cat > /usr/share/nginx/html/config.js <<CONFIG
window.JELLYFLIX_CONFIG = { serverUrl: "$url" };
CONFIG
echo "jellyflix-web: sign-in starts with server '${url:-(empty)}'"
