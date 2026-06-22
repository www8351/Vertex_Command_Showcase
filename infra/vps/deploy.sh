#!/usr/bin/env bash
set -euo pipefail

VERTEX_DIR="${VERTEX_DIR:-/opt/vertex-command}"
COMPOSE_PROFILES="${COMPOSE_PROFILES:-ssl}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $(date '+%H:%M:%S') $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $(date '+%H:%M:%S') $*"; }
err()  { echo -e "${RED}[deploy]${NC} $(date '+%H:%M:%S') $*" >&2; }

cd "$VERTEX_DIR"

if [ ! -f ".env" ]; then
  err ".env file not found at $VERTEX_DIR/.env"
  exit 1
fi

log "=== Vertex Command Deployment ==="
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
log "Deploying commit: $COMMIT"

PREV_APP_IMAGE=$(docker compose images vertex-app --format "{{.ID}}" 2>/dev/null | head -1 || echo "")
PREV_ANALYTICS_IMAGE=$(docker compose images analytics --format "{{.ID}}" 2>/dev/null | head -1 || echo "")

log "Step 1/4: Build containers"
docker compose --profile "$COMPOSE_PROFILES" build --parallel 2>&1 | tail -5

log "Step 2/4: Rolling restart (postgres untouched, app services recreated)"

docker compose up -d --no-deps --build analytics
log "Analytics container updated"

docker compose up -d --no-deps --build vertex-app
log "Vertex-app container updated"

log "Waiting for vertex-app health..."
sleep 5
RETRIES=0
MAX_RETRIES=12
while [ $RETRIES -lt $MAX_RETRIES ]; do
  # 127.0.0.1 (not localhost): musl/Alpine resolves localhost->::1 first, but the app listens IPv4-only.
  HTTP_CODE=$(docker compose exec -T vertex-app wget -qS -O /dev/null http://127.0.0.1:5000/api/v1/auth/me 2>&1 | grep -oP 'HTTP/\S+ \K\d+' | head -1 || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "302" ]; then
    log "Vertex-app healthy (HTTP $HTTP_CODE)"
    break
  fi
  RETRIES=$((RETRIES + 1))
  sleep 5
done

if [ $RETRIES -ge $MAX_RETRIES ]; then
  err "Vertex-app health check failed after $MAX_RETRIES attempts"
  err "Attempting rollback to previous images..."
  docker compose logs --tail=30 vertex-app

  if [ -n "$PREV_APP_IMAGE" ]; then
    warn "Rollback: restarting previous vertex-app image"
    docker compose stop vertex-app
    docker compose up -d vertex-app
  fi
  if [ -n "$PREV_ANALYTICS_IMAGE" ]; then
    warn "Rollback: restarting previous analytics image"
    docker compose stop analytics
    docker compose up -d analytics
  fi
  exit 1
fi

docker compose up -d --no-deps ingress
log "Ingress updated"

if echo "$COMPOSE_PROFILES" | grep -q "ssl"; then
  docker compose --profile ssl up -d certbot
  log "Certbot started"
fi

log "Step 3/4: Cleanup old images"
docker image prune -f --filter "until=48h" 2>/dev/null || true
docker builder prune -f --filter "until=48h" 2>/dev/null || true

log "Step 4/4: Verify deployment"
echo ""
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""

HEALTHY=true
for SVC in postgres vertex-app analytics ingress; do
  STATUS=$(docker compose ps --format "{{.Status}}" "$SVC" 2>/dev/null | head -1)
  if echo "$STATUS" | grep -qi "up"; then
    log "✓ $SVC: $STATUS"
  else
    err "✗ $SVC: $STATUS"
    HEALTHY=false
  fi
done

echo ""
if $HEALTHY; then
  log "=== Deployment successful (commit: $COMMIT) ==="
else
  err "=== Deployment completed with warnings ==="
  exit 1
fi
