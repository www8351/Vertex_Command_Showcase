import {
  accounts, withdrawals, firms, firmTiers, balanceHistory, alerts, monthlyReports, auditLog, settings, users,
  referralCodes, referrals, securityEvents, equityTicks, linkedUsers, riskInterventions,
  type Account, type InsertAccount,
  type Withdrawal, type InsertWithdrawal,
  type Firm, type InsertFirm,
  type FirmTier, type InsertFirmTier,
  type BalanceHistory, type InsertBalanceHistory,
  type Alert, type InsertAlert,
  type MonthlyReport, type InsertMonthlyReport,
  type AuditLog, type InsertAuditLog,
  type Settings, type InsertSettings,
  type User, type InsertUser,
  type ReferralCode, type InsertReferralCode,
  type Referral, type InsertReferral,
  type SecurityEvent, type InsertSecurityEvent,
  type EquityTick, type InsertEquityTick,
  type LinkedUser, type InsertLinkedUser,
  type RiskIntervention, type InsertRiskIntervention,
} from "@shared/schema";
import {
  integrationProviders, integrationConnections, integrationAccounts, importedTrades, syncJobs, syncLogs,
  type IntegrationProvider, type InsertIntegrationProvider,
  type IntegrationConnection, type InsertIntegrationConnection,
  type IntegrationAccount, type InsertIntegrationAccount,
  type ImportedTrade, type InsertImportedTrade,
  type SyncJob, type InsertSyncJob,
  type SyncLog, type InsertSyncLog,
} from "@shared/integrations-schema";
import {
  copyTradingConnections, copyTradingConnectionAccounts,
  copyTradingGroups, copyTradingFollowers, copyTradingOrders,
  signalMappings, processedSignals,
  type CopyTradingConnection, type InsertCopyTradingConnection,
  type CopyTradingConnectionAccount, type InsertCopyTradingConnectionAccount,
  type CopyTradingGroup, type InsertCopyTradingGroup,
  type CopyTradingFollower, type InsertCopyTradingFollower,
  type CopyTradingOrder, type InsertCopyTradingOrder,
  type SignalMapping, type InsertSignalMapping,
  type ProcessedSignal, type InsertProcessedSignal,
} from "@shared/copy-trading-schema";
import {
  journalEntries, journalPsychology, journalDailySummary, sharedReports, tradingGoals,
  journalAlerts, journalAlertSettings,
  playbooks, tradeTags, tradeScreenshots,
  type JournalEntry, type InsertJournalEntry,
  type JournalPsychology, type InsertJournalPsychology,
  type JournalDailySummary, type InsertJournalDailySummary,
  type SharedReport, type InsertSharedReport,
  type TradingGoal, type InsertTradingGoal,
  type JournalAlert, type InsertJournalAlert,
  type JournalAlertSettings, type InsertJournalAlertSettings,
  type Playbook, type InsertPlaybook,
  type TradeTag, type InsertTradeTag,
  type TradeScreenshot, type InsertTradeScreenshot,
} from "@shared/journal-schema";
import {
  plans, subscriptions, invoices, paymentMethods, billingEvents,
  type Plan, type InsertPlan,
  type Subscription, type InsertSubscription,
  type Invoice, type InsertInvoice,
  type PaymentMethod, type InsertPaymentMethod,
  type BillingEvent, type InsertBillingEvent,
} from "@shared/billing-schema";
import { db } from "./db";
import { eq, desc, and, sql, gte, inArray } from "drizzle-orm";
import { determineAccountTier, classifyAccountType, resolveStartingBalance } from "./account-tier";

export interface IStorage {
  getAccounts(userId: number): Promise<Account[]>;
  getAccount(id: number): Promise<Account | undefined>;
  getAccountsByConnectionId(connectionId: number): Promise<Account[]>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: number, data: Partial<InsertAccount>): Promise<Account | undefined>;
  deleteAccount(id: number): Promise<boolean>;

  getFirms(): Promise<Firm[]>;
  getFirm(id: number): Promise<Firm | undefined>;
  getFirmByName(name: string): Promise<Firm | undefined>;
  createFirm(firm: InsertFirm): Promise<Firm>;
  updateFirm(id: number, firm: Partial<InsertFirm>): Promise<Firm | undefined>;
  deleteFirm(id: number): Promise<boolean>;

  getFirmTiers(): Promise<FirmTier[]>;
  getFirmTiersByFirmId(firmId: number): Promise<FirmTier[]>;
  getFirmTier(id: number): Promise<FirmTier | undefined>;
  createFirmTier(tier: InsertFirmTier): Promise<FirmTier>;
  updateFirmTier(id: number, data: Partial<InsertFirmTier>): Promise<FirmTier | undefined>;
  deleteFirmTier(id: number): Promise<boolean>;

  getWithdrawals(userId: number): Promise<Withdrawal[]>;
  getWithdrawalsByAccount(accountId: number): Promise<Withdrawal[]>;
  createWithdrawal(withdrawal: InsertWithdrawal): Promise<Withdrawal>;
  updateWithdrawal(id: number, data: Partial<InsertWithdrawal>): Promise<Withdrawal | undefined>;
  deleteWithdrawal(id: number): Promise<boolean>;

  getBalanceHistory(accountId: number): Promise<BalanceHistory[]>;
  createBalanceSnapshot(snapshot: InsertBalanceHistory): Promise<BalanceHistory>;

  getAlerts(userId: number): Promise<Alert[]>;
  getAlertsByAccount(accountId: number): Promise<Alert[]>;
  getUnreadAlerts(userId: number): Promise<Alert[]>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  markAlertRead(id: number): Promise<Alert | undefined>;
  markAllAlertsRead(userId: number): Promise<void>;
  deleteAlert(id: number): Promise<boolean>;
  deleteAlerts(ids: number[]): Promise<number>;

  getMonthlyReports(userId: number): Promise<MonthlyReport[]>;
  createMonthlyReport(report: InsertMonthlyReport): Promise<MonthlyReport>;

  createAuditEntry(entry: InsertAuditLog): Promise<AuditLog>;
  getAuditLog(): Promise<AuditLog[]>;

  getSettings(userId: number): Promise<Settings | undefined>;
  upsertSettings(s: InsertSettings): Promise<Settings>;

  createUser(user: InsertUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByVerificationToken(token: string): Promise<User | undefined>;
  verifyUser(id: number): Promise<void>;
  updateUserVerificationToken(id: number, token: string, expiresAt: Date): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  updateUserResetToken(id: number, token: string | null, expiresAt: Date | null): Promise<void>;
  updateUserPassword(id: number, passwordHash: string): Promise<void>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined>;
  updateUserRole(id: number, role: string): Promise<User | undefined>;
  incrementFailedLoginAttempts(id: number): Promise<User | undefined>;
  resetFailedLoginAttempts(id: number): Promise<void>;
  lockAccount(id: number, until: Date): Promise<void>;
  unlockAccount(id: number): Promise<void>;
  updateUserTotp(id: number, totpSecret: string | null, totpEnabled: boolean, totpBackupCodes: string | null): Promise<void>;
  getAllAccounts(): Promise<Account[]>;
  getAllConnections(): Promise<IntegrationConnection[]>;
  deleteAccountsByConnectionId(connectionId: number): Promise<number>;
  bulkDeleteAccounts(ids: number[]): Promise<number>;
  updateAccountStatus(id: number, status: string): Promise<Account | undefined>;

  getProviders(): Promise<IntegrationProvider[]>;
  getProvider(id: number): Promise<IntegrationProvider | undefined>;
  getProviderByKey(key: string): Promise<IntegrationProvider | undefined>;
  getConnections(userId: number): Promise<IntegrationConnection[]>;
  getConnection(id: number): Promise<IntegrationConnection | undefined>;
  createConnection(conn: InsertIntegrationConnection): Promise<IntegrationConnection>;
  updateConnection(id: number, data: Partial<InsertIntegrationConnection>): Promise<IntegrationConnection | undefined>;
  deleteConnection(id: number): Promise<boolean>;
  getIntegrationAccounts(connectionId: number): Promise<IntegrationAccount[]>;
  createIntegrationAccount(acc: InsertIntegrationAccount): Promise<IntegrationAccount>;
  linkAccount(externalId: string, internalAccountId: number): Promise<IntegrationAccount | undefined>;
  unlinkAccount(externalId: string): Promise<IntegrationAccount | undefined>;
  createSyncJob(job: InsertSyncJob): Promise<SyncJob>;
  updateSyncJob(id: number, data: Partial<InsertSyncJob>): Promise<SyncJob | undefined>;
  getSyncJobs(connectionId: number): Promise<SyncJob[]>;
  getSyncJob(id: number): Promise<SyncJob | undefined>;
  createSyncLog(log: InsertSyncLog): Promise<SyncLog>;
  getSyncLogs(jobId: number): Promise<SyncLog[]>;
  createTrade(trade: InsertImportedTrade): Promise<ImportedTrade>;
  getTradesByAccount(accountId: number): Promise<ImportedTrade[]>;
  getTradesByUser(userId: number): Promise<ImportedTrade[]>;

  getPlans(): Promise<Plan[]>;
  getPlanByKey(key: string): Promise<Plan | undefined>;
  createPlan(data: InsertPlan): Promise<Plan>;
  updatePlan(id: number, data: Partial<InsertPlan>): Promise<Plan | undefined>;
  getSubscription(userId: number): Promise<Subscription | undefined>;
  createSubscription(sub: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: number, data: Partial<InsertSubscription>): Promise<Subscription | undefined>;
  migrateSubscriptionsPlan(oldPlanId: number, newPlanId: number): Promise<number>;
  getInvoices(userId: number): Promise<Invoice[]>;
  createInvoice(inv: InsertInvoice): Promise<Invoice>;
  getPaymentMethods(userId: number): Promise<PaymentMethod[]>;
  createPaymentMethod(pm: InsertPaymentMethod): Promise<PaymentMethod>;
  deletePaymentMethod(id: number): Promise<boolean>;
  createBillingEvent(ev: InsertBillingEvent): Promise<BillingEvent>;

  getCopyTradingConnections(userId: number): Promise<CopyTradingConnection[]>;
  getCopyTradingConnection(id: number): Promise<CopyTradingConnection | undefined>;
  createCopyTradingConnection(conn: InsertCopyTradingConnection): Promise<CopyTradingConnection>;
  updateCopyTradingConnection(id: number, data: Partial<Record<string, any>>): Promise<CopyTradingConnection | undefined>;
  deleteCopyTradingConnection(id: number): Promise<boolean>;

  getCopyTradingConnectionAccounts(connectionId: number): Promise<CopyTradingConnectionAccount[]>;
  getCopyTradingConnectionAccount(id: number): Promise<CopyTradingConnectionAccount | undefined>;
  createCopyTradingConnectionAccount(acc: InsertCopyTradingConnectionAccount): Promise<CopyTradingConnectionAccount>;
  updateCopyTradingConnectionAccount(id: number, data: Partial<Record<string, any>>): Promise<CopyTradingConnectionAccount | undefined>;
  deleteCopyTradingConnectionAccounts(connectionId: number): Promise<number>;

  getCopyGroups(userId: number): Promise<CopyTradingGroup[]>;
  getCopyGroup(id: number): Promise<CopyTradingGroup | undefined>;
  createCopyGroup(group: InsertCopyTradingGroup): Promise<CopyTradingGroup>;
  updateCopyGroup(id: number, data: Partial<InsertCopyTradingGroup>): Promise<CopyTradingGroup | undefined>;
  deleteCopyGroup(id: number): Promise<boolean>;
  getActiveCopyGroups(): Promise<CopyTradingGroup[]>;

  getCopyFollowers(groupId: number): Promise<CopyTradingFollower[]>;
  getCopyFollower(id: number): Promise<CopyTradingFollower | undefined>;
  createCopyFollower(follower: InsertCopyTradingFollower): Promise<CopyTradingFollower>;
  updateCopyFollower(id: number, data: Partial<InsertCopyTradingFollower>): Promise<CopyTradingFollower | undefined>;
  deleteCopyFollower(id: number): Promise<boolean>;

  getCopyOrders(groupId: number, limit?: number, offset?: number): Promise<CopyTradingOrder[]>;
  createCopyOrder(order: InsertCopyTradingOrder): Promise<CopyTradingOrder>;
  updateCopyOrder(id: number, data: Partial<InsertCopyTradingOrder>): Promise<CopyTradingOrder | undefined>;
  getCopyOrderCount(groupId: number): Promise<number>;
  findRecentDuplicateOrder(groupId: number, followerAccountId: number, symbol: string, side: string, windowMs: number): Promise<CopyTradingOrder | undefined>;
  getCopyGroupByWebhookToken(token: string): Promise<CopyTradingGroup | undefined>;
  getRecentFilledOrders(groupId: number, limit?: number): Promise<CopyTradingOrder[]>;
  getSlippageStats(groupId: number): Promise<{ symbol: string; avgSlippageTicks: number; avgSlippageDollars: number; count: number }[]>;

  getSignalMappings(source?: string): Promise<SignalMapping[]>;
  getSignalMapping(source: string, externalSymbol: string): Promise<SignalMapping | undefined>;
  createSignalMapping(mapping: InsertSignalMapping): Promise<SignalMapping>;
  updateSignalMapping(id: number, data: Partial<InsertSignalMapping>): Promise<SignalMapping | undefined>;
  deleteSignalMapping(id: number): Promise<boolean>;

  insertProcessedSignalAtomic(signal: InsertProcessedSignal): Promise<{ inserted: boolean; signal: ProcessedSignal }>;
  getProcessedSignals(limit?: number, offset?: number): Promise<ProcessedSignal[]>;
  updateProcessedSignal(id: number, data: Partial<InsertProcessedSignal>): Promise<ProcessedSignal | undefined>;

  getJournalEntries(userId: number, filters?: { accountId?: number; symbol?: string; tag?: string; dateFrom?: string; dateTo?: string }): Promise<JournalEntry[]>;
  getJournalEntry(id: number): Promise<JournalEntry | undefined>;
  createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry>;
  updateJournalEntry(id: number, data: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined>;
  deleteJournalEntry(id: number): Promise<boolean>;

  getJournalPsychology(journalEntryId: number): Promise<JournalPsychology | undefined>;
  upsertJournalPsychology(data: InsertJournalPsychology): Promise<JournalPsychology>;

  getJournalDailySummaries(userId: number, dateFrom?: string, dateTo?: string): Promise<JournalDailySummary[]>;
  upsertJournalDailySummary(data: InsertJournalDailySummary): Promise<JournalDailySummary>;

  getJournalAnalytics(userId: number, dateFrom?: string, dateTo?: string, accountId?: number): Promise<{
    totalTrades: number;
    winners: number;
    losers: number;
    winRate: number;
    totalPnl: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    bestTrade: number;
    worstTrade: number;
    bySymbol: { symbol: string; count: number; pnl: number; winRate: number }[];
    byTag: { tag: string; count: number; pnl: number; winRate: number }[];
    byWeekday: { day: number; count: number; pnl: number; winRate: number }[];
    equityCurve: { date: string; equity: number }[];
    calendarData: { date: string; pnl: number; trades: number }[];
  }>;

  getJournalPsychologyAnalytics(userId: number): Promise<{
    moodVsPnl: { mood: string; avgPnl: number; count: number }[];
    confidenceVsWinRate: { confidence: number; winRate: number; count: number }[];
    recentLessons: { lesson: string; date: Date | null; pnl: number | null }[];
  }>;

  getSharedReports(userId: number): Promise<SharedReport[]>;
  getSharedReportByToken(token: string): Promise<SharedReport | undefined>;
  createSharedReport(report: InsertSharedReport): Promise<SharedReport>;
  updateSharedReport(id: number, data: Partial<InsertSharedReport>): Promise<SharedReport | undefined>;
  deleteSharedReport(id: number): Promise<boolean>;
  incrementReportViewCount(id: number): Promise<void>;

  getTradingGoals(userId: number): Promise<TradingGoal | undefined>;
  upsertTradingGoals(data: InsertTradingGoal): Promise<TradingGoal>;

  getReferralCode(userId: number): Promise<ReferralCode | undefined>;
  getReferralCodeByCode(code: string): Promise<ReferralCode | undefined>;
  createReferralCode(data: InsertReferralCode): Promise<ReferralCode>;
  getReferralsByReferrer(userId: number): Promise<Referral[]>;
  getReferralByReferred(userId: number): Promise<Referral | undefined>;
  createReferral(data: InsertReferral): Promise<Referral>;
  updateReferral(id: number, data: Partial<InsertReferral>): Promise<Referral | undefined>;
  getAllReferrals(): Promise<Referral[]>;
  getAllReferralCodes(): Promise<ReferralCode[]>;

  getJournalAlerts(userId: number): Promise<JournalAlert[]>;
  createJournalAlert(alert: InsertJournalAlert): Promise<JournalAlert>;
  markJournalAlertRead(id: number): Promise<JournalAlert | undefined>;
  markAllJournalAlertsRead(userId: number): Promise<void>;
  getJournalAlertSettings(userId: number): Promise<JournalAlertSettings | undefined>;
  upsertJournalAlertSettings(data: InsertJournalAlertSettings): Promise<JournalAlertSettings>;

  createSecurityEvent(event: InsertSecurityEvent): Promise<SecurityEvent>;
  getSecurityEvents(filters?: { severity?: string; eventType?: string; limit?: number; offset?: number }): Promise<SecurityEvent[]>;
  getSecurityEventCount(filters?: { severity?: string; eventType?: string }): Promise<number>;
  deleteOldSecurityEvents(olderThanDays: number): Promise<number>;

  createEquityTick(tick: InsertEquityTick): Promise<EquityTick>;
  getEquityTicks(accountId: number, from?: Date, to?: Date, limit?: number): Promise<EquityTick[]>;
  getLatestEquityTick(accountId: number): Promise<EquityTick | undefined>;
  getEquityTickCount(accountId: number): Promise<number>;
  deleteOldEquityTicks(olderThanDays: number): Promise<number>;
  getEquityTicksByUser(userId: number, from?: Date, to?: Date): Promise<EquityTick[]>;

  createRiskIntervention(intervention: InsertRiskIntervention): Promise<RiskIntervention>;
  updateRiskIntervention(id: number, data: Partial<InsertRiskIntervention>): Promise<RiskIntervention | undefined>;
  getRiskInterventions(accountId: number, limit?: number): Promise<RiskIntervention[]>;

  getLinkedUserIds(userId: number): Promise<number[]>;
  getLinkedUsers(): Promise<LinkedUser[]>;
  createLinkedUser(data: InsertLinkedUser): Promise<LinkedUser>;
  deleteLinkedUser(id: number): Promise<boolean>;

  getPlaybooks(userId: number): Promise<Playbook[]>;
  getPlaybook(id: number): Promise<Playbook | undefined>;
  createPlaybook(data: InsertPlaybook): Promise<Playbook>;
  updatePlaybook(id: number, data: Partial<InsertPlaybook>): Promise<Playbook | undefined>;
  deletePlaybook(id: number): Promise<boolean>;

  getTradeTags(userId: number): Promise<TradeTag[]>;
  getTradeTag(id: number): Promise<TradeTag | undefined>;
  createTradeTag(data: InsertTradeTag): Promise<TradeTag>;
  updateTradeTag(id: number, data: Partial<InsertTradeTag>): Promise<TradeTag | undefined>;
  deleteTradeTag(id: number): Promise<boolean>;

  getTradeScreenshots(journalEntryId: number): Promise<TradeScreenshot[]>;
  createTradeScreenshot(data: InsertTradeScreenshot): Promise<TradeScreenshot>;
  deleteTradeScreenshot(id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getAccounts(userId: number): Promise<Account[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(accounts).where(inArray(accounts.userId, userIds));
  }

  async getAccount(id: number): Promise<Account | undefined> {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    return account;
  }

  async getAccountsByConnectionId(connectionId: number): Promise<Account[]> {
    return await db.select().from(accounts).where(eq(accounts.integrationConnectionId, connectionId));
  }

  async createAccount(account: InsertAccount): Promise<Account> {
    const values: InsertAccount = { ...account };
    if (values.startingBalance == null) {
      values.startingBalance = resolveStartingBalance(values.name, values.accountId, values.balance);
    }
    if (values.accountType == null) {
      values.accountType = classifyAccountType(values.name, values.accountId);
    }
    if (values.accountType === "LIVE") {
      values.stage = "LIVE";
    }
    const [created] = await db.insert(accounts).values(values).returning();
    return created;
  }

  async updateAccount(id: number, data: Partial<InsertAccount>): Promise<Account | undefined> {
    const setData: Record<string, any> = { ...data };
    if (setData.startingBalance != null) {
      setData.startingBalance = sql`COALESCE(${accounts.startingBalance}, ${setData.startingBalance})`;
    }
    const [updated] = await db.update(accounts).set(setData).where(eq(accounts.id, id)).returning();
    return updated;
  }

  async deleteAccount(id: number): Promise<boolean> {
    await db.delete(equityTicks).where(eq(equityTicks.accountId, id));
    await db.delete(balanceHistory).where(eq(balanceHistory.accountId, id));
    await db.delete(withdrawals).where(eq(withdrawals.accountId, id));
    await db.delete(alerts).where(eq(alerts.accountId, id));
    await db.delete(journalEntries).where(eq(journalEntries.accountId, id));
    await db.delete(importedTrades).where(eq(importedTrades.accountId, id));
    await db.delete(copyTradingFollowers).where(eq(copyTradingFollowers.followerAccountId, id));
    await db.delete(copyTradingGroups).where(eq(copyTradingGroups.masterAccountId, id));
    const result = await db.delete(accounts).where(eq(accounts.id, id)).returning();
    return result.length > 0;
  }

  async getFirms(): Promise<Firm[]> {
    return await db.select().from(firms);
  }

  async getFirm(id: number): Promise<Firm | undefined> {
    const [firm] = await db.select().from(firms).where(eq(firms.id, id));
    return firm;
  }

  async getFirmByName(name: string): Promise<Firm | undefined> {
    const [firm] = await db.select().from(firms).where(eq(firms.name, name));
    return firm;
  }

  async createFirm(firm: InsertFirm): Promise<Firm> {
    const [created] = await db.insert(firms).values(firm).returning();
    return created;
  }

  async updateFirm(id: number, data: Partial<InsertFirm>): Promise<Firm | undefined> {
    const [updated] = await db.update(firms).set(data).where(eq(firms.id, id)).returning();
    return updated;
  }

  async deleteFirm(id: number): Promise<boolean> {
    await db.delete(firmTiers).where(eq(firmTiers.firmId, id));
    const result = await db.delete(firms).where(eq(firms.id, id)).returning();
    return result.length > 0;
  }

  async getFirmTiers(): Promise<FirmTier[]> {
    return await db.select().from(firmTiers);
  }

  async getFirmTiersByFirmId(firmId: number): Promise<FirmTier[]> {
    return await db.select().from(firmTiers).where(eq(firmTiers.firmId, firmId));
  }

  async getFirmTier(id: number): Promise<FirmTier | undefined> {
    const [tier] = await db.select().from(firmTiers).where(eq(firmTiers.id, id));
    return tier;
  }

  async createFirmTier(tier: InsertFirmTier): Promise<FirmTier> {
    const [created] = await db.insert(firmTiers).values(tier).returning();
    return created;
  }

  async updateFirmTier(id: number, data: Partial<InsertFirmTier>): Promise<FirmTier | undefined> {
    const [updated] = await db.update(firmTiers).set(data).where(eq(firmTiers.id, id)).returning();
    return updated;
  }

  async deleteFirmTier(id: number): Promise<boolean> {
    const result = await db.delete(firmTiers).where(eq(firmTiers.id, id)).returning();
    return result.length > 0;
  }

  async getWithdrawals(userId: number): Promise<Withdrawal[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(withdrawals).where(inArray(withdrawals.userId, userIds)).orderBy(desc(withdrawals.id));
  }

  async getWithdrawalsByAccount(accountId: number): Promise<Withdrawal[]> {
    return await db.select().from(withdrawals).where(eq(withdrawals.accountId, accountId)).orderBy(desc(withdrawals.id));
  }

  async createWithdrawal(withdrawal: InsertWithdrawal): Promise<Withdrawal> {
    const [created] = await db.insert(withdrawals).values(withdrawal).returning();
    return created;
  }

  async updateWithdrawal(id: number, data: Partial<InsertWithdrawal>): Promise<Withdrawal | undefined> {
    const [updated] = await db.update(withdrawals).set(data).where(eq(withdrawals.id, id)).returning();
    return updated;
  }

  async deleteWithdrawal(id: number): Promise<boolean> {
    const result = await db.delete(withdrawals).where(eq(withdrawals.id, id)).returning();
    return result.length > 0;
  }

  async getBalanceHistory(accountId: number): Promise<BalanceHistory[]> {
    return await db.select().from(balanceHistory).where(eq(balanceHistory.accountId, accountId)).orderBy(balanceHistory.date);
  }

  async createBalanceSnapshot(snapshot: InsertBalanceHistory): Promise<BalanceHistory> {
    const [created] = await db.insert(balanceHistory).values(snapshot).returning();
    return created;
  }

  async getAlerts(userId: number): Promise<Alert[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(alerts).where(inArray(alerts.userId, userIds)).orderBy(desc(alerts.createdAt));
  }

  async getAlertsByAccount(accountId: number): Promise<Alert[]> {
    return await db.select().from(alerts).where(eq(alerts.accountId, accountId)).orderBy(desc(alerts.createdAt));
  }

  async getUnreadAlerts(userId: number): Promise<Alert[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(alerts).where(and(inArray(alerts.userId, userIds), eq(alerts.read, false))).orderBy(desc(alerts.createdAt));
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    const [created] = await db.insert(alerts).values(alert).returning();
    return created;
  }

  async markAlertRead(id: number): Promise<Alert | undefined> {
    const [updated] = await db.update(alerts).set({ read: true }).where(eq(alerts.id, id)).returning();
    return updated;
  }

  async markAllAlertsRead(userId: number): Promise<void> {
    const userIds = await this.getLinkedUserIds(userId);
    await db.update(alerts).set({ read: true }).where(and(inArray(alerts.userId, userIds), eq(alerts.read, false)));
  }

  async deleteAlert(id: number): Promise<boolean> {
    const result = await db.delete(alerts).where(eq(alerts.id, id)).returning();
    return result.length > 0;
  }

  async deleteAlerts(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await db.delete(alerts).where(inArray(alerts.id, ids)).returning();
    return result.length;
  }

  async getMonthlyReports(userId: number): Promise<MonthlyReport[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(monthlyReports).where(inArray(monthlyReports.userId, userIds)).orderBy(desc(monthlyReports.month));
  }

  async createMonthlyReport(report: InsertMonthlyReport): Promise<MonthlyReport> {
    const [created] = await db.insert(monthlyReports).values(report).returning();
    return created;
  }

  async createAuditEntry(entry: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLog).values(entry).returning();
    return created;
  }

  async getAuditLog(): Promise<AuditLog[]> {
    return await db.select().from(auditLog).orderBy(desc(auditLog.timestamp));
  }

  async getSettings(userId: number): Promise<Settings | undefined> {
    const userIds = await this.getLinkedUserIds(userId);
    const rows = await db.select().from(settings).where(inArray(settings.userId, userIds));
    if (rows.length === 0) return undefined;
    return rows.find(r => r.userId === userId) || rows.sort((a, b) => a.userId - b.userId)[0];
  }

  async upsertSettings(s: InsertSettings): Promise<Settings> {
    if (s.userId) {
      const existing = await this.getSettings(s.userId);
      if (existing) {
        const [updated] = await db.update(settings).set(s).where(eq(settings.id, existing.id)).returning();
        return updated;
      }
    }
    const [created] = await db.insert(settings).values(s).returning();
    return created;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.verificationToken, token));
    return user;
  }

  async verifyUser(id: number): Promise<void> {
    await db.update(users).set({ emailVerified: true, verificationToken: null }).where(eq(users.id, id));
  }

  async updateUserVerificationToken(id: number, token: string, expiresAt: Date): Promise<void> {
    await db.update(users).set({ verificationToken: token, verificationTokenExpiresAt: expiresAt }).where(eq(users.id, id));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.resetToken, token));
    return user;
  }

  async updateUserResetToken(id: number, token: string | null, expiresAt: Date | null): Promise<void> {
    await db.update(users).set({ resetToken: token, resetTokenExpiresAt: expiresAt }).where(eq(users.id, id));
  }

  async updateUserPassword(id: number, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async updateUserRole(id: number, role: string): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    return updated;
  }

  async incrementFailedLoginAttempts(id: number): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ failedLoginAttempts: sql`${users.failedLoginAttempts} + 1` }).where(eq(users.id, id)).returning();
    return updated;
  }

  async resetFailedLoginAttempts(id: number): Promise<void> {
    await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, id));
  }

  async lockAccount(id: number, until: Date): Promise<void> {
    await db.update(users).set({ lockedUntil: until }).where(eq(users.id, id));
  }

  async unlockAccount(id: number): Promise<void> {
    await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, id));
  }

  async updateUserTotp(id: number, totpSecret: string | null, totpEnabled: boolean, totpBackupCodes: string | null): Promise<void> {
    await db.update(users).set({ totpSecret, totpEnabled, totpBackupCodes }).where(eq(users.id, id));
  }

  async getAllAccounts(): Promise<Account[]> {
    return await db.select().from(accounts);
  }

  async getAllConnections(): Promise<IntegrationConnection[]> {
    return await db.select().from(integrationConnections);
  }

  async deleteAccountsByConnectionId(connectionId: number): Promise<number> {
    const linkedAccounts = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.integrationConnectionId, connectionId));
    const accountIds = linkedAccounts.map(a => a.id);
    if (accountIds.length > 0) {
      await db.delete(balanceHistory).where(inArray(balanceHistory.accountId, accountIds));
      await db.delete(withdrawals).where(inArray(withdrawals.accountId, accountIds));
      await db.delete(alerts).where(inArray(alerts.accountId, accountIds));
      await db.delete(journalEntries).where(inArray(journalEntries.accountId, accountIds));
      await db.delete(importedTrades).where(inArray(importedTrades.accountId, accountIds));
      await db.delete(copyTradingFollowers).where(inArray(copyTradingFollowers.followerAccountId, accountIds));
      await db.delete(copyTradingGroups).where(inArray(copyTradingGroups.masterAccountId, accountIds));
    }
    const result = await db.delete(accounts).where(eq(accounts.integrationConnectionId, connectionId)).returning();
    return result.length;
  }

  async bulkDeleteAccounts(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    await db.delete(balanceHistory).where(inArray(balanceHistory.accountId, ids));
    await db.delete(withdrawals).where(inArray(withdrawals.accountId, ids));
    await db.delete(alerts).where(inArray(alerts.accountId, ids));
    await db.delete(journalEntries).where(inArray(journalEntries.accountId, ids));
    await db.delete(importedTrades).where(inArray(importedTrades.accountId, ids));
    await db.delete(copyTradingFollowers).where(inArray(copyTradingFollowers.followerAccountId, ids));
    await db.delete(copyTradingGroups).where(inArray(copyTradingGroups.masterAccountId, ids));
    const result = await db.delete(accounts).where(inArray(accounts.id, ids)).returning();
    return result.length;
  }

  async updateAccountStatus(id: number, status: string): Promise<Account | undefined> {
    const [updated] = await db.update(accounts).set({ status }).where(eq(accounts.id, id)).returning();
    return updated;
  }

  async getProviders(): Promise<IntegrationProvider[]> {
    return await db.select().from(integrationProviders).where(eq(integrationProviders.active, true));
  }

  async getProvider(id: number): Promise<IntegrationProvider | undefined> {
    const [p] = await db.select().from(integrationProviders).where(eq(integrationProviders.id, id));
    return p;
  }

  async getProviderByKey(key: string): Promise<IntegrationProvider | undefined> {
    const [p] = await db.select().from(integrationProviders).where(eq(integrationProviders.key, key));
    return p;
  }

  async getConnections(userId: number): Promise<IntegrationConnection[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(integrationConnections).where(inArray(integrationConnections.userId, userIds)).orderBy(desc(integrationConnections.createdAt));
  }

  async getConnection(id: number): Promise<IntegrationConnection | undefined> {
    const [c] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, id));
    return c;
  }

  async createConnection(conn: InsertIntegrationConnection): Promise<IntegrationConnection> {
    const [created] = await db.insert(integrationConnections).values(conn).returning();
    return created;
  }

  async updateConnection(id: number, data: Partial<InsertIntegrationConnection>): Promise<IntegrationConnection | undefined> {
    const [updated] = await db.update(integrationConnections).set({ ...data, updatedAt: new Date() }).where(eq(integrationConnections.id, id)).returning();
    return updated;
  }

  async deleteConnection(id: number): Promise<boolean> {
    const linkedAccounts = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.integrationConnectionId, id));
    const accountIds = linkedAccounts.map(a => a.id);

    if (accountIds.length > 0) {
      await db.delete(equityTicks).where(inArray(equityTicks.accountId, accountIds));
      await db.delete(balanceHistory).where(inArray(balanceHistory.accountId, accountIds));
      await db.delete(withdrawals).where(inArray(withdrawals.accountId, accountIds));
      await db.delete(alerts).where(inArray(alerts.accountId, accountIds));
      await db.delete(journalEntries).where(inArray(journalEntries.accountId, accountIds));
      await db.delete(importedTrades).where(inArray(importedTrades.accountId, accountIds));
      await db.delete(copyTradingFollowers).where(inArray(copyTradingFollowers.followerAccountId, accountIds));
      await db.delete(copyTradingGroups).where(inArray(copyTradingGroups.masterAccountId, accountIds));
    }

    await db.delete(importedTrades).where(eq(importedTrades.connectionId, id));

    const syncJobsList = await db.select({ id: syncJobs.id }).from(syncJobs).where(eq(syncJobs.connectionId, id));
    if (syncJobsList.length > 0) {
      await db.delete(syncLogs).where(inArray(syncLogs.syncJobId, syncJobsList.map(j => j.id)));
    }
    await db.delete(syncJobs).where(eq(syncJobs.connectionId, id));

    await db.delete(integrationAccounts).where(eq(integrationAccounts.connectionId, id));

    if (accountIds.length > 0) {
      await db.delete(accounts).where(inArray(accounts.id, accountIds));
    }

    const result = await db.delete(integrationConnections).where(eq(integrationConnections.id, id)).returning();
    return result.length > 0;
  }

  async getIntegrationAccounts(connectionId: number): Promise<IntegrationAccount[]> {
    return await db.select().from(integrationAccounts).where(eq(integrationAccounts.connectionId, connectionId));
  }

  async createIntegrationAccount(acc: InsertIntegrationAccount): Promise<IntegrationAccount> {
    const [created] = await db.insert(integrationAccounts).values(acc).returning();
    return created;
  }

  async linkAccount(externalId: string, internalAccountId: number): Promise<IntegrationAccount | undefined> {
    const [updated] = await db.update(integrationAccounts).set({ linkedAccountId: internalAccountId }).where(eq(integrationAccounts.externalAccountId, externalId)).returning();
    return updated;
  }

  async unlinkAccount(externalId: string): Promise<IntegrationAccount | undefined> {
    const [updated] = await db.update(integrationAccounts).set({ linkedAccountId: null }).where(eq(integrationAccounts.externalAccountId, externalId)).returning();
    return updated;
  }

  async createSyncJob(job: InsertSyncJob): Promise<SyncJob> {
    const [created] = await db.insert(syncJobs).values(job).returning();
    return created;
  }

  async updateSyncJob(id: number, data: Partial<InsertSyncJob>): Promise<SyncJob | undefined> {
    const [updated] = await db.update(syncJobs).set(data).where(eq(syncJobs.id, id)).returning();
    return updated;
  }

  async getSyncJobs(connectionId: number): Promise<SyncJob[]> {
    return await db.select().from(syncJobs).where(eq(syncJobs.connectionId, connectionId)).orderBy(desc(syncJobs.id));
  }

  async getSyncJob(id: number): Promise<SyncJob | undefined> {
    const [j] = await db.select().from(syncJobs).where(eq(syncJobs.id, id));
    return j;
  }

  async createSyncLog(log: InsertSyncLog): Promise<SyncLog> {
    const [created] = await db.insert(syncLogs).values(log).returning();
    return created;
  }

  async getSyncLogs(jobId: number): Promise<SyncLog[]> {
    return await db.select().from(syncLogs).where(eq(syncLogs.syncJobId, jobId)).orderBy(syncLogs.createdAt);
  }

  async createTrade(trade: InsertImportedTrade): Promise<ImportedTrade> {
    const [created] = await db.insert(importedTrades).values(trade).returning();
    try {
      const account = await this.getAccount(trade.accountId);
      if (account?.userId) {
        const existing = await db.select({ id: journalEntries.id }).from(journalEntries)
          .where(eq(journalEntries.importedTradeId, created.id)).limit(1);
        if (existing.length === 0) {
          await db.insert(journalEntries).values({
            userId: account.userId,
            importedTradeId: created.id,
            accountId: trade.accountId,
            symbol: trade.symbol || null,
            side: trade.side || null,
            quantity: trade.quantity ?? null,
            entryPrice: trade.entryPrice ?? null,
            exitPrice: trade.exitPrice ?? null,
            realizedPnl: trade.realizedPnl ?? null,
            openedAt: trade.openedAt ?? null,
            closedAt: trade.closedAt ?? null,
          });
        }
      }
    } catch (e: any) {
      console.warn("[Storage] Failed to auto-create journal entry for trade", created.id, e.message);
    }
    return created;
  }

  async getTradesByAccount(accountId: number): Promise<ImportedTrade[]> {
    return await db.select().from(importedTrades).where(eq(importedTrades.accountId, accountId)).orderBy(desc(importedTrades.importedAt));
  }

  async getTradesByUser(userId: number): Promise<ImportedTrade[]> {
    const userIds = await this.getLinkedUserIds(userId);
    const userAccounts = await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.userId, userIds));
    if (userAccounts.length === 0) return [];
    const accountIds = userAccounts.map(a => a.id);
    return await db.select().from(importedTrades).where(inArray(importedTrades.accountId, accountIds)).orderBy(desc(importedTrades.openedAt));
  }

  async getPlans(): Promise<Plan[]> {
    return await db.select().from(plans).where(eq(plans.active, true));
  }

  async getPlanByKey(key: string): Promise<Plan | undefined> {
    const [p] = await db.select().from(plans).where(eq(plans.key, key));
    return p;
  }

  async createPlan(data: InsertPlan): Promise<Plan> {
    const [created] = await db.insert(plans).values(data).returning();
    return created;
  }

  async updatePlan(id: number, data: Partial<InsertPlan>): Promise<Plan | undefined> {
    const [updated] = await db.update(plans).set({ ...data, updatedAt: new Date() }).where(eq(plans.id, id)).returning();
    return updated;
  }

  async getSubscription(userId: number): Promise<Subscription | undefined> {
    const userIds = await this.getLinkedUserIds(userId);
    const rows = await db.select().from(subscriptions).where(inArray(subscriptions.userId, userIds)).orderBy(desc(subscriptions.createdAt));
    if (rows.length === 0) return undefined;
    const ownRow = rows.find(r => r.userId === userId);
    return ownRow || rows[0];
  }

  async createSubscription(sub: InsertSubscription): Promise<Subscription> {
    const [created] = await db.insert(subscriptions).values(sub).returning();
    return created;
  }

  async updateSubscription(id: number, data: Partial<InsertSubscription>): Promise<Subscription | undefined> {
    const [updated] = await db.update(subscriptions).set({ ...data, updatedAt: new Date() }).where(eq(subscriptions.id, id)).returning();
    return updated;
  }

  async migrateSubscriptionsPlan(oldPlanId: number, newPlanId: number): Promise<number> {
    const result = await db.update(subscriptions).set({ planId: newPlanId, updatedAt: new Date() }).where(eq(subscriptions.planId, oldPlanId)).returning();
    return result.length;
  }

  async getInvoices(userId: number): Promise<Invoice[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(invoices).where(inArray(invoices.userId, userIds)).orderBy(desc(invoices.createdAt));
  }

  async createInvoice(inv: InsertInvoice): Promise<Invoice> {
    const [created] = await db.insert(invoices).values(inv).returning();
    return created;
  }

  async getPaymentMethods(userId: number): Promise<PaymentMethod[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(paymentMethods).where(inArray(paymentMethods.userId, userIds));
  }

  async createPaymentMethod(pm: InsertPaymentMethod): Promise<PaymentMethod> {
    const [created] = await db.insert(paymentMethods).values(pm).returning();
    return created;
  }

  async deletePaymentMethod(id: number): Promise<boolean> {
    const result = await db.delete(paymentMethods).where(eq(paymentMethods.id, id)).returning();
    return result.length > 0;
  }

  async createBillingEvent(ev: InsertBillingEvent): Promise<BillingEvent> {
    const [created] = await db.insert(billingEvents).values(ev).returning();
    return created;
  }

  async getCopyTradingConnections(userId: number): Promise<CopyTradingConnection[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(copyTradingConnections).where(inArray(copyTradingConnections.userId, userIds)).orderBy(desc(copyTradingConnections.createdAt));
  }

  async getCopyTradingConnection(id: number): Promise<CopyTradingConnection | undefined> {
    const [c] = await db.select().from(copyTradingConnections).where(eq(copyTradingConnections.id, id));
    return c;
  }

  async createCopyTradingConnection(conn: InsertCopyTradingConnection): Promise<CopyTradingConnection> {
    const [created] = await db.insert(copyTradingConnections).values(conn).returning();
    return created;
  }

  async updateCopyTradingConnection(id: number, data: Partial<Record<string, any>>): Promise<CopyTradingConnection | undefined> {
    const [updated] = await db.update(copyTradingConnections).set({ ...data, updatedAt: new Date() }).where(eq(copyTradingConnections.id, id)).returning();
    return updated;
  }

  async deleteCopyTradingConnection(id: number): Promise<boolean> {
    await db.delete(copyTradingConnectionAccounts).where(eq(copyTradingConnectionAccounts.connectionId, id));
    const result = await db.delete(copyTradingConnections).where(eq(copyTradingConnections.id, id)).returning();
    return result.length > 0;
  }

  async getCopyTradingConnectionAccounts(connectionId: number): Promise<CopyTradingConnectionAccount[]> {
    return await db.select().from(copyTradingConnectionAccounts).where(eq(copyTradingConnectionAccounts.connectionId, connectionId));
  }

  async getCopyTradingConnectionAccount(id: number): Promise<CopyTradingConnectionAccount | undefined> {
    const [account] = await db.select().from(copyTradingConnectionAccounts).where(eq(copyTradingConnectionAccounts.id, id));
    return account;
  }

  async updateCopyTradingConnectionAccount(id: number, data: Partial<Record<string, any>>): Promise<CopyTradingConnectionAccount | undefined> {
    const [updated] = await db.update(copyTradingConnectionAccounts).set(data).where(eq(copyTradingConnectionAccounts.id, id)).returning();
    return updated;
  }

  async createCopyTradingConnectionAccount(acc: InsertCopyTradingConnectionAccount): Promise<CopyTradingConnectionAccount> {
    const [created] = await db.insert(copyTradingConnectionAccounts).values(acc).returning();
    return created;
  }

  async deleteCopyTradingConnectionAccounts(connectionId: number): Promise<number> {
    const result = await db.delete(copyTradingConnectionAccounts).where(eq(copyTradingConnectionAccounts.connectionId, connectionId)).returning();
    return result.length;
  }

  async getCopyGroups(userId: number): Promise<CopyTradingGroup[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(copyTradingGroups).where(inArray(copyTradingGroups.userId, userIds)).orderBy(desc(copyTradingGroups.createdAt));
  }

  async getCopyGroup(id: number): Promise<CopyTradingGroup | undefined> {
    const [g] = await db.select().from(copyTradingGroups).where(eq(copyTradingGroups.id, id));
    return g;
  }

  async createCopyGroup(group: InsertCopyTradingGroup): Promise<CopyTradingGroup> {
    const [created] = await db.insert(copyTradingGroups).values(group).returning();
    return created;
  }

  async updateCopyGroup(id: number, data: Partial<InsertCopyTradingGroup>): Promise<CopyTradingGroup | undefined> {
    const [updated] = await db.update(copyTradingGroups).set({ ...data, updatedAt: new Date() }).where(eq(copyTradingGroups.id, id)).returning();
    return updated;
  }

  async deleteCopyGroup(id: number): Promise<boolean> {
    return await db.transaction(async (tx) => {
      await tx.delete(copyTradingOrders).where(eq(copyTradingOrders.groupId, id));
      await tx.delete(copyTradingFollowers).where(eq(copyTradingFollowers.groupId, id));
      const result = await tx.delete(copyTradingGroups).where(eq(copyTradingGroups.id, id)).returning();
      return result.length > 0;
    });
  }

  async getActiveCopyGroups(): Promise<CopyTradingGroup[]> {
    return await db.select().from(copyTradingGroups).where(eq(copyTradingGroups.status, "active"));
  }

  async getCopyFollowers(groupId: number): Promise<CopyTradingFollower[]> {
    return await db.select().from(copyTradingFollowers).where(eq(copyTradingFollowers.groupId, groupId));
  }

  async getCopyFollower(id: number): Promise<CopyTradingFollower | undefined> {
    const [f] = await db.select().from(copyTradingFollowers).where(eq(copyTradingFollowers.id, id));
    return f;
  }

  async createCopyFollower(follower: InsertCopyTradingFollower): Promise<CopyTradingFollower> {
    const [created] = await db.insert(copyTradingFollowers).values(follower).returning();
    return created;
  }

  async updateCopyFollower(id: number, data: Partial<InsertCopyTradingFollower>): Promise<CopyTradingFollower | undefined> {
    const [updated] = await db.update(copyTradingFollowers).set(data).where(eq(copyTradingFollowers.id, id)).returning();
    return updated;
  }

  async deleteCopyFollower(id: number): Promise<boolean> {
    const result = await db.delete(copyTradingFollowers).where(eq(copyTradingFollowers.id, id)).returning();
    return result.length > 0;
  }

  async getCopyOrders(groupId: number, limit: number = 50, offset: number = 0): Promise<CopyTradingOrder[]> {
    return await db.select().from(copyTradingOrders).where(eq(copyTradingOrders.groupId, groupId)).orderBy(desc(copyTradingOrders.createdAt)).limit(limit).offset(offset);
  }

  async createCopyOrder(order: InsertCopyTradingOrder): Promise<CopyTradingOrder> {
    const [created] = await db.insert(copyTradingOrders).values(order).returning();
    return created;
  }

  async updateCopyOrder(id: number, data: Partial<InsertCopyTradingOrder>): Promise<CopyTradingOrder | undefined> {
    const [updated] = await db.update(copyTradingOrders).set(data).where(eq(copyTradingOrders.id, id)).returning();
    return updated;
  }

  async getCopyOrderCount(groupId: number): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(copyTradingOrders).where(eq(copyTradingOrders.groupId, groupId));
    return Number(result?.count || 0);
  }

  async findRecentDuplicateOrder(groupId: number, followerAccountId: number, symbol: string, side: string, windowMs: number): Promise<CopyTradingOrder | undefined> {
    const windowStart = new Date(Date.now() - windowMs);
    const [found] = await db.select().from(copyTradingOrders)
      .where(
        and(
          eq(copyTradingOrders.groupId, groupId),
          eq(copyTradingOrders.followerAccountId, followerAccountId),
          eq(copyTradingOrders.symbol, symbol),
          eq(copyTradingOrders.side, side),
          gte(copyTradingOrders.createdAt, windowStart),
          inArray(copyTradingOrders.status, ["pending", "sent", "filled"])
        )
      )
      .orderBy(desc(copyTradingOrders.createdAt))
      .limit(1);
    return found;
  }

  async getCopyGroupByWebhookToken(token: string): Promise<CopyTradingGroup | undefined> {
    const [g] = await db.select().from(copyTradingGroups).where(eq(copyTradingGroups.webhookToken, token));
    return g;
  }

  async getRecentFilledOrders(groupId: number, limit: number = 50): Promise<CopyTradingOrder[]> {
    return await db.select().from(copyTradingOrders)
      .where(and(eq(copyTradingOrders.groupId, groupId), eq(copyTradingOrders.status, "filled")))
      .orderBy(desc(copyTradingOrders.createdAt))
      .limit(limit);
  }

  async getSlippageStats(groupId: number): Promise<{ symbol: string; avgSlippageTicks: number; avgSlippageDollars: number; count: number }[]> {
    const result = await db.select({
      symbol: copyTradingOrders.symbol,
      avgSlippageTicks: sql<number>`COALESCE(AVG(${copyTradingOrders.slippageTicks}), 0)`,
      avgSlippageDollars: sql<number>`COALESCE(AVG(${copyTradingOrders.slippageDollars}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
      .from(copyTradingOrders)
      .where(and(
        eq(copyTradingOrders.groupId, groupId),
        eq(copyTradingOrders.status, "filled"),
        sql`${copyTradingOrders.slippageTicks} IS NOT NULL`
      ))
      .groupBy(copyTradingOrders.symbol);
    return result.map(r => ({
      symbol: r.symbol,
      avgSlippageTicks: Number(r.avgSlippageTicks),
      avgSlippageDollars: Number(r.avgSlippageDollars),
      count: Number(r.count),
    }));
  }

  async getSignalMappings(source?: string): Promise<SignalMapping[]> {
    if (source) {
      return db.select().from(signalMappings).where(eq(signalMappings.source, source)).orderBy(signalMappings.externalSymbol);
    }
    return db.select().from(signalMappings).orderBy(signalMappings.source, signalMappings.externalSymbol);
  }

  async getSignalMapping(source: string, externalSymbol: string): Promise<SignalMapping | undefined> {
    const [found] = await db.select().from(signalMappings)
      .where(and(
        eq(signalMappings.source, source),
        eq(signalMappings.externalSymbol, externalSymbol),
        eq(signalMappings.active, true),
      ))
      .limit(1);
    return found;
  }

  async createSignalMapping(mapping: InsertSignalMapping): Promise<SignalMapping> {
    const [created] = await db.insert(signalMappings).values(mapping).returning();
    return created;
  }

  async updateSignalMapping(id: number, data: Partial<InsertSignalMapping>): Promise<SignalMapping | undefined> {
    const [updated] = await db.update(signalMappings).set({ ...data, updatedAt: new Date() }).where(eq(signalMappings.id, id)).returning();
    return updated;
  }

  async deleteSignalMapping(id: number): Promise<boolean> {
    const [deleted] = await db.delete(signalMappings).where(eq(signalMappings.id, id)).returning();
    return !!deleted;
  }

  async insertProcessedSignalAtomic(signal: InsertProcessedSignal): Promise<{ inserted: boolean; signal: ProcessedSignal }> {
    const [result] = await db.insert(processedSignals)
      .values(signal)
      .onConflictDoNothing({ target: processedSignals.signalHash })
      .returning();
    if (result) {
      return { inserted: true, signal: result };
    }
    const [existing] = await db.select().from(processedSignals)
      .where(eq(processedSignals.signalHash, signal.signalHash!))
      .limit(1);
    return { inserted: false, signal: existing };
  }

  async getProcessedSignals(limit: number = 50, offset: number = 0): Promise<ProcessedSignal[]> {
    return db.select().from(processedSignals)
      .orderBy(desc(processedSignals.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async updateProcessedSignal(id: number, data: Partial<InsertProcessedSignal>): Promise<ProcessedSignal | undefined> {
    const [updated] = await db.update(processedSignals).set(data).where(eq(processedSignals.id, id)).returning();
    return updated;
  }

  async getJournalEntries(userId: number, filters?: { accountId?: number; symbol?: string; tag?: string; dateFrom?: string; dateTo?: string }): Promise<JournalEntry[]> {
    const userIds = await this.getLinkedUserIds(userId);
    const conditions = [inArray(journalEntries.userId, userIds)];
    if (filters?.accountId) conditions.push(eq(journalEntries.accountId, filters.accountId));
    if (filters?.symbol) conditions.push(eq(journalEntries.symbol, filters.symbol));
    if (filters?.dateFrom) conditions.push(sql`COALESCE(${journalEntries.closedAt}, ${journalEntries.openedAt}) >= ${new Date(filters.dateFrom)}`);
    if (filters?.dateTo) {
      const endDate = new Date(filters.dateTo);
      endDate.setDate(endDate.getDate() + 1);
      conditions.push(sql`COALESCE(${journalEntries.closedAt}, ${journalEntries.openedAt}) < ${endDate}`);
    }
    let entries = await db.select().from(journalEntries)
      .where(and(...conditions))
      .orderBy(desc(sql`COALESCE(${journalEntries.closedAt}, ${journalEntries.openedAt})`));
    if (filters?.tag) {
      entries = entries.filter(e => e.tags?.includes(filters.tag!));
    }
    return entries;
  }

  async getJournalEntry(id: number): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    return entry;
  }

  async createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry> {
    const [created] = await db.insert(journalEntries).values(entry).returning();
    return created;
  }

  async updateJournalEntry(id: number, data: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined> {
    const [updated] = await db.update(journalEntries).set({ ...data, updatedAt: new Date() }).where(eq(journalEntries.id, id)).returning();
    return updated;
  }

  async deleteJournalEntry(id: number): Promise<boolean> {
    await db.delete(journalPsychology).where(eq(journalPsychology.journalEntryId, id));
    const result = await db.delete(journalEntries).where(eq(journalEntries.id, id)).returning();
    return result.length > 0;
  }

  async getJournalPsychology(journalEntryId: number): Promise<JournalPsychology | undefined> {
    const [p] = await db.select().from(journalPsychology).where(eq(journalPsychology.journalEntryId, journalEntryId));
    return p;
  }

  async upsertJournalPsychology(data: InsertJournalPsychology): Promise<JournalPsychology> {
    const existing = await this.getJournalPsychology(data.journalEntryId);
    if (existing) {
      const [updated] = await db.update(journalPsychology).set(data).where(eq(journalPsychology.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(journalPsychology).values(data).returning();
    return created;
  }

  async getJournalDailySummaries(userId: number, dateFrom?: string, dateTo?: string): Promise<JournalDailySummary[]> {
    const userIds = await this.getLinkedUserIds(userId);
    const conditions = [inArray(journalDailySummary.userId, userIds)];
    if (dateFrom) conditions.push(gte(journalDailySummary.date, dateFrom));
    if (dateTo) conditions.push(sql`${journalDailySummary.date} <= ${dateTo}`);
    return await db.select().from(journalDailySummary).where(and(...conditions)).orderBy(desc(journalDailySummary.date));
  }

  async upsertJournalDailySummary(data: InsertJournalDailySummary): Promise<JournalDailySummary> {
    const [existing] = await db.select().from(journalDailySummary)
      .where(and(eq(journalDailySummary.userId, data.userId), eq(journalDailySummary.date, data.date)))
      .limit(1);
    if (existing) {
      const [updated] = await db.update(journalDailySummary).set(data).where(eq(journalDailySummary.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(journalDailySummary).values(data).returning();
    return created;
  }

  async getJournalAnalytics(userId: number, dateFrom?: string, dateTo?: string, accountId?: number) {
    const entries = await this.getJournalEntries(userId, { dateFrom, dateTo, accountId });
    const wins = entries.filter(e => (e.realizedPnl || 0) > 0);
    const losses = entries.filter(e => (e.realizedPnl || 0) < 0);
    const totalPnl = entries.reduce((s, e) => s + (e.realizedPnl || 0), 0);
    const grossWins = wins.reduce((s, e) => s + (e.realizedPnl || 0), 0);
    const grossLosses = Math.abs(losses.reduce((s, e) => s + (e.realizedPnl || 0), 0));

    const symbolMap = new Map<string, { count: number; pnl: number; wins: number }>();
    const tagMap = new Map<string, { count: number; pnl: number; wins: number }>();
    const weekdayMap = new Map<number, { count: number; pnl: number; wins: number }>();
    const dateMap = new Map<string, { pnl: number; trades: number }>();

    for (const e of entries) {
      const sym = e.symbol || "Unknown";
      const prev = symbolMap.get(sym) || { count: 0, pnl: 0, wins: 0 };
      prev.count++;
      prev.pnl += e.realizedPnl || 0;
      if ((e.realizedPnl || 0) > 0) prev.wins++;
      symbolMap.set(sym, prev);

      if (e.tags) {
        for (const tag of e.tags) {
          const tp = tagMap.get(tag) || { count: 0, pnl: 0, wins: 0 };
          tp.count++;
          tp.pnl += e.realizedPnl || 0;
          if ((e.realizedPnl || 0) > 0) tp.wins++;
          tagMap.set(tag, tp);
        }
      }

      const tradeDate = e.closedAt || e.openedAt;
      if (tradeDate) {
        const day = new Date(tradeDate).getDay();
        const wd = weekdayMap.get(day) || { count: 0, pnl: 0, wins: 0 };
        wd.count++;
        wd.pnl += e.realizedPnl || 0;
        if ((e.realizedPnl || 0) > 0) wd.wins++;
        weekdayMap.set(day, wd);

        const dateStr = new Date(tradeDate).toISOString().split("T")[0];
        const dd = dateMap.get(dateStr) || { pnl: 0, trades: 0 };
        dd.pnl += e.realizedPnl || 0;
        dd.trades++;
        dateMap.set(dateStr, dd);
      }
    }

    const sortedDates = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let runningEquity = 0;
    const equityCurve = sortedDates.map(([date, d]) => {
      runningEquity += d.pnl;
      return { date, equity: runningEquity };
    });

    const pnls = entries.map(e => e.realizedPnl || 0);

    return {
      totalTrades: entries.length,
      winners: wins.length,
      losers: losses.length,
      winRate: entries.length > 0 ? (wins.length / entries.length) * 100 : 0,
      totalPnl,
      avgWin: wins.length > 0 ? grossWins / wins.length : 0,
      avgLoss: losses.length > 0 ? grossLosses / losses.length : 0,
      profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
      bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
      worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
      bySymbol: [...symbolMap.entries()].map(([symbol, d]) => ({ symbol, count: d.count, pnl: d.pnl, winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0 })),
      byTag: [...tagMap.entries()].map(([tag, d]) => ({ tag, count: d.count, pnl: d.pnl, winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0 })),
      byWeekday: [...weekdayMap.entries()].map(([day, d]) => ({ day, count: d.count, pnl: d.pnl, winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0 })),
      equityCurve,
      calendarData: sortedDates.map(([date, d]) => ({ date, pnl: d.pnl, trades: d.trades })),
    };
  }

  async getJournalPsychologyAnalytics(userId: number) {
    const entries = await this.getJournalEntries(userId);
    const psychMap = new Map<number, JournalPsychology>();
    for (const e of entries) {
      const p = await this.getJournalPsychology(e.id);
      if (p) psychMap.set(e.id, p);
    }

    const moodPnl = new Map<string, { total: number; count: number }>();
    const confWin = new Map<number, { wins: number; count: number }>();
    const lessons: { lesson: string; date: Date | null; pnl: number | null }[] = [];

    for (const e of entries) {
      const p = psychMap.get(e.id);
      if (!p) continue;

      if (p.moodBefore) {
        const m = moodPnl.get(p.moodBefore) || { total: 0, count: 0 };
        m.total += e.realizedPnl || 0;
        m.count++;
        moodPnl.set(p.moodBefore, m);
      }

      if (p.confidence) {
        const c = confWin.get(p.confidence) || { wins: 0, count: 0 };
        c.count++;
        if ((e.realizedPnl || 0) > 0) c.wins++;
        confWin.set(p.confidence, c);
      }

      if (p.lessonsLearned) {
        lessons.push({ lesson: p.lessonsLearned, date: e.closedAt, pnl: e.realizedPnl });
      }
    }

    return {
      moodVsPnl: [...moodPnl.entries()].map(([mood, d]) => ({ mood, avgPnl: d.count > 0 ? d.total / d.count : 0, count: d.count })),
      confidenceVsWinRate: [...confWin.entries()].map(([confidence, d]) => ({ confidence, winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0, count: d.count })),
      recentLessons: lessons.slice(0, 20),
    };
  }

  async getSharedReports(userId: number): Promise<SharedReport[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(sharedReports).where(inArray(sharedReports.userId, userIds)).orderBy(desc(sharedReports.createdAt));
  }

  async getSharedReportByToken(token: string): Promise<SharedReport | undefined> {
    const [report] = await db.select().from(sharedReports).where(eq(sharedReports.shareToken, token));
    return report;
  }

  async createSharedReport(report: InsertSharedReport): Promise<SharedReport> {
    const [created] = await db.insert(sharedReports).values(report).returning();
    return created;
  }

  async updateSharedReport(id: number, data: Partial<InsertSharedReport>): Promise<SharedReport | undefined> {
    const [updated] = await db.update(sharedReports).set(data).where(eq(sharedReports.id, id)).returning();
    return updated;
  }

  async deleteSharedReport(id: number): Promise<boolean> {
    const result = await db.delete(sharedReports).where(eq(sharedReports.id, id)).returning();
    return result.length > 0;
  }

  async incrementReportViewCount(id: number): Promise<void> {
    await db.update(sharedReports).set({ viewCount: sql`${sharedReports.viewCount} + 1` }).where(eq(sharedReports.id, id));
  }

  async getTradingGoals(userId: number): Promise<TradingGoal | undefined> {
    const userIds = await this.getLinkedUserIds(userId);
    const rows = await db.select().from(tradingGoals).where(inArray(tradingGoals.userId, userIds));
    if (rows.length === 0) return undefined;
    return rows.find(r => r.userId === userId) || rows.sort((a, b) => a.userId - b.userId)[0];
  }

  async upsertTradingGoals(data: InsertTradingGoal): Promise<TradingGoal> {
    const existing = await this.getTradingGoals(data.userId);
    if (existing) {
      const [updated] = await db.update(tradingGoals).set({
        monthlyPnlTarget: data.monthlyPnlTarget,
        yearlyPnlTarget: data.yearlyPnlTarget,
        updatedAt: new Date(),
      }).where(eq(tradingGoals.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(tradingGoals).values(data).returning();
    return created;
  }

  async getReferralCode(userId: number): Promise<ReferralCode | undefined> {
    const [code] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId));
    return code;
  }

  async getReferralCodeByCode(code: string): Promise<ReferralCode | undefined> {
    const [result] = await db.select().from(referralCodes).where(eq(referralCodes.code, code));
    return result;
  }

  async createReferralCode(data: InsertReferralCode): Promise<ReferralCode> {
    const [created] = await db.insert(referralCodes).values(data).returning();
    return created;
  }

  async getReferralsByReferrer(userId: number): Promise<Referral[]> {
    return await db.select().from(referrals).where(eq(referrals.referrerUserId, userId)).orderBy(desc(referrals.createdAt));
  }

  async getReferralByReferred(userId: number): Promise<Referral | undefined> {
    const [result] = await db.select().from(referrals).where(eq(referrals.referredUserId, userId));
    return result;
  }

  async createReferral(data: InsertReferral): Promise<Referral> {
    const [created] = await db.insert(referrals).values(data).returning();
    return created;
  }

  async updateReferral(id: number, data: Partial<InsertReferral>): Promise<Referral | undefined> {
    const [updated] = await db.update(referrals).set(data).where(eq(referrals.id, id)).returning();
    return updated;
  }

  async getAllReferrals(): Promise<Referral[]> {
    return await db.select().from(referrals).orderBy(desc(referrals.createdAt));
  }

  async getAllReferralCodes(): Promise<ReferralCode[]> {
    return await db.select().from(referralCodes);
  }

  async getJournalAlerts(userId: number): Promise<JournalAlert[]> {
    const userIds = await this.getLinkedUserIds(userId);
    return await db.select().from(journalAlerts).where(inArray(journalAlerts.userId, userIds)).orderBy(desc(journalAlerts.createdAt));
  }

  async createJournalAlert(alert: InsertJournalAlert): Promise<JournalAlert> {
    const [created] = await db.insert(journalAlerts).values(alert).returning();
    return created;
  }

  async markJournalAlertRead(id: number): Promise<JournalAlert | undefined> {
    const [updated] = await db.update(journalAlerts).set({ isRead: true }).where(eq(journalAlerts.id, id)).returning();
    return updated;
  }

  async markAllJournalAlertsRead(userId: number): Promise<void> {
    const userIds = await this.getLinkedUserIds(userId);
    await db.update(journalAlerts).set({ isRead: true }).where(and(inArray(journalAlerts.userId, userIds), eq(journalAlerts.isRead, false)));
  }

  async getJournalAlertSettings(userId: number): Promise<JournalAlertSettings | undefined> {
    const userIds = await this.getLinkedUserIds(userId);
    const rows = await db.select().from(journalAlertSettings).where(inArray(journalAlertSettings.userId, userIds));
    if (rows.length === 0) return undefined;
    return rows.find(r => r.userId === userId) || rows.sort((a, b) => a.userId - b.userId)[0];
  }

  async upsertJournalAlertSettings(data: InsertJournalAlertSettings): Promise<JournalAlertSettings> {
    const existing = await this.getJournalAlertSettings(data.userId);
    if (existing) {
      const [updated] = await db.update(journalAlertSettings).set({ ...data, updatedAt: new Date() }).where(eq(journalAlertSettings.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(journalAlertSettings).values(data).returning();
    return created;
  }

  async createSecurityEvent(event: InsertSecurityEvent): Promise<SecurityEvent> {
    const [created] = await db.insert(securityEvents).values(event).returning();
    return created;
  }

  async getSecurityEvents(filters?: { severity?: string; eventType?: string; limit?: number; offset?: number }): Promise<SecurityEvent[]> {
    const conditions = [];
    if (filters?.severity) conditions.push(eq(securityEvents.severity, filters.severity));
    if (filters?.eventType) conditions.push(eq(securityEvents.eventType, filters.eventType));

    const query = db.select().from(securityEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(securityEvents.createdAt))
      .limit(filters?.limit || 100)
      .offset(filters?.offset || 0);

    return await query;
  }

  async getSecurityEventCount(filters?: { severity?: string; eventType?: string }): Promise<number> {
    const conditions = [];
    if (filters?.severity) conditions.push(eq(securityEvents.severity, filters.severity));
    if (filters?.eventType) conditions.push(eq(securityEvents.eventType, filters.eventType));

    const [result] = await db.select({ count: sql<number>`count(*)` }).from(securityEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return Number(result.count);
  }

  async deleteOldSecurityEvents(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await db.delete(securityEvents).where(sql`${securityEvents.createdAt} < ${cutoff}`).returning();
    return result.length;
  }

  async createEquityTick(tick: InsertEquityTick): Promise<EquityTick> {
    const [created] = await db.insert(equityTicks).values(tick).returning();
    return created;
  }

  async getEquityTicks(accountId: number, from?: Date, to?: Date, limit?: number): Promise<EquityTick[]> {
    const conditions = [eq(equityTicks.accountId, accountId)];
    if (from) conditions.push(gte(equityTicks.timestamp, from));
    if (to) conditions.push(sql`${equityTicks.timestamp} <= ${to}`);
    return await db.select().from(equityTicks)
      .where(and(...conditions))
      .orderBy(equityTicks.timestamp)
      .limit(limit || 10000);
  }

  async getLatestEquityTick(accountId: number): Promise<EquityTick | undefined> {
    const [tick] = await db.select().from(equityTicks)
      .where(eq(equityTicks.accountId, accountId))
      .orderBy(desc(equityTicks.timestamp))
      .limit(1);
    return tick;
  }

  async getEquityTickCount(accountId: number): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(equityTicks)
      .where(eq(equityTicks.accountId, accountId));
    return Number(result.count);
  }

  async deleteOldEquityTicks(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await db.delete(equityTicks).where(sql`${equityTicks.timestamp} < ${cutoff}`).returning();
    return result.length;
  }

  async getEquityTicksByUser(userId: number, from?: Date, to?: Date): Promise<EquityTick[]> {
    const userIds = await this.getLinkedUserIds(userId);
    const conditions = [inArray(equityTicks.userId, userIds)];
    if (from) conditions.push(gte(equityTicks.timestamp, from));
    if (to) conditions.push(sql`${equityTicks.timestamp} <= ${to}`);
    return await db.select().from(equityTicks)
      .where(and(...conditions))
      .orderBy(equityTicks.timestamp)
      .limit(50000);
  }

  async createRiskIntervention(intervention: InsertRiskIntervention): Promise<RiskIntervention> {
    const [created] = await db.insert(riskInterventions).values(intervention).returning();
    return created;
  }

  async updateRiskIntervention(id: number, data: Partial<InsertRiskIntervention>): Promise<RiskIntervention | undefined> {
    const [updated] = await db.update(riskInterventions).set(data).where(eq(riskInterventions.id, id)).returning();
    return updated;
  }

  async getRiskInterventions(accountId: number, limit = 50): Promise<RiskIntervention[]> {
    return await db.select().from(riskInterventions)
      .where(eq(riskInterventions.accountId, accountId))
      .orderBy(desc(riskInterventions.triggerTimestamp))
      .limit(limit);
  }

  async getLinkedUserIds(userId: number): Promise<number[]> {
    const allRows = await db.select().from(linkedUsers);
    if (allRows.length === 0) return [userId];

    const adjacency = new Map<number, Set<number>>();
    for (const r of allRows) {
      if (!adjacency.has(r.primaryUserId)) adjacency.set(r.primaryUserId, new Set());
      if (!adjacency.has(r.linkedUserId)) adjacency.set(r.linkedUserId, new Set());
      adjacency.get(r.primaryUserId)!.add(r.linkedUserId);
      adjacency.get(r.linkedUserId)!.add(r.primaryUserId);
    }

    if (!adjacency.has(userId)) return [userId];

    const visited = new Set<number>();
    const queue = [userId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) queue.push(n);
        }
      }
    }
    return Array.from(visited);
  }

  async getLinkedUsers(): Promise<LinkedUser[]> {
    return await db.select().from(linkedUsers).orderBy(desc(linkedUsers.createdAt));
  }

  async createLinkedUser(data: InsertLinkedUser): Promise<LinkedUser> {
    const [created] = await db.insert(linkedUsers).values(data).returning();
    return created;
  }

  async deleteLinkedUser(id: number): Promise<boolean> {
    const result = await db.delete(linkedUsers).where(eq(linkedUsers.id, id)).returning();
    return result.length > 0;
  }

  async getPlaybooks(userId: number): Promise<Playbook[]> {
    return await db.select().from(playbooks).where(eq(playbooks.userId, userId)).orderBy(desc(playbooks.createdAt));
  }

  async getPlaybook(id: number): Promise<Playbook | undefined> {
    const [pb] = await db.select().from(playbooks).where(eq(playbooks.id, id));
    return pb;
  }

  async createPlaybook(data: InsertPlaybook): Promise<Playbook> {
    const [created] = await db.insert(playbooks).values(data).returning();
    return created;
  }

  async updatePlaybook(id: number, data: Partial<InsertPlaybook>): Promise<Playbook | undefined> {
    const [updated] = await db.update(playbooks).set({ ...data, updatedAt: new Date() }).where(eq(playbooks.id, id)).returning();
    return updated;
  }

  async deletePlaybook(id: number): Promise<boolean> {
    const result = await db.delete(playbooks).where(eq(playbooks.id, id)).returning();
    return result.length > 0;
  }

  async getTradeTags(userId: number): Promise<TradeTag[]> {
    return await db.select().from(tradeTags).where(eq(tradeTags.userId, userId)).orderBy(desc(tradeTags.createdAt));
  }

  async getTradeTag(id: number): Promise<TradeTag | undefined> {
    const [tag] = await db.select().from(tradeTags).where(eq(tradeTags.id, id));
    return tag;
  }

  async createTradeTag(data: InsertTradeTag): Promise<TradeTag> {
    const [created] = await db.insert(tradeTags).values(data).returning();
    return created;
  }

  async updateTradeTag(id: number, data: Partial<InsertTradeTag>): Promise<TradeTag | undefined> {
    const [updated] = await db.update(tradeTags).set(data).where(eq(tradeTags.id, id)).returning();
    return updated;
  }

  async deleteTradeTag(id: number): Promise<boolean> {
    const result = await db.delete(tradeTags).where(eq(tradeTags.id, id)).returning();
    return result.length > 0;
  }

  async getTradeScreenshots(journalEntryId: number): Promise<TradeScreenshot[]> {
    return await db.select().from(tradeScreenshots).where(eq(tradeScreenshots.journalEntryId, journalEntryId)).orderBy(desc(tradeScreenshots.createdAt));
  }

  async createTradeScreenshot(data: InsertTradeScreenshot): Promise<TradeScreenshot> {
    const [created] = await db.insert(tradeScreenshots).values(data).returning();
    return created;
  }

  async deleteTradeScreenshot(id: number): Promise<boolean> {
    const result = await db.delete(tradeScreenshots).where(eq(tradeScreenshots.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
