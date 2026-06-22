import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const integrationProviders = pgTable("integration_providers", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").default("trading_platform"),
  supportsOauth: boolean("supports_oauth").default(false),
  supportsApiKey: boolean("supports_api_key").default(true),
  supportsWebsocket: boolean("supports_websocket").default(false),
  readOnlyOnly: boolean("read_only_only").default(true),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertIntegrationProviderSchema = createInsertSchema(integrationProviders).omit({ id: true, createdAt: true });
export type InsertIntegrationProvider = z.infer<typeof insertIntegrationProviderSchema>;
export type IntegrationProvider = typeof integrationProviders.$inferSelect;

export const integrationConnections = pgTable("integration_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  providerId: integer("provider_id").notNull(),
  connectionName: text("connection_name").notNull(),
  authType: text("auth_type").notNull().default("api_key"),
  integrationMode: text("integration_mode").notNull().default("sync"),
  encryptedCredentials: text("encrypted_credentials"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  settings: jsonb("settings").default({}),
  status: text("status").notNull().default("pending"),
  lastSuccessAt: timestamp("last_success_at"),
  lastErrorAt: timestamp("last_error_at"),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertIntegrationConnectionSchema = createInsertSchema(integrationConnections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntegrationConnection = z.infer<typeof insertIntegrationConnectionSchema>;
export type IntegrationConnection = typeof integrationConnections.$inferSelect;

export const integrationAccounts = pgTable("integration_accounts", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  externalAccountName: text("external_account_name"),
  platform: text("platform"),
  firmName: text("firm_name"),
  tierName: text("tier_name"),
  stage: text("stage"),
  linkedAccountId: integer("linked_account_id"),
  isActive: boolean("is_active").default(true),
  lastSyncedAt: timestamp("last_synced_at"),
  rawMetadataJson: jsonb("raw_metadata_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertIntegrationAccountSchema = createInsertSchema(integrationAccounts).omit({ id: true, createdAt: true });
export type InsertIntegrationAccount = z.infer<typeof insertIntegrationAccountSchema>;
export type IntegrationAccount = typeof integrationAccounts.$inferSelect;

export const importedTrades = pgTable("imported_trades", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  connectionId: integer("connection_id"),
  externalTradeId: text("external_trade_id"),
  symbol: text("symbol"),
  side: text("side"),
  quantity: real("quantity"),
  entryPrice: real("entry_price"),
  exitPrice: real("exit_price"),
  realizedPnl: real("realized_pnl"),
  openedAt: timestamp("opened_at"),
  closedAt: timestamp("closed_at"),
  importedAt: timestamp("imported_at").defaultNow(),
  rawPayloadJson: jsonb("raw_payload_json"),
});

export const insertImportedTradeSchema = createInsertSchema(importedTrades).omit({ id: true, importedAt: true });
export type InsertImportedTrade = z.infer<typeof insertImportedTradeSchema>;
export type ImportedTrade = typeof importedTrades.$inferSelect;

export const syncJobs = pgTable("sync_jobs", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull(),
  jobType: text("job_type").notNull().default("full_sync"),
  triggerType: text("trigger_type").notNull().default("manual"),
  status: text("status").notNull().default("queued"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  recordsProcessed: integer("records_processed").default(0),
  errorMessage: text("error_message"),
});

export const insertSyncJobSchema = createInsertSchema(syncJobs).omit({ id: true });
export type InsertSyncJob = z.infer<typeof insertSyncJobSchema>;
export type SyncJob = typeof syncJobs.$inferSelect;

export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  syncJobId: integer("sync_job_id").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  contextJson: jsonb("context_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSyncLogSchema = createInsertSchema(syncLogs).omit({ id: true, createdAt: true });
export type InsertSyncLog = z.infer<typeof insertSyncLogSchema>;
export type SyncLog = typeof syncLogs.$inferSelect;
