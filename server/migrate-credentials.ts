import { db } from "./db";
import { integrationConnections } from "@shared/integrations-schema";
import { encrypt, isEncrypted } from "./encryption";
import { eq } from "drizzle-orm";

export async function migrateCredentials(): Promise<void> {
  console.log("[Migration] Starting credentials encryption migration...");

  const connections = await db.select().from(integrationConnections);
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const conn of connections) {
    try {
      let needsUpdate = false;
      const updates: Record<string, string> = {};

      if (conn.encryptedCredentials && !isEncrypted(conn.encryptedCredentials)) {
        JSON.parse(conn.encryptedCredentials);
        updates.encryptedCredentials = encrypt(conn.encryptedCredentials);
        needsUpdate = true;
      }

      if (conn.encryptedRefreshToken && !isEncrypted(conn.encryptedRefreshToken)) {
        updates.encryptedRefreshToken = encrypt(conn.encryptedRefreshToken);
        needsUpdate = true;
      }

      if (needsUpdate) {
        await db.update(integrationConnections)
          .set(updates)
          .where(eq(integrationConnections.id, conn.id));
        migrated++;
      } else {
        skipped++;
      }
    } catch (err: any) {
      console.error(`[Migration] Error migrating connection #${conn.id}:`, err.message);
      errors++;
    }
  }

  console.log(`[Migration] Credentials migration complete: ${migrated} migrated, ${skipped} already encrypted/empty, ${errors} errors`);
}
