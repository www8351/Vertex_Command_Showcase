import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import * as integrationsSchema from "@shared/integrations-schema";
import * as billingSchema from "@shared/billing-schema";
import * as copyTradingSchema from "@shared/copy-trading-schema";
import * as journalSchema from "@shared/journal-schema";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath) && typeof (process as { loadEnvFile?: (p: string) => void }).loadEnvFile === "function") {
  try {
    (process as { loadEnvFile: (p: string) => void }).loadEnvFile(envPath);
  } catch {
    // ignore — .env is best-effort
  }
}

const allSchema = {
  ...schema,
  ...integrationsSchema,
  ...billingSchema,
  ...copyTradingSchema,
  ...journalSchema,
};

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const isMockDb = false;

export const db = drizzle(process.env.DATABASE_URL, { schema: allSchema });
