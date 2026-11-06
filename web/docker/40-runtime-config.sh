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

# The optional modules container. Left empty (the default), nothing about it is written: config.js and nginx are what they always were.
#   JELLYFLIX_MODULES_URL         where THIS container reaches the modules container, e.g. http://jellyflix-modules:8097. nginx then
#                                 passes /modules/ on to it (so the browser needs no other address, no CORS and no extra HTTPS).
#   JELLYFLIX_MODULES_PUBLIC_URL  instead: the address the BROWSER reaches it at, used as it is (no proxy).
modules_target="${JELLYFLIX_MODULES_URL:-}"
modules_public="${JELLYFLIX_MODULES_PUBLIC_URL:-}"
modules_config=""

# Written to /tmp, not next to the app: nginx.conf serves config.js from there, and the app's own files can stay read-only.
mkdir -p /tmp/jellyflix
# nginx.conf always includes this file; it is empty unless the proxy is switched on.
: > /tmp/jellyflix/modules.conf

if [ -n "$modules_target" ]; then
  # Only host and port: no path, quotes or spaces, since the value goes into the nginx configuration.
  if printf '%s' "$modules_target" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]+)?/?$'; then
    modules_target="${modules_target%/}"
    # nginx looks the name up when asked (not at start), so this container starts even when the modules container is not running.
    resolver=$(awk '/^nameserver/ && $2 ~ /^[0-9.]+$/ {print $2; exit}' /etc/resolv.conf 2>/dev/null || true)
    cat > /tmp/jellyflix/modules.conf <<MODULES
location /modules/ {
    resolver ${resolver:-127.0.0.11} valid=10s ipv6=off;
    set \$jellyflix_modules "$modules_target";
    rewrite ^/modules/(.*)\$ /\$1 break;
    proxy_pass \$jellyflix_modules;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_read_timeout 30s;
    client_max_body_size 256k;
    include /etc/nginx/snippets/security-headers.conf;
    add_header Cache-Control "no-store" always;
}
MODULES
    modules_config=', modulesUrl: "/modules"'
  else
    echo "jellyflix-web: JELLYFLIX_MODULES_URL must look like http://host:port; ignoring it." >&2
  fi
elif [ -n "$modules_public" ]; then
  if printf '%s' "$modules_public" | grep -Eq '^https?://[A-Za-z0-9._~:/%@+,-]+$'; then
    modules_config=", modulesUrl: \"$modules_public\""
  else
    echo "jellyflix-web: JELLYFLIX_MODULES_PUBLIC_URL is not an address; ignoring it." >&2
  fi
fi

cat > /tmp/jellyflix/config.js <<CONFIG
window.JELLYFLIX_CONFIG = { serverUrl: "$url"$modules_config };
CONFIG
echo "jellyflix-web: sign-in starts with server '${url:-(empty)}'"
if [ -n "$modules_config" ]; then echo "jellyflix-web: the modules container is switched on"; fi
