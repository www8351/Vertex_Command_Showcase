#!/bin/sh
set -e

SSL_DIR="/etc/letsencrypt/live/vertex"

if [ -f "$SSL_DIR/fullchain.pem" ] && [ -f "$SSL_DIR/privkey.pem" ]; then
  echo "[ssl-init] Certificates already exist, skipping generation"
  exit 0
fi

echo "[ssl-init] Generating self-signed bootstrap certificates..."
mkdir -p "$SSL_DIR"

openssl req -x509 -nodes -days 30 \
  -newkey rsa:2048 \
  -keyout "$SSL_DIR/privkey.pem" \
  -out "$SSL_DIR/fullchain.pem" \
  -subj "/CN=vertex-command/O=Vertex/C=US" \
  2>/dev/null

echo "[ssl-init] Bootstrap certificates generated (self-signed, 30-day)"
echo "[ssl-init] To obtain real certificates, run:"
echo "  docker compose --profile ssl run certbot certonly --webroot -w /var/www/certbot --cert-name vertex -d YOUR_DOMAIN --email YOUR_EMAIL --agree-tos"
