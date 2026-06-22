import { pgTable, text, varchar, real, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const firms = pgTable("firms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  minTradingDays: integer("min_trading_days").default(0),
  consistencyPercentage: real("consistency_percentage").default(30),
  dailyDrawdown: real("daily_drawdown"),
  totalDrawdown: real("total_drawdown"),
  drawdownType: text("drawdown_type").default("static"),
  trailingDrawdown: real("trailing_drawdown"),
  trailingStopType: text("trailing_stop_type").default("intraday"),
  withdrawalAllowedStage: text("withdrawal_allowed_stage").default("funded"),
  withdrawalWaitDays: integer("withdrawal_wait_days").default(0),
  bufferBeforeTarget: boolean("buffer_before_target").default(true),
});

export const insertFirmSchema = createInsertSchema(firms).omit({ id: true });
export type InsertFirm = z.infer<typeof insertFirmSchema>;
export type Firm = typeof firms.$inferSelect;

export const firmTiers = pgTable("firm_tiers", {
  id: serial("id").primaryKey(),
  firmId: integer("firm_id").notNull(),
  name: text("name").notNull(),
  minTradingDays: integer("min_trading_days").default(0),
  consistencyPercentage: real("consistency_percentage").default(30),
  dailyDrawdown: real("daily_drawdown"),
  totalDrawdown: real("total_drawdown"),
  drawdownType: text("drawdown_type").default("static"),
  trailingDrawdown: real("trailing_drawdown"),
  trailingStopType: text("trailing_stop_type").default("intraday"),
  withdrawalAllowedStage: text("withdrawal_allowed_stage").default("funded"),
  withdrawalWaitDays: integer("withdrawal_wait_days").default(0),
  bufferBeforeTarget: boolean("buffer_before_target").default(true),
});

export const insertFirmTierSchema = createInsertSchema(firmTiers).omit({ id: true });
export type InsertFirmTier = z.infer<typeof insertFirmTierSchema>;
export type FirmTier = typeof firmTiers.$inferSelect;

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  accountId: varchar("account_id", { length: 50 }).notNull(),
  name: text("name").notNull(),
  firm: text("firm").notNull(),
  tier: text("tier"),
  stage: text("stage").notNull(),
  size: real("size").notNull(),
  startingBalance: integer("starting_balance"),
  accountType: text("account_type").default("EVAL"),
  balance: real("balance").notNull(),
  target: real("target"),
  buffer: real("buffer"),
  maxDrawdown: real("max_drawdown"),
  drawdownType: text("drawdown_type").default("static"),
  trailingDrawdown: real("trailing_drawdown"),
  trailingStopType: text("trailing_stop_type").default("intraday"),
  consistencyRule: real("consistency_rule"),
  topDayProfit: real("top_day_profit"),
  tradingDays: integer("trading_days").default(0),
  bufferEnabled: boolean("buffer_enabled").default(true),
  peakBalance: real("peak_balance"),
  lowestEquity: real("lowest_equity"),
  brokerStatus: text("broker_status"),
  brokerActive: boolean("broker_active").default(true),
  brokerStatusRaw: text("broker_status_raw"),
  brokerStatusUpdatedAt: timestamp("broker_status_updated_at"),
  lastPeakUpdateDate: text("last_peak_update_date"),
  status: text("status").default("healthy"),
  dataSource: text("data_source").default("manual"),
  integrationConnectionId: integer("integration_connection_id"),
  externalAccountId: text("external_account_id"),
  lastSyncAt: timestamp("last_sync_at"),
  notes: text("notes"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ACCOUNT_STATUSES = [
  "healthy", "buffer_building", "near_target", "ready_to_withdraw", "passed",
  "consistency_risk", "drawdown_risk", "violated", "inactive", "sync_failed",
] as const;
export type AccountStatus = typeof ACCOUNT_STATUSES[number];

export const BLOCKED_COPY_STATUSES: ReadonlySet<string> = new Set<AccountStatus>(["violated", "sync_failed", "passed"]);

export const insertAccountSchema = createInsertSchema(accounts).omit({
  id: true,
  createdAt: true,
});
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

export const withdrawals = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  firm: text("firm").notNull(),
  accountName: text("account_name").notNull(),
  amount: real("amount").notNull(),
  dateRequested: text("date_requested").notNull(),
  dateApproved: text("date_approved"),
  datePaid: text("date_paid"),
  status: text("status").notNull().default("pending"),
  reason: text("reason"),
  notes: text("notes"),
  userId: integer("user_id"),
});

export const insertWithdrawalSchema = createInsertSchema(withdrawals).omit({
  id: true,
});
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawals.$inferSelect;

export const balanceHistory = pgTable("balance_history", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  date: text("date").notNull(),
  balance: real("balance").notNull(),
  profit: real("profit").notNull(),
  buffer: real("buffer"),
  targetProgress: real("target_progress"),
  equity: real("equity"),
  realizedPnl: real("realized_pnl"),
  unrealizedPnl: real("unrealized_pnl"),
  dailyPnl: real("daily_pnl"),
  drawdownRemaining: real("drawdown_remaining"),
  riskPercent: real("risk_percent"),
  sourceConnectionId: integer("source_connection_id"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBalanceHistorySchema = createInsertSchema(balanceHistory).omit({
  id: true,
  createdAt: true,
});
export type InsertBalanceHistory = z.infer<typeof insertBalanceHistorySchema>;
export type BalanceHistory = typeof balanceHistory.$inferSelect;

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("medium"),
  title: text("title"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  read: boolean("read").default(false),
  isResolved: boolean("is_resolved").default(false),
  resolvedAt: timestamp("resolved_at"),
  userId: integer("user_id"),
});

export const insertAlertSchema = createInsertSchema(alerts).omit({
  id: true,
  createdAt: true,
});
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alerts.$inferSelect;

export const monthlyReports = pgTable("monthly_reports", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  totalProfit: real("total_profit").default(0),
  totalWithdrawals: real("total_withdrawals").default(0),
  accountsActive: integer("accounts_active").default(0),
  accountsPassedStage: integer("accounts_passed_stage").default(0),
  accountsFailed: integer("accounts_failed").default(0),
  bestAccount: text("best_account"),
  worstAccount: text("worst_account"),
  metadataJson: jsonb("metadata_json"),
  userId: integer("user_id"),
});

export const insertMonthlyReportSchema = createInsertSchema(monthlyReports).omit({
  id: true,
});
export type InsertMonthlyReport = z.infer<typeof insertMonthlyReportSchema>;
export type MonthlyReport = typeof monthlyReports.$inferSelect;

export const securityEvents = pgTable("security_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull(),
  userId: integer("user_id"),
  ipAddress: text("ip_address"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSecurityEventSchema = createInsertSchema(securityEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;
export type SecurityEvent = typeof securityEvents.$inferSelect;

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  userId: integer("user_id"),
  timestamp: timestamp("timestamp").defaultNow(),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  timestamp: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLog.$inferSelect;

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  theme: text("theme").default("dark"),
  defaultView: text("default_view").default("grouped"),
  notificationPreferences: jsonb("notification_preferences"),
});

export const insertSettingsSchema = createInsertSchema(settings).omit({
  id: true,
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  status: text("status").notNull().default("active"),
  emailVerified: boolean("email_verified").notNull().default(false),
  verificationToken: text("verification_token"),
  verificationTokenExpiresAt: timestamp("verification_token_expires_at"),
  resetToken: text("reset_token"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at"),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  googleId: text("google_id"),
  avatarUrl: text("avatar_url"),
  tradingExperience: text("trading_experience"),
  accountType: text("account_type"),
  instruments: text("instruments").array(),
  goals: text("goals").array(),
  referralSource: text("referral_source"),
  onboardingCompleted: boolean("onboarding_completed").default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  totpBackupCodes: text("totp_backup_codes"),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const referralCodes = pgTable("referral_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  code: text("code").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertReferralCodeSchema = createInsertSchema(referralCodes).omit({ id: true, createdAt: true });
export type InsertReferralCode = z.infer<typeof insertReferralCodeSchema>;
export type ReferralCode = typeof referralCodes.$inferSelect;

export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerUserId: integer("referrer_user_id").notNull(),
  referredUserId: integer("referred_user_id").notNull(),
  status: text("status").notNull().default("registered"),
  rewardType: text("reward_type"),
  rewardAmount: real("reward_amount").default(0),
  rewardApplied: boolean("reward_applied").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  convertedAt: timestamp("converted_at"),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true, createdAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

export const riskInterventions = pgTable("risk_interventions", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  userId: integer("user_id"),
  triggerTimestamp: timestamp("trigger_timestamp").notNull().defaultNow(),
  triggerType: text("trigger_type").notNull().default("drawdown_breach"),
  hwm: real("hwm").notNull(),
  currentEquity: real("current_equity").notNull(),
  eodLimit: real("eod_limit").notNull(),
  riskPercent: real("risk_percent").notNull(),
  positionsClosed: integer("positions_closed").default(0),
  ordersCancelled: integer("orders_cancelled").default(0),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  executionMs: integer("execution_ms"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_risk_interventions_account").on(table.accountId),
  index("idx_risk_interventions_user").on(table.userId),
]);

export const insertRiskInterventionSchema = createInsertSchema(riskInterventions).omit({ id: true });
export type InsertRiskIntervention = z.infer<typeof insertRiskInterventionSchema>;
export type RiskIntervention = typeof riskInterventions.$inferSelect;

export const equityTicks = pgTable("equity_ticks", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  equity: real("equity").notNull(),
  hwm: real("hwm").notNull(),
  trailingStop: real("trailing_stop").notNull(),
  drawdownRisk: real("drawdown_risk").default(0),
  breached: boolean("breached").default(false),
  userId: integer("user_id"),
}, (table) => [
  index("idx_equity_ticks_account_ts").on(table.accountId, table.timestamp),
  index("idx_equity_ticks_user").on(table.userId),
]);

export const insertEquityTickSchema = createInsertSchema(equityTicks).omit({ id: true });
export type InsertEquityTick = z.infer<typeof insertEquityTickSchema>;
export type EquityTick = typeof equityTicks.$inferSelect;

export const linkedUsers = pgTable("linked_users", {
  id: serial("id").primaryKey(),
  primaryUserId: integer("primary_user_id").notNull(),
  linkedUserId: integer("linked_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLinkedUserSchema = createInsertSchema(linkedUsers).omit({ id: true, createdAt: true });
export type InsertLinkedUser = z.infer<typeof insertLinkedUserSchema>;
export type LinkedUser = typeof linkedUsers.$inferSelect;

export const marketDataCache = pgTable("market_data_cache", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  interval: text("interval").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume").default(0),
  fetchedAt: timestamp("fetched_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_market_data_unique_candle").on(table.symbol, table.interval, table.timestamp),
]);

export const insertMarketDataCacheSchema = createInsertSchema(marketDataCache).omit({ id: true, fetchedAt: true });
export type InsertMarketDataCache = z.infer<typeof insertMarketDataCacheSchema>;
export type MarketDataCache = typeof marketDataCache.$inferSelect;

export * from "./models/chat";
