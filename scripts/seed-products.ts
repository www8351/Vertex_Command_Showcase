import { getUncachableStripeClient } from "../server/stripeClient";

const PLANS = [
  {
    name: "Pro",
    description: "לסוחר הפרטי - עד 20 חשבונות, 2 אינטגרציות, ייצוא CSV, מנוע עדיפויות",
    monthlyAmount: 2900,
    yearlyAmount: 29000,
    metadata: { plan_key: "pro", max_accounts: "20", max_connections: "2" },
  },
  {
    name: "Trader",
    description: "הפופולרי ביותר - עד 100 חשבונות, 10 אינטגרציות, סנכרון אוטומטי, AI צ׳אטבוט",
    monthlyAmount: 7900,
    yearlyAmount: 79000,
    metadata: { plan_key: "trader", max_accounts: "100", max_connections: "10" },
  },
  {
    name: "Desk",
    description: "לצוותים ודסקים - חשבונות ללא הגבלה, 50 אינטגרציות, תמיכה בצוות, API מלא",
    monthlyAmount: 19900,
    yearlyAmount: 199000,
    metadata: { plan_key: "desk", max_accounts: "999", max_connections: "50" },
  },
];

async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();
    console.log("Creating Vertex Command subscription plans in Stripe...\n");

    for (const plan of PLANS) {
      const existing = await stripe.products.search({
        query: `name:'${plan.name}' AND active:'true'`,
      });

      if (existing.data.length > 0) {
        console.log(`✓ ${plan.name} already exists (${existing.data[0].id})`);
        const prices = await stripe.prices.list({ product: existing.data[0].id, active: true });
        for (const p of prices.data) {
          console.log(`  - ${p.id}: $${(p.unit_amount || 0) / 100}/${p.recurring?.interval}`);
        }
        continue;
      }

      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: plan.metadata,
      });
      console.log(`Created product: ${product.name} (${product.id})`);

      const monthlyPrice = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.monthlyAmount,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { plan_key: plan.metadata.plan_key, cycle: "monthly" },
      });
      console.log(`  Monthly: $${plan.monthlyAmount / 100}/month (${monthlyPrice.id})`);

      const yearlyPrice = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.yearlyAmount,
        currency: "usd",
        recurring: { interval: "year" },
        metadata: { plan_key: plan.metadata.plan_key, cycle: "yearly" },
      });
      console.log(`  Yearly: $${plan.yearlyAmount / 100}/year (${yearlyPrice.id})`);
    }

    console.log("\n✓ All plans created successfully!");
    process.exit(0);
  } catch (error: any) {
    console.error("Error creating products:", error.message);
    process.exit(1);
  }
}

createProducts();
