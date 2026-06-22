import { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { executeWebhookOrderForFollower } from "./copy-trading-engine";
import { recordLatency } from "./latency-monitor";
import { z } from "zod";

const SIGNAL_WEBHOOK_SECRET = process.env.SIGNAL_WEBHOOK_SECRET || "";

// Signal mappings / processed-signal history are GLOBAL copy-trading config
// (no per-user ownership column). They were previously readable/writable by any
// authenticated user, allowing cross-tenant tamper of the symbol→contract map
// and disclosure of every processed signal. Restrict to admins.
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
  const user = await storage.getUserById(req.session.userId);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

const mappingSchema = z.object({
  source: z.string().min(1),
  externalSymbol: z.string().min(1),
  brokerContractId: z.string().min(1),
  description: z.string().optional(),
  active: z.boolean().optional(),
});
const mappingUpdateSchema = mappingSchema.partial();

function verifyHmac(req: Request, res: Response, next: NextFunction) {
  if (!SIGNAL_WEBHOOK_SECRET) {
    console.error("[Signals] SIGNAL_WEBHOOK_SECRET not configured — rejecting all signals");
    return res.status(500).json({ error: "Signal webhook not configured" });
  }

  const signature = req.headers["x-signature-256"] as string
    || req.headers["x-hub-signature-256"] as string;

  if (!signature) {
    return res.status(401).json({ error: "Missing signature header" });
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    return res.status(400).json({ error: "Missing request body" });
  }

  const expected = "sha256=" + crypto
    .createHmac("sha256", SIGNAL_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  if (signature.length !== expected.length) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"))) {
      return res.status(401).json({ error: "Invalid signature" });
    }
  } catch {
    return res.status(401).json({ error: "Invalid signature" });
  }

  next();
}

const signalPayloadSchema = z.object({
  source: z.string().min(1),
  symbol: z.string().min(1),
  action: z.enum(["buy", "sell", "Buy", "Sell", "BUY", "SELL"]),
  quantity: z.number().positive(),
  group_id: z.number().int().positive().optional(),
  group_name: z.string().optional(),
  price: z.number().positive().optional(),
  order_type: z.enum(["Market", "Limit", "Stop", "StopLimit"]).optional(),
  time_in_force: z.enum(["Day", "GTC", "GTD", "FOK", "IOC"]).optional(),
  limit_price: z.number().positive().optional(),
  stop_price: z.number().positive().optional(),
  signal_id: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
});

function computeSignalHash(body: Buffer | string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function registerSignalRoutes(app: Express) {
  app.post("/api/v1/signals", verifyHmac, async (req: Request, res: Response) => {
    const startTime = Date.now();

    const parsed = signalPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid signal payload",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const signal = parsed.data;
    const normalizedAction: "Buy" | "Sell" = signal.action.charAt(0).toUpperCase() + signal.action.slice(1).toLowerCase() as "Buy" | "Sell";

    const rawBody = (req as any).rawBody as Buffer;
    const signalHash = computeSignalHash(rawBody);

    const { inserted, signal: dbSignal } = await storage.insertProcessedSignalAtomic({
      signalHash,
      source: signal.source,
      externalSymbol: signal.symbol,
      action: normalizedAction,
      quantity: signal.quantity,
      groupId: signal.group_id || null,
      status: "received",
      rawPayload: req.body,
    });

    if (!inserted) {
      return res.status(200).json({
        status: "duplicate",
        signal_id: dbSignal.id,
        message: "Signal already processed",
      });
    }

    try {
      const mapping = await storage.getSignalMapping(signal.source, signal.symbol);
      const resolvedSymbol = mapping?.brokerContractId || signal.symbol;

      await storage.updateProcessedSignal(dbSignal.id, {
        resolvedSymbol,
      });

      let group;
      if (signal.group_id) {
        group = await storage.getCopyGroup(signal.group_id);
      } else if (signal.group_name) {
        const activeGroups = await storage.getActiveCopyGroups();
        group = activeGroups.find(g => g.name.toLowerCase() === signal.group_name!.toLowerCase());
      }

      if (!group) {
        const activeGroups = await storage.getActiveCopyGroups();
        if (activeGroups.length === 1) {
          group = activeGroups[0];
        }
      }

      if (!group) {
        await storage.updateProcessedSignal(dbSignal.id, {
          status: "error",
          errorMessage: "No matching copy trading group found",
          processedAt: new Date(),
        });
        return res.status(422).json({
          status: "error",
          signal_id: dbSignal.id,
          error: "No matching copy trading group found. Specify group_id or group_name.",
        });
      }

      if (group.status !== "active") {
        await storage.updateProcessedSignal(dbSignal.id, {
          status: "error",
          errorMessage: `Group "${group.name}" is not active (status: ${group.status})`,
          processedAt: new Date(),
          groupId: group.id,
        });
        return res.status(422).json({
          status: "error",
          signal_id: dbSignal.id,
          error: `Group "${group.name}" is not active`,
        });
      }

      const followers = await storage.getCopyFollowers(group.id);
      const enabledFollowers = followers.filter(f => f.enabled);

      if (enabledFollowers.length === 0) {
        await storage.updateProcessedSignal(dbSignal.id, {
          status: "error",
          errorMessage: "No enabled followers in group",
          processedAt: new Date(),
          groupId: group.id,
        });
        return res.status(422).json({
          status: "error",
          signal_id: dbSignal.id,
          error: "No enabled followers in group",
        });
      }

      const orderParams = {
        orderType: signal.order_type || "Market",
        timeInForce: signal.time_in_force || "Day",
        limitPrice: signal.limit_price,
        stopPrice: signal.stop_price,
      };

      console.log(`[Signals] Processing signal: ${signal.source} ${signal.symbol}→${resolvedSymbol} ${normalizedAction} x${signal.quantity} → group "${group.name}" (${enabledFollowers.length} followers)`);

      const results = await Promise.allSettled(
        enabledFollowers.map(follower =>
          executeWebhookOrderForFollower(
            group!,
            follower,
            resolvedSymbol,
            normalizedAction,
            signal.quantity,
            orderParams,
          )
        )
      );

      const executionResults = results.map((r, i) => ({
        followerId: enabledFollowers[i].id,
        followerAccountId: enabledFollowers[i].followerAccountId,
        status: r.status,
        ...(r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason?.message }),
      }));

      const succeeded = executionResults.filter(r => r.status === "fulfilled" && (r as any).success).length;
      const failed = executionResults.length - succeeded;

      const latencyMs = Date.now() - startTime;
      recordLatency("execution", "signal_e2e", latencyMs);

      await storage.updateProcessedSignal(dbSignal.id, {
        status: failed === 0 ? "executed" : succeeded > 0 ? "partial" : "failed",
        resolvedSymbol,
        groupId: group.id,
        executionResults,
        processedAt: new Date(),
        errorMessage: failed > 0 ? `${failed}/${executionResults.length} followers failed` : null,
      });

      console.log(`[Signals] Signal ${dbSignal.id} completed: ${succeeded} succeeded, ${failed} failed (${latencyMs}ms)`);

      return res.status(200).json({
        status: failed === 0 ? "executed" : succeeded > 0 ? "partial" : "failed",
        signal_id: dbSignal.id,
        symbol: signal.symbol,
        resolved_symbol: resolvedSymbol,
        action: normalizedAction,
        quantity: signal.quantity,
        group: group.name,
        followers: {
          total: enabledFollowers.length,
          succeeded,
          failed,
        },
        latency_ms: latencyMs,
        results: executionResults,
      });

    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      console.error(`[Signals] Signal ${dbSignal.id} execution error: ${err.message}`);

      await storage.updateProcessedSignal(dbSignal.id, {
        status: "error",
        errorMessage: err.message,
        processedAt: new Date(),
      });

      return res.status(500).json({
        status: "error",
        signal_id: dbSignal.id,
        error: err.message,
        latency_ms: latencyMs,
      });
    }
  });

  app.get("/api/v1/signals/mappings", requireAdmin, async (req: Request, res: Response) => {
    const source = req.query.source as string | undefined;
    const mappings = await storage.getSignalMappings(source);
    res.json(mappings);
  });

  app.post("/api/v1/signals/mappings", requireAdmin, async (req: Request, res: Response) => {
    const parsed = mappingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid mapping", details: parsed.error.flatten().fieldErrors });
    }
    const mapping = await storage.createSignalMapping(parsed.data);
    res.status(201).json(mapping);
  });

  app.put("/api/v1/signals/mappings/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    // SECURITY: validate + whitelist fields. Never pass raw req.body to the DB
    // update (mass-assignment of arbitrary columns).
    const parsed = mappingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid mapping", details: parsed.error.flatten().fieldErrors });
    }
    const updated = await storage.updateSignalMapping(id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Mapping not found" });
    res.json(updated);
  });

  app.delete("/api/v1/signals/mappings/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const deleted = await storage.deleteSignalMapping(id);
    if (!deleted) return res.status(404).json({ error: "Mapping not found" });
    res.status(204).send();
  });

  app.get("/api/v1/signals/history", requireAdmin, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const signals = await storage.getProcessedSignals(limit, offset);
    res.json(signals);
  });
}
