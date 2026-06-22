#!/bin/sh

CERT_FILE="/etc/letsencrypt/live/vertex/fullchain.pem"
LAST_HASH=""

while true; do
  sleep 21600

  if [ -f "$CERT_FILE" ]; then
    CURRENT_HASH=$(sha256sum "$CERT_FILE" 2>/dev/null | cut -d' ' -f1)
    if [ -n "$LAST_HASH" ] && [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
      echo "[reload-watcher] Certificate change detected, reloading nginx..."
      nginx -s reload
      echo "[reload-watcher] Nginx reloaded successfully"
    fi
    LAST_HASH="$CURRENT_HASH"
  fi
done
