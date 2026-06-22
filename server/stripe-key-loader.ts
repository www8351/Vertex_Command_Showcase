import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), ".stripe-keys.json");

export async function loadStripeKeyFromIntegration(): Promise<boolean> {
  if (process.env.STRIPE_SECRET_KEY) {
    console.log("[Stripe] Key available from environment");
    return true;
  }

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const keys = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      if (keys.secret) {
        process.env.STRIPE_SECRET_KEY = keys.secret;
        if (keys.publishable) {
          process.env.STRIPE_PUBLISHABLE_KEY = keys.publishable;
        }
        console.log("[Stripe] Keys loaded from local config");
        return true;
      }
    }
  } catch {}

  try {
    const { ReplitConnectors } = await import("@replit/connectors-sdk");
    const connectors = new ReplitConnectors();
    const connections = await connectors.listConnections({ connector_names: "stripe" });

    if (connections && connections.length > 0) {
      const conn = connections[0] as any;
      const settings = conn.settings || conn.credentials || {};
      const secret = settings.secret || settings.stripe_secret_key;
      if (secret) {
        process.env.STRIPE_SECRET_KEY = secret;
        if (settings.publishable) {
          process.env.STRIPE_PUBLISHABLE_KEY = settings.publishable;
        }
        console.log("[Stripe] Keys loaded from Replit integration");
        return true;
      }
    }
  } catch (err: any) {
    console.log("[Stripe] Integration SDK not available:", err.message?.substring(0, 80));
  }

  console.warn("[Stripe] No key found. Set STRIPE_SECRET_KEY env var or run: node scripts/setup-stripe-keys.js");
  return false;
}

export function saveStripeKeys(secret: string, publishable?: string): void {
  const data: Record<string, string> = { secret };
  if (publishable) data.publishable = publishable;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}
