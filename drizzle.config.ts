import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: ["./shared/schema.ts", "./shared/integrations-schema.ts", "./shared/billing-schema.ts", "./shared/copy-trading-schema.ts", "./shared/journal-schema.ts"],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Do NOT let `push` touch the postgres-migrations tracking table used by the
  // @acpr/rate-limit-postgresql store (public.migrations). It is not part of the
  // Drizzle schema, so `push --force` would drop it on every boot, desyncing it from
  // the persistent rate_limit.* objects and forcing a failing re-init. See
  // scripts/migrate-ratelimit.cjs.
  tablesFilter: ["!migrations"],
});
