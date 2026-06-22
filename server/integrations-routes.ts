import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { insertIntegrationConnectionSchema } from "@shared/integrations-schema";
import type { InsertAccount } from "@shared/schema";
import { discoverTradovateAccounts, getTradovateOAuthUrl, tradovateOAuthExchange, discoverTradovateAccountsWithToken, tradovateAuth, tradovateGetTrades } from "./tradovate-client";
import { discoverTopstepXAccounts, topstepxAuthExport, topstepxGetTrades } from "./topstepx-client";
import { z } from "zod";
import { requirePlanFeature, checkAccountLimit } from "./billing-routes";
import { isAccountSyncEligible, recalculateAccountStatus } from "./rule-engine";
import { encrypt, decryptCredentials } from "./encryption";
import { determineAccountTier, classifyAccountType, resolveStartingBalance } from "./account-tier";
import { safeErrorResponse } from "./sanitize";
import { logSecurityEvent, getClientIp } from "./security-events";
import { pushSystemError } from "./system-health-stream";
import { onAccountSynced, onAccountRemoved, onConnectionRemoved } from "./data-pipeline-autoconnect";
import { processEquityTick, backfillEquityTicksFromTrades } from "./equity-tick-processor";
import { isLinkedUser } from "./linked-users";

const oauthPendingStates = new Map<string, { userId: number; environment: "demo" | "live"; expiresAt: number }>();

function formatAccountDisplayName(rawName: string): string {
  const parts = rawName.split("-");
  if (parts.length < 2) return rawName;
  const sizeMatch = rawName.match(/^(\d+K)/i);
  const lastPart = parts[parts.length - 1];
  if (sizeMatch && lastPart && /^\d+$/.test(lastPart)) {
    return `${sizeMatch[1]} · ${lastPart}`;
  }
  return rawName;
}

const tradovateConnectSchema = z.object({
  username: z.string().min(1, "שם משתמש נדרש"),
  password: z.string().min(1, "סיסמה נדרשת"),
  cid: z.string().min(1, "Client ID נדרש").regex(/^\d+$/, "Client ID חייב להיות מספר"),
  secret: z.string().min(1, "Client Secret נדרש"),
  environment: z.enum(["demo", "live"]).default("demo"),
});

const topstepxConnectSchema = z.object({
  username: z.string().min(1, "שם משתמש נדרש"),
  apiKey: z.string().min(1, "API Key נדרש"),
});

const syncSchema = z.object({
  jobType: z.enum(["full_sync", "incremental_sync", "accounts_only"]).optional().default("full_sync"),
});

const linkAccountSchema = z.object({
  internalAccountId: z.number({ required_error: "חסר מזהה חשבון" }),
  connectionId: z.number({ required_error: "חסר מזהה חיבור" }),
});

const autoCreateAccountsSchema = z.object({
  accounts: z.array(z.object({
    accountId: z.string(),
    name: z.string(),
    externalId: z.string(),
    balance: z.number(),
    realizedPnL: z.number().optional(),
    size: z.number(),
    active: z.boolean().optional(),
    firm: z.string().optional(),
    tier: z.string().nullable().optional(),
    stage: z.string().optional(),
    target: z.number().nullable().optional(),
    maxDrawdown: z.number().nullable().optional(),
    drawdownType: z.string().optional(),
    trailingDrawdown: z.number().nullable().optional(),
    consistencyRule: z.number().nullable().optional(),
    tradingDays: z.number().optional(),
    topDayProfit: z.number().nullable().optional(),
  })).min(1, "חשבונות נדרשים"),
});

export function registerIntegrationRoutes(app: Express) {
  const planGate = requirePlanFeature("integrations");

  app.get("/api/v1/integrations/providers", planGate, async (_req, res) => {
    const providers = await storage.getProviders();
    res.json(providers);
  });

  app.get("/api/v1/integrations/connections", planGate, async (req, res) => {
    const userId = req.session.userId!;
    const connections = await storage.getConnections(userId);
    const providers = await storage.getProviders();
    const providersMap = Object.fromEntries(providers.map(p => [p.id, p]));
    const enriched = connections.map(c => {
      const { encryptedCredentials, encryptedRefreshToken, ...safe } = c;
      return { ...safe, provider: providersMap[c.providerId] || null };
    });
    res.json(enriched);
  });

  app.post("/api/v1/integrations/connections", planGate, async (req, res) => {
    const userId = req.session.userId!;

    const user = await storage.getUserById(userId);
    if (user?.role !== "admin") {
      const sub = await storage.getSubscription(userId);
      let plan: any;
      if (!sub) {
        plan = await storage.getPlanByKey("free");
      } else {
        const allPlans = await storage.getPlans();
        plan = allPlans.find(p => p.id === sub.planId);
      }
      if (plan) {
        const existingConns = await storage.getConnections(userId);
        const maxConns = plan.maxConnections || 0;
        if (existingConns.length >= maxConns) {
          const planOrder = ["free", "pro", "trader", "desk"];
          const currentIdx = planOrder.indexOf(plan.key);
          const nextPlan = currentIdx < planOrder.length - 1 ? planOrder[currentIdx + 1] : "desk";
          return res.status(403).json({
            code: "plan_limit",
            feature: "max_connections",
            requiredPlan: nextPlan,
            message: `Your plan allows ${maxConns} connections. Upgrade to add more.`,
          });
        }
      }
    }

    const data = { ...req.body, userId };
    const parsed = insertIntegrationConnectionSchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "נתונים לא תקינים", errors: parsed.error.flatten() });
    const connData = { ...parsed.data };
    if (connData.encryptedCredentials) {
      connData.encryptedCredentials = encrypt(connData.encryptedCredentials);
    }
    if (connData.encryptedRefreshToken) {
      connData.encryptedRefreshToken = encrypt(connData.encryptedRefreshToken);
    }
    const conn = await storage.createConnection(connData);
    logSecurityEvent("credential_access", "info", userId, getClientIp(req), { action: "connection_created", connectionId: conn.id, provider: req.body.providerId });
    res.status(201).json(conn);
  });

  app.post("/api/v1/integrations/connections/:id/test", planGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });

    const provider = await storage.getProvider(conn.providerId);
    const providerKey = provider?.key || "";

    try {
      let creds: Record<string, any> = {};
      try {
        creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
      } catch {
        await storage.updateConnection(id, { status: "error", lastErrorAt: new Date(), lastErrorMessage: "לא ניתן לפענח את פרטי ההתחברות. נא להתחבר מחדש." });
        return res.status(400).json({ success: false, message: "לא ניתן לפענח את פרטי ההתחברות. נא לנתק ולהתחבר מחדש." });
      }

      if (providerKey === "tradovate" && creds.username && creds.password) {
        await discoverTradovateAccounts(creds.username, creds.password, creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec);
      } else if (providerKey === "tradovate" && creds.accessToken) {
        await discoverTradovateAccountsWithToken(creds.accessToken, creds.environment === "live");
      } else if (providerKey === "topstepx" && creds.username && creds.apiKey) {
        await discoverTopstepXAccounts(creds.username, creds.apiKey);
      }

      await storage.updateConnection(id, { status: "connected", lastSuccessAt: new Date(), lastErrorMessage: null });
      res.json({ success: true, message: "חיבור תקין" });
    } catch (err: any) {
      await storage.updateConnection(id, { status: "error", lastErrorAt: new Date(), lastErrorMessage: err.message });
      safeErrorResponse(res, err, 400, "שגיאה בבדיקת חיבור");
    }
  });

  app.patch("/api/v1/integrations/connections/:id/mode", planGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });

    const { integrationMode } = req.body;
    if (!integrationMode || integrationMode !== "sync") {
      return res.status(400).json({ message: "אינטגרציות כלליות תומכות רק במצב סנכרון (sync). לביצוע פקודות מסחר, השתמש בחיבורי קופי טריידינג." });
    }

    await storage.updateConnection(id, { integrationMode });
    res.json({ success: true, integrationMode });
  });

  app.patch("/api/v1/integrations/connections/:id/settings", planGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });

    const { settings } = req.body;
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ message: "הגדרות לא תקינות" });
    }

    const currentSettings = (conn.settings as Record<string, any>) || {};
    const merged = { ...currentSettings, ...settings };
    await storage.updateConnection(id, { settings: merged } as any);
    logSecurityEvent("credential_access", "info", req.session.userId!, getClientIp(req), { action: "settings_updated", connectionId: id });
    res.json({ success: true, settings: merged });
  });

  app.post("/api/v1/integrations/connections/:id/sync", planGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });

    const parsed = syncSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים", errors: parsed.error.flatten() });

    const job = await storage.createSyncJob({
      connectionId: id,
      jobType: parsed.data.jobType,
      triggerType: "manual",
      status: "queued",
    });

    await storage.updateSyncJob(job.id, { status: "running", startedAt: new Date() });
    await storage.createSyncLog({ syncJobId: job.id, level: "info", message: "סנכרון התחיל" });

    const provider = await storage.getProvider(conn.providerId);
    const providerKey = provider?.key || "";

    (async () => {
      try {
        let discoveredAccounts: any[] = [];
        let creds: Record<string, any> = {};
        try {
          creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
        } catch {
          await storage.updateConnection(conn.id, { status: "error", lastErrorMessage: "לא ניתן לפענח את פרטי ההתחברות. נא לנתק ולהתחבר מחדש." });
          await storage.updateSyncJob(job.id, "failed");
          await storage.createSyncLog({ syncJobId: job.id, level: "error", message: "לא ניתן לפענח את פרטי ההתחברות" });
          return;
        }

        if (providerKey === "tradovate" && creds.username && creds.password) {
          try {
            const result = await discoverTradovateAccounts(creds.username, creds.password, creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec);
            discoveredAccounts = result.accounts;
            await storage.createSyncLog({ syncJobId: job.id, level: "info", message: `Tradovate: נמצאו ${discoveredAccounts.length} חשבונות תקינים` });
            if (result.skipped.length > 0) {
              await storage.createSyncLog({ syncJobId: job.id, level: "info", message: `Tradovate: ${result.skipped.length} חשבונות נדלגו (חריגה/לא פעילים)` });
            }
          } catch (authErr: any) {
            const isTokenExpired = authErr.message?.includes("expired") || authErr.message?.includes("Unauthorized") || authErr.message?.includes("401");
            if (isTokenExpired) {
              await storage.updateConnection(id, { status: "token_expired" });
              await storage.createSyncLog({ syncJobId: job.id, level: "error", message: `Tradovate: טוקן פג תוקף - יש לחדש את החיבור` });
            }
            throw authErr;
          }
        } else if (providerKey === "tradovate" && creds.accessToken) {
          try {
            const isLive = creds.environment === "live";
            const result = await discoverTradovateAccountsWithToken(creds.accessToken, isLive);
            discoveredAccounts = result.accounts;
            await storage.createSyncLog({ syncJobId: job.id, level: "info", message: `Tradovate (OAuth): נמצאו ${discoveredAccounts.length} חשבונות תקינים` });
            if (result.skipped.length > 0) {
              await storage.createSyncLog({ syncJobId: job.id, level: "info", message: `Tradovate (OAuth): ${result.skipped.length} חשבונות נדלגו` });
            }
          } catch (authErr: any) {
            const errMsg = authErr.message || "";
            const isAuthFailure = errMsg.includes("401") || errMsg.includes("Unauthorized") || errMsg.includes("expired") || errMsg.includes("Invalid token") || errMsg.includes("access denied");
            if (isAuthFailure) {
              await storage.updateConnection(id, { status: "token_expired" });
              await storage.createSyncLog({ syncJobId: job.id, level: "error", message: `Tradovate OAuth: טוקן פג תוקף - יש לחדש את החיבור דרך OAuth` });
              throw new Error("טוקן Tradovate OAuth פג תוקף. יש להתחבר מחדש דרך OAuth.");
            }
            await storage.createSyncLog({ syncJobId: job.id, level: "error", message: `Tradovate OAuth: שגיאת סנכרון זמנית - ${errMsg}` });
            throw authErr;
          }
        } else if (providerKey === "topstepx" && creds.username && creds.apiKey) {
          const result = await discoverTopstepXAccounts(creds.username, creds.apiKey);
          discoveredAccounts = result.accounts;
          await storage.createSyncLog({ syncJobId: job.id, level: "info", message: `TopstepX: נמצאו ${discoveredAccounts.length} חשבונות תקינים` });
          if (result.skipped.length > 0) {
            await storage.createSyncLog({ syncJobId: job.id, level: "info", message: `TopstepX: ${result.skipped.length} חשבונות נדלגו (חריגה/לא פעילים)` });
          }
        }

        let updatedCount = 0;
        let createdCount = 0;
        let skippedCount = 0;
        if (discoveredAccounts.length > 0) {
          const linkedAccounts = await storage.getAccountsByConnectionId(id);

          const connSettings = (conn.settings as Record<string, any>) || {};
          const excludedExternalIds = new Set<string>(connSettings.excludedExternalIds || []);

          let topstepxToken: string | null = null;
          if (providerKey === "topstepx" && creds.username && creds.apiKey) {
            try {
              const auth = await topstepxAuthExport(creds.username, creds.apiKey);
              topstepxToken = auth.token;
            } catch {}
          }

          const linkedExternalIds = new Set(linkedAccounts.map(a => a.externalAccountId).filter(Boolean));
          const linkedAccountIds = new Set(linkedAccounts.map(a => a.accountId));

          for (const disc of discoveredAccounts) {
            const extId = disc.externalId || String(disc.accountId);
            if (excludedExternalIds.has(extId)) {
              skippedCount++;
              await storage.createSyncLog({
                syncJobId: job.id,
                level: "info",
                message: `חשבון ${disc.name || extId} נדלג (נמחק ידנית בעבר)`,
              });
              continue;
            }
            if (!linkedExternalIds.has(extId) && !linkedAccountIds.has(disc.accountId)) {
              const firmName = disc.firm || provider?.name || "Unknown";
              const existingFirm = await storage.getFirmByName(firmName);
              if (!existingFirm) {
                await storage.createFirm({ name: firmName });
              }
              const newAccount = await storage.createAccount({
                accountId: disc.accountId,
                name: formatAccountDisplayName(disc.name || disc.accountId),
                firm: firmName,
                tier: disc.tier || null,
                stage: disc.stage || "evaluation_1",
                size: disc.size || 50000,
                balance: disc.balance || disc.size || 50000,
                target: disc.target || null,
                maxDrawdown: disc.maxDrawdown || null,
                drawdownType: disc.drawdownType || "static",
                trailingDrawdown: disc.trailingDrawdown || null,
                consistencyRule: disc.consistencyRule || null,
                tradingDays: disc.tradingDays || 0,
                topDayProfit: disc.topDayProfit || null,
                peakBalance: disc.balance || disc.size || 50000,
                status: "healthy",
                dataSource: "integration",
                integrationConnectionId: id,
                externalAccountId: extId,
                lastSyncAt: new Date(),
                userId: conn.userId,
              });
              createdCount++;
              linkedAccounts.push(newAccount);
              linkedExternalIds.add(extId);
              linkedAccountIds.add(disc.accountId);
              await storage.createSyncLog({
                syncJobId: job.id,
                level: "info",
                message: `חשבון חדש נוצר: ${newAccount.name} ($${(disc.balance || 0).toLocaleString()})`,
              });
            }
          }

          for (const linked of linkedAccounts) {
            if (!isAccountSyncEligible(linked)) {
              skippedCount++;
              continue;
            }
            const match = discoveredAccounts.find(
              (d: any) => d.externalId === linked.externalAccountId || d.accountId === linked.accountId
            );
            if (match) {
              const drawdownType = (linked as any).drawdownType || 'static';
              const trailingStopType = (linked as any).trailingStopType || 'intraday';

              const updateData: Record<string, any> = {
                balance: match.balance || linked.balance,
                lastSyncAt: new Date(),
              };

              if ((linked as any).startingBalance == null) {
                updateData.startingBalance = resolveStartingBalance(linked.name, linked.accountId, match.balance || linked.balance);
              }

              const detectedType = classifyAccountType(linked.name, linked.accountId);
              updateData.accountType = detectedType;

              if (match.stage && match.stage !== linked.stage) {
                updateData.stage = match.stage;
              }

              // LIVE override must run LAST so the broker-reported stage cannot clobber it.
              if (detectedType === "LIVE") {
                updateData.stage = "LIVE";
              }

              const rawData = match.raw || {};
              const changedFields: string[] = [];

              if (rawData.maxDrawdown && rawData.maxDrawdown !== linked.maxDrawdown) {
                updateData.maxDrawdown = rawData.maxDrawdown;
                changedFields.push(`maxDrawdown: ${linked.maxDrawdown} → ${rawData.maxDrawdown}`);
              }
              if (rawData.trailingDrawdown && rawData.trailingDrawdown !== (linked as any).trailingDrawdown) {
                updateData.trailingDrawdown = rawData.trailingDrawdown;
                changedFields.push(`trailingDrawdown: ${(linked as any).trailingDrawdown} → ${rawData.trailingDrawdown}`);
              }
              if (rawData.target && rawData.target !== linked.target) {
                updateData.target = rawData.target;
                changedFields.push(`target: ${linked.target} → ${rawData.target}`);
              }
              if (rawData.dailyLossLimit && rawData.dailyLossLimit !== (linked as any).dailyLossLimit) {
                updateData.dailyLossLimit = rawData.dailyLossLimit;
                changedFields.push(`dailyLossLimit: ${(linked as any).dailyLossLimit} → ${rawData.dailyLossLimit}`);
              }
              if (rawData.consistencyRule && rawData.consistencyRule !== linked.consistencyRule) {
                updateData.consistencyRule = rawData.consistencyRule;
                changedFields.push(`consistencyRule: ${linked.consistencyRule} → ${rawData.consistencyRule}`);
              }
              if (rawData.maxContracts && rawData.maxContracts !== (linked as any).maxContracts) {
                updateData.maxContracts = rawData.maxContracts;
                changedFields.push(`maxContracts: ${(linked as any).maxContracts} → ${rawData.maxContracts}`);
              }
              // Don't let the broker overwrite size for LIVE accounts — TopstepX Express
              // reports balance-as-size, which would shrink a 50K account to its current cash.
              if (match.size && match.size !== linked.size && match.size > 0 && detectedType !== "LIVE") {
                updateData.size = match.size;
                changedFields.push(`size: ${linked.size} → ${match.size}`);
              }

              if (changedFields.length > 0) {
                await storage.createSyncLog({
                  syncJobId: job.id,
                  level: "info",
                  message: `${linked.name}: עודכנו נתוני ברוקר — ${changedFields.join(", ")}`,
                });
              }

              if (match.brokerStatus !== undefined) {
                const prevBrokerStatus = (linked as any).brokerStatus;
                const prevBrokerActive = (linked as any).brokerActive;
                updateData.brokerStatus = match.brokerStatus;
                updateData.brokerActive = match.active;
                updateData.brokerStatusRaw = match.brokerStatusRaw;
                updateData.brokerStatusUpdatedAt = new Date();

                if (prevBrokerActive !== false && match.active === false) {
                  const closingBalance = match.balance ?? linked.balance;
                  const closingProfit = closingBalance - linked.size;
                  const closingTarget = (match.raw?.target ?? linked.target) || 0;
                  const passedEvaluation = closingTarget > 0 && closingProfit >= closingTarget;

                  if (passedEvaluation) {
                    await storage.createAlert({
                      accountId: linked.id,
                      type: "broker_status",
                      severity: "low",
                      title: `🎉 חשבון ${linked.name} עבר את ההערכה`,
                      message: `הברוקר סגר את חשבון ${linked.name} לאחר עמידה ביעד הרווח (רווח: $${closingProfit.toLocaleString()} מתוך $${closingTarget.toLocaleString()}). החשבון סומן כ-Passed.`,
                      userId: conn.userId,
                    });
                    await storage.createSyncLog({
                      syncJobId: job.id,
                      level: "info",
                      message: `✅ חשבון ${linked.name} סומן כ-Passed (יעד הושג, ברוקר סגר את החשבון)`,
                    });
                  } else {
                    await storage.createAlert({
                      accountId: linked.id,
                      type: "broker_status",
                      severity: "critical",
                      title: `חשבון ${linked.name} כובה על ידי הברוקר`,
                      message: `הברוקר דיווח שחשבון ${linked.name} כבר לא פעיל. סטטוס ברוקר: ${match.brokerStatus}. ייתכן שזו שבירת חוקים, בעיה טכנית, או סיום חשבון.`,
                      userId: conn.userId,
                    });
                    await storage.createSyncLog({
                      syncJobId: job.id,
                      level: "warning",
                      message: `⚠️ חשבון ${linked.name} סומן כ-inactive על ידי הברוקר (סטטוס: ${match.brokerStatus})`,
                    });
                  }
                } else if (prevBrokerActive === false && match.active === true) {
                  await storage.createAlert({
                    accountId: linked.id,
                    type: "broker_status",
                    severity: "low",
                    title: `חשבון ${linked.name} הופעל מחדש`,
                    message: `הברוקר דיווח שחשבון ${linked.name} חזר לפעילות. סטטוס: ${match.brokerStatus}.`,
                    userId: conn.userId,
                  });
                } else if (prevBrokerStatus && prevBrokerStatus !== match.brokerStatus && match.brokerStatus !== "active") {
                  await storage.createAlert({
                    accountId: linked.id,
                    type: "broker_status",
                    severity: "medium",
                    title: `שינוי סטטוס ברוקר: ${linked.name}`,
                    message: `סטטוס ברוקר השתנה מ-${prevBrokerStatus} ל-${match.brokerStatus}.`,
                    userId: conn.userId,
                  });
                }
              }

              if (drawdownType === 'trailing' && trailingStopType === 'eod') {
                const today = new Date().toISOString().slice(0, 10);
                const lastPeakDate = (linked as any).lastPeakUpdateDate || '';
                const isNewTradingDay = today !== lastPeakDate;
                if (isNewTradingDay) {
                  const currentPeak = linked.peakBalance || 0;
                  const previousDayClose = linked.balance;
                  updateData.peakBalance = Math.max(previousDayClose, currentPeak);
                  updateData.lastPeakUpdateDate = today;
                }
              } else {
                updateData.peakBalance = Math.max(match.balance || 0, linked.peakBalance || 0);
              }

              if (topstepxToken && linked.externalAccountId) {
                try {
                  console.log(`[Sync] Fetching trades for ${linked.name} (ext: ${linked.externalAccountId})`);
                  const apiTrades = await topstepxGetTrades(topstepxToken, parseInt(linked.externalAccountId));
                  console.log(`[Sync] Got ${apiTrades.length} trades for ${linked.name}`);
                  if (apiTrades.length > 0) {
                    const existingTrades = await storage.getTradesByAccount(linked.id);
                    const existingExternalIds = new Set(existingTrades.map(t => t.externalTradeId).filter(Boolean));
                    let newTradeCount = 0;
                    const tradingDaysSet = new Set<string>();
                    for (const t of apiTrades) {
                      const tExtId = String(t.id);
                      if (t.timestamp) {
                        const day = t.timestamp.split('T')[0] || t.timestamp.substring(0, 10);
                        if (day) tradingDaysSet.add(day);
                      }
                      if (!existingExternalIds.has(tExtId)) {
                        await storage.createTrade({
                          accountId: linked.id,
                          connectionId: id,
                          externalTradeId: tExtId,
                          symbol: t.symbol,
                          side: t.side,
                          quantity: t.quantity,
                          entryPrice: t.price,
                          exitPrice: null,
                          realizedPnl: t.pnl,
                          openedAt: t.timestamp ? new Date(t.timestamp) : null,
                          closedAt: t.exitTimestamp ? new Date(t.exitTimestamp) : null,
                          rawPayloadJson: null,
                        });
                        newTradeCount++;
                      }
                    }
                    if (tradingDaysSet.size > 0) {
                      updateData.tradingDays = tradingDaysSet.size;
                    }
                    if (newTradeCount > 0) {
                      await storage.createSyncLog({
                        syncJobId: job.id,
                        level: "info",
                        message: `${linked.name}: ${newTradeCount} עסקאות חדשות, ${tradingDaysSet.size} ימי מסחר`,
                      });
                    }
                  }
                } catch (tradeErr: any) {
                  console.log(`[Sync] Could not fetch trades for ${linked.name}: ${tradeErr.message}`);
                }
              }

              await storage.updateAccount(linked.id, updateData);

              try {
                await backfillEquityTicksFromTrades(linked.id);
              } catch (bfErr: any) {
                console.warn(`[Sync] Equity backfill failed for ${linked.name}: ${bfErr.message}`);
              }

              try {
                const tickEquity = match.balance || linked.balance;
                await processEquityTick(linked.id, tickEquity);
              } catch (tickErr: any) {
                console.warn(`[Sync] Equity tick processing failed for ${linked.name}: ${tickErr.message}`);
              }

              const newStatus = await recalculateAccountStatus(linked.id);
              if (newStatus === 'violated') {
                await storage.createSyncLog({
                  syncJobId: job.id,
                  level: "warn",
                  message: `חשבון ${linked.name} סומן כחריגה (שרוף) — לא יסונכרן יותר`,
                });
              }
              if (newStatus === 'sync_failed') {
                const balanceDiff = (match.balance || linked.balance) - linked.size;
                await storage.createSyncLog({
                  syncJobId: job.id,
                  level: "warn",
                  message: `חשבון ${linked.name} סומן כ-sync_failed: באלאנס ($${(match.balance || linked.balance).toLocaleString()}) שונה מגודל הקרן ($${linked.size.toLocaleString()}) בפער של $${Math.abs(balanceDiff).toLocaleString()}, אך אין עסקאות מיובאות`,
                });
              }

              updatedCount++;
              await storage.createSyncLog({
                syncJobId: job.id,
                level: "info",
                message: `עודכן באלאנס: ${linked.name} → $${(match.balance || 0).toLocaleString()}`,
              });
            }
          }
          if (skippedCount > 0) {
            await storage.createSyncLog({
              syncJobId: job.id,
              level: "info",
              message: `דילוג על ${skippedCount} חשבונות לא פעילים/שנשרפו`,
            });
          }
        }

        await storage.updateSyncJob(job.id, {
          status: "success",
          finishedAt: new Date(),
          recordsProcessed: updatedCount + createdCount,
        });
        await storage.createSyncLog({ syncJobId: job.id, level: "info", message: `סנכרון הושלם: ${createdCount} חשבונות נוצרו, ${updatedCount} עודכנו` });
        await storage.updateConnection(id, { status: "connected", lastSuccessAt: new Date() });
        onAccountSynced(id).catch(err => console.warn(`[Sync] Data pipeline auto-connect after sync failed:`, err.message));
      } catch (err: any) {
        console.error(`[Sync] Error for connection ${id}:`, err.message);
        await storage.updateSyncJob(job.id, { status: "error", finishedAt: new Date(), errorMessage: err.message });
        await storage.createSyncLog({ syncJobId: job.id, level: "error", message: `שגיאה: ${err.message}` });
        const currentConn = await storage.getConnection(id);
        if (currentConn?.status !== "token_expired") {
          await storage.updateConnection(id, { status: "error", lastErrorAt: new Date(), lastErrorMessage: err.message });
        }
      }
    })();

    res.json({ jobId: job.id, message: "סנכרון התחיל" });
  });

  app.post("/api/v1/integrations/connections/:id/reconnect", planGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });
    await storage.updateConnection(id, { status: "connected", lastSuccessAt: new Date(), lastErrorMessage: null });
    logSecurityEvent("credential_access", "info", req.session.userId!, getClientIp(req), { action: "connection_reconnected", connectionId: id });
    res.json({ success: true, message: "חיבור חודש בהצלחה" });
  });

  app.delete("/api/v1/integrations/connections/:id", planGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });
    logSecurityEvent("credential_access", "warning", req.session.userId!, getClientIp(req), { action: "connection_deleted", connectionId: id });
    await storage.deleteConnection(id);
    onConnectionRemoved(id);
    res.status(204).send();
  });

  app.get("/api/v1/integrations/connections/:id/accounts", planGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });
    const accs = await storage.getIntegrationAccounts(id);
    res.json(accs);
  });

  app.post("/api/v1/integrations/accounts/:externalId/link", planGate, async (req, res) => {
    const { externalId } = req.params;
    const parsed = linkAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים", errors: parsed.error.flatten() });
    const { internalAccountId, connectionId } = parsed.data;
    const conn = await storage.getConnection(connectionId);
    if (!conn || !await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });
    const updated = await storage.linkAccount(externalId, internalAccountId);
    if (!updated) return res.status(404).json({ message: "חשבון חיצוני לא נמצא" });
    res.json(updated);
  });

  app.post("/api/v1/integrations/accounts/:externalId/unlink", planGate, async (req, res) => {
    const { externalId } = req.params;
    const unlinkParsed = z.object({ connectionId: z.number({ required_error: "חסר מזהה חיבור" }) }).safeParse(req.body);
    if (!unlinkParsed.success) return res.status(400).json({ message: unlinkParsed.error.issues[0]?.message || "נתונים לא תקינים", errors: unlinkParsed.error.flatten() });
    const { connectionId } = unlinkParsed.data;
    const conn = await storage.getConnection(connectionId);
    if (!conn || !await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });
    const updated = await storage.unlinkAccount(externalId);
    if (!updated) return res.status(404).json({ message: "חשבון חיצוני לא נמצא" });
    res.json(updated);
  });

  app.get("/api/v1/integrations/sync-jobs", planGate, async (req, res) => {
    const connectionId = parseInt(req.query.connectionId as string);
    if (isNaN(connectionId)) return res.status(400).json({ message: "חסר מזהה חיבור" });
    const conn = await storage.getConnection(connectionId);
    if (!conn || !await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });
    const jobs = await storage.getSyncJobs(connectionId);
    res.json(jobs);
  });

  app.get("/api/v1/integrations/sync-jobs/:id", planGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const job = await storage.getSyncJob(id);
    if (!job) return res.status(404).json({ message: "עבודת סנכרון לא נמצאה" });
    const conn = await storage.getConnection(job.connectionId);
    if (!conn || !await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });
    res.json(job);
  });

  app.get("/api/v1/integrations/sync-logs", planGate, async (req, res) => {
    const jobId = parseInt(req.query.jobId as string);
    if (isNaN(jobId)) return res.status(400).json({ message: "חסר מזהה עבודה" });
    const job = await storage.getSyncJob(jobId);
    if (!job) return res.status(404).json({ message: "עבודה לא נמצאה" });
    const conn = await storage.getConnection(job.connectionId);
    if (!conn || !await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });
    const logs = await storage.getSyncLogs(jobId);
    res.json(logs);
  });

  app.post("/api/v1/integrations/validate-tradovate", planGate, async (req, res) => {
    try {
      const parsed = tradovateConnectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          valid: false,
          code: "validation_error",
          message: "נתונים לא תקינים - וודא שכל השדות מולאו כראוי",
        });
      }
      const { username, password, cid, secret, environment } = parsed.data;
      const cidNum = parseInt(cid, 10);
      if (isNaN(cidNum) || cidNum <= 0) {
        return res.status(400).json({
          success: false,
          valid: false,
          code: "invalid_cid",
          message: "Client ID חייב להיות מספר חיובי. מצא אותו בדף ה-API Access בחשבון Tradovate.",
        });
      }

      const auth = await tradovateAuth(username, password, cidNum, secret, environment);
      res.json({
        success: true,
        valid: true,
        userName: auth.name,
        environment: auth.isLive ? "live" : "demo",
        message: `אימות הצליח! מחובר כ-${auth.name} (${auth.isLive ? "Live" : "Demo"})`,
      });
    } catch (error: any) {
      console.error("[Tradovate] Validate error:", error.message);
            pushSystemError("warning", "tradovate", `Validate error: ${error.message}`);
      const msg = error.message || "";
      let errorMessage = "שגיאה באימות מול Tradovate";
      let code = "auth_failed";

      if (msg.includes("CID and SEC are required")) {
        errorMessage = "חסרים CID ו-Secret. לך ל-Settings > API Keys בחשבון Tradovate וצור מפתח חדש.";
        code = "missing_credentials";
      } else if (msg.includes("שגיאת Tradovate:")) {
        const detail = msg.replace("שגיאת Tradovate: ", "");
        errorMessage = `Tradovate דחתה את הבקשה: ${detail}. בדוק שם משתמש, סיסמה, Client ID ו-Secret.`;
        code = "tradovate_auth_rejected";
      } else if (msg.includes("לא הצלחנו להתחבר")) {
        errorMessage = "לא הצלחנו להתחבר ל-Tradovate. בדוק שם משתמש וסיסמה ונסה שוב.";
        code = "connection_failed";
      }

      res.status(401).json({ success: false, valid: false, code, message: errorMessage });
    }
  });

  app.post("/api/v1/integrations/connect-tradovate", planGate, async (req, res) => {
    try {
      const parsed = tradovateConnectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: "validation_error",
          message: parsed.error.issues[0]?.message || "Invalid input",
          errors: parsed.error.flatten(),
        });
      }
      const { username, password, cid, secret, environment } = parsed.data;

      const cidNum = parseInt(cid, 10);
      if (isNaN(cidNum) || cidNum <= 0) {
        return res.status(400).json({
          success: false,
          code: "invalid_cid",
          message: "Client ID חייב להיות מספר חיובי. מצא אותו בדף ה-API Access.",
        });
      }

      console.log(`[Tradovate] Connect attempt: fields={username: string(${username.length}), cid: ${cidNum}, secret: string(${secret.length}), env: "${environment}"}`);

      const result = await discoverTradovateAccounts(username, password, cidNum, secret, environment);

      res.json({
        success: true,
        userName: result.userName,
        accounts: result.accounts.map(a => ({
          accountId: a.accountId,
          name: a.name,
          externalId: a.externalId,
          balance: a.balance,
          realizedPnL: a.realizedPnL,
          size: a.size,
          active: a.active,
        })),
        skipped: result.skipped.map(a => ({
          accountId: a.accountId,
          name: a.name,
          externalId: a.externalId,
          reason: a.validation.skippedReason,
        })),
      });
    } catch (error: any) {
      console.error("[Tradovate] Connect error:", error.message);
            pushSystemError("error", "tradovate", `Connect error: ${error.message}`);
      const msg = error.message || "";
      if (msg.includes("CID and SEC are required")) {
        return res.status(400).json({ success: false, code: "missing_credentials", message: "חסרים CID ו-Secret. לך ל-Settings > API Keys בחשבון Tradovate וצור מפתח חדש." });
      }
      if (msg.startsWith("שגיאת Tradovate:")) {
        const detail = msg.replace("שגיאת Tradovate: ", "");
        return res.status(401).json({ success: false, code: "tradovate_auth_rejected", message: `Tradovate דחתה את הבקשה: ${detail}. בדוק את הפרטים ונסה שוב.` });
      }
      if (msg.includes("לא הצלחנו להתחבר")) {
        return res.status(401).json({ success: false, code: "connection_failed", message: "לא הצלחנו להתחבר ל-Tradovate. בדוק שם משתמש וסיסמה." });
      }
      safeErrorResponse(res, error, 400, "שגיאה בחיבור ל-Tradovate");
    }
  });

  app.get("/api/v1/integrations/tradovate/oauth/status", planGate, (req, res) => {
    const cid = parseInt(process.env.TRADOVATE_CID || "0");
    const sec = process.env.TRADOVATE_SEC || "";
    res.json({ configured: !!(cid && sec) });
  });

  app.get("/api/v1/integrations/tradovate/oauth/start", planGate, async (req, res) => {
    try {
      const cid = parseInt(process.env.TRADOVATE_CID || "0");
      const sec = process.env.TRADOVATE_SEC || "";
      if (!cid || !sec) {
        return res.redirect("/integrations?oauth_error=" + encodeURIComponent("Tradovate OAuth is not configured. Contact the administrator to set up TRADOVATE_CID and TRADOVATE_SEC."));
      }

      const userId = req.session.userId!;
      const environment = (req.query.environment as string) === "live" ? "live" : "demo";

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host || "";
      const redirectUri = `${protocol}://${host}/api/v1/integrations/tradovate/oauth/callback`;

      const nonce = crypto.randomBytes(32).toString("hex");
      oauthPendingStates.set(nonce, {
        userId,
        environment,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      const oauthUrl = getTradovateOAuthUrl(environment, redirectUri, nonce);

      console.log(`[Tradovate OAuth] Starting OAuth flow for user ${userId}, env=${environment}`);
      res.redirect(oauthUrl);
    } catch (error: any) {
      console.error("[Tradovate OAuth] Start error:", error.message);
            pushSystemError("error", "tradovate-oauth", `OAuth start error: ${error.message}`);
      res.redirect(`/integrations?oauth_error=${encodeURIComponent("שגיאה בהתחלת חיבור OAuth")}`);
    }
  });

  app.get("/api/v1/integrations/tradovate/oauth/callback", async (req, res) => {
    try {
      const code = req.query.code as string;
      const stateParam = req.query.state as string;
      const errorParam = req.query.error as string;

      if (errorParam) {
        console.error("[Tradovate OAuth] Error from Tradovate:", errorParam);
        return res.redirect(`/integrations?oauth_error=${encodeURIComponent(errorParam)}`);
      }

      if (!code || !stateParam) {
        return res.redirect("/integrations?oauth_error=missing_code");
      }

      const stateData = oauthPendingStates.get(stateParam);
      if (!stateData) {
        return res.redirect("/integrations?oauth_error=invalid_or_expired_state");
      }

      oauthPendingStates.delete(stateParam);

      if (Date.now() > stateData.expiresAt) {
        return res.redirect("/integrations?oauth_error=state_expired");
      }

      const { userId, environment } = stateData;

      const sessionUserId = req.session.userId;
      if (sessionUserId && sessionUserId !== userId) {
        return res.redirect("/integrations?oauth_error=session_mismatch");
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.redirect("/integrations?oauth_error=user_not_found");
      }

      const existingConnections = await storage.getConnectionsByUser(userId);
      const existingAccounts = await storage.getAccountsByUser(userId);
      const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const isAdmin = ADMIN_EMAILS.includes(user.email.toLowerCase());

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host || "";
      const redirectUri = `${protocol}://${host}/api/v1/integrations/tradovate/oauth/callback`;

      console.log(`[Tradovate OAuth] Exchanging code for token, env=${environment}, user=${userId}`);
      const auth = await tradovateOAuthExchange(code, redirectUri, environment);

      console.log(`[Tradovate OAuth] Discovering accounts for user ${auth.name}`);
      const discoverResult = await discoverTradovateAccountsWithToken(auth.token, auth.isLive);

      const providers = await storage.getProviders();
      const tradovateProvider = providers.find((p: any) => p.key === "tradovate");
      if (!tradovateProvider) throw new Error("Tradovate provider not found");

      const connName = `Tradovate (${environment === "live" ? "Live" : "Demo"}) - ${auth.name}`;
      const newConn = await storage.createConnection({
        userId,
        providerId: tradovateProvider.id,
        connectionName: connName,
        authType: "oauth",
        encryptedCredentials: encrypt(JSON.stringify({
          accessToken: auth.token,
          environment,
          oauthUserId: auth.userId,
          userName: auth.name,
        })),
        status: "connected",
      });

      const realAccounts = discoverResult.accounts.map((a: any) => ({
        accountId: a.accountId,
        name: a.name,
        firm: `Tradovate (${environment === "live" ? "Live" : "Demo"})`,
        stage: "evaluation_1" as const,
        size: a.size || Math.abs(a.balance) || 50000,
        balance: a.balance || 0,
        maxDrawdown: null,
        drawdownType: "trailing" as const,
        trailingDrawdown: null,
        target: null,
        externalId: a.externalId,
        tradingDays: 0,
        topDayProfit: null,
      }));

      let importedCount = 0;
      const maxAccounts = isAdmin ? Infinity : 50;
      const currentCount = existingAccounts.length;

      for (const accData of realAccounts) {
        if (!isAdmin && currentCount + importedCount >= maxAccounts) break;
        try {
          await storage.createAccount({
            ...accData,
            userId,
            connectionId: newConn.id,
          } as InsertAccount);
          importedCount++;
        } catch (err: any) {
          console.error(`[Tradovate OAuth] Failed to create account ${accData.accountId}:`, err.message);
        }
      }

      console.log(`[Tradovate OAuth] Imported ${importedCount} accounts for user ${userId}`);
      res.redirect(`/integrations?oauth_success=true&imported=${importedCount}&broker=Tradovate&env=${environment}`);
    } catch (error: any) {
      console.error("[Tradovate OAuth] Callback error:", error.message);
            pushSystemError("error", "tradovate-oauth", `OAuth callback error: ${error.message}`);
      res.redirect(`/integrations?oauth_error=${encodeURIComponent("שגיאה בחיבור OAuth")}`);
    }
  });

  app.post("/api/v1/integrations/connect-topstepx", planGate, async (req, res) => {
    try {
      const parsed = topstepxConnectSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים", errors: parsed.error.flatten() });
      const { username, apiKey } = parsed.data;

      const result = await discoverTopstepXAccounts(username, apiKey);

      res.json({
        success: true,
        userName: result.userName,
        accounts: result.accounts.map(a => ({
          accountId: a.accountId,
          name: a.name,
          externalId: a.externalId,
          balance: a.balance,
          realizedPnL: a.realizedPnL,
          size: a.size,
          active: a.active,
          target: a.raw?.target || null,
          maxDrawdown: a.raw?.maxDrawdown || null,
          trailingDrawdown: a.raw?.maxDrawdown || null,
          drawdownType: "trailing",
          consistencyRule: a.raw?.consistencyRule || 40,
          dailyLossLimit: a.raw?.dailyLossLimit || null,
          maxContracts: a.raw?.maxContracts || null,
        })),
        skipped: result.skipped.map(a => ({
          accountId: a.accountId,
          name: a.name,
          externalId: a.externalId,
          reason: a.validation.skippedReason,
        })),
      });
    } catch (error: any) {
      console.error("TopstepX connect error:", error.message);
            pushSystemError("warning", "topstepx", `Connect error: ${error.message}`);
      safeErrorResponse(res, error, 400, "שגיאה בחיבור ל-TopstepX");
    }
  });


  app.post("/api/v1/integrations/connections/:id/auto-create-accounts", planGate, async (req, res) => {
    const connectionId = parseInt(req.params.id);
    if (isNaN(connectionId)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getConnection(connectionId);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });

    const parsed = autoCreateAccountsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים", errors: parsed.error.flatten() });
    const { accounts: discoveredAccounts } = parsed.data;

    const user = await storage.getUserById(req.session.userId!);
    if (user?.role !== "admin") {
      const accountCheck = await checkAccountLimit(req.session.userId!);
      if (!accountCheck.allowed) {
        return res.status(403).json({
          code: "plan_limit",
          feature: "max_accounts",
          requiredPlan: accountCheck.requiredPlan || "pro",
          message: `Your plan allows ${accountCheck.maxAccounts} accounts. You currently have ${accountCheck.currentCount}.`,
        });
      }
      const remainingSlots = accountCheck.maxAccounts - accountCheck.currentCount;
      if (discoveredAccounts.length > remainingSlots) {
        return res.status(403).json({
          code: "plan_limit",
          feature: "max_accounts",
          requiredPlan: accountCheck.requiredPlan || "pro",
          message: `You can only add ${remainingSlots} more accounts. Upgrade to add more.`,
        });
      }
    }

    const provider = await storage.getProvider(conn.providerId);
    const platformName = provider?.name || "Unknown";

    const connSettings = (conn.settings as Record<string, any>) || {};
    const excludedExternalIds = new Set<string>(connSettings.excludedExternalIds || []);

    const firmName = discoveredAccounts[0]?.firm || platformName;
    const existingFirm = await storage.getFirmByName(firmName);
    if (!existingFirm) {
      await storage.createFirm({ name: firmName });
    }

    const createdAccounts = [];
    for (const disc of discoveredAccounts) {
      const extId = disc.externalId || String(disc.accountId);
      if (excludedExternalIds.has(extId)) {
        continue;
      }
      const accountData: InsertAccount = {
        accountId: disc.accountId,
        name: formatAccountDisplayName(disc.name || disc.accountId),
        firm: disc.firm || firmName,
        tier: disc.tier || null,
        stage: disc.stage || "evaluation_1",
        size: disc.size || 50000,
        balance: disc.balance || disc.size || 50000,
        target: disc.target || null,
        maxDrawdown: disc.maxDrawdown || null,
        drawdownType: disc.drawdownType || "static",
        trailingDrawdown: disc.trailingDrawdown || null,
        consistencyRule: disc.consistencyRule || null,
        tradingDays: disc.tradingDays || 0,
        topDayProfit: disc.topDayProfit || null,
        peakBalance: disc.balance || disc.size || 50000,
        status: "healthy",
        dataSource: "integration",
        integrationConnectionId: connectionId,
        externalAccountId: disc.externalId || String(disc.accountId),
        lastSyncAt: new Date(),
        userId: req.session.userId!,
      };

      const account = await storage.createAccount(accountData);
      await storage.createAuditEntry({
        action: "create",
        entityType: "account",
        entityId: account.id,
        userId: req.session.userId!,
        metadata: { source: "auto_integration", platform: platformName, connectionId },
      });
      createdAccounts.push(account);
    }

    onAccountSynced(connectionId).catch(err => console.warn(`[AutoCreate] Data pipeline auto-connect failed:`, err.message));
    res.status(201).json({ created: createdAccounts.length, accounts: createdAccounts });
  });

  app.post("/api/v1/integrations/connections/:id/fetch-trades", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
    const id = parseInt(req.params.id);
    const conn = await storage.getConnection(id);
    if (!conn || !await isLinkedUser(req.session.userId!, conn.userId)) return res.status(404).json({ error: "Connection not found" });

    const providers = await storage.getProviders();
    const provider = providers.find((p: any) => p.id === conn.providerId);
    const providerKey = provider?.key || "";

    try {
      let creds: Record<string, any> = {};
      try {
        creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
      } catch {
        await storage.updateConnection(id, { status: "error", lastErrorMessage: "לא ניתן לפענח את פרטי ההתחברות. נא לנתק ולהתחבר מחדש." });
        return res.status(400).json({ error: "לא ניתן לפענח את פרטי ההתחברות. נא לנתק ולהתחבר מחדש." });
      }

      let linkedAccounts = await storage.getAccounts(req.session.userId!);
      let linked = linkedAccounts.filter(a => a.integrationConnectionId === id);

      if (linked.length === 0) {
        console.log(`[TradesFetch] No linked accounts for connection ${id}, auto-discovering for ${providerKey}...`);
        let discovered: any[] = [];
        if (providerKey === "topstepx") {
          const result = await discoverTopstepXAccounts(creds.username, creds.apiKey);
          discovered = result.accounts.filter((a: any) => a.canTrade !== false);
        } else if (providerKey === "tradovate") {
          let result;
          if (creds.accessToken) {
            result = await discoverTradovateAccountsWithToken(creds.accessToken, creds.environment === "live");
          } else {
            result = await discoverTradovateAccounts(creds.username, creds.password, creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec, creds.environment);
          }
          discovered = result.accounts;
        }
        console.log(`[TradesFetch] Discovered ${discovered.length} valid accounts, creating...`);

        const connSettings = (conn.settings as Record<string, any>) || {};
        const excludedExternalIds = new Set<string>(connSettings.excludedExternalIds || []);

        const firmName = discovered[0]?.firm || provider?.name || providerKey;
        const existingFirm = await storage.getFirmByName(firmName);
        if (!existingFirm) {
          await storage.createFirm({ name: firmName });
        }

        for (const disc of discovered) {
          const extId = disc.externalId || String(disc.accountId);
          if (excludedExternalIds.has(extId)) {
            console.log(`[TradesFetch] Skipping excluded account ${extId}`);
            continue;
          }
          const newAccount = await storage.createAccount({
            accountId: disc.accountId,
            name: formatAccountDisplayName(disc.name || disc.accountId),
            firm: disc.firm || firmName,
            tier: disc.tier || null,
            stage: disc.stage || "evaluation_1",
            size: disc.size || 50000,
            balance: disc.balance || disc.size || 50000,
            target: disc.target || null,
            maxDrawdown: disc.maxDrawdown || null,
            drawdownType: disc.drawdownType || "static",
            trailingDrawdown: disc.trailingDrawdown || null,
            consistencyRule: disc.consistencyRule || null,
            tradingDays: disc.tradingDays || 0,
            topDayProfit: disc.topDayProfit || null,
            peakBalance: disc.balance || disc.size || 50000,
            status: "healthy",
            dataSource: "integration",
            integrationConnectionId: id,
            externalAccountId: extId,
            lastSyncAt: new Date(),
            userId: req.session.userId!,
          });
          linked.push(newAccount);
          console.log(`[TradesFetch] Created account: ${newAccount.name} (id: ${newAccount.id})`);
        }
      }

      const results: any[] = [];
      for (const account of linked) {
        if (!account.externalAccountId) continue;
        console.log(`[TradesFetch] Fetching trades for account ${account.name} (extId: ${account.externalAccountId}), provider: ${providerKey}`);

        let trades: { id: any; symbol: string; side: string; quantity: number; price: number; pnl: number; timestamp: string; exitTimestamp?: string }[] = [];

        if (providerKey === "topstepx") {
          const auth = await topstepxAuthExport(creds.username, creds.apiKey);
          trades = await topstepxGetTrades(auth.token, parseInt(account.externalAccountId));
        } else if (providerKey === "tradovate") {
          let token: string;
          let isLive: boolean;
          if (creds.accessToken) {
            token = creds.accessToken;
            isLive = creds.environment === "live";
          } else {
            const auth = await tradovateAuth(creds.username, creds.password, creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec, creds.environment);
            token = auth.token;
            isLive = auth.isLive;
          }
          trades = await tradovateGetTrades(token, parseInt(account.externalAccountId), isLive);
        } else {
          console.log(`[TradesFetch] Unknown provider: ${providerKey}, skipping`);
          continue;
        }

        console.log(`[TradesFetch] Got ${trades.length} trades for ${account.name}`);

        let newCount = 0;
        if (trades.length > 0) {
          const existingTrades = await storage.getTradesByAccount(account.id);
          const existingExternalIds = new Set(existingTrades.map(t => t.externalTradeId).filter(Boolean));
          const tradingDaysSet = new Set<string>();

          for (const t of trades) {
            const extTradeId = String(t.id);
            if (t.timestamp) {
              const day = typeof t.timestamp === 'string' ? t.timestamp.split('T')[0] : '';
              if (day) tradingDaysSet.add(day);
            }
            if (!existingExternalIds.has(extTradeId)) {
              await storage.createTrade({
                accountId: account.id,
                connectionId: id,
                externalTradeId: extTradeId,
                symbol: t.symbol,
                side: t.side,
                quantity: t.quantity,
                entryPrice: t.price,
                exitPrice: null,
                realizedPnl: t.pnl,
                openedAt: t.timestamp ? new Date(t.timestamp) : null,
                closedAt: t.exitTimestamp ? new Date(t.exitTimestamp) : null,
                rawPayloadJson: null,
              });
              newCount++;
            }
          }

          if (tradingDaysSet.size > 0) {
            await storage.updateAccount(account.id, { tradingDays: tradingDaysSet.size });
          }
        }

        if (newCount > 0) {
          try { await backfillEquityTicksFromTrades(account.id); } catch (e: any) {
            console.warn(`[TradesFetch] Backfill failed for ${account.name}: ${e.message}`);
          }
        }

        results.push({
          accountId: account.id,
          accountName: account.name,
          externalId: account.externalAccountId,
          tradesFromApi: trades.length,
          newTradesSaved: newCount,
          sampleTrade: trades[0] || null,
        });
      }

      res.json({ success: true, results });
    } catch (err: any) {
      console.error(`[TradesFetch] Error:`, err);
      safeErrorResponse(res, err, 500, "שגיאה בשליפת עסקאות");
    }
  });

  app.post("/api/v1/accounts/:accountId/fetch-trades", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
    const accountId = parseInt(req.params.accountId);
    const account = await storage.getAccount(accountId);
    if (!account || !await isLinkedUser(req.session.userId!, account.userId!)) return res.status(404).json({ error: "Account not found" });
    if (!account.integrationConnectionId || !account.externalAccountId) {
      return res.status(400).json({ error: "Account is not linked to an integration" });
    }

    const conn = await storage.getConnection(account.integrationConnectionId);
    if (!conn) return res.status(404).json({ error: "Connection not found" });

    const providers = await storage.getProviders();
    const provider = providers.find((p: any) => p.id === conn.providerId);
    const providerKey = provider?.key || "";

    try {
      let creds: Record<string, any> = {};
      try {
        creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
      } catch {
        return res.status(400).json({ error: "לא ניתן לפענח את פרטי ההתחברות. נא לנתק ולהתחבר מחדש." });
      }

      let trades: { id: any; symbol: string; side: string; quantity: number; price: number; pnl: number; timestamp: string; exitTimestamp?: string }[] = [];

      if (providerKey === "topstepx") {
        const auth = await topstepxAuthExport(creds.username, creds.apiKey);
        trades = await topstepxGetTrades(auth.token, parseInt(account.externalAccountId));
      } else if (providerKey === "tradovate") {
        let token: string;
        let isLive: boolean;
        if (creds.accessToken) {
          token = creds.accessToken;
          isLive = creds.environment === "live";
        } else {
          const auth = await tradovateAuth(creds.username, creds.password, creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec, creds.environment);
          token = auth.token;
          isLive = auth.isLive;
        }
        trades = await tradovateGetTrades(token, parseInt(account.externalAccountId), isLive);
      } else {
        return res.status(400).json({ error: `Unsupported provider: ${providerKey}` });
      }

      console.log(`[TradesFetch] Single account: ${account.name}, got ${trades.length} trades`);

      let newCount = 0;
      if (trades.length > 0) {
        const existingTrades = await storage.getTradesByAccount(account.id);
        const existingExternalIds = new Set(existingTrades.map(t => t.externalTradeId).filter(Boolean));
        const tradingDaysSet = new Set<string>();

        for (const t of trades) {
          const extTradeId = String(t.id);
          if (t.timestamp) {
            const day = typeof t.timestamp === 'string' ? t.timestamp.split('T')[0] : '';
            if (day) tradingDaysSet.add(day);
          }
          if (!existingExternalIds.has(extTradeId)) {
            await storage.createTrade({
              accountId: account.id,
              connectionId: account.integrationConnectionId!,
              externalTradeId: extTradeId,
              symbol: t.symbol,
              side: t.side,
              quantity: t.quantity,
              entryPrice: t.price,
              exitPrice: null,
              realizedPnl: t.pnl,
              openedAt: t.timestamp ? new Date(t.timestamp) : null,
              closedAt: t.exitTimestamp ? new Date(t.exitTimestamp) : null,
              rawPayloadJson: null,
            });
            newCount++;
          }
        }

        if (tradingDaysSet.size > 0) {
          await storage.updateAccount(account.id, { tradingDays: tradingDaysSet.size });
        }
      }

      if (newCount > 0) {
        try { await backfillEquityTicksFromTrades(account.id); } catch (e: any) {
          console.warn(`[TradesFetch] Backfill failed for ${account.name}: ${e.message}`);
        }
      }

      res.json({
        success: true,
        accountId: account.id,
        accountName: account.name,
        tradesFromApi: trades.length,
        newTradesSaved: newCount,
      });
    } catch (err: any) {
      console.error(`[TradesFetch] Single account error:`, err);
      safeErrorResponse(res, err, 500, "שגיאה בשליפת עסקאות לחשבון");
    }
  });
}
