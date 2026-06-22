import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { insertPlaybookSchema, insertTradeTagSchema, insertTradeScreenshotSchema } from "@shared/journal-schema";
import { z } from "zod";
import { safeErrorResponse } from "./sanitize";
import { isLinkedUser } from "./linked-users";

function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

export function registerPlaybookRoutes(app: Express) {
  app.get("/api/v1/playbooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const result = await storage.getPlaybooks(userId);
      res.json(result);
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.get("/api/v1/playbooks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const pb = await storage.getPlaybook(id);
      if (!pb) return res.status(404).json({ message: "Playbook not found" });
      if (!await isLinkedUser(req.session.userId!, pb.userId)) return res.status(403).json({ message: "Access denied" });
      res.json(pb);
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.post("/api/v1/playbooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = insertPlaybookSchema.safeParse({ ...req.body, userId: req.session.userId! });
      if (!parsed.success) return res.status(400).json({ message: "Invalid input", details: parsed.error.errors });
      const created = await storage.createPlaybook(parsed.data);
      res.status(201).json(created);
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.patch("/api/v1/playbooks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const existing = await storage.getPlaybook(id);
      if (!existing) return res.status(404).json({ message: "Playbook not found" });
      if (!await isLinkedUser(req.session.userId!, existing.userId)) return res.status(403).json({ message: "Access denied" });
      // SECURITY: validate + strip userId so the body can't reassign the row to another user (mass-assignment).
      const parsed = insertPlaybookSchema.omit({ userId: true }).partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid input", details: parsed.error.errors });
      const updated = await storage.updatePlaybook(id, parsed.data);
      res.json(updated);
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.delete("/api/v1/playbooks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const existing = await storage.getPlaybook(id);
      if (!existing) return res.status(404).json({ message: "Playbook not found" });
      if (!await isLinkedUser(req.session.userId!, existing.userId)) return res.status(403).json({ message: "Access denied" });
      await storage.deletePlaybook(id);
      res.json({ success: true });
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.get("/api/v1/playbooks/:id/stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const pb = await storage.getPlaybook(id);
      if (!pb) return res.status(404).json({ message: "Playbook not found" });
      if (!await isLinkedUser(req.session.userId!, pb.userId)) return res.status(403).json({ message: "Access denied" });

      const entries = await storage.getJournalEntries(pb.userId, {});
      const pbEntries = entries.filter(e => e.playbookId === id);
      const winners = pbEntries.filter(e => (e.realizedPnl ?? 0) > 0);
      const losers = pbEntries.filter(e => (e.realizedPnl ?? 0) < 0);
      const totalPnl = pbEntries.reduce((sum, e) => sum + (e.realizedPnl ?? 0), 0);

      res.json({
        totalTrades: pbEntries.length,
        winners: winners.length,
        losers: losers.length,
        winRate: pbEntries.length > 0 ? (winners.length / pbEntries.length) * 100 : 0,
        totalPnl,
        avgPnl: pbEntries.length > 0 ? totalPnl / pbEntries.length : 0,
        bestTrade: pbEntries.length > 0 ? Math.max(...pbEntries.map(e => e.realizedPnl ?? 0)) : 0,
        worstTrade: pbEntries.length > 0 ? Math.min(...pbEntries.map(e => e.realizedPnl ?? 0)) : 0,
      });
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.get("/api/v1/trade-tags", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const result = await storage.getTradeTags(userId);
      res.json(result);
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.post("/api/v1/trade-tags", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = insertTradeTagSchema.safeParse({ ...req.body, userId: req.session.userId! });
      if (!parsed.success) return res.status(400).json({ message: "Invalid input", details: parsed.error.errors });
      const created = await storage.createTradeTag(parsed.data);
      res.status(201).json(created);
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.patch("/api/v1/trade-tags/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const existing = await storage.getTradeTag(id);
      if (!existing) return res.status(404).json({ message: "Tag not found" });
      if (!await isLinkedUser(req.session.userId!, existing.userId)) return res.status(403).json({ message: "Access denied" });
      // SECURITY: validate + strip userId so the body can't reassign the row to another user (mass-assignment).
      const parsed = insertTradeTagSchema.omit({ userId: true }).partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid input", details: parsed.error.errors });
      const updated = await storage.updateTradeTag(id, parsed.data);
      res.json(updated);
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.delete("/api/v1/trade-tags/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const existing = await storage.getTradeTag(id);
      if (!existing) return res.status(404).json({ message: "Tag not found" });
      if (!await isLinkedUser(req.session.userId!, existing.userId)) return res.status(403).json({ message: "Access denied" });
      await storage.deleteTradeTag(id);
      res.json({ success: true });
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.get("/api/v1/trade-screenshots/:journalEntryId", requireAuth, async (req: Request, res: Response) => {
    try {
      const journalEntryId = parseInt(req.params.journalEntryId);
      if (isNaN(journalEntryId)) return res.status(400).json({ message: "Invalid ID" });
      const entry = await storage.getJournalEntry(journalEntryId);
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      if (!await isLinkedUser(req.session.userId!, entry.userId)) return res.status(403).json({ message: "Access denied" });
      const screenshots = await storage.getTradeScreenshots(journalEntryId);
      res.json(screenshots);
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.post("/api/v1/trade-screenshots", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = insertTradeScreenshotSchema.safeParse({ ...req.body, userId: req.session.userId! });
      if (!parsed.success) return res.status(400).json({ message: "Invalid input", details: parsed.error.errors });
      const entry = await storage.getJournalEntry(parsed.data.journalEntryId);
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      if (!await isLinkedUser(req.session.userId!, entry.userId)) return res.status(403).json({ message: "Access denied" });
      const created = await storage.createTradeScreenshot(parsed.data);
      res.status(201).json(created);
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });

  app.delete("/api/v1/trade-screenshots/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      await storage.deleteTradeScreenshot(id);
      res.json({ success: true });
    } catch (err) {
      safeErrorResponse(res, err);
    }
  });
}
