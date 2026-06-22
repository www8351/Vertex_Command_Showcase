import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_NAME = process.env.ADMIN_NAME ?? "Admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function seedAdmin() {
  if (!ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD env var is required to seed the admin user.");
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const [existing] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL));

  if (existing) {
    await db.update(users).set({
      name: ADMIN_NAME,
      passwordHash,
      role: "admin",
      status: "active",
      emailVerified: true,
      onboardingCompleted: true,
      isDemo: false,
    }).where(eq(users.id, existing.id));
    console.log(`Updated existing admin: ${ADMIN_EMAIL} (id=${existing.id})`);
  } else {
    const [created] = await db.insert(users).values({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      status: "active",
      emailVerified: true,
      onboardingCompleted: true,
      isDemo: false,
    }).returning();
    console.log(`Created admin: ${ADMIN_EMAIL} (id=${created.id})`);
  }

  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error("Failed to seed admin:", err);
  process.exit(1);
});
