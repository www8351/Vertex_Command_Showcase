#!/bin/sh
set -e

echo "[entrypoint] Waiting for PostgreSQL..."

DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${POSTGRES_USER:-vertex}"

MAX_RETRIES=30
RETRY=0

while [ "$RETRY" -lt "$MAX_RETRIES" ]; do
  if pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -q 2>/dev/null; then
    echo "[entrypoint] PostgreSQL is ready"
    break
  fi
  RETRY=$((RETRY + 1))
  echo "[entrypoint] PostgreSQL not ready (attempt $RETRY/$MAX_RETRIES)..."
  sleep 2
done

if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
  echo "[entrypoint] ERROR: PostgreSQL did not become ready in time"
  exit 1
fi

echo "[entrypoint] Running database migrations..."
npx drizzle-kit push --force 2>&1 || {
  echo "[entrypoint] WARNING: Migration push encountered issues, continuing..."
}

# Apply the rate-limit store migrations ONCE, before the app constructs its 6 stores
# (whose constructors otherwise race on these migrations and crash). See scripts/migrate-ratelimit.cjs.
echo "[entrypoint] Applying rate-limit store migrations..."
node scripts/migrate-ratelimit.cjs || {
  echo "[entrypoint] WARNING: rate-limit migration step failed, continuing..."
}

echo "[entrypoint] Starting Vertex Command..."
exec node dist/index.cjs
