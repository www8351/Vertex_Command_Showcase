import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { randomBytes } from "crypto";
import {
  getEngineStatus, restartGroupEngine, stopGroupEngine, isSupportedCopyProvider,
  flattenAllPositions, detectOrphanedTrades, recordHeartbeat, getLastHeartbeat,
  executeWebhookOrderForFollower, enrichWebhookRiskContext,
} from "./copy-trading-engine";
import { getDailyLossTotal, runRiskChecks, applyAdvancedSizing } from "./copy-trading-risk-engine";
import { getCopyExecutionMetrics } from "./latency-monitor";
import { requirePlanFeature } from "./billing-routes";
import { encryptCredentials, decryptCredentials } from "./encryption";
import { discoverTradovateAccounts, discoverTradovateAccountsWithToken } from "./tradovate-client";
import { discoverTopstepXAccounts } from "./topstepx-client";
import { safeErrorResponse } from "./sanitize";
import { db } from "./db";
import { accounts, BLOCKED_COPY_STATUSES } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { isLinkedUser } from "./linked-users";

const SUPPORTED_PROVIDERS = ["tradovate", "topstepx"];

const connectTradovateSchema = z.object({
  provider: z.literal("tradovate"),
  connectionName: z.string().min(1).optional(),
  username: z.string().min(1, "שם משתמש נדרש"),
  password: z.string().min(1, "סיסמה נדרשת"),
  cid: z.string().min(1, "Client ID נדרש"),
  secret: z.string().min(1, "Client Secret נדרש"),
  environment: z.enum(["demo", "live"]).default("demo"),
});

const connectTopstepxSchema = z.object({
  provider: z.literal("topstepx"),
  connectionName: z.string().min(1).optional(),
  username: z.string().min(1, "שם משתמש נדרש"),
  apiKey: z.string().min(1, "API Key נדרש"),
});

const createGroupSchema = z.object({
  name: z.string().min(1, "שם קבוצה נדרש"),
  masterAccountId: z.number({ required_error: "חשבון מאסטר נדרש" }),
  masterConnectionId: z.number().nullable().optional().default(null),
  pollIntervalMs: z.number().min(1000).max(60000).optional().default(5000),
  maxSlippagePercent: z.number().min(0).max(100).nullable().optional(),
  maxSlippageTicks: z.number().min(0).nullable().optional(),
  settingsJson: z.any().optional(),
  dailyLossLimit: z.number().min(0).nullable().optional(),
  restrictedSymbols: z.array(z.string()).nullable().optional(),
  newsEmbargoMinutes: z.number().min(0).nullable().optional(),
  newsEmbargoEvents: z.any().nullable().optional(),
  heartbeatTimeoutSec: z.number().min(0).nullable().optional(),
  defaultOrderType: z.enum(["Market", "Limit", "Stop", "StopLimit", "TrailingStop", "Bracket", "OCO", "OTO"]).optional().default("Market"),
  defaultTimeInForce: z.enum(["Day", "GTC", "GTD", "IOC", "FOK"]).optional().default("Day"),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["active", "paused"]).optional(),
  pollIntervalMs: z.number().min(1000).max(60000).optional(),
  maxSlippagePercent: z.number().min(0).max(100).nullable().optional(),
  maxSlippageTicks: z.number().min(0).nullable().optional(),
  settingsJson: z.any().optional(),
  dailyLossLimit: z.number().min(0).nullable().optional(),
  restrictedSymbols: z.array(z.string()).nullable().optional(),
  newsEmbargoMinutes: z.number().min(0).nullable().optional(),
  newsEmbargoEvents: z.any().nullable().optional(),
  heartbeatTimeoutSec: z.number().min(0).nullable().optional(),
  defaultOrderType: z.enum(["Market", "Limit", "Stop", "StopLimit", "TrailingStop", "Bracket", "OCO", "OTO"]).optional(),
  defaultTimeInForce: z.enum(["Day", "GTC", "GTD", "IOC", "FOK"]).optional(),
});

const createFollowerSchema = z.object({
  followerAccountId: z.number({ required_error: "חשבון עוקב נדרש" }),
  followerConnectionId: z.number().nullable().optional().default(null),
  multiplier: z.number().min(0.1).max(10).optional().default(1.0),
  sizingMode: z.enum(["proportional", "fixed"]).optional().default("proportional"),
  maxPositionSize: z.number().min(1).nullable().optional(),
  maxSlippagePercent: z.number().min(0).max(100).nullable().optional(),
  maxSlippageTicks: z.number().min(0).nullable().optional(),
  allowedSymbols: z.array(z.string()).nullable().optional(),
  enabled: z.boolean().optional().default(true),
  minPositionSize: z.number().min(1).nullable().optional(),
  fixedLotSize: z.number().min(0.1).nullable().optional(),
  roundingLogic: z.enum(["nearest", "floor", "ceil"]).optional().default("nearest"),
  orderType: z.enum(["Market", "Limit", "Stop", "StopLimit", "TrailingStop", "Bracket", "OCO", "OTO"]).nullable().optional(),
  timeInForce: z.enum(["Day", "GTC", "GTD", "IOC", "FOK"]).nullable().optional(),
});

const updateFollowerSchema = z.object({
  multiplier: z.number().min(0.1).max(10).optional(),
  sizingMode: z.enum(["proportional", "fixed"]).optional(),
  maxPositionSize: z.number().min(1).nullable().optional(),
  maxSlippagePercent: z.number().min(0).max(100).nullable().optional(),
  maxSlippageTicks: z.number().min(0).nullable().optional(),
  allowedSymbols: z.array(z.string()).nullable().optional(),
  enabled: z.boolean().optional(),
  minPositionSize: z.number().min(1).nullable().optional(),
  fixedLotSize: z.number().min(0.1).nullable().optional(),
  roundingLogic: z.enum(["nearest", "floor", "ceil"]).optional(),
  orderType: z.enum(["Market", "Limit", "Stop", "StopLimit", "TrailingStop", "Bracket", "OCO", "OTO"]).nullable().optional(),
  timeInForce: z.enum(["Day", "GTC", "GTD", "IOC", "FOK"]).nullable().optional(),
});

export function registerCopyTradingRoutes(app: Express) {
  const copyGate = requirePlanFeature("copy_trading");

  app.get("/api/v1/copy-trading/connections", copyGate, async (req, res) => {
    const userId = req.session.userId!;
    const connections = await storage.getCopyTradingConnections(userId);
    const enriched = await Promise.all(connections.map(async (c) => {
      const { encryptedCredentials, ...safe } = c;
      const connAccounts = await storage.getCopyTradingConnectionAccounts(c.id);

      const externalIds = connAccounts
        .map(a => a.externalAccountId)
        .filter(Boolean);

      let accountMap = new Map<string, { size: number; balance: number }>();
      if (externalIds.length > 0) {
        const mainAccounts = await db
          .select({ externalAccountId: accounts.externalAccountId, size: accounts.size, balance: accounts.balance })
          .from(accounts)
          .where(and(eq(accounts.userId, userId), inArray(accounts.externalAccountId, externalIds)));
        for (const ma of mainAccounts) {
          if (ma.externalAccountId) {
            accountMap.set(ma.externalAccountId, { size: ma.size, balance: ma.balance });
          }
        }
      }

      const enrichedAccounts = connAccounts.map(a => {
        const mainData = accountMap.get(a.externalAccountId);
        return {
          ...a,
          size: mainData?.size ?? null,
          balance: mainData?.balance ?? null,
        };
      });

      return { ...safe, accounts: enrichedAccounts };
    }));
    res.json(enriched);
  });

  app.post("/api/v1/copy-trading/connections", copyGate, async (req, res) => {
    const userId = req.session.userId!;
    const provider = req.body?.provider;

    if (!provider || !SUPPORTED_PROVIDERS.includes(provider)) {
      return res.status(400).json({ message: "ברוקר לא נתמך. נתמכים: Tradovate, TopstepX" });
    }

    try {
      let credentials: Record<string, any> = {};
      let connectionName = req.body.connectionName || "";
      let discoveredAccounts: any[] = [];

      if (provider === "tradovate") {
        const parsed = connectTradovateSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים" });
        const { username, password, cid, secret, environment } = parsed.data;
        const result = await discoverTradovateAccounts(username, password, parseInt(cid), secret, environment);
        credentials = { username, password, cid, sec: secret, environment };
        connectionName = connectionName || `Tradovate (${environment}) - ${result.userName}`;
        discoveredAccounts = result.accounts;
      } else if (provider === "topstepx") {
        const parsed = connectTopstepxSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים" });
        const { username, apiKey } = parsed.data;
        const result = await discoverTopstepXAccounts(username, apiKey);
        credentials = { username, apiKey };
        connectionName = connectionName || `TopstepX - ${result.userName}`;
        discoveredAccounts = result.accounts;
        }

      const conn = await storage.createCopyTradingConnection({
        userId,
        provider,
        connectionName,
        encryptedCredentials: encryptCredentials(credentials),
        status: "connected",
        lastSuccessAt: new Date(),
      });

      for (const acc of discoveredAccounts) {
        await storage.createCopyTradingConnectionAccount({
          connectionId: conn.id,
          externalAccountId: acc.externalId || String(acc.accountId),
          externalAccountName: acc.name || acc.accountId,
          platform: provider,
          isActive: true,
        });
      }

      const accounts = await storage.getCopyTradingConnectionAccounts(conn.id);
      const { encryptedCredentials, ...safe } = conn;
      res.status(201).json({ ...safe, accounts });
    } catch (err: any) {
      safeErrorResponse(res, err, 400, "שגיאה בחיבור ברוקר");
    }
  });

  app.post("/api/v1/copy-trading/connections/:id/test", copyGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getCopyTradingConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });

    try {
      let creds: Record<string, any> = {};
      try {
        creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
      } catch {
        await storage.updateCopyTradingConnection(id, { status: "error", lastErrorMessage: "לא ניתן לפענח את פרטי ההתחברות. נא לנתק ולהתחבר מחדש." });
        return res.status(400).json({ success: false, message: "לא ניתן לפענח את פרטי ההתחברות. נא לנתק ולהתחבר מחדש." });
      }

      if (conn.provider === "tradovate" && creds.username && creds.password) {
        await discoverTradovateAccounts(creds.username, creds.password, creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec);
      } else if (conn.provider === "tradovate" && creds.accessToken) {
        await discoverTradovateAccountsWithToken(creds.accessToken, creds.environment === "live");
      } else if (conn.provider === "topstepx" && creds.username && creds.apiKey) {
        await discoverTopstepXAccounts(creds.username, creds.apiKey);
      }

      await storage.updateCopyTradingConnection(id, { status: "connected", lastSuccessAt: new Date(), lastErrorMessage: null });
      res.json({ success: true, message: "חיבור תקין" });
    } catch (err: any) {
      await storage.updateCopyTradingConnection(id, { status: "error", lastErrorAt: new Date(), lastErrorMessage: err.message });
      safeErrorResponse(res, err, 400, "שגיאה בבדיקת חיבור");
    }
  });

  app.post("/api/v1/copy-trading/connections/:id/discover", copyGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getCopyTradingConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });

    try {
      let creds: Record<string, any> = {};
      try {
        creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
      } catch {
        return res.status(400).json({ message: "לא ניתן לפענח את פרטי ההתחברות. נא לנתק ולהתחבר מחדש." });
      }
      let discoveredAccounts: any[] = [];

      if (conn.provider === "tradovate" && creds.username && creds.password) {
        const result = await discoverTradovateAccounts(creds.username, creds.password, creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec);
        discoveredAccounts = result.accounts;
      } else if (conn.provider === "topstepx" && creds.username && creds.apiKey) {
        const result = await discoverTopstepXAccounts(creds.username, creds.apiKey);
        discoveredAccounts = result.accounts;
      }

      const existingAccounts = await storage.getCopyTradingConnectionAccounts(id);
      const existingByExtId = new Map(existingAccounts.map(a => [a.externalAccountId, a]));
      const discoveredExtIds = new Set<string>();

      for (const acc of discoveredAccounts) {
        const extId = acc.externalId || String(acc.accountId);
        discoveredExtIds.add(extId);
        const existing = existingByExtId.get(extId);
        if (existing) {
          await storage.updateCopyTradingConnectionAccount(existing.id, {
            externalAccountName: acc.name || acc.accountId,
            platform: conn.provider,
            isActive: true,
          });
        } else {
          await storage.createCopyTradingConnectionAccount({
            connectionId: id,
            externalAccountId: extId,
            externalAccountName: acc.name || acc.accountId,
            platform: conn.provider,
            isActive: true,
          });
        }
      }

      for (const existing of existingAccounts) {
        if (!discoveredExtIds.has(existing.externalAccountId)) {
          await storage.updateCopyTradingConnectionAccount(existing.id, { isActive: false });
        }
      }

      await storage.updateCopyTradingConnection(id, { status: "connected", lastSuccessAt: new Date() });
      const accounts = await storage.getCopyTradingConnectionAccounts(id);
      res.json({ success: true, accounts });
    } catch (err: any) {
      await storage.updateCopyTradingConnection(id, { status: "error", lastErrorAt: new Date(), lastErrorMessage: err.message });
      safeErrorResponse(res, err, 400, "שגיאה בגילוי חשבונות");
    }
  });

  app.delete("/api/v1/copy-trading/connections/:id", copyGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const conn = await storage.getCopyTradingConnection(id);
    if (!conn) return res.status(404).json({ message: "חיבור לא נמצא" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "אין גישה" });

    await storage.deleteCopyTradingConnection(id);
    res.status(204).send();
  });

  app.get("/api/v1/copy-trading/groups", copyGate, async (req, res) => {
    const userId = req.session.userId!;
    const groups = await storage.getCopyGroups(userId);

    const enriched = await Promise.all(groups.map(async (g) => {
      const followers = await storage.getCopyFollowers(g.id);
      const orderCount = await storage.getCopyOrderCount(g.id);
      let providerKey: string | null = null;
      let masterAccount: any = null;
      if (g.masterConnectionId) {
        const copyConn = await storage.getCopyTradingConnection(g.masterConnectionId);
        providerKey = copyConn?.provider || null;
        const connAccount = await storage.getCopyTradingConnectionAccount(g.masterAccountId);
        if (connAccount) {
          masterAccount = { name: connAccount.externalAccountName || connAccount.externalAccountId, externalAccountId: connAccount.externalAccountId };
        }
      } else {
        masterAccount = await storage.getAccount(g.masterAccountId);
        if (masterAccount?.integrationConnectionId) {
          const conn = await storage.getConnection(masterAccount.integrationConnectionId);
          if (conn) {
            const provider = await storage.getProvider(conn.providerId);
            providerKey = provider?.key || null;
          }
        }
      }
      return { ...g, followers, masterAccount, orderCount, providerKey };
    }));

    res.json(enriched);
  });

  app.get("/api/v1/copy-trading/groups/:id", copyGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const group = await storage.getCopyGroup(id);
    if (!group) return res.status(404).json({ message: "קבוצה לא נמצאה" });
    if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "אין גישה" });

    const followers = await storage.getCopyFollowers(id);
    let masterAccount: any = null;
    if (group.masterConnectionId) {
      const connAccount = await storage.getCopyTradingConnectionAccount(group.masterAccountId);
      if (connAccount) {
        masterAccount = { name: connAccount.externalAccountName || connAccount.externalAccountId, externalAccountId: connAccount.externalAccountId };
      }
    } else {
      masterAccount = await storage.getAccount(group.masterAccountId);
    }

    const enrichedFollowers = await Promise.all(followers.map(async (f) => {
      let account: any = null;
      if (f.followerConnectionId) {
        const connAccount = await storage.getCopyTradingConnectionAccount(f.followerAccountId);
        if (connAccount) {
          account = { name: connAccount.externalAccountName || connAccount.externalAccountId, externalAccountId: connAccount.externalAccountId };
        }
      } else {
        account = await storage.getAccount(f.followerAccountId);
      }
      return { ...f, account };
    }));

    res.json({ ...group, followers: enrichedFollowers, masterAccount });
  });

  app.post("/api/v1/copy-trading/groups", copyGate, async (req, res) => {
    const userId = req.session.userId!;
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים" });

    const masterAccount = await storage.getAccount(parsed.data.masterAccountId);
    if (!masterAccount || !await isLinkedUser(userId, masterAccount.userId!)) {
      return res.status(400).json({ message: "חשבון מאסטר לא נמצא או לא שייך לך" });
    }
    if (masterAccount.status && BLOCKED_COPY_STATUSES.has(masterAccount.status)) {
      return res.status(400).json({ error: "Validation Error", message: "Cannot assign a failed account to a copy group." });
    }
    if (!masterAccount.integrationConnectionId) {
      return res.status(400).json({ message: "חשבון המאסטר לא מחובר דרך אינטגרציה. חבר את הברוקר בעמוד אינטגרציות." });
    }
    const integConn = await storage.getConnection(masterAccount.integrationConnectionId);
    if (!integConn) {
      return res.status(400).json({ message: "חיבור אינטגרציה לא נמצא" });
    }
    const provider = await storage.getProvider(integConn.providerId);
    if (!provider || !isSupportedCopyProvider(provider.key)) {
      return res.status(400).json({ message: "קופי טריידינג נתמך רק עם Tradovate ו-TopstepX" });
    }

    const group = await storage.createCopyGroup({
      ...parsed.data,
      masterConnectionId: null,
      masterAccountId: masterAccount.id,
      userId,
      status: "paused",
    });

    res.status(201).json(group);
  });

  app.patch("/api/v1/copy-trading/groups/:id", copyGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const group = await storage.getCopyGroup(id);
    if (!group) return res.status(404).json({ message: "קבוצה לא נמצאה" });
    if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "אין גישה" });

    const parsed = updateGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים" });

    if (parsed.data.status === "active") {
      const followers = await storage.getCopyFollowers(id);
      if (followers.length === 0) {
        return res.status(400).json({ message: "יש להוסיף לפחות חשבון עוקב אחד לפני הפעלה" });
      }
    }

    const updated = await storage.updateCopyGroup(id, parsed.data);

    if (parsed.data.status !== undefined || parsed.data.pollIntervalMs !== undefined) {
      await restartGroupEngine(id);
    }

    res.json(updated);
  });

  app.delete("/api/v1/copy-trading/groups/:id", copyGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const group = await storage.getCopyGroup(id);
    if (!group) return res.status(404).json({ message: "קבוצה לא נמצאה" });
    if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "אין גישה" });

    stopGroupEngine(id);
    await storage.deleteCopyGroup(id);
    res.status(204).send();
  });

  app.post("/api/v1/copy-trading/groups/:id/followers", copyGate, async (req, res) => {
    const groupId = parseInt(req.params.id);
    if (isNaN(groupId)) return res.status(400).json({ message: "Invalid ID" });
    const group = await storage.getCopyGroup(groupId);
    if (!group) return res.status(404).json({ message: "קבוצה לא נמצאה" });
    if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "אין גישה" });

    const parsed = createFollowerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים" });

    const followerAccount = await storage.getAccount(parsed.data.followerAccountId);
    if (!followerAccount || !await isLinkedUser(req.session.userId!, followerAccount.userId!)) {
      return res.status(400).json({ message: "חשבון עוקב לא נמצא או לא שייך לך" });
    }
    if (followerAccount.status && BLOCKED_COPY_STATUSES.has(followerAccount.status)) {
      return res.status(400).json({ error: "Validation Error", message: "Cannot assign a failed account to a copy group." });
    }
    if (!followerAccount.integrationConnectionId) {
      return res.status(400).json({ message: "חשבון העוקב לא מחובר דרך אינטגרציה. חבר את הברוקר בעמוד אינטגרציות." });
    }
    const followerIntegConn = await storage.getConnection(followerAccount.integrationConnectionId);
    if (!followerIntegConn) {
      return res.status(400).json({ message: "חיבור אינטגרציה לא נמצא" });
    }
    const followerProvider = await storage.getProvider(followerIntegConn.providerId);
    if (!followerProvider || !isSupportedCopyProvider(followerProvider.key)) {
      return res.status(400).json({ message: "קופי טריידינג נתמך רק עם Tradovate ו-TopstepX" });
    }

    if (followerAccount.id === group.masterAccountId) {
      return res.status(400).json({ message: "חשבון עוקב לא יכול להיות זהה לחשבון המאסטר" });
    }

    const existingFollowers = await storage.getCopyFollowers(groupId);
    if (existingFollowers.some(f => f.followerAccountId === followerAccount.id)) {
      return res.status(409).json({ message: "חשבון זה כבר מוגדר כעוקב בקבוצה" });
    }

    const follower = await storage.createCopyFollower({
      ...parsed.data,
      followerConnectionId: null,
      followerAccountId: followerAccount.id,
      groupId,
      status: "idle",
    });

    res.status(201).json(follower);
  });

  app.patch("/api/v1/copy-trading/followers/:id", copyGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const follower = await storage.getCopyFollower(id);
    if (!follower) return res.status(404).json({ message: "עוקב לא נמצא" });

    const group = await storage.getCopyGroup(follower.groupId);
    if (!group || !await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "אין גישה" });

    const parsed = updateFollowerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים" });

    const updated = await storage.updateCopyFollower(id, parsed.data);
    res.json(updated);
  });

  app.delete("/api/v1/copy-trading/followers/:id", copyGate, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const follower = await storage.getCopyFollower(id);
    if (!follower) return res.status(404).json({ message: "עוקב לא נמצא" });

    const group = await storage.getCopyGroup(follower.groupId);
    if (!group || !await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "אין גישה" });

    await storage.deleteCopyFollower(id);
    res.status(204).send();
  });

  app.get("/api/v1/copy-trading/groups/:id/orders", copyGate, async (req, res) => {
    const groupId = parseInt(req.params.id);
    if (isNaN(groupId)) return res.status(400).json({ message: "Invalid ID" });
    const group = await storage.getCopyGroup(groupId);
    if (!group) return res.status(404).json({ message: "קבוצה לא נמצאה" });
    if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "אין גישה" });

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const orders = await storage.getCopyOrders(groupId, limit, offset);
    const total = await storage.getCopyOrderCount(groupId);

    res.json({ orders, total, limit, offset });
  });

  app.get("/api/v1/copy-trading/engine-status", copyGate, async (req, res) => {
    const status = getEngineStatus();
    res.json(status);
  });

  app.get("/api/v1/copy-trading/execution-metrics", copyGate, async (req, res) => {
    const metrics = getCopyExecutionMetrics();
    res.json(metrics);
  });

  app.post("/api/v1/copy-trading/groups/:id/flatten", copyGate, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) return res.status(400).json({ message: "Invalid ID" });
      const group = await storage.getCopyGroup(groupId);
      if (!group) return res.status(404).json({ message: "Group not found" });
      if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "Access denied" });

      const result = await flattenAllPositions(groupId);
      res.json(result);
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "Flatten failed");
    }
  });

  app.get("/api/v1/copy-trading/groups/:id/orphaned", copyGate, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) return res.status(400).json({ message: "Invalid ID" });
      const group = await storage.getCopyGroup(groupId);
      if (!group) return res.status(404).json({ message: "Group not found" });
      if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "Access denied" });

      const result = await detectOrphanedTrades(groupId);
      res.json(result);
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "Orphaned detection failed");
    }
  });

  app.post("/api/v1/copy-trading/groups/:id/webhook-token", copyGate, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) return res.status(400).json({ message: "Invalid ID" });
      const group = await storage.getCopyGroup(groupId);
      if (!group) return res.status(404).json({ message: "Group not found" });
      if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "Access denied" });

      const token = randomBytes(32).toString("hex");
      await storage.updateCopyGroup(groupId, { webhookToken: token });
      res.json({ webhookToken: token });
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "Token generation failed");
    }
  });

  app.get("/api/v1/copy-trading/groups/:id/slippage-stats", copyGate, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) return res.status(400).json({ message: "Invalid ID" });
      const group = await storage.getCopyGroup(groupId);
      if (!group) return res.status(404).json({ message: "Group not found" });
      if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "Access denied" });

      const stats = await storage.getSlippageStats(groupId);
      const dailyLoss = getDailyLossTotal(groupId);
      res.json({ slippage: stats, dailyLoss, dailyLossLimit: group.dailyLossLimit });
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "Stats query failed");
    }
  });

  app.post("/api/v1/copy-trading/groups/:id/heartbeat", copyGate, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) return res.status(400).json({ message: "Invalid ID" });
      const group = await storage.getCopyGroup(groupId);
      if (!group) return res.status(404).json({ message: "Group not found" });
      if (!await isLinkedUser(req.session.userId!, group.userId)) return res.status(403).json({ message: "Access denied" });

      recordHeartbeat(groupId);
      res.json({ ok: true, lastHeartbeat: getLastHeartbeat(groupId) });
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "Heartbeat failed");
    }
  });

  const bracketLegSchema = z.object({
    price: z.number().optional(),
    stopPrice: z.number().optional(),
  });

  const webhookPayloadSchema = z.object({
    symbol: z.string().min(1),
    action: z.enum(["Buy", "Sell"]),
    qty: z.number().min(1).optional(),
    orderType: z.enum(["Market", "Limit", "Stop", "StopLimit", "TrailingStop", "Bracket", "OCO", "OTO"]).optional(),
    limitPrice: z.number().optional(),
    stopPrice: z.number().optional(),
    trailOffset: z.number().optional(),
    bracketLegs: z.array(bracketLegSchema).max(4).optional(),
    timeInForce: z.enum(["Day", "GTC", "GTD", "IOC", "FOK"]).optional(),
  });

  app.post("/api/v1/copy-trading/webhook/:token", async (req, res) => {
    try {
      const token = req.params.token;
      if (!token) return res.status(400).json({ message: "Token required" });

      const group = await storage.getCopyGroupByWebhookToken(token);
      if (!group) return res.status(404).json({ message: "Invalid webhook token" });
      if (group.status !== "active") return res.status(400).json({ message: "Group not active" });

      recordHeartbeat(group.id);

      const parsed = webhookPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.json({ ok: true, groupId: group.id, message: "Heartbeat only (no valid trade payload)" });
      }

      const { symbol, action, qty, orderType, limitPrice, stopPrice, trailOffset, bracketLegs, timeInForce } = parsed.data;

      const followers = await storage.getCopyFollowers(group.id);
      const enabledFollowers = followers.filter(f => f.enabled);

      let dispatched = 0;
      const errors: string[] = [];

      for (const follower of enabledFollowers) {
        try {
          const masterPrice = limitPrice || stopPrice || 0;
          const enrichedCtx = await enrichWebhookRiskContext(follower, symbol, masterPrice);
          const riskResult = await runRiskChecks({
            group,
            follower,
            symbol,
            action,
            qty: qty || 1,
            masterPrice,
            followerBalance: enrichedCtx.followerBalance,
            followerSize: enrichedCtx.followerSize,
            followerMaxDrawdown: enrichedCtx.followerMaxDrawdown,
            availableMargin: enrichedCtx.availableMargin,
            currentPrice: enrichedCtx.currentPrice,
            tickSize: enrichedCtx.tickSize,
            quoteSource: enrichedCtx.quoteSource,
          });

          if (!riskResult.passed) {
            errors.push(`${follower.id}: ${riskResult.blockReason}`);
            await storage.createCopyOrder({
              groupId: group.id,
              followerAccountId: follower.followerAccountId,
              masterOrderRef: `webhook-${Date.now()}`,
              symbol,
              side: action,
              quantity: qty || 1,
              masterPrice: limitPrice || stopPrice || 0,
              status: "risk_blocked",
              errorMessage: riskResult.blockReason || "Risk blocked",
              riskCheckResult: JSON.parse(JSON.stringify(riskResult)),
              masterDetectedAt: new Date(),
              latencyMs: 0,
              orderType: orderType || group.defaultOrderType || "Market",
              timeInForce: timeInForce || group.defaultTimeInForce || "Day",
            });
            continue;
          }

          const finalQty = applyAdvancedSizing(qty || 1, follower);
          const effectiveOrderType = orderType || group.defaultOrderType || "Market";
          const effectiveTIF = timeInForce || group.defaultTimeInForce || "Day";

          const execResult = await executeWebhookOrderForFollower(
            group, follower, symbol, action, finalQty,
            { orderType: effectiveOrderType, limitPrice, stopPrice, trailOffset, bracketLegs, timeInForce: effectiveTIF },
          );

          if (execResult.success) {
            dispatched++;
          } else {
            errors.push(`${follower.id}: ${execResult.error}`);
          }
        } catch (err: any) {
          errors.push(`${follower.id}: ${err.message}`);
        }
      }

      res.json({
        ok: true,
        groupId: group.id,
        dispatched,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Webhook processing failed" });
    }
  });
}
