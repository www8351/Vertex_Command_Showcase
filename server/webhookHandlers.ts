import type Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";
import { storage } from "./storage";

export async function handleStripeWebhook(event: Stripe.Event): Promise<void> {
  console.log("[Stripe Webhook] Event:", event.type);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = parseInt(session.metadata?.userId || "0");
      const planKey = session.metadata?.planKey;

      if (userId && planKey) {
        const plan = await storage.getPlanByKey(planKey);
        if (plan) {
          const existingSub = await storage.getSubscription(userId);
          if (existingSub) {
            await storage.updateSubscription(existingSub.id, {
              planId: plan.id,
              status: "active",
              providerCustomerId: session.customer as string,
              providerSubscriptionId: session.subscription as string,
            });
          } else {
            await storage.createSubscription({
              userId,
              planId: plan.id,
              provider: "stripe",
              providerCustomerId: session.customer as string,
              providerSubscriptionId: session.subscription as string,
              status: "active",
              billingCycle: "monthly",
              amount: plan.monthlyPrice || 0,
              currency: "usd",
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            });
          }
          await storage.createBillingEvent({
            userId,
            eventType: "checkout.completed",
            payloadJson: { planKey, sessionId: session.id },
          });
        }
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = parseInt(subscription.metadata?.userId || "0");
      if (userId) {
        const existingSub = await storage.getSubscription(userId);
        if (existingSub) {
          await storage.updateSubscription(existingSub.id, {
            status: subscription.status === "active" ? "active" : subscription.status === "past_due" ? "past_due" : "canceled",
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          });
        }
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = parseInt(subscription.metadata?.userId || "0");
      if (userId) {
        const existingSub = await storage.getSubscription(userId);
        if (existingSub) {
          await storage.updateSubscription(existingSub.id, {
            status: "canceled",
            canceledAt: new Date(),
          });
          await storage.createBillingEvent({
            userId,
            subscriptionId: existingSub.id,
            eventType: "subscription.deleted",
          });
        }
      }
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      break;
    }

    default:
      break;
  }
}
