import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { getUncachableStripeClient } from "./stripeClient";
import { z } from "zod";
import { safeErrorResponse } from "./sanitize";

const checkoutSchema = z.object({
  planKey: z.string().min(1, "חסר מזהה תוכנית"),
  billingCycle: z.enum(["monthly", "yearly"]).optional().default("monthly"),
});

const changePlanSchema = z.object({
  planKey: z.string().min(1, "חסר מזהה תוכנית"),
  billingCycle: z.enum(["monthly", "yearly"]).optional().default("monthly"),
});

const emptyBodySchema = z.object({}).passthrough();

interface FeatureCheckResult {
  allowed: boolean;
  requiredPlan?: string;
}

const FEATURE_REQUIRED_PLAN: Record<string, string> = {
  integrations: "basic",
  auto_sync: "pro",
  exports: "basic",
  priority_engine: "basic",
  team_support: "unlimited",
  ai_chatbot: "pro",
  copy_trading: "basic",
};

function checkFeature(plan: any, feature: string): FeatureCheckResult {
  const requiredPlan = FEATURE_REQUIRED_PLAN[feature];
  switch (feature) {
    case "integrations":
      return plan.hasIntegrations ? { allowed: true } : { allowed: false, requiredPlan };
    case "auto_sync":
      return plan.hasAutoSync ? { allowed: true } : { allowed: false, requiredPlan };
    case "exports":
      return plan.hasExports ? { allowed: true } : { allowed: false, requiredPlan };
    case "priority_engine":
      return plan.hasPriorityEngine ? { allowed: true } : { allowed: false, requiredPlan };
    case "team_support":
      return plan.hasTeamSupport ? { allowed: true } : { allowed: false, requiredPlan };
    case "ai_chatbot":
      return plan.hasAiChatbot ? { allowed: true } : { allowed: false, requiredPlan };
    case "copy_trading":
      return plan.hasCopyTrading ? { allowed: true } : { allowed: false, requiredPlan };
    default:
      return { allowed: true };
  }
}

export async function checkPlanLimit(userId: number, feature: string): Promise<FeatureCheckResult> {
  const sub = await storage.getSubscription(userId);
  if (!sub) {
    const freePlan = await storage.getPlanByKey("free");
    if (!freePlan) return { allowed: true };
    return checkFeature(freePlan, feature);
  }
  const plans = await storage.getPlans();
  const plan = plans.find(p => p.id === sub.planId);
  if (!plan) return { allowed: true };
  return checkFeature(plan, feature);
}

export function requirePlanFeature(feature: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    try {
      const user = await storage.getUserById(userId);
      if (user?.role === "admin") return next();

      const result = await checkPlanLimit(userId, feature);
      if (result.allowed) return next();

      return res.status(403).json({
        code: "plan_limit",
        feature,
        requiredPlan: result.requiredPlan || FEATURE_REQUIRED_PLAN[feature] || "pro",
        message: `This feature requires the ${FEATURE_REQUIRED_PLAN[feature] || "Pro"} plan or higher`,
      });
    } catch (err) {
      return res.status(500).json({ code: "server_error", message: "Unable to verify plan access" });
    }
  };
}

export async function checkAccountLimit(userId: number): Promise<{ allowed: boolean; maxAccounts: number; currentCount: number; requiredPlan?: string }> {
  const sub = await storage.getSubscription(userId);
  let plan: any;
  if (!sub) {
    plan = await storage.getPlanByKey("free");
    if (!plan) return { allowed: true, maxAccounts: 999, currentCount: 0 };
  } else {
    const plans = await storage.getPlans();
    plan = plans.find(p => p.id === sub.planId);
    if (!plan) return { allowed: true, maxAccounts: 999, currentCount: 0 };
  }

  const accounts = await storage.getAccounts(userId);
  const maxAccounts = plan.maxAccounts || 3;
  const currentCount = accounts.length;

  if (currentCount >= maxAccounts) {
    const planOrder = ["free", "basic", "pro", "unlimited"];
    const currentIdx = planOrder.indexOf(plan.key);
    const nextPlan = currentIdx < planOrder.length - 1 ? planOrder[currentIdx + 1] : "unlimited";
    return { allowed: false, maxAccounts, currentCount, requiredPlan: nextPlan };
  }

  return { allowed: true, maxAccounts, currentCount };
}

async function getStripePrices(): Promise<{ planKey: string; monthlyPriceId: string; yearlyPriceId: string }[]> {
  try {
    const stripe = await getUncachableStripeClient();
    const products = await stripe.products.list({ active: true, limit: 20 });
    const prices = await stripe.prices.list({ active: true, limit: 100 });

    const priceMap: Record<string, { monthlyPriceId: string; yearlyPriceId: string }> = {};

    for (const product of products.data) {
      const planKey = product.metadata?.plan_key;
      if (!planKey) continue;

      if (!priceMap[planKey]) priceMap[planKey] = { monthlyPriceId: "", yearlyPriceId: "" };

      const productPrices = prices.data.filter(p => p.product === product.id);
      for (const price of productPrices) {
        if (price.recurring?.interval === "month") {
          priceMap[planKey].monthlyPriceId = price.id;
        } else if (price.recurring?.interval === "year") {
          priceMap[planKey].yearlyPriceId = price.id;
        }
      }
    }

    return Object.entries(priceMap).map(([planKey, prices]) => ({
      planKey,
      ...prices,
    }));
  } catch (err: any) {
    console.error("Error fetching Stripe prices:", err.message);
    return [];
  }
}

const DEFAULT_PLANS = [
  { key: "free",      name: "Free",      monthlyPrice: 0,   yearlyPrice: 0,    maxAccounts: 2,    maxConnections: 1,   hasIntegrations: true,  hasAutoSync: false, hasExports: false, hasPriorityEngine: false, hasTeamSupport: false, hasAiChatbot: false, hasCopyTrading: false, maxCopyTradingAccounts: 0, maxJournalAccounts: 0  },
  { key: "basic",     name: "Basic",     monthlyPrice: 29,  yearlyPrice: 290,  maxAccounts: 5,    maxConnections: 3,   hasIntegrations: true,  hasAutoSync: true,  hasExports: true,  hasPriorityEngine: true,  hasTeamSupport: false, hasAiChatbot: false, hasCopyTrading: true,  maxCopyTradingAccounts: 3, maxJournalAccounts: 1  },
  { key: "pro",       name: "Pro",       monthlyPrice: 79,  yearlyPrice: 790,  maxAccounts: 15,   maxConnections: 10,  hasIntegrations: true,  hasAutoSync: true,  hasExports: true,  hasPriorityEngine: true,  hasTeamSupport: false, hasAiChatbot: true,  hasCopyTrading: true,  maxCopyTradingAccounts: 10, maxJournalAccounts: 5 },
  { key: "unlimited", name: "Unlimited", monthlyPrice: 199, yearlyPrice: 1990, maxAccounts: 9999, maxConnections: 100, hasIntegrations: true,  hasAutoSync: true,  hasExports: true,  hasPriorityEngine: true,  hasTeamSupport: true,  hasAiChatbot: true,  hasCopyTrading: true,  maxCopyTradingAccounts: 9999, maxJournalAccounts: 9999 },
];

const LEGACY_PLAN_MIGRATION: Record<string, string> = {
  "trader": "pro",
  "desk": "unlimited",
};

export async function ensurePlansSeeded() {
  const existing = await storage.getPlans();
  for (const def of DEFAULT_PLANS) {
    const found = existing.find(p => p.key === def.key);
    if (!found) {
      await storage.createPlan(def);
    } else {
      const needsUpdate = (
        found.hasAiChatbot !== def.hasAiChatbot ||
        found.hasCopyTrading !== def.hasCopyTrading ||
        found.hasIntegrations !== def.hasIntegrations ||
        found.hasExports !== def.hasExports ||
        found.hasPriorityEngine !== def.hasPriorityEngine ||
        found.hasTeamSupport !== def.hasTeamSupport ||
        found.hasAutoSync !== def.hasAutoSync ||
        found.maxAccounts !== def.maxAccounts ||
        found.maxConnections !== def.maxConnections ||
        found.name !== def.name ||
        found.monthlyPrice !== def.monthlyPrice ||
        found.yearlyPrice !== def.yearlyPrice ||
        (found.maxCopyTradingAccounts || 0) !== def.maxCopyTradingAccounts ||
        (found.maxJournalAccounts || 0) !== def.maxJournalAccounts
      );
      if (needsUpdate) {
        await storage.updatePlan(found.id, def);
      }
    }
  }

  const refreshed = await storage.getPlans();
  for (const [oldKey, newKey] of Object.entries(LEGACY_PLAN_MIGRATION)) {
    const oldPlan = refreshed.find(p => p.key === oldKey);
    const newPlan = refreshed.find(p => p.key === newKey);
    if (oldPlan && newPlan) {
      await storage.migrateSubscriptionsPlan(oldPlan.id, newPlan.id);
      await storage.updatePlan(oldPlan.id, { active: false });
      console.log(`[Plans] Migrated subscriptions from "${oldKey}" (id=${oldPlan.id}) to "${newKey}" (id=${newPlan.id})`);
    }
  }
}

export function registerBillingRoutes(app: Express) {
  app.get("/api/v1/billing/status", async (req, res) => {
    const userId = req.session.userId!;
    const sub = await storage.getSubscription(userId);
    if (!sub) {
      return res.json({ status: "expired", daysLeft: 0, trialEndsAt: null, planName: "Free" });
    }
    const allPlans = await storage.getPlans();
    const plan = allPlans.find(p => p.id === sub.planId);
    const planName = plan?.name || "Free";

    if (sub.status === "active") {
      return res.json({ status: "active", daysLeft: null, trialEndsAt: null, planName });
    }

    if (sub.status === "trialing" && sub.trialEndsAt) {
      const now = new Date();
      const end = new Date(sub.trialEndsAt);
      const diffMs = end.getTime() - now.getTime();
      const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      if (daysLeft <= 0) {
        return res.json({ status: "expired", daysLeft: 0, trialEndsAt: sub.trialEndsAt, planName });
      }
      return res.json({ status: "trialing", daysLeft, trialEndsAt: sub.trialEndsAt, planName });
    }

    return res.json({ status: "expired", daysLeft: 0, trialEndsAt: sub.trialEndsAt, planName });
  });

  app.get("/api/v1/billing/plans", async (_req, res) => {
    const allPlans = await storage.getPlans();
    res.json(allPlans);
  });

  app.get("/api/v1/billing/subscription", async (req, res) => {
    const userId = req.session.userId!;
    const sub = await storage.getSubscription(userId);
    if (!sub) {
      const freePlan = await storage.getPlanByKey("free");
      return res.json({
        planKey: "free",
        planName: freePlan?.name || "Free",
        status: "active",
        plan: freePlan || null,
      });
    }
    const allPlans = await storage.getPlans();
    const plan = allPlans.find(p => p.id === sub.planId);
    res.json({ ...sub, plan: plan || null, planKey: plan?.key || "free", planName: plan?.name || "Free" });
  });

  app.get("/api/v1/billing/stripe-prices", async (_req, res) => {
    const prices = await getStripePrices();
    res.json(prices);
  });

  app.post("/api/v1/billing/create-checkout", async (req, res) => {
    const userId = req.session.userId!;
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים", errors: parsed.error.flatten() });
    const { planKey, billingCycle } = parsed.data;

    try {
      const stripe = await getUncachableStripeClient();
      const prices = await getStripePrices();
      const planPrices = prices.find(p => p.planKey === planKey);

      if (!planPrices) {
        return res.status(404).json({ message: "לא נמצאו מחירים בסטרייפ לתוכנית זו. יש להריץ את סקריפט יצירת המוצרים." });
      }

      const priceId = billingCycle === "yearly" ? planPrices.yearlyPriceId : planPrices.monthlyPriceId;
      if (!priceId) {
        return res.status(404).json({ message: "מחיר לא נמצא לתוכנית זו" });
      }

      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "משתמש לא נמצא" });

      let customerId: string | undefined;

      const existingSub = await storage.getSubscription(userId);
      if (existingSub?.providerCustomerId) {
        customerId = existingSub.providerCustomerId;
      }

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name,
          metadata: { userId: String(userId) },
        });
        customerId = customer.id;
      }

      const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: `${baseUrl}/billing?success=true&plan=${planKey}`,
        cancel_url: `${baseUrl}/billing?canceled=true`,
        metadata: { userId: String(userId), planKey },
        subscription_data: {
          metadata: { userId: String(userId), planKey },
        },
      });

      const plan = await storage.getPlanByKey(planKey);
      const amount = billingCycle === "yearly" ? plan?.yearlyPrice : plan?.monthlyPrice;

      if (!existingSub && plan) {
        await storage.createSubscription({
          userId,
          planId: plan.id,
          provider: "stripe",
          providerCustomerId: customerId,
          status: "pending",
          billingCycle: billingCycle || "monthly",
          amount: amount || 0,
          currency: "usd",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + (billingCycle === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000),
        });
      }

      await storage.createBillingEvent({
        userId,
        eventType: "checkout.started",
        payloadJson: { planKey, billingCycle, sessionId: session.id },
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Stripe checkout error:", error.message);
      safeErrorResponse(res, error, 500, "שגיאה ביצירת דף תשלום");
    }
  });

  app.post("/api/v1/billing/create-portal", async (req, res) => {
    emptyBodySchema.safeParse(req.body);
    const userId = req.session.userId!;

    try {
      const existingSub = await storage.getSubscription(userId);
      if (!existingSub?.providerCustomerId) {
        return res.status(400).json({ message: "אין מנוי פעיל עם Stripe" });
      }

      const stripe = await getUncachableStripeClient();
      const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;

      const session = await stripe.billingPortal.sessions.create({
        customer: existingSub.providerCustomerId,
        return_url: `${baseUrl}/billing`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Stripe portal error:", error.message);
      res.status(500).json({ message: "שגיאה בפתיחת פורטל חיוב" });
    }
  });

  app.post("/api/v1/billing/change-plan", async (req, res) => {
    const userId = req.session.userId!;
    const parsed = changePlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים", errors: parsed.error.flatten() });
    const { planKey, billingCycle } = parsed.data;

    const plan = await storage.getPlanByKey(planKey);
    if (!plan) return res.status(404).json({ message: "תוכנית לא נמצאה" });

    if (planKey === "free") {
      const existingSub = await storage.getSubscription(userId);
      if (existingSub) {
        await storage.updateSubscription(existingSub.id, {
          planId: plan.id,
          amount: 0,
          status: "active",
          cancelAtPeriodEnd: false,
          canceledAt: null,
        });
      }
      return res.json({ message: "עברת לתוכנית חינמית" });
    }

    // SECURITY: paid plans must NOT be activated here. Activation is driven only
    // by a verified Stripe payment via the create-checkout flow + webhook. This
    // route previously set status:"active" with no payment, allowing any user to
    // grant themselves a paid plan for free. Route paid changes through checkout.
    return res.status(402).json({
      code: "payment_required",
      message: "שדרוג לתוכנית בתשלום מחייב מעבר לתשלום",
      checkoutEndpoint: "/api/v1/billing/create-checkout",
    });
  });

  app.post("/api/v1/billing/cancel", async (req, res) => {
    emptyBodySchema.safeParse(req.body);
    const userId = req.session.userId!;
    const sub = await storage.getSubscription(userId);
    if (!sub) return res.status(404).json({ message: "לא נמצא מנוי פעיל" });

    await storage.updateSubscription(sub.id, {
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
    });
    await storage.createBillingEvent({
      userId,
      subscriptionId: sub.id,
      eventType: "subscription.canceled",
    });

    res.json({ message: "המנוי יבוטל בסוף תקופת החיוב" });
  });

  app.post("/api/v1/billing/resume", async (req, res) => {
    emptyBodySchema.safeParse(req.body);
    const userId = req.session.userId!;
    const sub = await storage.getSubscription(userId);
    if (!sub) return res.status(404).json({ message: "לא נמצא מנוי" });

    await storage.updateSubscription(sub.id, {
      cancelAtPeriodEnd: false,
      canceledAt: null,
      status: "active",
    });
    await storage.createBillingEvent({
      userId,
      subscriptionId: sub.id,
      eventType: "subscription.resumed",
    });

    res.json({ message: "המנוי חודש בהצלחה" });
  });

  app.get("/api/v1/billing/invoices", async (req, res) => {
    const userId = req.session.userId!;
    const inv = await storage.getInvoices(userId);
    res.json(inv);
  });

  app.post("/api/billing/webhook", async (req, res) => {
    res.json({ received: true });
  });
}
