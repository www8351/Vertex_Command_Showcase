import { pgTable, text, serial, integer, real, timestamp, date, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  importedTradeId: integer("imported_trade_id"),
  accountId: integer("account_id"),
  symbol: text("symbol"),
  side: text("side"),
  quantity: real("quantity"),
  entryPrice: real("entry_price"),
  exitPrice: real("exit_price"),
  realizedPnl: real("realized_pnl"),
  openedAt: timestamp("opened_at"),
  closedAt: timestamp("closed_at"),
  notes: text("notes"),
  tags: text("tags").array(),
  autoTags: text("auto_tags").array(),
  setupType: text("setup_type"),
  strategy: text("strategy"),
  playbookId: integer("playbook_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type JournalEntry = typeof journalEntries.$inferSelect;

export const journalPsychology = pgTable("journal_psychology", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id").notNull(),
  moodBefore: text("mood_before"),
  moodAfter: text("mood_after"),
  confidence: integer("confidence"),
  discipline: integer("discipline"),
  lessonsLearned: text("lessons_learned"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertJournalPsychologySchema = createInsertSchema(journalPsychology).omit({ id: true, createdAt: true });
export type InsertJournalPsychology = z.infer<typeof insertJournalPsychologySchema>;
export type JournalPsychology = typeof journalPsychology.$inferSelect;

export const journalDailySummary = pgTable("journal_daily_summary", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: date("date").notNull(),
  totalTrades: integer("total_trades").default(0),
  winners: integer("winners").default(0),
  losers: integer("losers").default(0),
  grossPnl: real("gross_pnl").default(0),
  netPnl: real("net_pnl").default(0),
  bestTrade: real("best_trade"),
  worstTrade: real("worst_trade"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertJournalDailySummarySchema = createInsertSchema(journalDailySummary).omit({ id: true, createdAt: true });
export type InsertJournalDailySummary = z.infer<typeof insertJournalDailySummarySchema>;
export type JournalDailySummary = typeof journalDailySummary.$inferSelect;

export const tradingGoals = pgTable("trading_goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  monthlyPnlTarget: real("monthly_pnl_target"),
  yearlyPnlTarget: real("yearly_pnl_target"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTradingGoalSchema = createInsertSchema(tradingGoals).omit({ id: true, updatedAt: true });
export type InsertTradingGoal = z.infer<typeof insertTradingGoalSchema>;
export type TradingGoal = typeof tradingGoals.$inferSelect;

export const sharedReports = pgTable("shared_reports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  shareToken: text("share_token").notNull().unique(),
  title: text("title").notNull(),
  reportType: text("report_type").notNull().default("performance"),
  dateFrom: text("date_from"),
  dateTo: text("date_to"),
  includeFields: jsonb("include_fields"),
  snapshotData: jsonb("snapshot_data"),
  isActive: boolean("is_active").notNull().default(true),
  viewCount: integer("view_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSharedReportSchema = createInsertSchema(sharedReports).omit({ id: true, createdAt: true, viewCount: true });
export type InsertSharedReport = z.infer<typeof insertSharedReportSchema>;
export type SharedReport = typeof sharedReports.$inferSelect;

export const journalAlerts = pgTable("journal_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("info"),
  message: text("message").notNull(),
  data: jsonb("data"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertJournalAlertSchema = createInsertSchema(journalAlerts).omit({ id: true, createdAt: true });
export type InsertJournalAlert = z.infer<typeof insertJournalAlertSchema>;
export type JournalAlert = typeof journalAlerts.$inferSelect;

export const playbooks = pgTable("playbooks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  rules: text("rules"),
  color: text("color").default("#6366f1"),
  icon: text("icon").default("book"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPlaybookSchema = createInsertSchema(playbooks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlaybook = z.infer<typeof insertPlaybookSchema>;
export type Playbook = typeof playbooks.$inferSelect;

export const tradeTags = pgTable("trade_tags", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  color: text("color").default("#3b82f6"),
  category: text("category").default("custom"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTradeTagSchema = createInsertSchema(tradeTags).omit({ id: true, createdAt: true });
export type InsertTradeTag = z.infer<typeof insertTradeTagSchema>;
export type TradeTag = typeof tradeTags.$inferSelect;

export const tradeScreenshots = pgTable("trade_screenshots", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id").notNull(),
  userId: integer("user_id").notNull(),
  filename: text("filename").notNull(),
  url: text("url").notNull(),
  caption: text("caption"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTradeScreenshotSchema = createInsertSchema(tradeScreenshots).omit({ id: true, createdAt: true });
export type InsertTradeScreenshot = z.infer<typeof insertTradeScreenshotSchema>;
export type TradeScreenshot = typeof tradeScreenshots.$inferSelect;

export const journalAlertSettings = pgTable("journal_alert_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  maxDailyLoss: real("max_daily_loss"),
  maxConsecutiveLosses: integer("max_consecutive_losses").default(3),
  winRateDropThreshold: real("win_rate_drop_threshold").default(10),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertJournalAlertSettingsSchema = createInsertSchema(journalAlertSettings).omit({ id: true, updatedAt: true });
export type InsertJournalAlertSettings = z.infer<typeof insertJournalAlertSettingsSchema>;
export type JournalAlertSettings = typeof journalAlertSettings.$inferSelect;
