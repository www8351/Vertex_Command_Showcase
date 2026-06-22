import { db } from "../server/db";
import { users } from "../shared/schema";
import { plans, subscriptions } from "../shared/billing-schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "ChangeMe123!";

const DEMO_USERS = [
  { name: "Demo Free",      email: "userfree1@demo.vertex",  planKey: "free" },
  { name: "Demo Basic",     email: "userbasic1@demo.vertex",  planKey: "basic" },
  { name: "Demo Pro",       email: "userpro1@demo.vertex",    planKey: "pro" },
  { name: "Demo Unlimited", email: "userun1@demo.vertex",     planKey: "unlimited" },
];

async function seedDemoUsers() {
  console.log("Seeding demo users...\n");

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const allPlans = await db.select().from(plans);
  if (allPlans.length === 0) {
    console.error("No plans found in DB. Make sure plans are seeded first.");
    process.exit(1);
  }

  const planMap = new Map(allPlans.map(p => [p.key, p]));

  for (const demo of DEMO_USERS) {
    const plan = planMap.get(demo.planKey);
    if (!plan) {
      console.error(`Plan "${demo.planKey}" not found. Skipping ${demo.email}`);
      continue;
    }

    const [existing] = await db.select().from(users).where(eq(users.email, demo.email));
    let userId: number;

    if (existing) {
      await db.update(users).set({
        name: demo.name,
        passwordHash,
        role: "user",
        isDemo: true,
        emailVerified: true,
        onboardingCompleted: true,
      }).where(eq(users.id, existing.id));
      userId = existing.id;
      console.log(`Updated existing user: ${demo.email} (id=${userId})`);
    } else {
      const [created] = await db.insert(users).values({
        name: demo.name,
        email: demo.email,
        passwordHash,
        role: "user",
        isDemo: true,
        emailVerified: true,
        onboardingCompleted: true,
      }).returning();
      userId = created.id;
      console.log(`Created user: ${demo.email} (id=${userId})`);
    }

    const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    if (existingSub) {
      await db.update(subscriptions).set({
        planId: plan.id,
        status: "active",
        provider: "internal",
        trialEndsAt: null,
        amount: 0,
        billingCycle: "monthly",
        currency: "usd",
      }).where(eq(subscriptions.id, existingSub.id));
      console.log(`  Updated subscription → ${demo.planKey} (active)`);
    } else {
      await db.insert(subscriptions).values({
        userId,
        planId: plan.id,
        provider: "internal",
        status: "active",
        trialEndsAt: null,
        amount: 0,
        billingCycle: "monthly",
        currency: "usd",
      });
      console.log(`  Created subscription → ${demo.planKey} (active)`);
    }
  }

  console.log("\n✓ All demo users seeded successfully!");
  process.exit(0);
}

seedDemoUsers().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
