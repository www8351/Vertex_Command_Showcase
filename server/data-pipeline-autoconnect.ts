import { storage } from "./storage";
import { isAccountSyncEligible } from "./rule-engine";
import { decryptCredentials } from "./encryption";
import { tradovateAuth } from "./tradovate-client";
import {
  getOrCreateWSClient,
  getWSClient,
  addWSClientOwner,
  releaseWSClient,
  getAllWSClientStates,
} from "./tradovate-websocket";
import {
  getOrCreateTopstepXClient,
  getTopstepXClient,
  addTopstepXClientOwner,
  releaseTopstepXClient,
  getTopstepXClientStates,
} from "./topstepx-streaming";

const OWNER_KEY = "data-pipeline";
const RECONNECT_INTERVAL_MS = 30_000;
const STARTUP_DELAY_MS = 5_000;
const DATA_PIPELINE_POLL_INTERVAL_MS = 30_000;
const DATA_PIPELINE_MAX_ERRORS = 30;

const managedConnectionIds = new Set<number>();
let reconnectTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let initialConnectDone = false;

export async function startDataPipelineAutoConnect(): Promise<void> {
  if (started) return;
  started = true;
  console.log("[DataPipeline] Scheduling auto-connect after startup delay...");
  setTimeout(async () => {
    try {
      await connectAllBrokers();
      initialConnectDone = true;
    } catch (err: any) {
      console.warn("[DataPipeline] Initial auto-connect failed:", err.message);
    }
    reconnectTimer = setInterval(async () => {
      try {
        await reconnectDroppedConnections();
      } catch (err: any) {
        console.warn("[DataPipeline] Reconnect cycle failed:", err.message);
      }
    }, RECONNECT_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

export async function stopDataPipelineAutoConnect(): Promise<void> {
  if (reconnectTimer) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
  for (const connId of managedConnectionIds) {
    releaseWSClient(connId, OWNER_KEY);
    releaseTopstepXClient(connId, OWNER_KEY);
  }
  managedConnectionIds.clear();
  initialConnectDone = false;
  console.log("[DataPipeline] Auto-connect stopped and all connections released.");
}

export async function onAccountSynced(connectionId: number): Promise<void> {
  if (managedConnectionIds.has(connectionId)) return;
  try {
    const conn = await storage.getConnection(connectionId);
    if (!conn || (conn.status !== "connected" && conn.status !== "active")) return;
    const provider = await storage.getProvider(conn.providerId);
    if (!provider) return;
    await connectSingleBroker(conn, provider);
    console.log(`[DataPipeline] New connection #${connectionId} auto-connected after sync.`);
  } catch (err: any) {
    console.warn(`[DataPipeline] Failed to auto-connect new connection #${connectionId}:`, err.message);
  }
}

export async function onAccountRemoved(connectionId: number): Promise<void> {
  if (!managedConnectionIds.has(connectionId)) return;
  const linkedAccounts = await storage.getAccountsByConnectionId(connectionId);
  const eligible = linkedAccounts.filter(isAccountSyncEligible);
  if (eligible.length === 0) {
    releaseWSClient(connectionId, OWNER_KEY);
    releaseTopstepXClient(connectionId, OWNER_KEY);
    managedConnectionIds.delete(connectionId);
    console.log(`[DataPipeline] Connection #${connectionId} released (no eligible accounts).`);
  }
}

export function onConnectionRemoved(connectionId: number): void {
  if (!managedConnectionIds.has(connectionId)) return;
  releaseWSClient(connectionId, OWNER_KEY);
  releaseTopstepXClient(connectionId, OWNER_KEY);
  managedConnectionIds.delete(connectionId);
  console.log(`[DataPipeline] Connection #${connectionId} force-released (connection deleted).`);
}

async function connectAllBrokers(): Promise<void> {
  const allConnections = await storage.getAllConnections();
  const activeConnections = allConnections.filter(
    c => c.status === "connected" || c.status === "active"
  );

  const providers = await storage.getProviders();
  const providerMap = new Map(providers.map(p => [p.id, p]));

  let connectedCount = 0;
  let topstepxCount = 0;
  for (const conn of activeConnections) {
    const provider = providerMap.get(conn.providerId);
    if (!provider) continue;

    const linkedAccounts = await storage.getAccountsByConnectionId(conn.id);
    const eligible = linkedAccounts.filter(isAccountSyncEligible);
    if (eligible.length === 0) continue;

    try {
      if (provider.key === "topstepx" && topstepxCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      await connectSingleBroker(conn, provider);
      if (provider.key === "topstepx") topstepxCount++;
      connectedCount++;
    } catch (err: any) {
      console.warn(`[DataPipeline] Failed to connect ${provider.key} connection #${conn.id}:`, err.message);
    }
  }
  if (connectedCount > 0) {
    console.log(`[DataPipeline] Auto-connected ${connectedCount} broker connection(s).`);
  }
}

async function connectSingleBroker(conn: any, provider: any): Promise<void> {
  let creds: Record<string, any> = {};
  if (conn.encryptedCredentials) {
    try {
      creds = decryptCredentials(conn.encryptedCredentials);
    } catch (err: any) {
      console.error(`[DataPipeline] Failed to decrypt credentials for connection #${conn.id}: ${err.message}`);
      await storage.updateConnection(conn.id, { status: "error", lastErrorMessage: "Credentials could not be decrypted. Please reconnect your account." });
      return;
    }
  }
  const linkedAccounts = await storage.getAccountsByConnectionId(conn.id);
  const eligible = linkedAccounts.filter(isAccountSyncEligible);
  if (eligible.length === 0) return;

  if (provider.key === "tradovate") {
    const existingClient = getWSClient(conn.id);
    if (existingClient && existingClient.connectionState !== "closed" && existingClient.connectionState !== "disconnected") {
      addWSClientOwner(conn.id, OWNER_KEY);
      managedConnectionIds.add(conn.id);
      return;
    }

    const accountIds = eligible
      .map(a => parseInt(a.externalAccountId || "0"))
      .filter(id => id > 0);

    let token: string;
    let isLive: boolean;
    let tokenRefreshFn: () => Promise<string | null>;

    if (creds.accessToken) {
      token = creds.accessToken;
      isLive = creds.environment === "live";
      const storedCredsForRefresh = creds;
      tokenRefreshFn = async () => {
        if (storedCredsForRefresh.username && storedCredsForRefresh.password) {
          try {
            const refreshed = await tradovateAuth(
              storedCredsForRefresh.username, storedCredsForRefresh.password,
              storedCredsForRefresh.cid ? parseInt(storedCredsForRefresh.cid) : undefined, storedCredsForRefresh.secret || storedCredsForRefresh.sec
            );
            return refreshed.token;
          } catch { return null; }
        }
        return null;
      };
    } else {
      const auth = await tradovateAuth(
        creds.username, creds.password,
        creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec
      );
      token = auth.token;
      isLive = auth.isLive;
      const storedCreds = creds;
      tokenRefreshFn = async () => {
        try {
          const refreshed = await tradovateAuth(
            storedCreds.username, storedCreds.password,
            storedCreds.cid ? parseInt(storedCreds.cid) : undefined, storedCreds.secret || storedCreds.sec
          );
          return refreshed.token;
        } catch { return null; }
      };
    }

    const client = getOrCreateWSClient({
      token,
      isLive,
      connectionId: conn.id,
      accountIds,
      tokenRefreshFn,
      owner: OWNER_KEY,
    });
    client.connect();
    managedConnectionIds.add(conn.id);
    console.log(`[DataPipeline] Tradovate WS connected for connection #${conn.id}`);

  } else if (provider.key === "topstepx") {
    const existingClient = getTopstepXClient(conn.id);
    if (existingClient && existingClient.connectionState !== "closed" && existingClient.connectionState !== "disconnected") {
      addTopstepXClientOwner(conn.id, OWNER_KEY);
      managedConnectionIds.add(conn.id);
      return;
    }

    const { topstepxAuthExport: tsxAuth } = await import("./topstepx-client");
    const auth = await tsxAuth(creds.userName || creds.username, creds.apiKey);

    const accountIds = eligible
      .map(a => parseInt(a.externalAccountId || "0"))
      .filter(id => id > 0);

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
      owner: OWNER_KEY,
      pollIntervalMs: connSettings.pollIntervalMs || DATA_PIPELINE_POLL_INTERVAL_MS,
      equityPollIntervalMs: connSettings.equityPollIntervalMs,
      maxConsecutiveErrors: DATA_PIPELINE_MAX_ERRORS,
    });
    topstepxClient.connect();
    managedConnectionIds.add(conn.id);
    console.log(`[DataPipeline] TopstepX polling connected for connection #${conn.id}`);
  }
}

async function reconnectDroppedConnections(): Promise<void> {
  if (!initialConnectDone) {
    await connectAllBrokers();
    initialConnectDone = true;
    return;
  }

  if (managedConnectionIds.size === 0) {
    const allConnections = await storage.getAllConnections();
    const activeConnections = allConnections.filter(
      c => c.status === "connected" || c.status === "active"
    );
    const hasEligible = await (async () => {
      for (const conn of activeConnections) {
        const linked = await storage.getAccountsByConnectionId(conn.id);
        if (linked.some(isAccountSyncEligible)) return true;
      }
      return false;
    })();
    if (hasEligible) {
      await connectAllBrokers();
    }
    return;
  }

  for (const connId of managedConnectionIds) {
    const tradovateClient = getWSClient(connId);
    const topstepxClient = getTopstepXClient(connId);

    const tradovateActive = tradovateClient && tradovateClient.connectionState !== "closed" && tradovateClient.connectionState !== "disconnected";
    const topstepxActive = topstepxClient && topstepxClient.connectionState !== "closed" && topstepxClient.connectionState !== "disconnected";

    if (!tradovateActive && !topstepxActive) {
      managedConnectionIds.delete(connId);
      try {
        const conn = await storage.getConnection(connId);
        if (!conn || (conn.status !== "connected" && conn.status !== "active")) continue;
        const provider = await storage.getProvider(conn.providerId);
        if (!provider) continue;
        await connectSingleBroker(conn, provider);
        console.log(`[DataPipeline] Reconnected dropped connection #${connId}`);
      } catch (err: any) {
        console.warn(`[DataPipeline] Failed to reconnect connection #${connId}:`, err.message);
      }
    }
  }
}
