import { pushSystemError } from "./system-health-stream";

let stripePromise: Promise<any> | null = null;

function getStripeSecretKey(): string {
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY;
  }

  throw new Error("STRIPE_SECRET_KEY not configured. Set it as an environment variable or connect the Stripe integration.");
}

export async function getUncachableStripeClient(): Promise<any> {
  if (!stripePromise) {
    stripePromise = (async () => {
      const key = getStripeSecretKey();
      const mod = await import("stripe");
      const Stripe = mod.default || mod;
      return new Stripe(key);
    })();
  }
  return stripePromise;
}

export async function testStripeConnection(): Promise<boolean> {
  try {
    const stripe = await getUncachableStripeClient();
    const products = await stripe.products.list({ limit: 1 });
    console.log("[Stripe] Connected successfully, products count:", products.data.length);
    return true;
  } catch (err: any) {
    console.error("[Stripe] Connection failed:", err.message);
    pushSystemError("error", "stripe", `Connection failed: ${err.message}`);
    return false;
  }
}

export function getStripePublishableKey(): string {
  return process.env.STRIPE_PUBLISHABLE_KEY || "";
}
