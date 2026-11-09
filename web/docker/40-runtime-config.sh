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

# The security headers nginx sends (docker/security-headers.conf, kept in the image as security-headers.default.conf). nginx reads them
# from /tmp, through a link the image has at /etc/nginx/snippets/security-headers.conf, so they can be adjusted here at each start.
cp /etc/nginx/snippets/security-headers.default.conf /tmp/jellyflix/security-headers.conf

# Optional: JELLYFLIX_STRICT_CSP=1 lets the page reach only this site, the server in JELLYFIN_URL and the modules container (the open
# policy lets it reach any address, because the server can be anywhere). Then, even if a fault in the app ever let a script run, the
# session could not be sent anywhere else. With it, signing in to a server other than JELLYFIN_URL does not work, and the previews of
# pictures from the internet in Administration (Identify, Pictures) do not show.
case "${JELLYFLIX_STRICT_CSP:-}" in
  1|true|yes)
    # Only scheme, host and port: "http://192.168.1.10:8096/jellyfin" gives "http://192.168.1.10:8096".
    origin=$(printf '%s' "$url" | sed -E 's|^(https?://[^/?#]+).*$|\1|')
    if printf '%s' "$origin" | grep -Eq '^https?://[][A-Za-z0-9.:-]+$'; then
      # The server's socket (remote control, SyncPlay) is the same address with ws:// or wss://.
      sources="'self' $origin $(printf '%s' "$origin" | sed -E 's|^http|ws|')"
      # The modules container at an address of its own (behind the /modules/ proxy it is this same site).
      if [ -z "$modules_target" ] && [ -n "$modules_config" ]; then
        modules_origin=$(printf '%s' "$modules_public" | sed -E 's|^(https?://[^/?#]+).*$|\1|')
        if printf '%s' "$modules_origin" | grep -Eq '^https?://[][A-Za-z0-9.:-]+$'; then sources="$sources $modules_origin"; fi
      fi
      sed -i -E "s#(img-src|media-src|connect-src) \* data: blob:#\1 $sources data: blob:#g" /tmp/jellyflix/security-headers.conf
      echo "jellyflix-web: strict policy: the page only reaches $sources"
    else
      echo "jellyflix-web: JELLYFLIX_STRICT_CSP needs JELLYFIN_URL (an http:// or https:// address); keeping the open policy." >&2
    fi
    ;;
esac

cat > /tmp/jellyflix/config.js <<CONFIG
window.JELLYFLIX_CONFIG = { serverUrl: "$url"$modules_config };
CONFIG
echo "jellyflix-web: sign-in starts with server '${url:-(empty)}'"
if [ -n "$modules_config" ]; then echo "jellyflix-web: the modules container is switched on"; fi
