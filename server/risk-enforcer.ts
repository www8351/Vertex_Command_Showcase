import { storage } from "./storage";
import { tradovateAuth, tradovateGetPositions, tradovatePlaceOrder, tradovateGetOrders } from "./tradovate-client";
import { topstepxAuthExport, topstepxGetPositions, topstepxPlaceOrder, topstepxGetOrders } from "./topstepx-client";
import { decryptCredentials } from "./encryption";
import { apiQueue } from "./api-queue";
import { dispatchRiskIntervention } from "./webhook-dispatcher";
import { riskInterventionsTotal } from "./prometheus-metrics";

const flatteningInProgress = new Set<number>();

const COOLDOWN_MS = 60_000;
const lastFlattenTime = new Map<number, number>();

interface FlattenResult {
  positionsClosed: number;
  ordersCancelled: number;
  errors: string[];
}

interface TriggerContext {
  hwm: number;
  currentEquity: number;
  eodLimit: number;
  riskPercent: number;
}

export async function onBreachDetected(
  accountId: number,
  context: TriggerContext
): Promise<void> {
  if (flatteningInProgress.has(accountId)) {
    return;
  }

  const lastTime = lastFlattenTime.get(accountId);
  if (lastTime && Date.now() - lastTime < COOLDOWN_MS) {
    return;
  }

  flatteningInProgress.add(accountId);
  const startMs = Date.now();

  let interventionId: number | undefined;

  try {
    const account = await storage.getAccount(accountId);
    if (!account) {
      console.warn(`[RiskEnforcer] Account ${accountId} not found, skipping flatten`);
      return;
    }

    const intervention = await storage.createRiskIntervention({
      accountId,
      userId: account.userId ?? undefined,
      triggerTimestamp: new Date(),
      hwm: context.hwm,
      currentEquity: context.currentEquity,
      eodLimit: context.eodLimit,
      riskPercent: context.riskPercent,
      status: "executing",
    });
    interventionId = intervention.id;

    console.log(
      `[RiskEnforcer] BREACH — account=${accountId} name="${account.name}" ` +
      `equity=$${context.currentEquity.toFixed(2)} limit=$${context.eodLimit.toFixed(2)} ` +
      `risk=${(context.riskPercent * 100).toFixed(1)}% — executing flatten`
    );

    const result = await flattenAccount(account);
    const executionMs = Date.now() - startMs;

    await storage.updateRiskIntervention(interventionId, {
      positionsClosed: result.positionsClosed,
      ordersCancelled: result.ordersCancelled,
      status: result.errors.length > 0 ? "partial" : "completed",
      errorMessage: result.errors.length > 0 ? result.errors.join("; ") : undefined,
      executionMs,
      completedAt: new Date(),
    });

    const status = result.errors.length > 0 ? "partial" : "completed";
    riskInterventionsTotal.inc({ type: "auto_flatten", status });

    console.log(
      `[RiskEnforcer] Flatten complete — account=${accountId} ` +
      `positions=${result.positionsClosed} orders=${result.ordersCancelled} ` +
      `time=${executionMs}ms errors=${result.errors.length}`
    );

    if (result.errors.length > 0) {
      console.warn(`[RiskEnforcer] Errors for account ${accountId}:`, result.errors);
    }

    await storage.createAlert({
      accountId,
      type: "risk_intervention",
      severity: "critical",
      title: `Auto-Flatten: ${account.name}`,
      message: `Emergency flatten executed. Closed ${result.positionsClosed} position(s), cancelled ${result.ordersCancelled} order(s). ` +
        `Trigger: equity $${context.currentEquity.toFixed(2)} breached limit $${context.eodLimit.toFixed(2)}.`,
      userId: account.userId,
    });

    dispatchRiskIntervention({
      userId: account.userId,
      accountName: account.name,
      accountId,
      eventType: "drawdown_breach",
      title: `Auto-Flatten: ${account.name}`,
      message: `Emergency flatten executed. Closed ${result.positionsClosed} position(s), cancelled ${result.ordersCancelled} order(s).`,
      equity: context.currentEquity,
      eodLimit: context.eodLimit,
      riskPercent: context.riskPercent,
      positionsClosed: result.positionsClosed,
      ordersCancelled: result.ordersCancelled,
      executionMs,
    });

  } catch (err: any) {
    const executionMs = Date.now() - startMs;
    console.error(`[RiskEnforcer] Fatal error flattening account ${accountId}:`, err.message);

    if (interventionId) {
      await storage.updateRiskIntervention(interventionId, {
        status: "failed",
        errorMessage: err.message,
        executionMs,
        completedAt: new Date(),
      }).catch(() => {});
    }

    const account = await storage.getAccount(accountId).catch(() => null);
    dispatchRiskIntervention({
      userId: account?.userId,
      accountName: account?.name || `Account #${accountId}`,
      accountId,
      eventType: "flatten_failed",
      title: `Flatten FAILED: ${account?.name || accountId}`,
      message: `Emergency flatten failed: ${err.message}`,
      equity: context.currentEquity,
      eodLimit: context.eodLimit,
      riskPercent: context.riskPercent,
      executionMs,
    });
  } finally {
    lastFlattenTime.set(accountId, Date.now());
    flatteningInProgress.delete(accountId);
  }
}

export async function flattenAccount(account: {
  id: number;
  accountId: string;
  integrationConnectionId: number | null;
  externalAccountId: string | null;
  name: string;
}): Promise<FlattenResult> {
  const errors: string[] = [];
  let positionsClosed = 0;
  let ordersCancelled = 0;

  if (!account.integrationConnectionId) {
    errors.push("No broker connection linked to account");
    return { positionsClosed, ordersCancelled, errors };
  }

  const conn = await storage.getConnection(account.integrationConnectionId);
  if (!conn) {
    errors.push("Broker connection not found");
    return { positionsClosed, ordersCancelled, errors };
  }

  const provider = await storage.getProvider(conn.providerId);
  if (!provider) {
    errors.push("Provider not found");
    return { positionsClosed, ordersCancelled, errors };
  }

  let creds: Record<string, any> = {};
  try {
    creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
  } catch {
    errors.push("Failed to decrypt broker credentials");
    return { positionsClosed, ordersCancelled, errors };
  }

  const externalId = account.externalAccountId || "0";

  if (provider.key === "tradovate") {
    const result = await flattenTradovate(creds, externalId, account.accountId, errors);
    positionsClosed = result.positionsClosed;
    ordersCancelled = result.ordersCancelled;
  } else if (provider.key === "topstepx") {
    const result = await flattenTopstepX(creds, externalId, errors);
    positionsClosed = result.positionsClosed;
    ordersCancelled = result.ordersCancelled;
  } else {
    errors.push(`Unsupported provider: ${provider.key}`);
  }

  return { positionsClosed, ordersCancelled, errors };
}

export async function flattenTradovate(
  creds: Record<string, any>,
  externalAccountId: string,
  accountSpec: string,
  errors: string[]
): Promise<{ positionsClosed: number; ordersCancelled: number }> {
  let positionsClosed = 0;
  let ordersCancelled = 0;

  const auth = await tradovateAuth(
    creds.username, creds.password,
    creds.cid ? parseInt(creds.cid) : undefined,
    creds.secret || creds.sec
  );

  const numericId = parseInt(externalAccountId);
  if (!numericId) {
    errors.push("Invalid Tradovate account ID");
    return { positionsClosed, ordersCancelled };
  }

  const orders = await tradovateGetOrders(auth.token, numericId, auth.isLive);
  const workingStatuses = ["Working", "Accepted", "PendingNew", "PendingReplace"];
  const workingOrders = orders.filter(o => workingStatuses.includes(o.ordStatus));

  const baseUrl = auth.isLive
    ? "https://live.tradovateapi.com/v1"
    : "https://demo.tradovateapi.com/v1";

  for (const order of workingOrders) {
    try {
      const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/order/cancelorder`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      if (res.ok) {
        ordersCancelled++;
      } else {
        const text = await res.text();
        errors.push(`Cancel order ${order.id}: ${res.status} ${text}`);
      }
    } catch (err: any) {
      errors.push(`Cancel order ${order.id}: ${err.message}`);
    }
  }

  const positions = await tradovateGetPositions(auth.token, numericId, auth.isLive);
  for (const pos of positions) {
    if (pos.netPos === 0) continue;

    const action = pos.netPos > 0 ? "Sell" : "Buy";
    const qty = Math.abs(pos.netPos);

    try {
      await tradovatePlaceOrder(
        auth.token, accountSpec, numericId,
        pos.contractId, action as "Buy" | "Sell", qty, auth.isLive,
        "Market"
      );
      positionsClosed++;
    } catch (err: any) {
      errors.push(`Close position contract=${pos.contractId}: ${err.message}`);
    }
  }

  return { positionsClosed, ordersCancelled };
}

export async function flattenTopstepX(
  creds: Record<string, any>,
  externalAccountId: string,
  errors: string[]
): Promise<{ positionsClosed: number; ordersCancelled: number }> {
  let positionsClosed = 0;
  let ordersCancelled = 0;

  const auth = await topstepxAuthExport(creds.userName || creds.username, creds.apiKey);

  const numericId = parseInt(externalAccountId);
  if (!numericId) {
    errors.push("Invalid TopstepX account ID");
    return { positionsClosed, ordersCancelled };
  }

  const orders = await topstepxGetOrders(auth.token, numericId);
  const workingStatuses = ["working", "accepted", "pending", "new", "Working", "Accepted", "Pending", "New"];
  const workingOrders = orders.filter(o => workingStatuses.includes(o.status));

  for (const order of workingOrders) {
    try {
      const res = await apiQueue.enqueueFetch("topstepx", `https://api.topstepx.com/api/Order/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      if (res.ok) {
        ordersCancelled++;
      } else {
        const text = await res.text();
        errors.push(`Cancel order ${order.id}: ${res.status} ${text}`);
      }
    } catch (err: any) {
      errors.push(`Cancel order ${order.id}: ${err.message}`);
    }
  }

  const positions = await topstepxGetPositions(auth.token, numericId);
  for (const pos of positions) {
    if (pos.netPosition === 0) continue;

    const action = pos.netPosition > 0 ? "Sell" : "Buy";
    const qty = Math.abs(pos.netPosition);

    try {
      await topstepxPlaceOrder(
        auth.token, numericId,
        pos.contractId, action as "Buy" | "Sell", qty,
        "market"
      );
      positionsClosed++;
    } catch (err: any) {
      errors.push(`Close position contract=${pos.contractId}: ${err.message}`);
    }
  }

  return { positionsClosed, ordersCancelled };
}

export function isFlattening(accountId: number): boolean {
  return flatteningInProgress.has(accountId);
}

export function getFlatteningStatus(): { activeFlattens: number; accountIds: number[] } {
  return {
    activeFlattens: flatteningInProgress.size,
    accountIds: Array.from(flatteningInProgress),
  };
}
