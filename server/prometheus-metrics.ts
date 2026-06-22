import client from "prom-client";

const register = new client.Registry();

client.collectDefaultMetrics({ register, prefix: "vertex_" });

export const httpRequestDuration = new client.Histogram({
  name: "vertex_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: "vertex_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const wsConnectionsActive = new client.Gauge({
  name: "vertex_ws_connections_active",
  help: "Active WebSocket/streaming connections",
  labelNames: ["provider", "type"],
  registers: [register],
});

export const brokerApiLatency = new client.Histogram({
  name: "vertex_broker_api_latency_ms",
  help: "Broker API call latency in milliseconds",
  labelNames: ["provider", "operation"],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [register],
});

export const copyOrderLatency = new client.Histogram({
  name: "vertex_copy_order_latency_ms",
  help: "Copy trading order execution latency in milliseconds",
  labelNames: ["provider"],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

export const riskInterventionsTotal = new client.Counter({
  name: "vertex_risk_interventions_total",
  help: "Total risk interventions triggered",
  labelNames: ["type", "status"],
  registers: [register],
});

export const eventLoopLag = new client.Gauge({
  name: "vertex_eventloop_lag_ms",
  help: "Node.js event loop lag in milliseconds",
  registers: [register],
});

export const inFlightOrders = new client.Gauge({
  name: "vertex_inflight_orders",
  help: "Number of orders currently being executed",
  registers: [register],
});

export const sseClientsActive = new client.Gauge({
  name: "vertex_sse_clients_active",
  help: "Active SSE streaming clients",
  labelNames: ["stream"],
  registers: [register],
});

export const dbQueryLatency = new client.Histogram({
  name: "vertex_db_query_latency_ms",
  help: "Database query latency in milliseconds",
  buckets: [1, 2, 5, 10, 25, 50, 100, 200, 500],
  registers: [register],
});

export const reconciliationRuns = new client.Counter({
  name: "vertex_reconciliation_runs_total",
  help: "Total reconciliation daemon runs",
  labelNames: ["result"],
  registers: [register],
});

export const orphansDetected = new client.Gauge({
  name: "vertex_orphans_detected",
  help: "Orphan positions detected in last reconciliation scan",
  registers: [register],
});

let lagInterval: ReturnType<typeof setInterval> | null = null;

export function startEventLoopMonitoring(): void {
  if (lagInterval) return;
  let lastCheck = process.hrtime.bigint();

  lagInterval = setInterval(() => {
    const now = process.hrtime.bigint();
    const expectedNs = BigInt(1000) * BigInt(1_000_000);
    const actualNs = now - lastCheck;
    const lagMs = Number(actualNs - expectedNs) / 1_000_000;
    eventLoopLag.set(Math.max(0, lagMs));
    lastCheck = now;
  }, 1000);

  lagInterval.unref();
}

export { register };
