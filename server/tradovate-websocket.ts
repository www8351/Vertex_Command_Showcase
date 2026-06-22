import WebSocket from "ws";
import { EventEmitter } from "events";
import type { TradovatePosition, TradovateOrder } from "./tradovate-client";
import { recordLatency } from "./latency-monitor";
import { pushSystemError } from "./system-health-stream";
import { tradovateData } from "./tradovate-data-service";

/**
 * Pipes a WS client's events into the shared `tradovateData` snapshot store.
 * Idempotent — guarded by a Symbol marker so reconnect upgrades don't double-pipe.
 *
 * When position/order events arrive with an unknown contractId, lazily fetch
 * contract metadata via REST and cache it in `tradovateData` so subsequent
 * events resolve to a real symbol.
 */
const PIPED = Symbol("tradovateDataPiped");
const pendingContractFetches = new Set<number>();

function resolveContractLazy(contractId: number, token: string, isLive: boolean): void {
  if (!Number.isFinite(contractId)) return;
  if (tradovateData.getContract(contractId)) return;
  if (pendingContractFetches.has(contractId)) return;
  pendingContractFetches.add(contractId);
  // Dynamic import avoids a circular dep at module init.
  import("./tradovate-client").then(({ tradovateGetContract }) => {
    return tradovateGetContract(token, contractId, isLive);
  }).then(c => {
    if (c) {
      tradovateData.setContract(contractId, {
        symbol: c.name,
        productCode: c.name.replace(/[A-Z][0-9]+$/, ''),
        tickSize: c.providerTickSize ?? 0,
        pointValue: 0, // not provided by /contract/item; can be enriched later
      });
    }
  }).catch(() => {
    // Swallow — symbol stays as "contract:<id>" placeholder.
  }).finally(() => {
    pendingContractFetches.delete(contractId);
  });
}

function pipeClientToDataService(
  client: TradovateWebSocketClient,
  opts: { token: string; isLive: boolean }
): void {
  if ((client as any)[PIPED]) return;
  (client as any)[PIPED] = true;
  client.on("position", (event: TradovateWSEvent) => {
    if (typeof event.entity?.contractId === 'number') {
      resolveContractLazy(event.entity.contractId, opts.token, opts.isLive);
    }
    tradovateData.ingestPositionEvent(event.entity);
  });
  client.on("order", (event: TradovateWSEvent) => {
    if (typeof event.entity?.contractId === 'number') {
      resolveContractLazy(event.entity.contractId, opts.token, opts.isLive);
    }
    tradovateData.ingestOrderEvent(event.entity);
  });
  client.on("cashBalance", (event: TradovateWSEvent) => {
    tradovateData.ingestCashBalanceEvent(event.entity);
  });
  client.on("account", (event: TradovateWSEvent) => {
    tradovateData.ingestAccountEvent(event.entity);
  });
}

const TRADOVATE_DEMO_WS = "wss://demo.tradovateapi.com/v1/websocket";
const TRADOVATE_LIVE_WS = "wss://live.tradovateapi.com/v1/websocket";

const HEARTBEAT_INTERVAL_MS = 2500;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 20;

export type TradovateWSConnectionState = "disconnected" | "connecting" | "authenticating" | "connected" | "reconnecting" | "closed";

export interface TradovateWSEvent {
  type: "position" | "order" | "cashBalance" | "account";
  entityType: string;
  entity: any;
  accountId?: number;
}

interface TradovateWSMessage {
  e?: string;
  d?: any;
  i?: number;
  s?: number;
}

export class TradovateWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private token: string;
  private isLive: boolean;
  private connectionId: number;
  private accountIds: number[];
  private state: TradovateWSConnectionState = "disconnected";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 100;
  private authRequestId = 1;
  private awaitingAuth = false;
  private pendingRequests = new Map<number, { resolve: (data: any) => void; reject: (err: Error) => void }>();
  private intentionallyClosed = false;
  private lastHeartbeatResponse = 0;
  private tokenRefreshFn: (() => Promise<string | null>) | null = null;

  constructor(opts: {
    token: string;
    isLive: boolean;
    connectionId: number;
    accountIds: number[];
    tokenRefreshFn?: () => Promise<string | null>;
  }) {
    super();
    this.setMaxListeners(20);
    this.token = opts.token;
    this.isLive = opts.isLive;
    this.connectionId = opts.connectionId;
    this.accountIds = opts.accountIds;
    this.tokenRefreshFn = opts.tokenRefreshFn || null;
  }

  get connectionState(): TradovateWSConnectionState {
    return this.state;
  }

  get connId(): number {
    return this.connectionId;
  }

  get lastMessageTimestamp(): number {
    return this.lastHeartbeatResponse;
  }

  updateToken(newToken: string) {
    this.token = newToken;
  }

  updateAccountIds(newAccountIds: number[]) {
    const merged = new Set([...this.accountIds, ...newAccountIds]);
    this.accountIds = Array.from(merged);
  }

  removeAccountIds(idsToRemove: number[]) {
    const removeSet = new Set(idsToRemove);
    this.accountIds = this.accountIds.filter(id => !removeSet.has(id));
  }

  connect(): void {
    if (this.state === "connected" || this.state === "connecting" || this.state === "authenticating") {
      return;
    }

    this.intentionallyClosed = false;
    this.setState("connecting");

    const wsUrl = this.isLive ? TRADOVATE_LIVE_WS : TRADOVATE_DEMO_WS;
    console.log(`[TradovateWS] Connecting to ${wsUrl} (connection #${this.connectionId})`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err: any) {
      console.error(`[TradovateWS] Failed to create WebSocket:`, err.message);
      pushSystemError("error", "tradovate-ws", `WebSocket creation failed: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      console.log(`[TradovateWS] Connected, authenticating...`);
      this.setState("authenticating");
      this.authenticate();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on("close", (code, reason) => {
      console.log(`[TradovateWS] Connection closed (code=${code}, reason=${reason.toString()})`);
      this.cleanup();
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      } else {
        this.setState("closed");
      }
    });

    this.ws.on("error", (err) => {
      console.error(`[TradovateWS] WebSocket error:`, err.message);
      pushSystemError("error", "tradovate-ws", `WebSocket error: ${err.message}`);
    });
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.cleanup();
    if (this.ws) {
      try {
        this.ws.close(1000, "Client disconnect");
      } catch {}
      this.ws = null;
    }
    this.setState("closed");
    console.log(`[TradovateWS] Disconnected (connection #${this.connectionId})`);
  }

  private setState(newState: TradovateWSConnectionState) {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      this.emit("stateChange", { connectionId: this.connectionId, oldState, newState });
    }
  }

  private authenticate() {
    this.awaitingAuth = true;
    this.sendRaw(`authorize\n${this.authRequestId}\n\n${this.token}`);
  }

  private handleMessage(raw: string) {
    if (!raw || raw.trim() === "") return;
    const msgReceiveTime = Date.now();

    if (raw === "o") {
      return;
    }

    if (raw.startsWith("h")) {
      const now = Date.now();
      if (this.lastHeartbeatResponse > 0) {
        recordLatency("pipeline", "tradovate_ws_heartbeat", now - this.lastHeartbeatResponse);
      }
      this.lastHeartbeatResponse = now;
      return;
    }

    if (raw.startsWith("a")) {
      const payload = raw.substring(1);
      try {
        const messages: string[] = JSON.parse(payload);
        for (const msg of messages) {
          this.processFrame(msg);
        }
      } catch {
        this.processFrame(payload);
      }
      recordLatency("pipeline", "tradovate_ws", Date.now() - msgReceiveTime);
      return;
    }

    this.processFrame(raw);
    recordLatency("pipeline", "tradovate_ws", Date.now() - msgReceiveTime);
  }

  private processFrame(frame: string) {
    if (!frame || frame.trim() === "") return;

    const headerEnd = frame.indexOf("\n\n");
    if (headerEnd === -1) {
      this.tryParseJsonFrame(frame);
      return;
    }

    const headerPart = frame.substring(0, headerEnd);
    const bodyPart = frame.substring(headerEnd + 2);

    const headerLines = headerPart.split("\n");
    const requestIdLine = headerLines.length > 1 ? headerLines[1]?.trim() : "";
    const reqId = parseInt(requestIdLine);

    let body: any = null;
    if (bodyPart.trim()) {
      try {
        body = JSON.parse(bodyPart);
      } catch {
        body = bodyPart;
      }
    }

    if (this.awaitingAuth && (headerLines[0]?.trim() === "authorize" || reqId === this.authRequestId)) {
      this.awaitingAuth = false;
      if (body && body.s === 200) {
        console.log(`[TradovateWS] Authenticated successfully`);
        this.setState("connected");
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.subscribeToUserSync();
        this.emit("authenticated", { connectionId: this.connectionId });
      } else {
        console.error(`[TradovateWS] Authentication failed:`, body);
        this.emit("authError", { connectionId: this.connectionId, error: body });
        this.cleanup();
        if (this.ws) {
          try { this.ws.close(1000, "Auth failed"); } catch {}
          this.ws = null;
        }
        this.scheduleReconnect();
      }
      return;
    }

    if (!isNaN(reqId) && this.pendingRequests.has(reqId)) {
      const pending = this.pendingRequests.get(reqId)!;
      this.pendingRequests.delete(reqId);
      if (body?.s >= 200 && body?.s < 300) {
        pending.resolve(body?.d || body);
      } else {
        pending.reject(new Error(body?.d?.errorText || `Request failed with status ${body?.s}`));
      }
      return;
    }

    if (body && typeof body === "object") {
      this.handleEntityUpdate(body);
    }
  }

  private tryParseJsonFrame(frame: string) {
    try {
      const data = JSON.parse(frame);

      if (data.s !== undefined && data.i !== undefined) {
        const reqId = data.i;

        if (this.awaitingAuth && reqId === this.authRequestId) {
          this.awaitingAuth = false;
          if (data.s === 200) {
            console.log(`[TradovateWS] Authenticated successfully (JSON frame)`);
            this.setState("connected");
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            this.subscribeToUserSync();
            this.emit("authenticated", { connectionId: this.connectionId });
          } else {
            console.error(`[TradovateWS] Authentication failed (JSON frame):`, data);
            this.emit("authError", { connectionId: this.connectionId, error: data });
            this.cleanup();
            if (this.ws) {
              try { this.ws.close(1000, "Auth failed"); } catch {}
              this.ws = null;
            }
            this.scheduleReconnect();
          }
          return;
        }

        if (this.pendingRequests.has(reqId)) {
          const pending = this.pendingRequests.get(reqId)!;
          this.pendingRequests.delete(reqId);
          if (data.s >= 200 && data.s < 300) {
            pending.resolve(data.d || data);
          } else {
            pending.reject(new Error(data.d?.errorText || `Status ${data.s}`));
          }
          return;
        }
      }

      if (data.e) {
        this.handleEntityEvent(data.e, data.d);
        return;
      }

      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.e) {
            this.handleEntityEvent(item.e, item.d);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[TradovateWS] Failed to parse JSON frame:`, err.message);
    }
  }

  private handleEntityEvent(eventType: string, data: any) {
    if (!data) return;

    const entities = Array.isArray(data) ? data : [data];

    for (const entity of entities) {
      const entityType = entity.entityType || eventType;
      const lowerType = entityType.toLowerCase();

      if (lowerType.includes("position") || lowerType === "position") {
        if (this.accountIds.length === 0 || this.accountIds.includes(entity.accountId)) {
          this.emit("position", {
            type: "position",
            entityType: "position",
            entity: entity as TradovatePosition,
            accountId: entity.accountId,
          } as TradovateWSEvent);
        }
      } else if (lowerType.includes("order") || lowerType === "order" || lowerType === "executionreport") {
        if (this.accountIds.length === 0 || this.accountIds.includes(entity.accountId)) {
          this.emit("order", {
            type: "order",
            entityType: "order",
            entity: entity as TradovateOrder,
            accountId: entity.accountId,
          } as TradovateWSEvent);
        }
      } else if (lowerType.includes("cashbalance") || lowerType.includes("balance")) {
        if (this.accountIds.length === 0 || this.accountIds.includes(entity.accountId)) {
          this.emit("cashBalance", {
            type: "cashBalance",
            entityType: "cashBalance",
            entity,
            accountId: entity.accountId,
          } as TradovateWSEvent);
        }
      } else if (lowerType.includes("account")) {
        this.emit("account", {
          type: "account",
          entityType: "account",
          entity,
          accountId: entity.id,
        } as TradovateWSEvent);
      }
    }
  }

  private handleEntityUpdate(body: any) {
    if (body.d && body.d.users) {
      const users = body.d.users;
      if (users.positions) {
        for (const pos of users.positions) {
          this.handleEntityEvent("position", pos);
        }
      }
      if (users.orders) {
        for (const order of users.orders) {
          this.handleEntityEvent("order", order);
        }
      }
      if (users.cashBalances) {
        for (const cb of users.cashBalances) {
          this.handleEntityEvent("cashBalance", cb);
        }
      }
      if (users.accounts) {
        for (const acc of users.accounts) {
          this.handleEntityEvent("account", acc);
        }
      }
    }

    if (body.e) {
      this.handleEntityEvent(body.e, body.d);
    }
  }

  private subscribeToUserSync() {
    console.log(`[TradovateWS] Subscribing to user/syncrequest`);
    this.sendRequest("user/syncrequest", {}).then((response) => {
      console.log(`[TradovateWS] Sync request successful`);
      if (response && typeof response === "object") {
        this.handleEntityUpdate({ d: response });
      }
    }).catch((err) => {
      console.error(`[TradovateWS] Sync request failed:`, err.message);
    });
  }

  private sendRequest(url: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const bodyStr = body && Object.keys(body).length > 0 ? JSON.stringify(body) : "";
      this.sendRaw(`${url}\n${id}\n\n${bodyStr}`);

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${url} timed out`));
        }
      }, 10000);
    });
  }

  private sendRaw(data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastHeartbeatResponse = Date.now();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendRaw("[]");

        if (Date.now() - this.lastHeartbeatResponse > HEARTBEAT_INTERVAL_MS * 4) {
          console.warn(`[TradovateWS] No heartbeat response, reconnecting...`);
          this.cleanup();
          this.scheduleReconnect();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanup() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pendingRequests.clear();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
    }
  }

  private scheduleReconnect() {
    if (this.intentionallyClosed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[TradovateWS] Max reconnect attempts reached for connection #${this.connectionId}`);
      this.setState("disconnected");
      this.emit("maxReconnectReached", { connectionId: this.connectionId });
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    );

    console.log(`[TradovateWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    this.setState("reconnecting");

    this.reconnectTimer = setTimeout(async () => {
      if (this.tokenRefreshFn) {
        try {
          const newToken = await this.tokenRefreshFn();
          if (newToken) {
            this.token = newToken;
            console.log(`[TradovateWS] Token refreshed before reconnect (connection #${this.connectionId})`);
          }
        } catch (err: any) {
          console.warn(`[TradovateWS] Token refresh failed, using existing token:`, err.message);
        }
      }
      this.connect();
    }, delay);
  }
}

const activeClients = new Map<number, TradovateWebSocketClient>();
const clientRefCounts = new Map<number, Set<string>>();

function addClientRef(connectionId: number, owner: string) {
  if (!clientRefCounts.has(connectionId)) {
    clientRefCounts.set(connectionId, new Set());
  }
  clientRefCounts.get(connectionId)!.add(owner);
}

function removeClientRef(connectionId: number, owner: string): boolean {
  const refs = clientRefCounts.get(connectionId);
  if (!refs) return true;
  refs.delete(owner);
  if (refs.size === 0) {
    clientRefCounts.delete(connectionId);
    return true;
  }
  return false;
}

export function getOrCreateWSClient(opts: {
  token: string;
  isLive: boolean;
  connectionId: number;
  accountIds: number[];
  tokenRefreshFn?: () => Promise<string | null>;
  owner?: string;
}): TradovateWebSocketClient {
  const ownerKey = opts.owner || "default";
  const existing = activeClients.get(opts.connectionId);
  if (existing && existing.connectionState !== "closed" && existing.connectionState !== "disconnected") {
    existing.updateToken(opts.token);
    existing.updateAccountIds(opts.accountIds);
    addClientRef(opts.connectionId, ownerKey);
    return existing;
  }

  if (existing) {
    existing.removeAllListeners();
    activeClients.delete(opts.connectionId);
    clientRefCounts.delete(opts.connectionId);
  }

  const client = new TradovateWebSocketClient(opts);
  pipeClientToDataService(client, { token: opts.token, isLive: opts.isLive });
  activeClients.set(opts.connectionId, client);
  addClientRef(opts.connectionId, ownerKey);
  return client;
}

export function getWSClient(connectionId: number): TradovateWebSocketClient | undefined {
  return activeClients.get(connectionId);
}

export function addWSClientOwner(connectionId: number, owner: string): void {
  addClientRef(connectionId, owner);
}

export function releaseWSClient(connectionId: number, owner: string): void {
  const shouldDisconnect = removeClientRef(connectionId, owner);
  if (shouldDisconnect) {
    const client = activeClients.get(connectionId);
    if (client) {
      client.disconnect();
      client.removeAllListeners();
      activeClients.delete(connectionId);
    }
  }
}

export function disconnectWSClient(connectionId: number): void {
  const client = activeClients.get(connectionId);
  if (client) {
    client.disconnect();
    client.removeAllListeners();
    activeClients.delete(connectionId);
    clientRefCounts.delete(connectionId);
  }
}

export function disconnectAllWSClients(): void {
  activeClients.forEach((client) => {
    client.disconnect();
    client.removeAllListeners();
  });
  activeClients.clear();
  clientRefCounts.clear();
}

export function getAllWSClientStates(): { connectionId: number; state: TradovateWSConnectionState; lastMessageAgeMs: number | null }[] {
  const now = Date.now();
  const states: { connectionId: number; state: TradovateWSConnectionState; lastMessageAgeMs: number | null }[] = [];
  activeClients.forEach((client, id) => {
    const lmt = client.lastMessageTimestamp;
    states.push({
      connectionId: id,
      state: client.connectionState,
      lastMessageAgeMs: lmt > 0 ? now - lmt : null,
    });
  });
  return states;
}

export function getSSEClientCount(): number {
  let count = 0;
  sseClients.forEach(set => { count += set.size; });
  return count;
}

const execClients = new Map<number, TradovateWebSocketClient>();
const execClientRefCounts = new Map<number, Set<string>>();

function addExecClientRef(connectionId: number, owner: string) {
  if (!execClientRefCounts.has(connectionId)) {
    execClientRefCounts.set(connectionId, new Set());
  }
  execClientRefCounts.get(connectionId)!.add(owner);
}

function removeExecClientRef(connectionId: number, owner: string): boolean {
  const refs = execClientRefCounts.get(connectionId);
  if (!refs) return true;
  refs.delete(owner);
  if (refs.size === 0) {
    execClientRefCounts.delete(connectionId);
    return true;
  }
  return false;
}

export function getOrCreateExecWSClient(opts: {
  token: string;
  isLive: boolean;
  connectionId: number;
  accountIds: number[];
  tokenRefreshFn?: () => Promise<string | null>;
  owner?: string;
}): TradovateWebSocketClient {
  const ownerKey = opts.owner || "default";
  const existing = execClients.get(opts.connectionId);
  if (existing && existing.connectionState !== "closed" && existing.connectionState !== "disconnected") {
    existing.updateToken(opts.token);
    existing.updateAccountIds(opts.accountIds);
    addExecClientRef(opts.connectionId, ownerKey);
    return existing;
  }

  if (existing) {
    existing.removeAllListeners();
    execClients.delete(opts.connectionId);
    execClientRefCounts.delete(opts.connectionId);
  }

  const client = new TradovateWebSocketClient(opts);
  pipeClientToDataService(client, { token: opts.token, isLive: opts.isLive });
  execClients.set(opts.connectionId, client);
  addExecClientRef(opts.connectionId, ownerKey);
  return client;
}

export function getExecWSClient(connectionId: number): TradovateWebSocketClient | undefined {
  return execClients.get(connectionId);
}

export function releaseExecWSClient(connectionId: number, owner: string): void {
  const shouldDisconnect = removeExecClientRef(connectionId, owner);
  if (shouldDisconnect) {
    const client = execClients.get(connectionId);
    if (client) {
      client.disconnect();
      client.removeAllListeners();
      execClients.delete(connectionId);
    }
  }
}

export function getExecWSClientStates(): { connectionId: number; state: TradovateWSConnectionState; lastMessageAgeMs: number | null }[] {
  const now = Date.now();
  const states: { connectionId: number; state: TradovateWSConnectionState; lastMessageAgeMs: number | null }[] = [];
  execClients.forEach((client, id) => {
    const lmt = client.lastMessageTimestamp;
    states.push({
      connectionId: id,
      state: client.connectionState,
      lastMessageAgeMs: lmt > 0 ? now - lmt : null,
    });
  });
  return states;
}

export function getTradovateMapSizes(): { active: number; activeRefs: number; exec: number; execRefs: number; sse: number } {
  return {
    active: activeClients.size,
    activeRefs: clientRefCounts.size,
    exec: execClients.size,
    execRefs: execClientRefCounts.size,
    sse: sseClients.size,
  };
}

function sweepOrphanedTradovateClients() {
  activeClients.forEach((client, id) => {
    if (client.connectionState === "disconnected" || client.connectionState === "closed") {
      if (!clientRefCounts.has(id) || clientRefCounts.get(id)!.size === 0) {
        client.removeAllListeners();
        activeClients.delete(id);
        clientRefCounts.delete(id);
      }
    }
  });
  execClients.forEach((client, id) => {
    if (client.connectionState === "disconnected" || client.connectionState === "closed") {
      if (!execClientRefCounts.has(id) || execClientRefCounts.get(id)!.size === 0) {
        client.removeAllListeners();
        execClients.delete(id);
        execClientRefCounts.delete(id);
      }
    }
  });
}

setInterval(sweepOrphanedTradovateClients, 60_000);

const sseClients = new Map<number, Set<(event: string, data: any) => void>>();

export function registerSSEClient(userId: number, sender: (event: string, data: any) => void): () => void {
  if (!sseClients.has(userId)) {
    sseClients.set(userId, new Set());
  }
  sseClients.get(userId)!.add(sender);

  return () => {
    const set = sseClients.get(userId);
    if (set) {
      set.delete(sender);
      if (set.size === 0) sseClients.delete(userId);
    }
  };
}

export function broadcastToUser(userId: number, event: string, data: any) {
  const broadcastStart = Date.now();
  const clients = sseClients.get(userId);
  if (clients && clients.size > 0) {
    clients.forEach((sender) => {
      try {
        sender(event, data);
      } catch {}
    });
    recordLatency("pipeline", "sse_broadcast", Date.now() - broadcastStart);
  }
}
