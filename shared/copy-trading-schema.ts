import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const copyTradingConnections = pgTable("copy_trading_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  provider: text("provider").notNull(),
  connectionName: text("connection_name").notNull(),
  encryptedCredentials: text("encrypted_credentials"),
  status: text("status").notNull().default("pending"),
  lastSuccessAt: timestamp("last_success_at"),
  lastErrorAt: timestamp("last_error_at"),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCopyTradingConnectionSchema = createInsertSchema(copyTradingConnections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCopyTradingConnection = z.infer<typeof insertCopyTradingConnectionSchema>;
export type CopyTradingConnection = typeof copyTradingConnections.$inferSelect;

export const copyTradingConnectionAccounts = pgTable("copy_trading_connection_accounts", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  externalAccountName: text("external_account_name"),
  platform: text("platform"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCopyTradingConnectionAccountSchema = createInsertSchema(copyTradingConnectionAccounts).omit({ id: true, createdAt: true });
export type InsertCopyTradingConnectionAccount = z.infer<typeof insertCopyTradingConnectionAccountSchema>;
export type CopyTradingConnectionAccount = typeof copyTradingConnectionAccounts.$inferSelect;

export const copyTradingGroups = pgTable("copy_trading_groups", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  masterAccountId: integer("master_account_id").notNull(),
  masterConnectionId: integer("master_connection_id"),
  status: text("status").notNull().default("paused"),
  pollIntervalMs: integer("poll_interval_ms").notNull().default(5000),
  maxSlippagePercent: real("max_slippage_percent"),
  maxSlippageTicks: integer("max_slippage_ticks"),
  settingsJson: jsonb("settings_json"),
  dailyLossLimit: real("daily_loss_limit"),
  restrictedSymbols: text("restricted_symbols").array(),
  newsEmbargoMinutes: integer("news_embargo_minutes"),
  newsEmbargoEvents: jsonb("news_embargo_events"),
  webhookToken: text("webhook_token"),
  heartbeatTimeoutSec: integer("heartbeat_timeout_sec"),
  defaultOrderType: text("default_order_type").default("Market"),
  defaultTimeInForce: text("default_time_in_force").default("Day"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCopyTradingGroupSchema = createInsertSchema(copyTradingGroups).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCopyTradingGroup = z.infer<typeof insertCopyTradingGroupSchema>;
export type CopyTradingGroup = typeof copyTradingGroups.$inferSelect;

export const copyTradingFollowers = pgTable("copy_trading_followers", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  followerAccountId: integer("follower_account_id").notNull(),
  followerConnectionId: integer("follower_connection_id"),
  multiplier: real("multiplier").notNull().default(1.0),
  sizingMode: text("sizing_mode").notNull().default("proportional"),
  maxPositionSize: integer("max_position_size"),
  minPositionSize: integer("min_position_size"),
  fixedLotSize: real("fixed_lot_size"),
  roundingLogic: text("rounding_logic").default("nearest"),
  maxSlippagePercent: real("max_slippage_percent"),
  maxSlippageTicks: integer("max_slippage_ticks"),
  orderType: text("order_type"),
  timeInForce: text("time_in_force"),
  allowedSymbols: text("allowed_symbols").array(),
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("idle"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCopyTradingFollowerSchema = createInsertSchema(copyTradingFollowers).omit({ id: true, createdAt: true });
export type InsertCopyTradingFollower = z.infer<typeof insertCopyTradingFollowerSchema>;
export type CopyTradingFollower = typeof copyTradingFollowers.$inferSelect;

export const copyTradingOrders = pgTable("copy_trading_orders", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  followerAccountId: integer("follower_account_id").notNull(),
  masterOrderRef: text("master_order_ref"),
  followerOrderRef: text("follower_order_ref"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: real("quantity").notNull(),
  price: real("price"),
  masterPrice: real("master_price"),
  orderType: text("order_type").default("Market"),
  timeInForce: text("time_in_force").default("Day"),
  limitPrice: real("limit_price"),
  stopPrice: real("stop_price"),
  trailOffset: real("trail_offset"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  normalizedError: text("normalized_error"),
  latencyMs: integer("latency_ms"),
  slippageTicks: real("slippage_ticks"),
  slippageDollars: real("slippage_dollars"),
  riskCheckResult: jsonb("risk_check_result"),
  isOrphaned: boolean("is_orphaned").default(false),
  masterDetectedAt: timestamp("master_detected_at"),
  followerSentAt: timestamp("follower_sent_at"),
  followerFilledAt: timestamp("follower_filled_at"),
  rawPayloadJson: jsonb("raw_payload_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCopyTradingOrderSchema = createInsertSchema(copyTradingOrders).omit({ id: true, createdAt: true });
export type InsertCopyTradingOrder = z.infer<typeof insertCopyTradingOrderSchema>;
export type CopyTradingOrder = typeof copyTradingOrders.$inferSelect;

export const signalMappings = pgTable("signal_mappings", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  externalSymbol: text("external_symbol").notNull(),
  brokerContractId: text("broker_contract_id").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSignalMappingSchema = createInsertSchema(signalMappings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSignalMapping = z.infer<typeof insertSignalMappingSchema>;
export type SignalMapping = typeof signalMappings.$inferSelect;

export const processedSignals = pgTable("processed_signals", {
  id: serial("id").primaryKey(),
  signalHash: text("signal_hash").notNull().unique(),
  source: text("source").notNull(),
  externalSymbol: text("external_symbol").notNull(),
  resolvedSymbol: text("resolved_symbol"),
  action: text("action").notNull(),
  quantity: real("quantity").notNull(),
  groupId: integer("group_id"),
  status: text("status").notNull().default("received"),
  errorMessage: text("error_message"),
  executionResults: jsonb("execution_results"),
  rawPayload: jsonb("raw_payload"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProcessedSignalSchema = createInsertSchema(processedSignals).omit({ id: true, createdAt: true });
export type InsertProcessedSignal = z.infer<typeof insertProcessedSignalSchema>;
export type ProcessedSignal = typeof processedSignals.$inferSelect;

export const ORDER_TYPES = ["Market", "Limit", "Stop", "StopLimit", "TrailingStop", "Bracket", "OCO", "OTO"] as const;
export type OrderType = typeof ORDER_TYPES[number];

export const TIME_IN_FORCE_OPTIONS = ["Day", "GTC", "GTD", "FOK", "IOC"] as const;
export type TimeInForce = typeof TIME_IN_FORCE_OPTIONS[number];

export const ROUNDING_LOGIC_OPTIONS = ["floor", "ceil", "nearest"] as const;
export type RoundingLogic = typeof ROUNDING_LOGIC_OPTIONS[number];
