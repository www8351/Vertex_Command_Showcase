#!/usr/bin/env node
"use strict";
/**
 * Apply the @acpr/rate-limit-postgresql migrations ONCE, serially, before the app boots.
 *
 * Why this exists:
 *   PostgresStore's constructor (node_modules/@acpr/rate-limit-postgresql) calls
 *   applyMigrations() fire-and-forget (it is async but NOT awaited). server/index.ts builds
 *   SIX rate-limit stores at module load, so six concurrent migration runs hit the same DB.
 *   postgres-migrations' check-then-apply is not atomic across those six clients, so one run
 *   tries to create an object another already created — e.g. `relation "unique_session_key"
 *   already exists` — and because the constructor never awaits/catches, the rejection is
 *   unhandled and crashes the Node process. A fresh DB sometimes wins the race; a restart over
 *   an existing DB loses reliably, so the container crash-loops.
 *
 *   Applying the migrations once up front (serially) means those six constructor runs find
 *   nothing pending and become harmless no-ops. Idempotent — safe to run on every boot.
 *
 * Wired into: Dockerfile entrypoint.sh, and npm "predev"/"prestart".
 */
const path = require("path");

// Standalone runs (npm predev/prestart) start before the app loads .env, so load it here too.
// In the container DATABASE_URL is already in the process env (compose env_file) — this is a no-op.
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env on disk — fall back to the real process environment */
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log(
      "[ratelimit-migrate] DATABASE_URL not set — skipping (app will fall back to its own store migrations)"
    );
    return;
  }

  const { migrate } = require("postgres-migrations");
  const { Client } = require("pg");
  // Resolve the library's bundled SQL migrations via its main entry (its package.json
  // "exports" blocks the ./package.json subpath, so resolve the entry and walk to ./migrations).
  const migrationsDir = path.join(
    path.dirname(require.resolve("@acpr/rate-limit-postgresql")),
    "migrations"
  );

  // Use a connected pg.Client — the same config shape the library itself passes to
  // postgres-migrations (migrate({ client }, dir)); { databaseUrl } is rejected by v5.
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await migrate({ client }, migrationsDir);
  } finally {
    await client.end();
  }
  console.log("[ratelimit-migrate] rate-limit store migrations applied");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[ratelimit-migrate] FAILED:", (err && err.message) || err);
    process.exit(1);
  }
);
