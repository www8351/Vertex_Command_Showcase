import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { collectFullChecklist, registerHealthSSECountProvider, registerPushSystemError } from "./latency-monitor";
import { recordLatency } from "./latency-monitor";
import { getEngineStatus, getEngineMapSizes } from "./copy-trading-engine";

interface ErrorEntry {
  id: number;
  timestamp: number;
  severity: "error" | "warning" | "info";
  source: string;
  message: string;
}

const MAX_ERROR_BUFFER = 200;
let errorIdCounter = 0;
const errorBuffer: ErrorEntry[] = [];

export function pushSystemError(severity: "error" | "warning" | "info", source: string, message: string): void {
  errorIdCounter++;
  errorBuffer.push({
    id: errorIdCounter,
    timestamp: Date.now(),
    severity,
    source,
    message: message.substring(0, 500),
  });
  if (errorBuffer.length > MAX_ERROR_BUFFER) {
    errorBuffer.splice(0, errorBuffer.length - MAX_ERROR_BUFFER);
  }
}

export function getErrorBuffer(): ErrorEntry[] {
  return [...errorBuffer];
}

const PING_TIMEOUT_MS = 4000;

async function pingStripeApi(): Promise<{ connected: boolean; latencyMs: number | null }> {
  try {
    const start = Date.now();
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return { connected: false, latencyMs: null };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const res = await fetch("https://api.stripe.com/v1/products?limit=1", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    recordLatency("external", "stripe_api", latencyMs);
    return { connected: res.ok, latencyMs };
  } catch {
    return { connected: false, latencyMs: null };
  }
}

async function pingOpenAiApi(): Promise<{ connected: boolean; latencyMs: number | null }> {
  try {
    const start = Date.now();
    const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
    if (!key) return { connected: false, latencyMs: null };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    recordLatency("external", "openai_api", latencyMs);
    return { connected: res.ok, latencyMs };
  } catch {
    return { connected: false, latencyMs: null };
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  storage.getUserById(req.session.userId).then(user => {
    if (!user || user.role !== "admin") return res.status(403).json({ message: "Admin access required" });
    next();
  }).catch(() => {
    res.status(500).json({ message: "Internal error" });
  });
}

type IntegrationStatusValue = "connected" | "warning" | "disconnected";

interface CategoryPayload {
  id: string;
  items: Array<{ id: string; connected: boolean; currentLatencyMs: number | null }>;
}

function deriveIntegrationStatus(connected: boolean, latencyMs: number | null, threshold: number): IntegrationStatusValue {
  if (!connected) return "disconnected";
  if (latencyMs != null && latencyMs > threshold) return "warning";
  return "connected";
}

function extractIntegration(categories: CategoryPayload[], categoryId: string, itemId: string, warnThreshold: number) {
  const cat = categories.find(c => c.id === categoryId);
  const item = cat?.items.find(i => i.id === itemId);
  const connected = item?.connected ?? false;
  const latencyMs = item?.currentLatencyMs ?? null;
  return {
    connected,
    latencyMs,
    status: deriveIntegrationStatus(connected, latencyMs, warnThreshold),
  };
}

async function collectEnginePulse() {
  const engineStatus = getEngineStatus();
  const mapSizes = getEngineMapSizes();

  let totalAccountCount = 0;
  try {
    const allAccounts = await storage.getAllAccounts();
    totalAccountCount = allAccounts.length;
  } catch {}

  return {
    copyTrading: {
      active: engineStatus.activeGroups > 0,
      activeGroups: engineStatus.activeGroups,
      groupIds: engineStatus.groupIds,
      positionsTracked: mapSizes.lastKnownPositions,
      ordersInFlight: mapSizes.activeTimers,
      consecutiveErrors: mapSizes.consecutiveErrors,
    },
    ruleEngine: {
      active: totalAccountCount > 0,
      accountsManaged: totalAccountCount,
    },
    prioritiesEngine: {
      active: totalAccountCount > 0,
      accountsManaged: totalAccountCount,
    },
  };
}

async function collectStreamPayload() {
  const [checklist, stripePing, openaiPing, enginePulse] = await Promise.all([
    collectFullChecklist(),
    pingStripeApi(),
    pingOpenAiApi(),
    collectEnginePulse(),
  ]);

  const tradovate = extractIntegration(checklist.categories, "data_pipeline", "tradovate_ws", 500);
  const topstepx = extractIntegration(checklist.categories, "data_pipeline", "topstepx_poll", 100);

  return {
    ...checklist,
    integrations: {
      tradovate: { connected: tradovate.connected, latencyMs: tradovate.latencyMs, status: tradovate.status },
      topstepx: { connected: topstepx.connected, latencyMs: topstepx.latencyMs, status: topstepx.status },
      stripe: { connected: stripePing.connected, latencyMs: stripePing.latencyMs, status: deriveIntegrationStatus(stripePing.connected, stripePing.latencyMs, 500) },
      openai: { connected: openaiPing.connected, latencyMs: openaiPing.latencyMs, status: deriveIntegrationStatus(openaiPing.connected, openaiPing.latencyMs, 1000) },
    },
    enginePulse,
    uptime: process.uptime(),
    timestamp: Date.now(),
  };
}

interface SSEClient {
  res: Response;
  lastErrorId: number;
}

const activeSSEClients = new Map<Response, SSEClient>();
let sharedSamplerInterval: ReturnType<typeof setInterval> | null = null;

export function getHealthSSEClientCount(): number {
  return activeSSEClients.size;
}


function startSharedSampler() {
  if (sharedSamplerInterval) return;
  sharedSamplerInterval = setInterval(async () => {
    if (activeSSEClients.size === 0) {
      if (sharedSamplerInterval) {
        clearInterval(sharedSamplerInterval);
        sharedSamplerInterval = null;
      }
      return;
    }

    try {
      const data = await collectStreamPayload();
      const healthMsg = `data: ${JSON.stringify({ type: "health", ...data })}\n\n`;

      for (const [res, client] of activeSSEClients) {
        if (res.destroyed) {
          activeSSEClients.delete(res);
          continue;
        }
        try {
          res.write(healthMsg);
          const newErrors = errorBuffer.filter(e => e.id > client.lastErrorId);
          if (newErrors.length > 0) {
            res.write(`data: ${JSON.stringify({ type: "errors", errors: newErrors })}\n\n`);
            client.lastErrorId = newErrors[newErrors.length - 1].id;
          }
        } catch {
          activeSSEClients.delete(res);
        }
      }
    } catch (err: any) {
      pushSystemError("error", "health-stream", `Sampler error: ${err.message}`);
    }
  }, 5000);
}

export function registerSystemHealthStreamRoutes(app: Express): void {
  registerHealthSSECountProvider(getHealthSSEClientCount);
  registerPushSystemError(pushSystemError);

  app.get("/api/v1/system/health/stream", requireAdmin, async (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    let lastErrorId = errorIdCounter;
    const existingErrors = errorBuffer.slice(-50);
    if (existingErrors.length > 0) {
      res.write(`data: ${JSON.stringify({ type: "errorBatch", errors: existingErrors })}\n\n`);
      lastErrorId = existingErrors[existingErrors.length - 1].id;
    }

    activeSSEClients.set(res, { res, lastErrorId });

    try {
      const data = await collectStreamPayload();
      res.write(`data: ${JSON.stringify({ type: "health", ...data })}\n\n`);
    } catch {}

    startSharedSampler();

    req.on("close", () => {
      activeSSEClients.delete(res);
    });
  });
}
