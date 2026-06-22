import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  monthlyPrice: real("monthly_price").default(0),
  yearlyPrice: real("yearly_price").default(0),
  maxAccounts: integer("max_accounts").default(3),
  maxConnections: integer("max_connections").default(0),
  hasIntegrations: boolean("has_integrations").default(false),
  hasAutoSync: boolean("has_auto_sync").default(false),
  hasExports: boolean("has_exports").default(false),
  hasPriorityEngine: boolean("has_priority_engine").default(false),
  hasTeamSupport: boolean("has_team_support").default(false),
  hasAiChatbot: boolean("has_ai_chatbot").default(false),
  hasCopyTrading: boolean("has_copy_trading").default(false),
  maxCopyTradingAccounts: integer("max_copy_trading_accounts").default(0),
  maxJournalAccounts: integer("max_journal_accounts").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPlanSchema = createInsertSchema(plans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plans.$inferSelect;

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  planId: integer("plan_id").notNull(),
  provider: text("provider").notNull().default("stripe"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  status: text("status").notNull().default("trialing"),
  billingCycle: text("billing_cycle").default("monthly"),
  amount: real("amount").default(0),
  currency: text("currency").default("usd"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  canceledAt: timestamp("canceled_at"),
  trialEndsAt: timestamp("trial_ends_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  subscriptionId: integer("subscription_id"),
  providerInvoiceId: text("provider_invoice_id"),
  amount: real("amount").notNull(),
  currency: text("currency").default("usd"),
  status: text("status").notNull().default("draft"),
  invoiceUrl: text("invoice_url"),
  hostedInvoiceUrl: text("hosted_invoice_url"),
  paidAt: timestamp("paid_at"),
  dueAt: timestamp("due_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

export const paymentMethods = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  provider: text("provider").notNull().default("stripe"),
  providerPaymentMethodId: text("provider_payment_method_id"),
  brand: text("brand"),
  last4: text("last4"),
  expMonth: integer("exp_month"),
  expYear: integer("exp_year"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaymentMethodSchema = createInsertSchema(paymentMethods).omit({ id: true, createdAt: true });
export type InsertPaymentMethod = z.infer<typeof insertPaymentMethodSchema>;
export type PaymentMethod = typeof paymentMethods.$inferSelect;

export const billingEvents = pgTable("billing_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  subscriptionId: integer("subscription_id"),
  eventType: text("event_type").notNull(),
  providerEventId: text("provider_event_id"),
  payloadJson: jsonb("payload_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBillingEventSchema = createInsertSchema(billingEvents).omit({ id: true, createdAt: true });
export type InsertBillingEvent = z.infer<typeof insertBillingEventSchema>;
export type BillingEvent = typeof billingEvents.$inferSelect;
