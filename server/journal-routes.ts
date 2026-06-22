import type { Express } from "express";
import { storage } from "./storage";
import { insertJournalEntrySchema, insertJournalPsychologySchema, type InsertJournalEntry } from "@shared/journal-schema";
import type { JournalEntry } from "@shared/journal-schema";
import { z } from "zod";
import multer from "multer";
import Papa from "papaparse";
import crypto from "crypto";
import { generateAutoTags } from "./auto-tagger";
import { sanitizeCsvCell, sanitizeCsvRow, safeErrorResponse } from "./sanitize";
import { isLinkedUser } from "./linked-users";
import { getMarketData, resolveSymbol, ensureMarketDataTable } from "./market-data";

async function analyzeAndGenerateAlerts(userId: number) {
  const settings = await storage.getJournalAlertSettings(userId);
  if (settings && !settings.enabled) return [];

  const entries = await storage.getJournalEntries(userId, {});
  if (entries.length === 0) return [];

  const existingAlerts = await storage.getJournalAlerts(userId);
  const recentAlertTypes = new Set(
    existingAlerts
      .filter(a => {
        const created = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        return Date.now() - created < 24 * 60 * 60 * 1000;
      })
      .map(a => a.type + "_" + JSON.stringify(a.data))
  );

  const newAlerts: { type: string; severity: string; message: string; data: any }[] = [];

  const maxConsecutive = settings?.maxConsecutiveLosses ?? 3;
  const sorted = [...entries].sort((a, b) => {
    const da = a.closedAt ? new Date(a.closedAt).getTime() : 0;
    const db2 = b.closedAt ? new Date(b.closedAt).getTime() : 0;
    return db2 - da;
  });

  let consecutiveLosses = 0;
  for (const e of sorted) {
    if ((e.realizedPnl || 0) < 0) consecutiveLosses++;
    else break;
  }
  if (consecutiveLosses >= maxConsecutive) {
    const key = `losing_streak_${JSON.stringify({ count: consecutiveLosses })}`;
    if (!recentAlertTypes.has(key)) {
      newAlerts.push({
        type: "losing_streak",
        severity: consecutiveLosses >= 5 ? "critical" : "warning",
        message: `Losing streak: ${consecutiveLosses} consecutive losses`,
        data: { count: consecutiveLosses },
      });
    }
  }

  const maxDailyLoss = settings?.maxDailyLoss;
  if (maxDailyLoss && maxDailyLoss > 0) {
    const today = new Date().toISOString().split("T")[0];
    const todayEntries = entries.filter(e => {
      if (!e.closedAt) return false;
      return new Date(e.closedAt).toISOString().split("T")[0] === today;
    });
    const todayPnl = todayEntries.reduce((s, e) => s + (e.realizedPnl || 0), 0);
    if (todayPnl < -maxDailyLoss) {
      const key = `daily_loss_exceeded_${JSON.stringify({ dailyLoss: Math.abs(todayPnl), threshold: maxDailyLoss })}`;
      if (!recentAlertTypes.has(key)) {
        newAlerts.push({
          type: "daily_loss_exceeded",
          severity: "critical",
          message: `Daily loss ($${Math.abs(todayPnl).toFixed(2)}) exceeds your limit ($${maxDailyLoss.toFixed(2)})`,
          data: { dailyLoss: Math.abs(todayPnl), threshold: maxDailyLoss },
        });
      }
    }
  }

  if (sorted.length > 1 && (sorted[0].realizedPnl || 0) > 0) {
    const latestPnl = sorted[0].realizedPnl || 0;
    const previousBest = Math.max(...sorted.slice(1).map(e => e.realizedPnl || 0));
    if (latestPnl > previousBest && previousBest >= 0) {
      const key = `new_pnl_record_${JSON.stringify({ amount: latestPnl })}`;
      if (!recentAlertTypes.has(key)) {
        newAlerts.push({
          type: "new_pnl_record",
          severity: "success",
          message: `New P&L record! $${latestPnl.toFixed(2)} on a single trade`,
          data: { amount: latestPnl },
        });
      }
    }
  }

  const winRateDropThreshold = settings?.winRateDropThreshold ?? 10;
  if (entries.length >= 20) {
    const recentCount = Math.min(10, Math.floor(entries.length / 2));
    const recentEntries = sorted.slice(0, recentCount);
    const olderEntries = sorted.slice(recentCount);
    const recentWinRate = (recentEntries.filter(e => (e.realizedPnl || 0) > 0).length / recentEntries.length) * 100;
    const olderWinRate = (olderEntries.filter(e => (e.realizedPnl || 0) > 0).length / olderEntries.length) * 100;
    const drop = olderWinRate - recentWinRate;
    if (drop >= winRateDropThreshold) {
      const key = `win_rate_drop_${JSON.stringify({ recentWinRate: Math.round(recentWinRate), previousWinRate: Math.round(olderWinRate) })}`;
      if (!recentAlertTypes.has(key)) {
        newAlerts.push({
          type: "win_rate_drop",
          severity: "warning",
          message: `Win rate dropped from ${olderWinRate.toFixed(0)}% to ${recentWinRate.toFixed(0)}%`,
          data: { recentWinRate: Math.round(recentWinRate), previousWinRate: Math.round(olderWinRate) },
        });
      }
    }
  }

  const created = [];
  for (const alert of newAlerts) {
    const a = await storage.createJournalAlert({ userId, ...alert });
    created.push(a);
  }
  return created;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const CSV_COLUMN_MAP: Record<string, string> = {
  symbol: "symbol", ticker: "symbol", instrument: "symbol",
  side: "side", direction: "side", type: "side", action: "side",
  quantity: "quantity", qty: "quantity", size: "quantity", contracts: "quantity", lots: "quantity", volume: "quantity",
  entryprice: "entryPrice", entry: "entryPrice", "entry price": "entryPrice", open: "entryPrice", "open price": "entryPrice",
  exitprice: "exitPrice", exit: "exitPrice", "exit price": "exitPrice", close: "exitPrice", "close price": "exitPrice",
  pnl: "realizedPnl", realizedpnl: "realizedPnl", "realized pnl": "realizedPnl", profit: "realizedPnl", "p&l": "realizedPnl", "net p&l": "realizedPnl", "realized p&l": "realizedPnl", "net pnl": "realizedPnl",
  openedat: "openedAt", "opened at": "openedAt", "open time": "openedAt", "entry time": "openedAt", "open date": "openedAt", "entry date": "openedAt", opentime: "openedAt", opendate: "openedAt", entrytime: "openedAt", entrydate: "openedAt",
  closedat: "closedAt", "closed at": "closedAt", "close time": "closedAt", "exit time": "closedAt", "close date": "closedAt", "exit date": "closedAt", closetime: "closedAt", closedate: "closedAt", exittime: "closedAt", exitdate: "closedAt",
  notes: "notes", comment: "notes", comments: "notes",
  tags: "tags",
  setup: "setupType", setuptype: "setupType", "setup type": "setupType",
  strategy: "strategy",
};

function normalizeHeaderName(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .trim()
    .replace(/[_\-]+/g, " ")
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/\s*\$\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ALLOWED_EXTENSIONS = [".csv", ".txt"];
const ALLOWED_MIMES = ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"];

const manualTradeSchema = z.object({
  accountId: z.number().optional(),
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell", "long", "short"]),
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  realizedPnl: z.number(),
  openedAt: z.string(),
  closedAt: z.string(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  setupType: z.string().optional(),
  strategy: z.string().optional(),
});

const psychologySchema = z.object({
  moodBefore: z.enum(["great", "good", "neutral", "bad", "terrible"]).optional(),
  moodAfter: z.enum(["great", "good", "neutral", "bad", "terrible"]).optional(),
  confidence: z.number().min(1).max(5).optional(),
  discipline: z.number().min(1).max(5).optional(),
  lessonsLearned: z.string().optional(),
});

export function registerJournalRoutes(app: Express) {
  app.get("/api/v1/journal/entries", async (req, res) => {
    const userId = req.session.userId!;
    const filters = {
      accountId: req.query.accountId ? parseInt(req.query.accountId as string) : undefined,
      symbol: req.query.symbol as string | undefined,
      tag: req.query.tag as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
    };
    const entries = await storage.getJournalEntries(userId, filters);

    const accounts = await storage.getAccounts(userId);
    const accountMap = new Map(accounts.map(a => [a.id, a]));
    const connections = await storage.getConnections(userId);
    const connMap = new Map(connections.map(c => [c.id, c]));
    const providers = await storage.getProviders();
    const providerMap = new Map(providers.map(p => [p.id, p]));

    const psychMap = new Map<number, any>();
    await Promise.all(entries.map(async (entry) => {
      const psych = await storage.getJournalPsychology(entry.id);
      if (psych) psychMap.set(entry.id, psych);
    }));

    const enriched = entries.map(entry => {
      let sourcePlatform = "manual";
      if (entry.importedTradeId && entry.accountId) {
        const account = accountMap.get(entry.accountId);
        if (account?.integrationConnectionId) {
          const conn = connMap.get(account.integrationConnectionId);
          if (conn) {
            const provider = providerMap.get(conn.providerId);
            sourcePlatform = provider?.key || "integration";
          }
        }
      }
      const psychology = psychMap.get(entry.id) || null;
      return { ...entry, sourcePlatform, psychology };
    });

    res.json(enriched);
  });

  app.get("/api/v1/journal/entries/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const entry = await storage.getJournalEntry(id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!await isLinkedUser(req.session.userId!, entry.userId)) return res.status(403).json({ message: "Access denied" });
    const psychology = await storage.getJournalPsychology(id);
    res.json({ ...entry, psychology });
  });

  app.post("/api/v1/journal/entries", async (req, res) => {
    const userId = req.session.userId!;
    const parsed = manualTradeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid data", errors: parsed.error.flatten() });
    const data = parsed.data;
    const openedAt = new Date(data.openedAt);
    const closedAt = new Date(data.closedAt);
    const autoTags = generateAutoTags({
      openedAt,
      closedAt,
      realizedPnl: data.realizedPnl,
      side: data.side,
      symbol: data.symbol,
      entryPrice: data.entryPrice,
      exitPrice: data.exitPrice,
    });
    const entry = await storage.createJournalEntry({
      userId,
      accountId: data.accountId || null,
      symbol: data.symbol,
      side: data.side,
      quantity: data.quantity,
      entryPrice: data.entryPrice,
      exitPrice: data.exitPrice,
      realizedPnl: data.realizedPnl,
      openedAt,
      closedAt,
      notes: data.notes || null,
      tags: data.tags || null,
      autoTags: autoTags.length > 0 ? autoTags : null,
      setupType: data.setupType || null,
      strategy: data.strategy || null,
    });
    res.status(201).json(entry);
  });

  const patchEntrySchema = z.object({
    symbol: z.string().min(1).optional(),
    side: z.enum(["buy", "sell", "long", "short"]).optional(),
    quantity: z.number().positive().optional(),
    entryPrice: z.number().optional(),
    exitPrice: z.number().optional(),
    realizedPnl: z.number().optional(),
    openedAt: z.string().refine(s => !isNaN(Date.parse(s)), { message: "Invalid date" }).optional(),
    closedAt: z.string().refine(s => !isNaN(Date.parse(s)), { message: "Invalid date" }).optional(),
    notes: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
    autoTags: z.array(z.string()).nullable().optional(),
    setupType: z.string().nullable().optional(),
    strategy: z.string().nullable().optional(),
    accountId: z.number().nullable().optional(),
  }).strict();

  app.patch("/api/v1/journal/entries/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const entry = await storage.getJournalEntry(id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!await isLinkedUser(req.session.userId!, entry.userId)) return res.status(403).json({ message: "Access denied" });
    const parsed = patchEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid data", errors: parsed.error.flatten() });
    const updateData: Partial<InsertJournalEntry> = {};
    const d = parsed.data;
    if (d.symbol !== undefined) updateData.symbol = d.symbol;
    if (d.side !== undefined) updateData.side = d.side;
    if (d.quantity !== undefined) updateData.quantity = d.quantity;
    if (d.entryPrice !== undefined) updateData.entryPrice = d.entryPrice;
    if (d.exitPrice !== undefined) updateData.exitPrice = d.exitPrice;
    if (d.realizedPnl !== undefined) updateData.realizedPnl = d.realizedPnl;
    if (d.openedAt !== undefined) updateData.openedAt = new Date(d.openedAt);
    if (d.closedAt !== undefined) updateData.closedAt = new Date(d.closedAt);
    if (d.notes !== undefined) updateData.notes = d.notes;
    if (d.tags !== undefined) updateData.tags = d.tags;
    if (d.autoTags !== undefined) updateData.autoTags = d.autoTags;
    if (d.setupType !== undefined) updateData.setupType = d.setupType;
    if (d.strategy !== undefined) updateData.strategy = d.strategy;
    if (d.accountId !== undefined) updateData.accountId = d.accountId;
    const updated = await storage.updateJournalEntry(id, updateData);
    res.json(updated);
  });

  app.delete("/api/v1/journal/entries/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const entry = await storage.getJournalEntry(id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!await isLinkedUser(req.session.userId!, entry.userId)) return res.status(403).json({ message: "Access denied" });
    await storage.deleteJournalEntry(id);
    res.status(204).send();
  });

  app.get("/api/v1/journal/entries/:id/psychology", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const entry = await storage.getJournalEntry(id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!await isLinkedUser(req.session.userId!, entry.userId)) return res.status(403).json({ message: "Access denied" });
    const psychology = await storage.getJournalPsychology(id);
    res.json(psychology || null);
  });

  app.post("/api/v1/journal/entries/:id/psychology", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const entry = await storage.getJournalEntry(id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!await isLinkedUser(req.session.userId!, entry.userId)) return res.status(403).json({ message: "Access denied" });
    const parsed = psychologySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid data" });
    const psychology = await storage.upsertJournalPsychology({
      journalEntryId: id,
      ...parsed.data,
    });
    res.json(psychology);
  });

  app.get("/api/v1/journal/analytics", async (req, res) => {
    const userId = req.session.userId!;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
    const analytics = await storage.getJournalAnalytics(userId, dateFrom, dateTo, accountId);
    res.json(analytics);
  });

  app.get("/api/v1/journal/psychology-analytics", async (req, res) => {
    const userId = req.session.userId!;
    const analytics = await storage.getJournalPsychologyAnalytics(userId);
    res.json(analytics);
  });

  app.get("/api/v1/journal/session-analytics", async (req, res) => {
    const userId = req.session.userId!;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
    const entries = await storage.getJournalEntries(userId, { dateFrom, dateTo, accountId });

    type SessionKey = "asia" | "europe" | "us";
    const sessionBuckets: Record<SessionKey, { count: number; wins: number; totalPnl: number }> = {
      asia: { count: 0, wins: 0, totalPnl: 0 },
      europe: { count: 0, wins: 0, totalPnl: 0 },
      us: { count: 0, wins: 0, totalPnl: 0 },
    };

    const heatMap: Record<string, number> = {};
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        heatMap[`${d}-${h}`] = 0;
      }
    }

    function getSession(hourEST: number): SessionKey {
      if (hourEST >= 18 || hourEST < 2) return "asia";
      if (hourEST >= 2 && hourEST < 8) return "europe";
      if (hourEST >= 8 && hourEST < 16) return "us";
      return "us";
    }

    for (const e of entries) {
      if (!e.openedAt) continue;
      const d = new Date(e.openedAt);
      if (isNaN(d.getTime())) continue;

      const utcHour = d.getUTCHours();
      const estHour = (utcHour - 5 + 24) % 24;

      const session = getSession(estHour);
      const pnl = e.realizedPnl || 0;
      sessionBuckets[session].count++;
      sessionBuckets[session].totalPnl += pnl;
      if (pnl > 0) sessionBuckets[session].wins++;

      const dayOfWeek = d.getUTCDay();
      heatMap[`${dayOfWeek}-${utcHour}`] = (heatMap[`${dayOfWeek}-${utcHour}`] || 0) + pnl;
    }

    const sessions = (Object.keys(sessionBuckets) as SessionKey[]).map(key => {
      const b = sessionBuckets[key];
      return {
        session: key,
        trades: b.count,
        winRate: b.count > 0 ? (b.wins / b.count) * 100 : 0,
        avgPnl: b.count > 0 ? b.totalPnl / b.count : 0,
        totalPnl: b.totalPnl,
      };
    });

    const heatMapData: { day: number; hour: number; pnl: number }[] = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        heatMapData.push({ day: d, hour: h, pnl: heatMap[`${d}-${h}`] || 0 });
      }
    }

    res.json({ sessions, heatMapData });
  });

  app.get("/api/v1/journal/calendar", async (req, res) => {
    const userId = req.session.userId!;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const analytics = await storage.getJournalAnalytics(userId, dateFrom, dateTo);
    res.json(analytics.calendarData);
  });

  app.get("/api/v1/journal/daily-summaries", async (req, res) => {
    const userId = req.session.userId!;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const summaries = await storage.getJournalDailySummaries(userId, dateFrom, dateTo);
    res.json(summaries);
  });

  app.post("/api/v1/journal/import-csv", (req, res, next) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ success: false, code: "file_too_large", message: "File exceeds 10MB limit" });
        }
        return res.status(400).json({ success: false, code: "upload_error", message: "שגיאה בהעלאת קובץ" });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const userId = req.session.userId!;
      if (!req.file) return res.status(400).json({ success: false, code: "no_file", message: "No file uploaded" });

      const rawAccountId = req.body.accountId && req.body.accountId !== "none" ? parseInt(req.body.accountId, 10) : null;
      const importAccountId = rawAccountId !== null && Number.isInteger(rawAccountId) ? rawAccountId : null;
      if (importAccountId) {
        const acc = await storage.getAccount(importAccountId);
        if (!acc || !await isLinkedUser(userId, acc.userId!)) {
          return res.status(400).json({ success: false, code: "invalid_account", message: "Invalid account" });
        }
      }

      const ext = (req.file.originalname || "").toLowerCase().slice((req.file.originalname || "").lastIndexOf("."));
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return res.status(400).json({ success: false, code: "invalid_type", message: `Unsupported file type: ${ext}. Use CSV or TXT.` });
      }

      const csvText = req.file.buffer.toString("utf-8").replace(/^\uFEFF/, "");
      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, transformHeader: (h: string) => h.trim() });

      if (parsed.errors.length > 0 && parsed.data.length === 0) {
        return res.status(400).json({ success: false, code: "parse_error", message: "Could not parse CSV file", errors: parsed.errors.slice(0, 5) });
      }

      const headers = parsed.meta.fields || [];
      const columnMapping: Record<string, string> = {};
      const unmatchedHeaders: string[] = [];
      for (const header of headers) {
        const normalized = normalizeHeaderName(header);
        if (CSV_COLUMN_MAP[normalized]) {
          columnMapping[header] = CSV_COLUMN_MAP[normalized];
        } else {
          unmatchedHeaders.push(header);
        }
      }

      const requiredFields = ["symbol", "side", "realizedPnl"];
      const mappedFields = Object.values(columnMapping);
      const missingRequired = requiredFields.filter(f => !mappedFields.includes(f));
      if (missingRequired.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required columns: ${missingRequired.join(", ")}. Found columns: ${headers.join(", ")}`,
          detectedColumns: columnMapping,
        });
      }

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < parsed.data.length; i++) {
        const row = parsed.data[i] as Record<string, string>;
        try {
          const mapped: Record<string, any> = {};
          for (const [csvCol, field] of Object.entries(columnMapping)) {
            const val = row[csvCol]?.trim();
            if (!val) continue;
            if (field === "tags") {
              mapped[field] = val.split(/[,;|]/).map((t: string) => sanitizeCsvCell(t.trim())).filter(Boolean);
            } else if (["quantity", "entryPrice", "exitPrice", "realizedPnl"].includes(field)) {
              const num = parseFloat(val.replace(/[,$]/g, ""));
              if (!isNaN(num)) mapped[field] = num;
            } else {
              mapped[field] = sanitizeCsvCell(val);
            }
          }

          if (!mapped.symbol || !mapped.side) {
            skipped++;
            continue;
          }

          const side = String(mapped.side).toLowerCase();
          if (["buy", "long", "b"].includes(side)) mapped.side = "buy";
          else if (["sell", "short", "s"].includes(side)) mapped.side = "sell";

          if (!mapped.quantity) mapped.quantity = 1;
          if (!mapped.entryPrice) mapped.entryPrice = 0;
          if (!mapped.exitPrice) mapped.exitPrice = 0;
          if (mapped.realizedPnl === undefined) mapped.realizedPnl = 0;

          const openedAt = mapped.openedAt ? new Date(mapped.openedAt) : new Date();
          const closedAt = mapped.closedAt ? new Date(mapped.closedAt) : openedAt;
          if (isNaN(openedAt.getTime())) { skipped++; continue; }

          const finalClosedAt = isNaN(closedAt.getTime()) ? openedAt : closedAt;
          const csvAutoTags = generateAutoTags({
            openedAt,
            closedAt: finalClosedAt,
            realizedPnl: mapped.realizedPnl,
            side: mapped.side,
            symbol: String(mapped.symbol).toUpperCase(),
            entryPrice: mapped.entryPrice,
            exitPrice: mapped.exitPrice,
          });
          await storage.createJournalEntry({
            userId,
            accountId: importAccountId,
            importedTradeId: null,
            symbol: String(mapped.symbol).toUpperCase(),
            side: mapped.side,
            quantity: mapped.quantity,
            entryPrice: mapped.entryPrice,
            exitPrice: mapped.exitPrice,
            realizedPnl: mapped.realizedPnl,
            openedAt,
            closedAt: finalClosedAt,
            notes: mapped.notes || null,
            tags: mapped.tags || null,
            autoTags: csvAutoTags.length > 0 ? csvAutoTags : null,
            setupType: mapped.setupType || null,
            strategy: mapped.strategy || null,
          });
          imported++;
        } catch (rowErr: any) {
          skipped++;
          if (errors.length < 5) errors.push(`Row ${i + 2}: ${rowErr.message}`);
        }
      }

      console.log(`[CSV Import] User ${userId}: ${imported} imported, ${skipped} skipped from ${parsed.data.length} rows. Unmatched headers: ${unmatchedHeaders.join(", ") || "none"}`);
      res.json({ success: true, imported, skipped, total: parsed.data.length, errors, detectedColumns: columnMapping, unmatchedHeaders });
    } catch (err: any) {
      console.error("[CSV Import] Error:", err.message);
      safeErrorResponse(res, err, 500, "שגיאה בייבוא CSV");
    }
  });

  app.get("/api/v1/journal/export", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const format = (req.query.format as string) || "csv";
      const entries = await storage.getJournalEntries(userId, {});

      const rows = entries.map(e => sanitizeCsvRow({
        Symbol: e.symbol || "",
        Side: e.side || "",
        Quantity: e.quantity || 0,
        "Entry Price": e.entryPrice || 0,
        "Exit Price": e.exitPrice || 0,
        "Realized PnL": e.realizedPnl || 0,
        "Opened At": e.openedAt ? new Date(e.openedAt).toISOString() : "",
        "Closed At": e.closedAt ? new Date(e.closedAt).toISOString() : "",
        "Setup Type": e.setupType || "",
        Strategy: e.strategy || "",
        Tags: (e.tags || []).join(", "),
        Notes: e.notes || "",
      }));

      if (format === "notion") {
        const psychMap = new Map<number, any>();
        for (const e of entries) {
          const p = await storage.getJournalPsychology(e.id);
          if (p) psychMap.set(e.id, p);
        }
        const notionRows = entries.map(e => {
          const p = psychMap.get(e.id);
          return sanitizeCsvRow({
            Name: e.symbol ? `${e.symbol} ${e.side || ""}`.trim() : "",
            Symbol: e.symbol || "",
            Side: e.side || "",
            Quantity: e.quantity || 0,
            "Entry Price": e.entryPrice || 0,
            "Exit Price": e.exitPrice || 0,
            "Realized PnL": e.realizedPnl || 0,
            Result: (e.realizedPnl || 0) >= 0 ? "Win" : "Loss",
            "Date Opened": e.openedAt ? new Date(e.openedAt).toISOString().split("T")[0] : "",
            "Date Closed": e.closedAt ? new Date(e.closedAt).toISOString().split("T")[0] : "",
            "Setup Type": e.setupType || "",
            Strategy: e.strategy || "",
            Tags: (e.tags || []).join(", "),
            Notes: e.notes || "",
            "Mood Before": p?.moodBefore || "",
            "Mood After": p?.moodAfter || "",
            Confidence: p?.confidence || "",
            Discipline: p?.discipline || "",
            "Lessons Learned": p?.lessonsLearned || "",
          });
        });
        const csv = Papa.unparse(notionRows);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="notion_trades_${new Date().toISOString().split("T")[0]}.csv"`);
        res.send("\uFEFF" + csv);
      } else if (format === "csv") {
        const csv = Papa.unparse(rows);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="trades_export_${new Date().toISOString().split("T")[0]}.csv"`);
        res.send("\uFEFF" + csv);
      } else {
        res.json({ entries: rows, exportedAt: new Date().toISOString(), total: rows.length });
      }
    } catch (err: any) {
      console.error("[Export] Error:", err.message);
      safeErrorResponse(res, err, 500, "שגיאה בייצוא נתונים");
    }
  });

  // ─── Tax Report ──────────────────────────────────
  app.get("/api/v1/journal/tax-report", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const dateFrom = `${year}-01-01`;
      const dateTo = `${year}-12-31`;

      const entries = await storage.getJournalEntries(userId, { dateFrom, dateTo });
      const withdrawals = await storage.getWithdrawals(userId);
      const yearWithdrawals = withdrawals.filter(w => {
        const d = w.requestedAt ? new Date(w.requestedAt) : null;
        return d && d.getFullYear() === year;
      });

      const wins = entries.filter(e => (e.realizedPnl || 0) > 0);
      const losses = entries.filter(e => (e.realizedPnl || 0) < 0);
      const totalGains = wins.reduce((s, e) => s + (e.realizedPnl || 0), 0);
      const totalLosses = Math.abs(losses.reduce((s, e) => s + (e.realizedPnl || 0), 0));
      const netPnl = totalGains - totalLosses;
      const totalWithdrawn = yearWithdrawals.reduce((s, w) => s + (w.amount || 0), 0);

      const monthly: Record<string, { gains: number; losses: number; trades: number }> = {};
      for (let m = 0; m < 12; m++) {
        const key = `${year}-${String(m + 1).padStart(2, "0")}`;
        monthly[key] = { gains: 0, losses: 0, trades: 0 };
      }
      for (const e of entries) {
        const d = e.closedAt ? new Date(e.closedAt) : e.openedAt ? new Date(e.openedAt) : null;
        if (!d) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (monthly[key]) {
          monthly[key].trades++;
          if ((e.realizedPnl || 0) > 0) monthly[key].gains += e.realizedPnl || 0;
          else monthly[key].losses += Math.abs(e.realizedPnl || 0);
        }
      }

      const bySymbol: Record<string, { gains: number; losses: number; count: number }> = {};
      for (const e of entries) {
        const sym = e.symbol || "UNKNOWN";
        if (!bySymbol[sym]) bySymbol[sym] = { gains: 0, losses: 0, count: 0 };
        bySymbol[sym].count++;
        if ((e.realizedPnl || 0) > 0) bySymbol[sym].gains += e.realizedPnl || 0;
        else bySymbol[sym].losses += Math.abs(e.realizedPnl || 0);
      }

      res.json({
        year,
        totalTrades: entries.length,
        totalGains,
        totalLosses,
        netPnl,
        totalWithdrawn,
        winCount: wins.length,
        lossCount: losses.length,
        monthly: Object.entries(monthly).map(([month, d]) => ({ month, ...d, net: d.gains - d.losses })),
        bySymbol: Object.entries(bySymbol).map(([symbol, d]) => ({ symbol, ...d, net: d.gains - d.losses })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
      });
    } catch (err: any) {
      console.error("[Tax Report] Error:", err.message);
      safeErrorResponse(res, err, 500, "שגיאה בהפקת דוח מס");
    }
  });

  app.get("/api/v1/journal/tax-report/export", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const dateFrom = `${year}-01-01`;
      const dateTo = `${year}-12-31`;
      const entries = await storage.getJournalEntries(userId, { dateFrom, dateTo });

      const rows = entries.map(e => sanitizeCsvRow({
        Symbol: e.symbol || "",
        Side: e.side || "",
        Quantity: e.quantity || 0,
        "Entry Price": e.entryPrice || 0,
        "Exit Price": e.exitPrice || 0,
        "Realized PnL": e.realizedPnl || 0,
        "Opened At": e.openedAt ? new Date(e.openedAt).toISOString().split("T")[0] : "",
        "Closed At": e.closedAt ? new Date(e.closedAt).toISOString().split("T")[0] : "",
        "Setup Type": e.setupType || "",
        Strategy: e.strategy || "",
      }));

      const csv = Papa.unparse(rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="tax_report_${year}.csv"`);
      res.send("\uFEFF" + csv);
    } catch (err: any) {
      console.error("[Tax Report Export] Error:", err.message);
      safeErrorResponse(res, err, 500, "שגיאה בייצוא דוח מס");
    }
  });

  // ─── Risk Analytics ─────────────────────────────
  app.get("/api/v1/journal/risk-analytics", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
      const drawdownLimit = req.query.drawdownLimit ? parseFloat(req.query.drawdownLimit as string) : undefined;

      const entries = await storage.getJournalEntries(userId, { dateFrom, dateTo, accountId });

      let drawdownLimitPct = drawdownLimit;
      let drawdownLimitAbs = 0;
      let accountBalance = 0;
      const userAccounts = await storage.getAccounts(userId);

      function resolveFromAccount(acct: typeof userAccounts[0]) {
        if (acct.maxDrawdown && acct.maxDrawdown > 0) {
          drawdownLimitAbs = acct.maxDrawdown;
          accountBalance = acct.balance || acct.size || 0;
          if (accountBalance > 0) {
            drawdownLimitPct = (acct.maxDrawdown / accountBalance) * 100;
          }
        }
      }

      if (!drawdownLimitPct && accountId) {
        const ownedAccount = userAccounts.find(a => a.id === accountId);
        if (ownedAccount) resolveFromAccount(ownedAccount);
      }
      if (!drawdownLimitPct) {
        const acctWithDD = userAccounts.find(a => a.maxDrawdown && a.maxDrawdown > 0);
        if (acctWithDD) resolveFromAccount(acctWithDD);
      }

      const sorted = [...entries]
        .filter(e => e.closedAt)
        .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

      const pnls = sorted.map(e => e.realizedPnl || 0);

      let peak = 0;
      let equity = 0;
      let maxDrawdown = 0;
      let currentDrawdown = 0;
      const drawdownCurve: { date: string; equity: number; drawdown: number; peak: number }[] = [];
      const dailyPnlMap = new Map<string, number>();

      for (const e of sorted) {
        const dateStr = new Date(e.closedAt!).toISOString().split("T")[0];
        dailyPnlMap.set(dateStr, (dailyPnlMap.get(dateStr) || 0) + (e.realizedPnl || 0));
      }

      const startingEquity = accountBalance > 0 ? accountBalance : 0;
      equity = startingEquity;
      peak = startingEquity;
      let maxDrawdownAbs = 0;
      for (const [date, dayPnl] of [...dailyPnlMap.entries()].sort()) {
        equity += dayPnl;
        if (equity > peak) peak = equity;
        const ddAbs = peak - equity;
        const ddPct = peak > 0 ? (ddAbs / peak) * 100 : (ddAbs > 0 ? 100 : 0);
        if (ddAbs > maxDrawdownAbs) maxDrawdownAbs = ddAbs;
        if (ddPct > maxDrawdown) maxDrawdown = ddPct;
        currentDrawdown = ddPct;
        drawdownCurve.push({ date, equity, drawdown: ddPct, peak });
      }

      const wins = pnls.filter(p => p > 0);
      const losses = pnls.filter(p => p < 0);
      const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + p, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, p) => s + p, 0) / losses.length) : 0;
      const riskRewardRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

      const dailyReturns = [...dailyPnlMap.values()];
      const meanReturn = dailyReturns.length > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;

      let variance = 0;
      let downsideVariance = 0;
      for (const r of dailyReturns) {
        variance += (r - meanReturn) ** 2;
        if (r < 0) downsideVariance += r ** 2;
      }
      const stdDev = dailyReturns.length > 1 ? Math.sqrt(variance / (dailyReturns.length - 1)) : 0;
      const downsideStdDev = dailyReturns.length > 1 ? Math.sqrt(downsideVariance / (dailyReturns.length - 1)) : 0;

      const annualizationFactor = Math.sqrt(252);
      const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * annualizationFactor : 0;
      const sortinoRatio = downsideStdDev > 0 ? (meanReturn / downsideStdDev) * annualizationFactor : 0;

      const symbolExposure: { symbol: string; tradeCount: number; totalVolume: number; totalPnl: number; percentage: number; avgPnl: number }[] = [];
      const symbolMap = new Map<string, { count: number; volume: number; pnl: number }>();
      let totalVolume = 0;

      for (const e of sorted) {
        const sym = e.symbol || "Unknown";
        const vol = (e.quantity || 1) * (e.entryPrice || 0);
        totalVolume += vol;
        const prev = symbolMap.get(sym) || { count: 0, volume: 0, pnl: 0 };
        prev.count++;
        prev.volume += vol;
        prev.pnl += e.realizedPnl || 0;
        symbolMap.set(sym, prev);
      }

      for (const [symbol, data] of symbolMap.entries()) {
        symbolExposure.push({
          symbol,
          tradeCount: data.count,
          totalVolume: data.volume,
          totalPnl: data.pnl,
          percentage: totalVolume > 0 ? (data.volume / totalVolume) * 100 : 0,
          avgPnl: data.count > 0 ? data.pnl / data.count : 0,
        });
      }
      symbolExposure.sort((a, b) => b.percentage - a.percentage);

      const drawdownWarning = drawdownLimitPct && currentDrawdown >= drawdownLimitPct * 0.8;
      const drawdownCritical = drawdownLimitPct && currentDrawdown >= drawdownLimitPct;

      res.json({
        maxDrawdown,
        maxDrawdownAbs,
        currentDrawdown,
        sharpeRatio,
        sortinoRatio,
        riskRewardRatio: riskRewardRatio === Infinity ? null : riskRewardRatio,
        avgWin,
        avgLoss,
        totalTrades: sorted.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        drawdownCurve,
        symbolExposure,
        dailyReturns: dailyReturns.length,
        meanDailyReturn: meanReturn,
        stdDevDaily: stdDev,
        drawdownWarning: !!drawdownWarning,
        drawdownCritical: !!drawdownCritical,
        drawdownLimitPct: drawdownLimitPct || null,
        drawdownLimitAbs: drawdownLimitAbs || null,
      });
    } catch (err: any) {
      console.error("[Risk Analytics] Error:", err.message);
      safeErrorResponse(res, err, 500, "שגיאה בחישוב ניתוח סיכונים");
    }
  });

  // ─── Benchmark ─────────────────────────────────
  app.get("/api/v1/journal/benchmark", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const dayOfWeek = now.getDay();
      const currentWeekStart = new Date(now);
      currentWeekStart.setDate(now.getDate() - dayOfWeek);
      currentWeekStart.setHours(0, 0, 0, 0);

      const yearStart = new Date(now.getFullYear(), 0, 1);

      const allEntries = await storage.getJournalEntries(userId, {});

      function calcStats(entries: typeof allEntries) {
        const wins = entries.filter(e => (e.realizedPnl || 0) > 0);
        const totalPnl = entries.reduce((s, e) => s + (e.realizedPnl || 0), 0);
        return {
          trades: entries.length,
          pnl: totalPnl,
          winRate: entries.length > 0 ? (wins.length / entries.length) * 100 : 0,
        };
      }

      const currentMonthEntries = allEntries.filter(e => {
        const d = e.closedAt ? new Date(e.closedAt) : null;
        return d && d >= currentMonthStart && d <= now;
      });

      const prevMonthEntries = allEntries.filter(e => {
        const d = e.closedAt ? new Date(e.closedAt) : null;
        return d && d >= prevMonthStart && d <= prevMonthEnd;
      });

      const currentWeekEntries = allEntries.filter(e => {
        const d = e.closedAt ? new Date(e.closedAt) : null;
        return d && d >= currentWeekStart && d <= now;
      });

      const weekMap = new Map<string, typeof allEntries>();
      for (const e of allEntries) {
        const d = e.closedAt ? new Date(e.closedAt) : null;
        if (!d) continue;
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const key = weekStart.toISOString().split("T")[0];
        const arr = weekMap.get(key) || [];
        arr.push(e);
        weekMap.set(key, arr);
      }

      const weeklyPnls = [...weekMap.values()].map(w => w.reduce((s, e) => s + (e.realizedPnl || 0), 0));
      const weeklyTrades = [...weekMap.values()].map(w => w.length);
      const weeklyWinRates = [...weekMap.values()].map(w => {
        const wins = w.filter(e => (e.realizedPnl || 0) > 0).length;
        return w.length > 0 ? (wins / w.length) * 100 : 0;
      });

      const avgWeeklyPnl = weeklyPnls.length > 0 ? weeklyPnls.reduce((a, b) => a + b, 0) / weeklyPnls.length : 0;
      const avgWeeklyTrades = weeklyTrades.length > 0 ? weeklyTrades.reduce((a, b) => a + b, 0) / weeklyTrades.length : 0;
      const avgWeeklyWinRate = weeklyWinRates.length > 0 ? weeklyWinRates.reduce((a, b) => a + b, 0) / weeklyWinRates.length : 0;

      const yearEntries = allEntries.filter(e => {
        const d = e.closedAt ? new Date(e.closedAt) : null;
        return d && d >= yearStart && d <= now;
      });
      const yearPnl = yearEntries.reduce((s, e) => s + (e.realizedPnl || 0), 0);

      const goals = await storage.getTradingGoals(userId);

      res.json({
        currentMonth: calcStats(currentMonthEntries),
        previousMonth: calcStats(prevMonthEntries),
        currentWeek: calcStats(currentWeekEntries),
        weeklyAverage: {
          pnl: avgWeeklyPnl,
          trades: avgWeeklyTrades,
          winRate: avgWeeklyWinRate,
        },
        yearPnl,
        goals: goals ? {
          monthlyPnlTarget: goals.monthlyPnlTarget,
          yearlyPnlTarget: goals.yearlyPnlTarget,
        } : null,
      });
    } catch (err: any) {
      console.error("[Benchmark] Error:", err.message);
      safeErrorResponse(res, err, 500, "שגיאה בהפקת מדדי ביצועים");
    }
  });

  // ─── Trading Goals ────────────────────────────────
  app.get("/api/v1/journal/goals", async (req, res) => {
    const userId = req.session.userId!;
    const goals = await storage.getTradingGoals(userId);
    res.json(goals || null);
  });

  app.post("/api/v1/journal/goals", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const schema = z.object({
        monthlyPnlTarget: z.number().nullable().optional(),
        yearlyPnlTarget: z.number().nullable().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data" });
      const goals = await storage.upsertTradingGoals({
        userId,
        monthlyPnlTarget: parsed.data.monthlyPnlTarget ?? null,
        yearlyPnlTarget: parsed.data.yearlyPnlTarget ?? null,
      });
      res.json(goals);
    } catch (err: any) {
      console.error("[Goals] Error:", err.message);
      safeErrorResponse(res, err, 500, "שגיאה בשמירת יעדים");
    }
  });

  // ─── Shared Reports ─────────────────────────────
  app.get("/api/v1/reports/shared", async (req, res) => {
    const userId = req.session.userId!;
    const reports = await storage.getSharedReports(userId);
    res.json(reports);
  });

  app.post("/api/v1/reports/shared", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { title, reportType, dateFrom, dateTo, includeFields } = req.body;
      if (!title || typeof title !== "string") return res.status(400).json({ message: "Title is required" });

      const VALID_FIELDS = ["winRate", "profitFactor", "totalPnl", "totalTrades", "equityCurve", "bySymbol", "byTag", "byWeekday", "avgWin", "avgLoss", "bestTrade", "worstTrade", "winners", "losers"];
      const rawFields = Array.isArray(includeFields) ? includeFields : ["winRate", "profitFactor", "totalPnl", "totalTrades", "equityCurve", "bySymbol"];
      const fields = rawFields.filter((f: string) => VALID_FIELDS.includes(f));

      const analytics = await storage.getJournalAnalytics(userId, dateFrom || undefined, dateTo || undefined);
      const user = await storage.getUserById(userId);

      const snapshot: Record<string, any> = { generatedAt: new Date().toISOString(), traderName: user?.name || "Trader" };
      for (const f of fields) {
        if (f in analytics) snapshot[f] = (analytics as any)[f];
      }

      const shareToken = crypto.randomBytes(16).toString("hex");
      const report = await storage.createSharedReport({
        userId,
        shareToken,
        title,
        reportType: reportType || "performance",
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        includeFields: fields,
        snapshotData: snapshot,
        isActive: true,
        expiresAt: null,
      });

      res.json(report);
    } catch (err: any) {
      console.error("[Shared Report] Error:", err.message);
      safeErrorResponse(res, err, 500, "שגיאה ביצירת דוח משותף");
    }
  });

  app.delete("/api/v1/reports/shared/:id", async (req, res) => {
    const userId = req.session.userId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid report ID" });
    const reports = await storage.getSharedReports(userId);
    if (!reports.find(r => r.id === id)) return res.status(404).json({ message: "Report not found" });
    await storage.deleteSharedReport(id);
    res.json({ success: true });
  });

  app.patch("/api/v1/reports/shared/:id", async (req, res) => {
    const userId = req.session.userId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid report ID" });
    const reports = await storage.getSharedReports(userId);
    if (!reports.find(r => r.id === id)) return res.status(404).json({ message: "Report not found" });
    const allowedFields: Record<string, any> = {};
    if (typeof req.body.isActive === "boolean") allowedFields.isActive = req.body.isActive;
    if (req.body.title && typeof req.body.title === "string") allowedFields.title = req.body.title;
    if (Object.keys(allowedFields).length === 0) return res.status(400).json({ message: "No valid fields to update" });
    const updated = await storage.updateSharedReport(id, allowedFields);
    res.json(updated);
  });

  // ─── Journal Alerts ─────────────────────────────
  app.get("/api/v1/journal/alerts", async (req, res) => {
    try {
      const userId = req.session.userId!;
      await analyzeAndGenerateAlerts(userId);
      const alerts = await storage.getJournalAlerts(userId);
      res.json(alerts);
    } catch (err: any) {
      console.error("[Journal Alerts] Error:", err.message);
      safeErrorResponse(res, err, 500, "שגיאה בשליפת התראות");
    }
  });

  app.patch("/api/v1/journal/alerts/:id/read", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const alerts = await storage.getJournalAlerts(userId);
      const alert = alerts.find(a => a.id === id);
      if (!alert) return res.status(404).json({ message: "Alert not found" });
      const updated = await storage.markJournalAlertRead(id);
      res.json(updated);
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "שגיאה בסימון התראה כנקראה");
    }
  });

  app.patch("/api/v1/journal/alerts/read-all", async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.markAllJournalAlertsRead(userId);
      res.json({ success: true });
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "שגיאה בסימון כל ההתראות כנקראו");
    }
  });

  app.get("/api/v1/journal/alerts/settings", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const settings = await storage.getJournalAlertSettings(userId);
      res.json(settings || { maxDailyLoss: null, maxConsecutiveLosses: 3, winRateDropThreshold: 10, enabled: true });
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "שגיאה בשליפת הגדרות התראות");
    }
  });

  app.post("/api/v1/journal/alerts/settings", async (req, res) => {
    try {
      const userId = req.session.userId!;
      const alertSettingsSchema = z.object({
        maxDailyLoss: z.number().positive().nullable().optional(),
        maxConsecutiveLosses: z.number().int().min(1).max(50).optional().default(3),
        winRateDropThreshold: z.number().min(1).max(100).optional().default(10),
        enabled: z.boolean().optional().default(true),
      });
      const parsed = alertSettingsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid data" });
      const { maxDailyLoss, maxConsecutiveLosses, winRateDropThreshold, enabled } = parsed.data;
      const settings = await storage.upsertJournalAlertSettings({
        userId,
        maxDailyLoss: maxDailyLoss ?? null,
        maxConsecutiveLosses,
        winRateDropThreshold,
        enabled,
      });
      res.json(settings);
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "שגיאה בשמירת הגדרות התראות");
    }
  });

  // ─── Public Shared Report View ──────────────────
  app.get("/api/v1/public/report/:token", async (req, res) => {
    try {
      const report = await storage.getSharedReportByToken(req.params.token);
      if (!report) return res.status(404).json({ message: "Report not found" });
      if (!report.isActive) return res.status(410).json({ message: "Report is no longer active" });
      if (report.expiresAt && new Date(report.expiresAt) < new Date()) {
        return res.status(410).json({ message: "Report has expired" });
      }

      await storage.incrementReportViewCount(report.id);

      res.json({
        title: report.title,
        reportType: report.reportType,
        dateFrom: report.dateFrom,
        dateTo: report.dateTo,
        data: report.snapshotData,
        createdAt: report.createdAt,
      });
    } catch (err: any) {
      safeErrorResponse(res, err, 500, "שגיאה בטעינת דוח");
    }
  });

  app.get("/api/v1/journal/market-data", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      await ensureMarketDataTable();
      const symbol = req.query.symbol as string;
      const start = req.query.start as string;
      const end = req.query.end as string;
      const interval = (req.query.interval as string) || "1h";

      if (!symbol || !start || !end) {
        return res.status(400).json({ message: "symbol, start, and end are required" });
      }

      const validIntervals = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1wk"];
      if (!validIntervals.includes(interval)) {
        return res.status(400).json({ message: `Invalid interval. Must be one of: ${validIntervals.join(", ")}` });
      }

      const resolved = resolveSymbol(symbol);
      if (!resolved) {
        return res.status(400).json({ message: `Unknown or unsupported symbol: ${symbol}` });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ message: "Invalid start or end date" });
      }

      const result = await getMarketData(symbol, startDate, endDate, interval);
      res.json(result);
    } catch (err: any) {
      console.error("[MarketData] Error:", err.message);
      res.status(502).json({ message: err.message || "Failed to fetch market data" });
    }
  });
}
