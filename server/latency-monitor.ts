import type { Express, Request, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { getEngineStatus } from "./copy-trading-engine";
import { getAllWSClientStates, getSSEClientCount, getExecWSClientStates } from "./tradovate-websocket";
import { getTopstepXClientStates, getExecTopstepXClientStates } from "./topstepx-streaming";
import { apiQueue } from "./api-queue";
import { storage } from "./storage";

interface LatencyRecord {
  timestamp: number;
  durationMs: number;
  label: string;
}

const METRIC_TTL_MS = 5 * 60 * 1000;
const RISK_METRIC_TTL_MS = 60 * 60 * 1000;
const MAX_RECORDS_PER_KEY = 200;

const latencyStore = new Map<string, LatencyRecord[]>();
const LATENCY_STORE_CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

function sweepStaleLatencyKeys() {
  const now = Date.now();
  latencyStore.forEach((records, key) => {
    const category = key.split(":")[0];
    const ttl = category === "risk" ? RISK_METRIC_TTL_MS : METRIC_TTL_MS;
    const cutoff = now - ttl;
    const valid = records.filter(r => r.timestamp > cutoff);
    if (valid.length === 0) {
      latencyStore.delete(key);
    } else if (valid.length !== records.length) {
      latencyStore.set(key, valid);
    }
  });
}

setInterval(sweepStaleLatencyKeys, LATENCY_STORE_CLEANUP_INTERVAL_MS);

let inFlightOrders = 0;

export function incrementInFlightOrders(): void {
  inFlightOrders++;
  inFlightOrdersGauge.set(inFlightOrders);
}

export function decrementInFlightOrders(): void {
  if (inFlightOrders > 0) inFlightOrders--;
  inFlightOrdersGauge.set(inFlightOrders);
}

export function getInFlightOrderCount(): number {
  return inFlightOrders;
}

export function syncPrometheusGauges(wsData: { tradovate: number; topstepx: number; execTradovate: number; execTopstepx: number }, sseCount: number): void {
  wsConnectionsActive.set({ provider: "tradovate", type: "data" }, wsData.tradovate);
  wsConnectionsActive.set({ provider: "topstepx", type: "data" }, wsData.topstepx);
  wsConnectionsActive.set({ provider: "tradovate", type: "execution" }, wsData.execTradovate);
  wsConnectionsActive.set({ provider: "topstepx", type: "execution" }, wsData.execTopstepx);
  sseClientsActive.set({ stream: "trading" }, sseCount);
}

import {
  brokerApiLatency,
  copyOrderLatency,
  dbQueryLatency,
  wsConnectionsActive,
  sseClientsActive,
  inFlightOrders as inFlightOrdersGauge,
} from "./prometheus-metrics";

function emitToPrometheus(category: string, label: string, durationMs: number): void {
  if (category === "pipeline") {
    brokerApiLatency.observe({ provider: label.split("_")[0], operation: label }, durationMs);
  } else if (category === "execution") {
    if (label === "order_fill" || label === "end_to_end") {
      copyOrderLatency.observe({ provider: "all" }, durationMs);
    }
    brokerApiLatency.observe({ provider: "copy", operation: label }, durationMs);
  } else if (category === "infra" && label === "db_query") {
    dbQueryLatency.observe(durationMs);
  } else if (category === "external") {
    brokerApiLatency.observe({ provider: label.replace("_api", ""), operation: "api_call" }, durationMs);
  } else if (category === "risk" && label === "check_latency") {
    brokerApiLatency.observe({ provider: "risk", operation: "check_latency" }, durationMs);
  }
}

export function recordLatency(category: string, label: string, durationMs: number): void {
  emitToPrometheus(category, label, durationMs);

  const key = `${category}:${label}`;
  if (!latencyStore.has(key)) {
    latencyStore.set(key, []);
  }
  const records = latencyStore.get(key)!;
  records.push({ timestamp: Date.now(), durationMs, label });

  if (records.length > MAX_RECORDS_PER_KEY) {
    records.splice(0, records.length - MAX_RECORDS_PER_KEY);
  }

  const ttl = category === "risk" ? RISK_METRIC_TTL_MS : METRIC_TTL_MS;
  const cutoff = Date.now() - ttl;
  const filtered = records.filter(r => r.timestamp > cutoff);
  latencyStore.set(key, filtered);
}

function getMetrics(category: string, label: string): { current: number | null; average: number | null; count: number } {
  const key = `${category}:${label}`;
  const records = latencyStore.get(key);
  if (!records || records.length === 0) {
    return { current: null, average: null, count: 0 };
  }

  const ttl = category === "risk" ? RISK_METRIC_TTL_MS : METRIC_TTL_MS;
  const cutoff = Date.now() - ttl;
  const valid = records.filter(r => r.timestamp > cutoff);
  if (valid.length === 0) return { current: null, average: null, count: 0 };

  const current = Math.round(valid[valid.length - 1].durationMs * 100) / 100;
  const average = Math.round((valid.reduce((sum, r) => sum + r.durationMs, 0) / valid.length) * 100) / 100;
  return { current, average, count: valid.length };
}

interface ChecklistItem {
  id: string;
  name: string;
  status: "green" | "yellow" | "red" | "unknown";
  connected: boolean;
  currentLatencyMs: number | null;
  averageLatencyMs: number | null;
  maxThresholdMs: number;
  detail?: string;
  value?: string | number;
}

interface ChecklistCategory {
  id: string;
  name: string;
  nameHe: string;
  items: ChecklistItem[];
}

function statusFromLatency(current: number | null, threshold: number): "green" | "yellow" | "red" | "unknown" {
  if (current === null) return "unknown";
  if (current <= threshold * 0.6) return "green";
  if (current <= threshold) return "yellow";
  return "red";
}

function statusFromBoolean(ok: boolean): "green" | "red" {
  return ok ? "green" : "red";
}

async function collectDataPipelineMetrics(): Promise<ChecklistCategory> {
  const tradovateStates = getAllWSClientStates();
  const topstepxStates = getTopstepXClientStates();

  const tradovateConnected = tradovateStates.filter(s => s.state === "connected").length;
  const tradovateTotal = tradovateStates.length;
  const tradovateMetrics = getMetrics("pipeline", "tradovate_ws");
  const tradovateHbMetrics = getMetrics("pipeline", "tradovate_ws_heartbeat");
  const tradovateLastMsgAge = tradovateStates
    .filter(s => s.lastMessageAgeMs !== null)
    .reduce((min, s) => Math.min(min, s.lastMessageAgeMs!), Infinity);
  const tradovateLastMsgAgeMs = tradovateLastMsgAge === Infinity ? null : tradovateLastMsgAge;

  const topstepxConnected = topstepxStates.filter(s => s.state === "connected").length;
  const topstepxTotal = topstepxStates.length;
  const topstepxMetrics = getMetrics("pipeline", "topstepx_poll");

  const sseMetrics = getMetrics("pipeline", "sse_broadcast");
  const sseClientCount = getSSEClientCount();
  let lastBroadcastAgeMs: number | null = null;
  const sseKey = "pipeline:sse_broadcast";
  const sseRecords = latencyStore.get(sseKey);
  if (sseRecords && sseRecords.length > 0) {
    lastBroadcastAgeMs = Date.now() - sseRecords[sseRecords.length - 1].timestamp;
  }

  function formatAge(ms: number | null): string {
    if (ms === null) return "N/A";
    if (ms < 1000) return `${ms}ms ago`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
    return `${Math.round(ms / 60000)}m ago`;
  }

  return {
    id: "data_pipeline",
    name: "Data Pipeline (Zero Latency Pipeline)",
    nameHe: "צינור נתונים (Zero Latency Pipeline)",
    items: [
      {
        id: "tradovate_ws",
        name: "Tradovate WebSocket",
        status: tradovateTotal > 0
          ? (tradovateConnected > 0
            ? (tradovateMetrics.current !== null ? statusFromLatency(tradovateMetrics.current, 500) : "green")
            : "red")
          : "unknown",
        connected: tradovateConnected > 0,
        currentLatencyMs: tradovateMetrics.current,
        averageLatencyMs: tradovateMetrics.average,
        maxThresholdMs: 500,
        detail: tradovateTotal > 0
          ? `${tradovateConnected}/${tradovateTotal} connected | last msg: ${formatAge(tradovateLastMsgAgeMs)}` + (tradovateHbMetrics.count > 0 ? ` | HB interval: ${tradovateHbMetrics.average ?? "?"}ms` : "")
          : "No connections configured",
      },
      {
        id: "topstepx_poll",
        name: "TopstepX Polling",
        status: topstepxTotal > 0
          ? (topstepxConnected > 0
            ? (topstepxMetrics.current !== null ? statusFromLatency(topstepxMetrics.current, 100) : "green")
            : "red")
          : "unknown",
        connected: topstepxConnected > 0,
        currentLatencyMs: topstepxMetrics.current,
        averageLatencyMs: topstepxMetrics.average,
        maxThresholdMs: 100,
        detail: topstepxTotal > 0
          ? `${topstepxConnected}/${topstepxTotal} connected | last poll: ${topstepxMetrics.current ?? "?"}ms (avg: ${topstepxMetrics.average ?? "?"}ms)`
          : "No connections configured",
      },
      {
        id: "sse_broadcast",
        name: "SSE Broadcast",
        status: statusFromLatency(sseMetrics.current, 100),
        connected: true,
        currentLatencyMs: sseMetrics.current,
        averageLatencyMs: sseMetrics.average,
        maxThresholdMs: 100,
        detail: `${sseClientCount} clients connected | ${sseMetrics.count} broadcasts | last: ${formatAge(lastBroadcastAgeMs)}`,
      },
    ],
  };
}

function collectExecutionConnectionMetrics(): ChecklistCategory {
  const execTradovateStates = getExecWSClientStates();
  const execTopstepxStates = getExecTopstepXClientStates();

  const execTradovateConnected = execTradovateStates.filter(s => s.state === "connected").length;
  const execTradovateTotal = execTradovateStates.length;
  const execTopstepxConnected = execTopstepxStates.filter(s => s.state === "connected").length;
  const execTopstepxTotal = execTopstepxStates.length;

  return {
    id: "execution_connections",
    name: "Execution Layer Connections",
    nameHe: "חיבורי שכבת ביצוע",
    items: [
      {
        id: "exec_tradovate_ws",
        name: "Tradovate Execution WS",
        status: execTradovateTotal > 0
          ? (execTradovateConnected > 0 ? "green" : "red")
          : "unknown",
        connected: execTradovateConnected > 0,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        detail: execTradovateTotal > 0
          ? `${execTradovateConnected}/${execTradovateTotal} connected`
          : "No execution connections",
      },
      {
        id: "exec_topstepx_ws",
        name: "TopstepX Execution Stream",
        status: execTopstepxTotal > 0
          ? (execTopstepxConnected > 0 ? "green" : "red")
          : "unknown",
        connected: execTopstepxConnected > 0,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        detail: execTopstepxTotal > 0
          ? `${execTopstepxConnected}/${execTopstepxTotal} connected`
          : "No execution connections",
      },
    ],
  };
}

function collectExecutionMetrics(): ChecklistCategory {
  const detectionMetrics = getMetrics("execution", "detection");
  const executionMetrics = getMetrics("execution", "order_send");
  const fillMetrics = getMetrics("execution", "order_fill");
  const e2eMetrics = getMetrics("execution", "end_to_end");

  const queueStatus = apiQueue.getStatus();
  const queueItems: string[] = [];
  for (const [provider, data] of Object.entries(queueStatus)) {
    const s = data.stats;
    const state = s.queued > 0 ? "processing" : s.throttled > 0 ? "rate-limited" : "idle";
    queueItems.push(`${provider}: ${state} (${s.queued} queued, ${s.active} active)`);
  }

  return {
    id: "execution_engine",
    name: "Smart Copy Trading Engine",
    nameHe: "מנוע ביצוע (Smart Copy Trading)",
    items: [
      {
        id: "detection_latency",
        name: "Detection Latency",
        status: statusFromLatency(detectionMetrics.current, 5),
        connected: true,
        currentLatencyMs: detectionMetrics.current,
        averageLatencyMs: detectionMetrics.average,
        maxThresholdMs: 5,
        detail: "Master position change → processing start",
      },
      {
        id: "execution_latency",
        name: "Execution Latency",
        status: statusFromLatency(executionMetrics.current, 10),
        connected: true,
        currentLatencyMs: executionMetrics.current,
        averageLatencyMs: executionMetrics.average,
        maxThresholdMs: 10,
        detail: "Processing → order sent to broker",
      },
      {
        id: "fill_latency",
        name: "Fill Latency",
        status: statusFromLatency(fillMetrics.current, 50),
        connected: true,
        currentLatencyMs: fillMetrics.current,
        averageLatencyMs: fillMetrics.average,
        maxThresholdMs: 50,
        detail: "Order created → fill confirmation",
      },
      {
        id: "e2e_latency",
        name: "End-to-End Latency",
        status: statusFromLatency(e2eMetrics.current, 100),
        connected: true,
        currentLatencyMs: e2eMetrics.current,
        averageLatencyMs: e2eMetrics.average,
        maxThresholdMs: 100,
        detail: "Master detection → all follower orders sent",
      },
      {
        id: "concurrent_orders",
        name: "Concurrent Orders",
        status: "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        value: getInFlightOrderCount(),
        detail: `${getInFlightOrderCount()} orders in-flight`,
      },
      {
        id: "queue_status",
        name: "Queue Status",
        status: queueItems.some(q => q.includes("rate-limited")) ? "yellow" : "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        detail: queueItems.join(" | ") || "No providers configured",
      },
    ],
  };
}

async function collectRiskShieldMetrics(): Promise<ChecklistCategory> {
  const riskCheckMetrics = getMetrics("risk", "check_latency");
  const blockedMetrics = getMetrics("risk", "blocked_trades");
  const slippageMetrics = getMetrics("risk", "slippage_blocks");
  const drawdownMetrics = getMetrics("risk", "drawdown_blocks");

  let pausedCount = 0;
  try {
    const engineStatus = getEngineStatus();
    for (const groupId of engineStatus.groupIds) {
      const followers = await storage.getCopyFollowers(groupId);
      pausedCount += followers.filter(f => f.status === "paused_risk").length;
    }
  } catch {}

  return {
    id: "risk_shield",
    name: "AI Risk Shield",
    nameHe: "AI Risk Shield",
    items: [
      {
        id: "risk_check_latency",
        name: "Risk Check Latency",
        status: statusFromLatency(riskCheckMetrics.current, 5),
        connected: true,
        currentLatencyMs: riskCheckMetrics.current,
        averageLatencyMs: riskCheckMetrics.average,
        maxThresholdMs: 5,
        detail: "Drawdown + slippage check before execution",
      },
      {
        id: "blocked_trades",
        name: "Blocked Trades (Last Hour)",
        status: "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        value: blockedMetrics.count,
        detail: `${blockedMetrics.count} trades blocked by Risk Shield`,
      },
      {
        id: "slippage_blocks",
        name: "Slippage Blocks (Last Hour)",
        status: "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        value: slippageMetrics.count,
        detail: `${slippageMetrics.count} slippage blocks`,
      },
      {
        id: "drawdown_blocks",
        name: "Drawdown Blocks (Last Hour)",
        status: "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        value: drawdownMetrics.count,
        detail: `${drawdownMetrics.count} drawdown blocks`,
      },
      {
        id: "paused_accounts",
        name: "Active Risk Paused Accounts",
        status: pausedCount > 0 ? "yellow" : "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        value: pausedCount,
        detail: `${pausedCount} accounts in paused_risk`,
      },
    ],
  };
}

let _healthSSECountFn: (() => number) | null = null;
let _pushSystemErrorFn: ((severity: string, source: string, message: string) => void) | null = null;

export function registerHealthSSECountProvider(fn: () => number): void {
  _healthSSECountFn = fn;
}

export function registerPushSystemError(fn: (severity: string, source: string, message: string) => void): void {
  _pushSystemErrorFn = fn;
}

function getHealthSSECount(): number {
  return _healthSSECountFn ? _healthSSECountFn() : 0;
}

async function collectInfrastructureMetrics(): Promise<ChecklistCategory> {
  let dbLatency: number | null = null;
  let dbConnected = false;
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatency = Date.now() - start;
    dbConnected = true;
    recordLatency("infra", "db_query", dbLatency);
  } catch {}

  const dbMetrics = getMetrics("infra", "db_query");

  const queueStatus = apiQueue.getStatus();
  const rateLimitItems: string[] = [];
  for (const [provider, data] of Object.entries(queueStatus)) {
    const s = data.stats;
    const cfg = data.config;
    rateLimitItems.push(`${provider}: ${s.throttled} throttled, ${cfg.maxRequestsPerSecond}/s limit`);
  }
  const anyThrottled = Object.values(queueStatus).some(d => d.stats.throttled > 0);

  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);

  const dataWsCount = getAllWSClientStates().length + getTopstepXClientStates().length;
  const execWsCount = getExecWSClientStates().length + getExecTopstepXClientStates().length;
  const tradingSseCount = getSSEClientCount();
  const healthSseCount = getHealthSSECount();

  return {
    id: "infrastructure",
    name: "System Infrastructure",
    nameHe: "תשתית מערכת",
    items: [
      {
        id: "db_query_latency",
        name: "Database Query Latency",
        status: dbConnected ? statusFromLatency(dbMetrics.current, 200) : "red",
        connected: dbConnected,
        currentLatencyMs: dbMetrics.current,
        averageLatencyMs: dbMetrics.average,
        maxThresholdMs: 200,
        detail: dbConnected ? `Last query: ${dbLatency}ms` : "Database unreachable",
      },
      {
        id: "api_rate_limit",
        name: "API Rate Limit Status",
        status: anyThrottled ? "yellow" : "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        detail: rateLimitItems.join(" | ") || "No rate limits active",
      },
      {
        id: "memory_usage",
        name: "Memory Usage",
        status: heapUsedMB > heapTotalMB * 0.9 ? "red" : heapUsedMB > heapTotalMB * 0.7 ? "yellow" : "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        value: heapUsedMB,
        detail: `Heap: ${heapUsedMB}/${heapTotalMB} MB | RSS: ${rssMB} MB`,
      },
      {
        id: "data_ws_connections",
        name: "Data Layer WS Connections",
        status: "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        value: dataWsCount,
        detail: `${dataWsCount} data connections`,
      },
      {
        id: "exec_ws_connections",
        name: "Execution Layer WS Connections",
        status: "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        value: execWsCount,
        detail: `${execWsCount} execution connections`,
      },
      {
        id: "sse_clients",
        name: "SSE Clients",
        status: "green",
        connected: true,
        currentLatencyMs: null,
        averageLatencyMs: null,
        maxThresholdMs: 0,
        value: tradingSseCount + healthSseCount,
        detail: `${tradingSseCount} trading + ${healthSseCount} health clients`,
      },
    ],
  };
}

function calculateHealthScore(categories: ChecklistCategory[]): number {
  let totalWeight = 0;
  let weightedScore = 0;

  const weights: Record<string, number> = {
    data_pipeline: 25,
    execution_connections: 15,
    execution_engine: 25,
    risk_shield: 15,
    infrastructure: 20,
  };

  for (const cat of categories) {
    const catWeight = weights[cat.id] || 25;
    let catScore = 0;
    let itemCount = 0;

    for (const item of cat.items) {
      itemCount++;
      switch (item.status) {
        case "green": catScore += 100; break;
        case "yellow": catScore += 60; break;
        case "red": catScore += 10; break;
        case "unknown": catScore += 50; break;
      }
    }

    if (itemCount > 0) {
      weightedScore += (catScore / itemCount) * catWeight;
      totalWeight += catWeight;
    }
  }

  return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
}

export function getLatencyStoreSize(): number {
  return latencyStore.size;
}

export function getCopyExecutionMetrics(): Record<string, { current: number | null; average: number | null; count: number }> {
  const keys = [
    "execution:order_fill",
    "risk:check_latency",
    "risk:blocked_trades",
    "risk:slippage_blocks",
    "risk:drawdown_blocks",
  ];
  const result: Record<string, { current: number | null; average: number | null; count: number }> = {};
  for (const key of keys) {
    const [category, label] = key.split(":");
    result[key] = getMetrics(category, label);
  }
  result["inflight_orders"] = { current: getInFlightOrderCount(), average: null, count: 0 };
  return result;
}

export async function collectFullChecklist(): Promise<{ healthScore: number; healthStatus: string; categories: ChecklistCategory[]; engineInfo: { activeGroups: number; groupIds: number[] } }> {
  const [dataPipeline, infrastructure, riskShield] = await Promise.all([
    collectDataPipelineMetrics(),
    collectInfrastructureMetrics(),
    collectRiskShieldMetrics(),
  ]);
  const executionEngine = collectExecutionMetrics();
  const executionConnections = collectExecutionConnectionMetrics();

  const categories = [dataPipeline, executionConnections, executionEngine, riskShield, infrastructure];
  const healthScore = calculateHealthScore(categories);
  const engineStatus = getEngineStatus();

  return {
    healthScore,
    healthStatus: healthScore > 80 ? "healthy" : healthScore > 50 ? "degraded" : "critical",
    categories,
    engineInfo: {
      activeGroups: engineStatus.activeGroups,
      groupIds: engineStatus.groupIds,
    },
  };
}

export function registerLatencyRoutes(app: Express): void {
  app.get("/api/v1/system/latency", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const user = await storage.getUserById(req.session.userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const subscription = await storage.getSubscription(user.id);
      let planKey = "free";
      if (subscription) {
        const plans = await storage.getPlans();
        const plan = plans.find(p => p.id === subscription.planId);
        planKey = plan?.key || "free";
      }

      // Access: Admin role OR Desk-tier plan (Desk plan uses "unlimited" key in billing-routes.ts)
      if (user.role !== "admin" && planKey !== "unlimited" && planKey !== "desk") {
        return res.status(403).json({ message: "Access restricted to Admin and Desk users" });
      }

      const [dataPipeline, infrastructure, riskShield] = await Promise.all([
        collectDataPipelineMetrics(),
        collectInfrastructureMetrics(),
        collectRiskShieldMetrics(),
      ]);
      const executionEngine = collectExecutionMetrics();
      const executionConnections = collectExecutionConnectionMetrics();

      const categories = [dataPipeline, executionConnections, executionEngine, riskShield, infrastructure];
      const healthScore = calculateHealthScore(categories);

      const engineStatus = getEngineStatus();

      res.json({
        healthScore,
        healthStatus: healthScore > 80 ? "healthy" : healthScore > 50 ? "degraded" : "critical",
        categories,
        engineInfo: {
          activeGroups: engineStatus.activeGroups,
          groupIds: engineStatus.groupIds,
        },
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[LatencyMonitor] Error collecting metrics:", errMsg);
      if (_pushSystemErrorFn) _pushSystemErrorFn("error", "latency-monitor", `Metrics collection error: ${errMsg}`);
      res.status(500).json({ message: "Failed to collect latency metrics" });
    }
  });
}
