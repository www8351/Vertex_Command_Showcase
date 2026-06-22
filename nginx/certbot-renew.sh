#!/bin/sh
set -e

DOMAIN="${VERTEX_DOMAIN:?Set VERTEX_DOMAIN environment variable}"
EMAIL="${CERTBOT_EMAIL:?Set CERTBOT_EMAIL environment variable}"

echo "[certbot] Requesting certificate for $DOMAIN..."

certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --cert-name vertex \
  -d "$DOMAIN"

echo "[certbot] Certificate obtained for $DOMAIN"
echo "[certbot] Nginx will auto-reload within 6 hours (reload-watcher), or restart ingress manually:"
echo "  docker compose restart ingress"
