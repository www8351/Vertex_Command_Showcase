import type { Express } from "express";
import { storage } from "./storage";
import { isAccountSyncEligible } from "./rule-engine";
import { z } from "zod";
import { tradovateAuth, tradovatePlaceOrder, tradovateGetPositions, tradovateGetOrders, type TradovatePosition, type TradovateOrder } from "./tradovate-client";
import { topstepxAuthExport, topstepxPlaceOrder, topstepxGetPositions, topstepxGetOrders } from "./topstepx-client";
import { decryptCredentials } from "./encryption";
import { safeErrorResponse } from "./sanitize";
import { processEquityTick } from "./equity-tick-processor";
import { isLinkedUser } from "./linked-users";
import {
  registerSSEClient,
  getAllWSClientStates,
  getOrCreateWSClient,
  releaseWSClient,
  addWSClientOwner,
  getWSClient,
  broadcastToUser,
  getExecWSClientStates,
  type TradovateWSEvent,
} from "./tradovate-websocket";
import {
  getOrCreateTopstepXClient,
  getTopstepXClient,
  addTopstepXClientOwner,
  releaseTopstepXClient,
  getTopstepXClientStates,
  getExecTopstepXClientStates,
  type TopstepXWSEvent,
} from "./topstepx-streaming";

let sseSessionCounter = 0;
const wsBroadcastBound = new Set<number>();

const CONNECTION_ACCOUNT_CACHE_MAX = 500;
const CONNECTION_ACCOUNT_CACHE_TTL_MS = 5 * 60 * 1000;

const connectionAccountCache = new Map<string, { value: number; expiresAt: number }>();

function connectionAccountCacheCleanup() {
  const now = Date.now();
  const keysToDelete: string[] = [];
  connectionAccountCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) keysToDelete.push(key);
  });
  keysToDelete.forEach(key => connectionAccountCache.delete(key));
  if (connectionAccountCache.size > CONNECTION_ACCOUNT_CACHE_MAX) {
    const entries = Array.from(connectionAccountCache.entries())
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toRemove = entries.slice(0, entries.length - CONNECTION_ACCOUNT_CACHE_MAX);
    toRemove.forEach(([key]) => connectionAccountCache.delete(key));
  }
}

setInterval(connectionAccountCacheCleanup, 60_000);

async function resolveInternalAccountId(connectionId: number, externalAccountId: string): Promise<number | null> {
  const cacheKey = `${connectionId}:${externalAccountId}`;
  const cached = connectionAccountCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const accounts = await storage.getAccountsByConnectionId(connectionId);
  for (const acc of accounts) {
    if (acc.externalAccountId === externalAccountId || acc.accountId === externalAccountId) {
      connectionAccountCache.set(cacheKey, { value: acc.id, expiresAt: Date.now() + CONNECTION_ACCOUNT_CACHE_TTL_MS });
      return acc.id;
    }
  }
  return null;
}

export function getConnectionAccountCacheSize(): number {
  return connectionAccountCache.size;
}

async function handleEquityTickFromStream(connectionId: number, externalAccountId: string, equity: number) {
  try {
    const internalId = await resolveInternalAccountId(connectionId, externalAccountId);
    if (internalId) {
      const result = await processEquityTick(internalId, equity);
      if (result.telemetry && result.userId) {
        broadcastToUser(result.userId, "equityUpdate", result.telemetry);
      }
    }
  } catch (err: any) {
    console.warn(`[EquityStream] Tick processing error (conn=${connectionId}, ext=${externalAccountId}):`, err.message);
  }
}

async function handleEquityTickWithPnl(connectionId: number, externalAccountId: string, pnl: number) {
  try {
    const internalId = await resolveInternalAccountId(connectionId, externalAccountId);
    if (!internalId) return;
    const account = await storage.getAccount(internalId);
    if (!account) return;
    const equity = (account.balance || account.size) + pnl;
    const result = await processEquityTick(internalId, equity);
    if (result.telemetry && result.userId) {
      broadcastToUser(result.userId, "equityUpdate", result.telemetry);
    }
  } catch (err: any) {
    console.warn(`[EquityStream] PnL tick error (conn=${connectionId}, ext=${externalAccountId}):`, err.message);
  }
}

async function handleBrokerStatusChange(connectionId: number, externalAccountId: string, brokerStatus: string, isActive: boolean, userId: number) {
  try {
    const internalId = await resolveInternalAccountId(connectionId, externalAccountId);
    if (!internalId) return;
    const account = await storage.getAccount(internalId);
    if (!account) return;
    const prevActive = (account as any).brokerActive;
    if (prevActive !== false && !isActive) {
      await storage.updateAccount(internalId, {
        brokerStatus,
        brokerActive: false,
        brokerStatusRaw: JSON.stringify({ status: brokerStatus, isActive }),
        brokerStatusUpdatedAt: new Date(),
      });
      await storage.createAlert({
        accountId: internalId,
        type: "broker_status",
        severity: "critical",
        title: `חשבון ${account.name} כובה על ידי הברוקר (זמן אמת)`,
        message: `הברוקר דיווח בזמן אמת שחשבון ${account.name} כבר לא פעיל. סטטוס: ${brokerStatus}. ייתכן שבירת חוקים או בעיה טכנית.`,
        userId,
      });
      broadcastToUser(userId, "brokerStatusChange", { connectionId, accountId: internalId, brokerStatus, isActive });
    }
  } catch (err: any) {
    console.warn(`[EquityStream] Broker status change error:`, err.message);
  }
}

function invalidateAccountCache(connectionId: number) {
  for (const key of connectionAccountCache.keys()) {
    if (key.startsWith(`${connectionId}:`)) {
      connectionAccountCache.delete(key);
    }
  }
}

function bindBroadcastListeners(client: ReturnType<typeof getOrCreateWSClient>, connectionId: number, userId: number) {
  if (wsBroadcastBound.has(connectionId)) return;
  wsBroadcastBound.add(connectionId);

  client.on("position", (event: TradovateWSEvent) => {
    broadcastToUser(userId, "positionUpdate", { connectionId, position: event.entity as TradovatePosition });
  });
  client.on("order", (event: TradovateWSEvent) => {
    broadcastToUser(userId, "orderUpdate", { connectionId, order: event.entity as TradovateOrder });
  });
  client.on("cashBalance", (event: TradovateWSEvent) => {
    broadcastToUser(userId, "balanceUpdate", { connectionId, balance: event.entity });
    const entity = event.entity;
    if (entity && entity.accountId != null && entity.cashBalance != null) {
      handleEquityTickFromStream(connectionId, String(entity.accountId), entity.cashBalance);
    }
  });
  client.on("stateChange", ({ newState }: { newState: string }) => {
    broadcastToUser(userId, "wsStateChange", { connectionId, state: newState });
  });
}

function bindRithmicBroadcastListeners(connectionId: number, userId: number) {
  if (wsBroadcastBound.has(connectionId)) return;
  wsBroadcastBound.add(connectionId);

  const client = getRithmicWSClient(connectionId);
  if (!client) return;

  client.on("position", (event: RithmicWSEvent) => {
    broadcastToUser(userId, "positionUpdate", { connectionId, position: event.entity });
    const entity = event.entity;
    if (entity && entity.accountId && (entity.openPnl != null || entity.closedPnl != null)) {
      const pnl = (entity.openPnl || 0) + (entity.closedPnl || 0);
      handleEquityTickWithPnl(connectionId, String(entity.accountId), pnl);
    }
  });
  client.on("order", (event: RithmicWSEvent) => {
    broadcastToUser(userId, "orderUpdate", { connectionId, order: event.entity });
  });
  client.on("stateChange", ({ newState }: { newState: string }) => {
    broadcastToUser(userId, "wsStateChange", { connectionId, state: newState });
  });
}

function bindTopstepXBroadcastListeners(connectionId: number, userId: number) {
  if (wsBroadcastBound.has(connectionId)) return;
  wsBroadcastBound.add(connectionId);

  const client = getTopstepXClient(connectionId);
  if (!client) return;

  client.on("position", (event: TopstepXWSEvent) => {
    broadcastToUser(userId, "positionUpdate", { connectionId, position: event.entity });
  });
  client.on("equityUpdate", (event: TopstepXWSEvent) => {
    if (event.accountId != null && event.entity?.balance != null) {
      handleEquityTickFromStream(connectionId, String(event.accountId), event.entity.balance);
    }
    if (event.accountId != null && event.entity?.isActive === false) {
      handleBrokerStatusChange(connectionId, String(event.accountId), event.entity.status || "inactive", false, userId);
    }
  });
  client.on("stateChange", ({ newState }: { newState: string }) => {
    broadcastToUser(userId, "wsStateChange", { connectionId, state: newState });
  });
}

const placeOrderSchema = z.object({
  connectionId: z.number(),
  accountSpec: z.string().min(1),
  externalAccountId: z.string().min(1),
  symbol: z.string().min(1),
  action: z.enum(["Buy", "Sell"]),
  quantity: z.number().int().min(1),
  orderType: z.enum(["market", "limit", "stop"]),
  price: z.number().optional(),
  stopPrice: z.number().optional(),
});

async function getProviderAuth(connectionId: number, userId: number) {
  const conn = await storage.getConnection(connectionId);
  if (!conn) throw new Error("Connection not found");
  if (!await isLinkedUser(userId, conn.userId)) {
    const err: any = new Error("Unauthorized");
    err.statusCode = 403;
    throw err;
  }

  const provider = await storage.getProvider(conn.providerId);
  if (!provider) throw new Error("Provider not found");

  let creds: Record<string, any> = {};
  try {
    creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
  } catch (err: any) {
    await storage.updateConnection(connectionId, { status: "error", lastErrorMessage: "Credentials could not be decrypted. Please reconnect your account." });
    throw new Error("Credentials could not be decrypted. Please reconnect your account.");
  }

  if (provider.key === "tradovate") {
    const auth = await tradovateAuth(creds.username, creds.password, creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec);
    return { providerKey: "tradovate" as const, token: auth.token, isLive: auth.isLive };
  } else if (provider.key === "topstepx") {
    const auth = await topstepxAuthExport(creds.username, creds.apiKey);
    return { providerKey: "topstepx" as const, token: auth.token, isLive: false };
  }
  throw new Error(`Provider ${provider.key} not supported for trading`);
}

export function registerTradingRoutes(app: Express) {
  app.post("/api/v1/trading/place-order", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });

    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid data", errors: parsed.error.flatten() });
    }

    const { connectionId, accountSpec, externalAccountId, symbol, action, quantity, orderType, price, stopPrice } = parsed.data;

    if (orderType === "limit" && price == null) {
      return res.status(400).json({ message: "Price is required for limit orders" });
    }
    if (orderType === "stop" && stopPrice == null) {
      return res.status(400).json({ message: "Stop price is required for stop orders" });
    }

    try {
      const conn = await storage.getConnection(connectionId);
      if (conn && (conn as any).integrationMode !== "full") {
        return res.status(403).json({ message: "Connection is in sync-only mode. Enable full integration to trade." });
      }

      const auth = await getProviderAuth(connectionId, req.session.userId!);

      let result: any;
      if (auth.providerKey === "tradovate") {
        const numericAccountId = parseInt(externalAccountId);
        const numericContractId = parseInt(symbol);
        if (isNaN(numericAccountId) || isNaN(numericContractId)) {
          return res.status(400).json({ message: "Invalid account or contract ID for Tradovate" });
        }
        const tradovateOrderType = orderType === "market" ? "Market" : orderType === "limit" ? "Limit" : "Stop";
        result = await tradovatePlaceOrder(
          auth.token,
          accountSpec,
          numericAccountId,
          numericContractId,
          action,
          quantity,
          auth.isLive,
          tradovateOrderType,
          price,
          stopPrice,
        );
      } else if (auth.providerKey === "topstepx") {
        const numericAccountId = parseInt(externalAccountId);
        if (isNaN(numericAccountId)) {
          return res.status(400).json({ message: "Invalid account ID for TopStepX" });
        }
        result = await topstepxPlaceOrder(
          auth.token,
          numericAccountId,
          symbol,
          action,
          quantity,
          orderType,
          price,
          stopPrice,
        );
      }

      res.json({ success: true, order: result });
    } catch (error: any) {
      console.error("[Trading] Place order error:", error.message);
      const status = error.statusCode || 400;
      safeErrorResponse(res, error, status, "שגיאה בשליחת פקודה");
    }
  });

  app.get("/api/v1/trading/positions/:connectionId/:externalAccountId", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });

    const connectionId = parseInt(req.params.connectionId);
    const externalAccountId = req.params.externalAccountId;

    if (isNaN(connectionId)) {
      return res.status(400).json({ message: "Invalid connection ID" });
    }

    try {
      const auth = await getProviderAuth(connectionId, req.session.userId!);

      let positions: any[] = [];
      if (auth.providerKey === "tradovate") {
        const numericId = parseInt(externalAccountId);
        if (isNaN(numericId)) return res.status(400).json({ message: "Invalid account ID" });
        positions = await tradovateGetPositions(auth.token, numericId, auth.isLive);
      } else if (auth.providerKey === "topstepx") {
        const numericId = parseInt(externalAccountId);
        if (isNaN(numericId)) return res.status(400).json({ message: "Invalid account ID" });
        positions = await topstepxGetPositions(auth.token, numericId);
      }

      res.json({ success: true, positions });
    } catch (error: any) {
      console.error("[Trading] Get positions error:", error.message);
      const status = error.statusCode || 400;
      safeErrorResponse(res, error, status, "שגיאה בשליפת פוזיציות");
    }
  });

  app.get("/api/v1/trading/orders/:connectionId/:externalAccountId", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });

    const connectionId = parseInt(req.params.connectionId);
    const externalAccountId = req.params.externalAccountId;

    if (isNaN(connectionId)) {
      return res.status(400).json({ message: "Invalid connection ID" });
    }

    try {
      const auth = await getProviderAuth(connectionId, req.session.userId!);

      let orders: any[] = [];
      if (auth.providerKey === "tradovate") {
        const numericId = parseInt(externalAccountId);
        if (isNaN(numericId)) return res.status(400).json({ message: "Invalid account ID" });
        orders = await tradovateGetOrders(auth.token, numericId, auth.isLive);
      } else if (auth.providerKey === "topstepx") {
        const numericId = parseInt(externalAccountId);
        if (isNaN(numericId)) return res.status(400).json({ message: "Invalid account ID" });
        orders = await topstepxGetOrders(auth.token, numericId);
      }

      res.json({ success: true, orders });
    } catch (error: any) {
      console.error("[Trading] Get orders error:", error.message);
      const status = error.statusCode || 400;
      safeErrorResponse(res, error, status, "שגיאה בשליפת פקודות");
    }
  });

  app.get("/api/v1/trading/stream", (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });

    const userId = req.session.userId;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write("data: {\"type\":\"connected\"}\n\n");

    const sseSessionId = ++sseSessionCounter;
    const wsOwner = `sse-session-${sseSessionId}`;
    const autoStartedConnectionIds: number[] = [];

    (async () => {
      try {
        const userConnections = await storage.getConnections(userId);
        const userConnectionIds = new Set(userConnections.map(c => c.id));
        const allDataStates = [
          ...getAllWSClientStates(),
          ...getTopstepXClientStates(),
        ];
        const allExecStates = [
          ...getExecWSClientStates(),
          ...getExecTopstepXClientStates(),
        ];
        const userDataStates = allDataStates.filter(s => userConnectionIds.has(s.connectionId));
        const userExecStates = allExecStates.filter(s => userConnectionIds.has(s.connectionId));
        if (userDataStates.length > 0 || userExecStates.length > 0) {
          res.write(`data: ${JSON.stringify({ type: "wsStates", states: userDataStates, executionStates: userExecStates })}\n\n`);
        }

        for (const conn of userConnections) {
          if (conn.status !== "connected" && conn.status !== "active") continue;
          const provider = await storage.getProvider(conn.providerId);
          if (!provider) continue;

          try {
            if (provider.key === "tradovate") {
              const existingWSCheck = getWSClient(conn.id);
              const alreadyActive = existingWSCheck && existingWSCheck.connectionState !== "closed" && existingWSCheck.connectionState !== "disconnected";

              if (alreadyActive) {
                const linkedAccounts = await storage.getAccountsByConnectionId(conn.id);
                const accountIds = linkedAccounts
                  .filter(isAccountSyncEligible)
                  .map(a => parseInt(a.externalAccountId || "0"))
                  .filter(id => id > 0);
                existingWSCheck!.updateAccountIds(accountIds);
                addWSClientOwner(conn.id, wsOwner);
                bindBroadcastListeners(existingWSCheck!, conn.id, userId);
                autoStartedConnectionIds.push(conn.id);
                continue;
              }

              let creds: Record<string, any> = {};
              try {
                creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
              } catch (decErr: any) {
                console.warn(`[Trading] Failed to decrypt credentials for connection #${conn.id}, skipping auto-start:`, decErr.message);
                continue;
              }
              const storedCreds = creds;
              let token: string;
              let isLive: boolean;
              let tokenRefreshFn: () => Promise<string | null>;

              if (creds.accessToken) {
                token = creds.accessToken;
                isLive = creds.environment === "live";
                tokenRefreshFn = async () => {
                  console.warn(`[Trading] OAuth token for connection #${conn.id} cannot be refreshed (requires user re-auth). WS will degrade to polling fallback.`);
                  return null;
                };
              } else {
                const auth = await tradovateAuth(
                  creds.username, creds.password,
                  creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec
                );
                token = auth.token;
                isLive = auth.isLive;
                tokenRefreshFn = async () => {
                  try {
                    const refreshedAuth = await tradovateAuth(
                      storedCreds.username, storedCreds.password,
                      storedCreds.cid ? parseInt(storedCreds.cid) : undefined, storedCreds.secret || storedCreds.sec
                    );
                    return refreshedAuth.token;
                  } catch {
                    return null;
                  }
                };
              }

              const linkedAccounts = await storage.getAccountsByConnectionId(conn.id);
              const accountIds = linkedAccounts
                .filter(isAccountSyncEligible)
                .map(a => parseInt(a.externalAccountId || "0"))
                .filter(id => id > 0);

              wsBroadcastBound.delete(conn.id);
              const client = getOrCreateWSClient({
                token,
                isLive,
                connectionId: conn.id,
                accountIds,
                owner: wsOwner,
                tokenRefreshFn,
              });

              autoStartedConnectionIds.push(conn.id);
              bindBroadcastListeners(client, conn.id, userId);
              client.connect();
              console.log(`[Trading] Auto-started WebSocket for Tradovate connection #${conn.id} (user ${userId})`);
            } else if (provider.key === "topstepx") {
              const existingClient = getTopstepXClient(conn.id);
              const alreadyActive = existingClient && existingClient.connectionState !== "closed" && existingClient.connectionState !== "disconnected";

              if (alreadyActive) {
                addTopstepXClientOwner(conn.id, wsOwner);
                bindTopstepXBroadcastListeners(conn.id, userId);
                autoStartedConnectionIds.push(conn.id);
                continue;
              }

              let creds: Record<string, any> = {};
              try {
                creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
              } catch (decErr: any) {
                console.warn(`[Trading] Failed to decrypt credentials for connection #${conn.id}, skipping auto-start:`, decErr.message);
                continue;
              }
              const { topstepxAuthExport: tsxAuth } = await import("./topstepx-client");
              const auth = await tsxAuth(creds.userName || creds.username, creds.apiKey);

              const linkedAccounts = await storage.getAccountsByConnectionId(conn.id);
              const accountIds = linkedAccounts
                .filter(isAccountSyncEligible)
                .map(a => parseInt(a.externalAccountId || "0"))
                .filter(id => id > 0);

              wsBroadcastBound.delete(conn.id);
              const connSettings = (conn.settings as Record<string, any>) || {};
              const topstepxClient = getOrCreateTopstepXClient({
                token: auth.token,
                connectionId: conn.id,
                accountIds,
                tokenRefreshFn: async () => {
                  try {
                    const refreshed = await tsxAuth(creds.userName || creds.username, creds.apiKey, true);
                    return refreshed.token;
                  } catch { return null; }
                },
                owner: wsOwner,
                pollIntervalMs: connSettings.pollIntervalMs,
                equityPollIntervalMs: connSettings.equityPollIntervalMs,
              });

              autoStartedConnectionIds.push(conn.id);
              bindTopstepXBroadcastListeners(conn.id, userId);
              topstepxClient.connect();
              console.log(`[Trading] Auto-started TopstepX streaming for connection #${conn.id} (user ${userId})`);
            }
          } catch (err: any) {
            console.warn(`[Trading] Failed to auto-start streaming for connection #${conn.id}:`, err.message);
          }
        }
      } catch (err: any) {
        console.warn(`[Trading] SSE auto-start error:`, err.message);
      }
    })();

    const sender = (event: string, data: any) => {
      try {
        res.write(`data: ${JSON.stringify({ type: event, ...data })}\n\n`);
      } catch (err: any) {
        console.warn(`[Trading] SSE send error:`, err.message);
      }
    };

    const unregister = registerSSEClient(userId, sender);

    const keepAlive = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {
        cleanup();
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(keepAlive);
      unregister();
      for (const connId of autoStartedConnectionIds) {
        releaseWSClient(connId, wsOwner);
        releaseTopstepXClient(connId, wsOwner);
        const tradovateRemaining = getWSClient(connId);
        const topstepxRemaining = getTopstepXClient(connId);
        const anyActive = (tradovateRemaining && tradovateRemaining.connectionState !== "closed" && tradovateRemaining.connectionState !== "disconnected") ||
          (topstepxRemaining && topstepxRemaining.connectionState !== "closed" && topstepxRemaining.connectionState !== "disconnected");
        if (!anyActive) {
          wsBroadcastBound.delete(connId);
          invalidateAccountCache(connId);
        }
      }
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
  });

  app.get("/api/v1/trading/ws-status", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });

    const tradovateStates = getAllWSClientStates();
    const topstepxStates = getTopstepXClientStates();
    const allDataStates = [...tradovateStates, ...topstepxStates];
    const allExecStates = [
      ...getExecWSClientStates(),
      ...getExecTopstepXClientStates(),
    ];
    const userConnections = await storage.getConnections(req.session.userId);
    const userConnectionIds = new Set(userConnections.map(c => c.id));

    const userDataStates = allDataStates.filter(s => userConnectionIds.has(s.connectionId));
    const userExecStates = allExecStates.filter(s => userConnectionIds.has(s.connectionId));
    res.json({ connections: userDataStates, executionConnections: userExecStates });
  });

  app.post("/api/v1/trading/ws-connect/:connectionId", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });

    const connectionId = parseInt(req.params.connectionId);
    if (isNaN(connectionId)) return res.status(400).json({ message: "Invalid connection ID" });

    try {
      const conn = await storage.getConnection(connectionId);
      if (!conn) return res.status(404).json({ message: "Connection not found" });
      if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "Unauthorized" });

      const provider = await storage.getProvider(conn.providerId);
      if (!provider || provider.key !== "tradovate") {
        return res.status(400).json({ message: "WebSocket is only supported for Tradovate connections" });
      }

      let creds: Record<string, any> = {};
      try {
        creds = conn.encryptedCredentials ? decryptCredentials(conn.encryptedCredentials) : {};
      } catch {
        return res.status(400).json({ message: "לא ניתן לפענח את פרטי ההתחברות. נא לנתק ולהתחבר מחדש." });
      }
      const storedCreds = creds;
      let token: string;
      let isLive: boolean;
      let tokenRefreshFn: () => Promise<string | null>;

      if (creds.accessToken) {
        token = creds.accessToken;
        isLive = creds.environment === "live";
        tokenRefreshFn = async () => {
          console.warn(`[Trading] OAuth token for manual WS connection #${connectionId} cannot be refreshed (requires user re-auth). WS will degrade to polling fallback.`);
          return null;
        };
      } else {
        const auth = await tradovateAuth(
          creds.username, creds.password,
          creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec
        );
        token = auth.token;
        isLive = auth.isLive;
        tokenRefreshFn = async () => {
          try {
            const refreshedAuth = await tradovateAuth(
              storedCreds.username, storedCreds.password,
              storedCreds.cid ? parseInt(storedCreds.cid) : undefined, storedCreds.secret || storedCreds.sec
            );
            return refreshedAuth.token;
          } catch {
            return null;
          }
        };
      }

      const linkedAccounts = await storage.getAccountsByConnectionId(connectionId);
      const accountIds = linkedAccounts
        .map(a => parseInt(a.externalAccountId || "0"))
        .filter(id => id > 0);

      const userId = req.session.userId!;
      const manualOwner = `manual-${userId}-conn-${connectionId}`;
      wsBroadcastBound.delete(connectionId);
      const client = getOrCreateWSClient({
        token,
        isLive,
        connectionId,
        accountIds,
        owner: manualOwner,
        tokenRefreshFn,
      });

      bindBroadcastListeners(client, connectionId, userId);

      client.connect();

      res.json({ success: true, message: "WebSocket connection initiated", connectionId });
    } catch (error: any) {
      console.error("[Trading] WS connect error:", error.message);
      safeErrorResponse(res, error, 400, "שגיאה בחיבור WebSocket");
    }
  });

  app.post("/api/v1/trading/ws-disconnect/:connectionId", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });

    const connectionId = parseInt(req.params.connectionId);
    if (isNaN(connectionId)) return res.status(400).json({ message: "Invalid connection ID" });

    const conn = await storage.getConnection(connectionId);
    if (!conn) return res.status(404).json({ message: "Connection not found" });
    if (!await isLinkedUser(req.session.userId!, conn.userId)) return res.status(403).json({ message: "Unauthorized" });

    const userId = req.session.userId!;
    const manualOwner = `manual-${userId}-conn-${connectionId}`;
    releaseWSClient(connectionId, manualOwner);
    res.json({ success: true, message: "WebSocket disconnected" });
  });
}
