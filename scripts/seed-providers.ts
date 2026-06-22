import { db } from "../server/db";
import { integrationProviders } from "../shared/integrations-schema";
import { eq } from "drizzle-orm";

const PROVIDERS = [
  {
    key: "tradovate",
    name: "Tradovate",
    category: "trading_platform",
    supportsOauth: true,
    supportsApiKey: true,
    supportsWebsocket: true,
    readOnlyOnly: true,
    active: true,
  },
  {
    key: "topstepx",
    name: "TopstepX",
    category: "trading_platform",
    supportsOauth: false,
    supportsApiKey: true,
    supportsWebsocket: false,
    readOnlyOnly: true,
    active: true,
  },
];

async function seedProviders() {
  for (const p of PROVIDERS) {
    const [existing] = await db
      .select()
      .from(integrationProviders)
      .where(eq(integrationProviders.key, p.key));

    if (existing) {
      await db
        .update(integrationProviders)
        .set({
          name: p.name,
          category: p.category,
          supportsOauth: p.supportsOauth,
          supportsApiKey: p.supportsApiKey,
          supportsWebsocket: p.supportsWebsocket,
          readOnlyOnly: p.readOnlyOnly,
          active: p.active,
        })
        .where(eq(integrationProviders.id, existing.id));
      console.log(`Updated provider: ${p.key} (id=${existing.id})`);
    } else {
      const [created] = await db
        .insert(integrationProviders)
        .values(p)
        .returning();
      console.log(`Created provider: ${p.key} (id=${created.id})`);
    }
  }

  process.exit(0);
}

seedProviders().catch((err) => {
  console.error("Failed to seed providers:", err);
  process.exit(1);
});
