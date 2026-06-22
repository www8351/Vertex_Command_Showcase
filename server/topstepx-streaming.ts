import { EventEmitter } from "events";
import { apiQueue } from "./api-queue";
import { recordLatency } from "./latency-monitor";
import { pushSystemError } from "./system-health-stream";
import { tradovateData } from "./tradovate-data-service";

/**
 * Idempotently pipes a TopstepX streaming client's events into the shared
 * `tradovateData` snapshot store so the Trading Monitor sees TopstepX accounts
 * the same as Tradovate.
 */
const PIPED_TSX = Symbol("tradovateDataPipedTsx");
function pipeTopstepXToDataService(client: TopstepXStreamingClient): void {
  if ((client as any)[PIPED_TSX]) return;
  (client as any)[PIPED_TSX] = true;
  client.on("position", (event: TopstepXWSEvent) => {
    if (typeof event.accountId === "number") {
      tradovateData.ingestTopstepXPosition(event.accountId, event.entity);
    }
  });
  client.on("equityUpdate", (event: TopstepXWSEvent) => {
    if (typeof event.accountId === "number") {
      tradovateData.ingestTopstepXEquity(event.accountId, event.entity);
    }
  });
}

const TOPSTEPX_API_URL = "https://api.topstepx.com";
const DEFAULT_POLL_INTERVAL_MS = 2500;
const MAX_RECONNECT_ATTEMPTS = 50;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

export type TopstepXWSConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "closed";

export interface TopstepXWSEvent {
  type: "position" | "order" | "equityUpdate";
  entity: any;
  accountId?: number;
}

interface TopstepXPositionSnapshot {
  contractId: string;
  symbol: string;
  netPosition: number;
  averagePrice: number;
}

export class TopstepXStreamingClient extends EventEmitter {
  private token: string;
  private connectionId: number;
  private accountIds: number[];
  private state: TopstepXWSConnectionState = "disconnected";
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private lastPositions = new Map<number, TopstepXPositionSnapshot[]>();
  private tokenRefreshFn: (() => Promise<string | null>) | null = null;
  private consecutiveErrors = 0;
  private pollInProgress = false;
  private pollIntervalMs: number;
  private equityPollIntervalMs: number;
  private maxConsecutiveErrors: number;
  private equityPollTimer: ReturnType<typeof setInterval> | null = null;
  private pollErrorLogCount = 0;

  constructor(opts: {
    token: string;
    connectionId: number;
    accountIds: number[];
    tokenRefreshFn?: () => Promise<string | null>;
    pollIntervalMs?: number;
    equityPollIntervalMs?: number;
    maxConsecutiveErrors?: number;
  }) {
    super();
    this.setMaxListeners(20);
    this.token = opts.token;
    this.connectionId = opts.connectionId;
    this.accountIds = opts.accountIds;
    this.tokenRefreshFn = opts.tokenRefreshFn || null;
    this.pollIntervalMs = opts.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
    this.equityPollIntervalMs = opts.equityPollIntervalMs || 5000;
    this.maxConsecutiveErrors = opts.maxConsecutiveErrors || 10;
  }

  get connectionState(): TopstepXWSConnectionState {
    return this.state;
  }

  get connId(): number {
    return this.connectionId;
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
    for (const id of idsToRemove) {
      this.lastPositions.delete(id);
    }
  }

  connect(): void {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.intentionallyClosed = false;
    this.setState("connecting");
    this.consecutiveErrors = 0;

    console.log(`[TopstepXStream] Starting fast-poll streaming (connection #${this.connectionId})`);

    this.startPolling();
    this.startEquityPolling();
    this.setState("connected");
    this.reconnectAttempts = 0;
    this.pollErrorLogCount = 0;
    this.emit("authenticated", { connectionId: this.connectionId });
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.cleanup();
    this.lastPositions.clear();
    this.setState("closed");
    console.log(`[TopstepXStream] Disconnected (connection #${this.connectionId})`);
  }

  private setState(newState: TopstepXWSConnectionState) {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      this.emit("stateChange", { connectionId: this.connectionId, oldState, newState });
    }
  }

  private startPolling() {
    this.stopPolling();

    this.pollOnce();

    this.pollTimer = setInterval(() => {
      this.pollOnce();
    }, this.pollIntervalMs);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startEquityPolling() {
    this.stopEquityPolling();
    this.equityPollOnce();
    this.equityPollTimer = setInterval(() => {
      this.equityPollOnce();
    }, this.equityPollIntervalMs);
  }

  private stopEquityPolling() {
    if (this.equityPollTimer) {
      clearInterval(this.equityPollTimer);
      this.equityPollTimer = null;
    }
  }

  private async equityPollOnce() {
    if (this.intentionallyClosed || this.state === "closed") return;
    try {
      const res = await apiQueue.enqueueFetch("topstepx", `${TOPSTEPX_API_URL}/api/Account/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ onlyActive: false }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const accounts: any[] = Array.isArray(data) ? data : (data.accounts || data.items || []);
      for (const acc of accounts) {
        if (this.accountIds.includes(acc.id)) {
          if (acc.balance != null) {
            this.emit("equityUpdate", {
              type: "equityUpdate" as const,
              entity: {
                name: acc.name ?? acc.accountNumber,
                balance: acc.balance,
                trailingDrawdown: acc.trailingDrawdown,
                isActive: acc.isActive,
                status: acc.status,
              },
              accountId: acc.id,
            } as TopstepXWSEvent);
          }
        }
      }
    } catch (err: any) {
      this.pollErrorLogCount++;
      if (this.pollErrorLogCount <= 3 || this.pollErrorLogCount % 50 === 0) {
        console.warn(`[TopstepXStream] Equity poll error (error #${this.pollErrorLogCount}):`, err.message);
      }
    }
  }

  private async pollOnce() {
    if (this.pollInProgress) return;
    if (this.intentionallyClosed || this.state === "closed") return;
    this.pollInProgress = true;

    for (const accountId of this.accountIds) {
      try {
        const pollStart = Date.now();
        const res = await apiQueue.enqueueFetch("topstepx", `${TOPSTEPX_API_URL}/api/Position/search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        });

        if (!res.ok) {
          if (res.status === 404) {
            this.consecutiveErrors = 0;
            recordLatency("pipeline", "topstepx_poll", Date.now() - pollStart);
            continue;
          }
          const errText = await res.text().catch(() => "");
          this.pollErrorLogCount++;
          if (this.pollErrorLogCount <= 3 || this.pollErrorLogCount % 50 === 0) {
            console.warn(`[TopstepXStream] Poll HTTP ${res.status} for account ${accountId} (conn #${this.connectionId}): ${errText.slice(0, 200)} (error #${this.pollErrorLogCount})`);
          }
          this.consecutiveErrors++;
          if (res.status === 401 || res.status === 403) {
            await this.refreshToken();
          }
          if (this.consecutiveErrors > this.maxConsecutiveErrors) {
            this.handleMaxErrors();
          }
          continue;
        }

        this.consecutiveErrors = 0;
        const data = await res.json();
        recordLatency("pipeline", "topstepx_poll", Date.now() - pollStart);

        const rawPositions: any[] = Array.isArray(data) ? data : (data.positions || data.items || []);

        const currentPositions: TopstepXPositionSnapshot[] = rawPositions
          .filter((p: any) => p.netPosition !== 0)
          .map((p: any) => ({
            contractId: String(p.contractId),
            symbol: p.symbol || this.parseContractSymbol(p.contractId),
            netPosition: p.netPosition,
            averagePrice: p.averagePrice || 0,
          }));

        const prevPositions = this.lastPositions.get(accountId) || [];
        const changes = this.detectChanges(prevPositions, currentPositions);
        this.lastPositions.set(accountId, currentPositions);

        for (const change of changes) {
          this.emit("position", {
            type: "position",
            entity: change,
            accountId,
          } as TopstepXWSEvent);
        }
      } catch (err: any) {
        this.consecutiveErrors++;
        this.pollErrorLogCount++;
        if (this.pollErrorLogCount <= 3 || this.pollErrorLogCount % 50 === 0) {
          console.warn(`[TopstepXStream] Poll error for account ${accountId} (error #${this.pollErrorLogCount}):`, err.message);
        }
        if (this.consecutiveErrors > this.maxConsecutiveErrors) {
          this.pollInProgress = false;
          this.handleMaxErrors();
          return;
        }
      }
    }
    this.pollInProgress = false;
  }

  private parseContractSymbol(contractId: string): string {
    if (!contractId) return "Unknown";
    const parts = String(contractId).split(".");
    if (parts.length >= 4) return parts[3];
    return String(contractId);
  }

  private detectChanges(prev: TopstepXPositionSnapshot[], current: TopstepXPositionSnapshot[]): any[] {
    const changes: any[] = [];
    const prevMap = new Map(prev.map(p => [p.contractId, p]));
    const currMap = new Map(current.map(c => [c.contractId, c]));

    for (const entry of Array.from(currMap.entries())) {
      const [contractId, curr] = entry;
      const prevPos = prevMap.get(contractId);
      const prevNetPos = prevPos?.netPosition || 0;
      if (curr.netPosition !== prevNetPos) {
        changes.push({
          contractId,
          symbol: curr.symbol,
          netPosition: curr.netPosition,
          previousNetPosition: prevNetPos,
          averagePrice: curr.averagePrice,
        });
      }
    }

    for (const entry of Array.from(prevMap.entries())) {
      const [contractId, prevPos] = entry;
      if (!currMap.has(contractId) && prevPos.netPosition !== 0) {
        changes.push({
          contractId,
          symbol: prevPos.symbol,
          netPosition: 0,
          previousNetPosition: prevPos.netPosition,
          averagePrice: 0,
        });
      }
    }

    return changes;
  }

  getPositionPrice(symbol: string): number | null {
    for (const positions of Array.from(this.lastPositions.values())) {
      for (const pos of positions) {
        if (pos.symbol === symbol && pos.averagePrice > 0) {
          return pos.averagePrice;
        }
      }
    }
    return null;
  }

  private async refreshToken() {
    if (!this.tokenRefreshFn) return;
    try {
      const newToken = await this.tokenRefreshFn();
      if (newToken) {
        this.token = newToken;
        console.log(`[TopstepXStream] Token refreshed (connection #${this.connectionId})`);
      }
    } catch (err: any) {
      console.warn(`[TopstepXStream] Token refresh failed:`, err.message);
    }
  }

  private handleMaxErrors() {
    console.error(`[TopstepXStream] Too many consecutive errors, reconnecting...`);
    pushSystemError("warning", "topstepx-stream", `Too many consecutive errors, reconnecting connection #${this.connectionId}`);
    this.cleanup();
    this.scheduleReconnect();
  }

  private cleanup() {
    this.stopPolling();
    this.stopEquityPolling();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.intentionallyClosed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[TopstepXStream] Max reconnect attempts reached for connection #${this.connectionId}`);
      pushSystemError("error", "topstepx-stream", `Max reconnect attempts reached for connection #${this.connectionId}`);
      this.setState("disconnected");
      this.emit("maxReconnectReached", { connectionId: this.connectionId });
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    );

    console.log(`[TopstepXStream] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    this.setState("reconnecting");

    this.reconnectTimer = setTimeout(async () => {
      await this.refreshToken();
      this.consecutiveErrors = 0;
      this.connect();
    }, delay);
  }
}

const activeTopstepXClients = new Map<number, TopstepXStreamingClient>();
const topstepxClientRefCounts = new Map<number, Set<string>>();

function addTopstepXRef(connectionId: number, owner: string) {
  if (!topstepxClientRefCounts.has(connectionId)) {
    topstepxClientRefCounts.set(connectionId, new Set());
  }
  topstepxClientRefCounts.get(connectionId)!.add(owner);
}

function removeTopstepXRef(connectionId: number, owner: string): boolean {
  const refs = topstepxClientRefCounts.get(connectionId);
  if (!refs) return true;
  refs.delete(owner);
  if (refs.size === 0) {
    topstepxClientRefCounts.delete(connectionId);
    return true;
  }
  return false;
}

export function getOrCreateTopstepXClient(opts: {
  token: string;
  connectionId: number;
  accountIds: number[];
  tokenRefreshFn?: () => Promise<string | null>;
  owner?: string;
  pollIntervalMs?: number;
  equityPollIntervalMs?: number;
  maxConsecutiveErrors?: number;
}): TopstepXStreamingClient {
  const ownerKey = opts.owner || "default";
  const existing = activeTopstepXClients.get(opts.connectionId);
  if (existing && existing.connectionState !== "closed" && existing.connectionState !== "disconnected") {
    existing.updateToken(opts.token);
    existing.updateAccountIds(opts.accountIds);
    addTopstepXRef(opts.connectionId, ownerKey);
    return existing;
  }

  if (existing) {
    existing.removeAllListeners();
    activeTopstepXClients.delete(opts.connectionId);
    topstepxClientRefCounts.delete(opts.connectionId);
  }

  const client = new TopstepXStreamingClient(opts);
  pipeTopstepXToDataService(client);
  activeTopstepXClients.set(opts.connectionId, client);
  addTopstepXRef(opts.connectionId, ownerKey);
  return client;
}

export function getTopstepXClient(connectionId: number): TopstepXStreamingClient | undefined {
  return activeTopstepXClients.get(connectionId);
}

export function addTopstepXClientOwner(connectionId: number, owner: string): void {
  addTopstepXRef(connectionId, owner);
}

export function releaseTopstepXClient(connectionId: number, owner: string): void {
  const shouldDisconnect = removeTopstepXRef(connectionId, owner);
  if (shouldDisconnect) {
    const client = activeTopstepXClients.get(connectionId);
    if (client) {
      client.disconnect();
      client.removeAllListeners();
      activeTopstepXClients.delete(connectionId);
    }
  }
}

export function getTopstepXClientStates(): { connectionId: number; state: TopstepXWSConnectionState }[] {
  const states: { connectionId: number; state: TopstepXWSConnectionState }[] = [];
  activeTopstepXClients.forEach((client, id) => {
    states.push({ connectionId: id, state: client.connectionState });
  });
  return states;
}

const execTopstepXClients = new Map<number, TopstepXStreamingClient>();
const execTopstepXRefCounts = new Map<number, Set<string>>();

function addExecTopstepXRef(connectionId: number, owner: string) {
  if (!execTopstepXRefCounts.has(connectionId)) {
    execTopstepXRefCounts.set(connectionId, new Set());
  }
  execTopstepXRefCounts.get(connectionId)!.add(owner);
}

function removeExecTopstepXRef(connectionId: number, owner: string): boolean {
  const refs = execTopstepXRefCounts.get(connectionId);
  if (!refs) return true;
  refs.delete(owner);
  if (refs.size === 0) {
    execTopstepXRefCounts.delete(connectionId);
    return true;
  }
  return false;
}

export function getOrCreateExecTopstepXClient(opts: {
  token: string;
  connectionId: number;
  accountIds: number[];
  tokenRefreshFn?: () => Promise<string | null>;
  owner?: string;
}): TopstepXStreamingClient {
  const ownerKey = opts.owner || "default";
  const existing = execTopstepXClients.get(opts.connectionId);
  if (existing && existing.connectionState !== "closed" && existing.connectionState !== "disconnected") {
    existing.updateToken(opts.token);
    existing.updateAccountIds(opts.accountIds);
    addExecTopstepXRef(opts.connectionId, ownerKey);
    return existing;
  }

  if (existing) {
    existing.removeAllListeners();
    execTopstepXClients.delete(opts.connectionId);
    execTopstepXRefCounts.delete(opts.connectionId);
  }

  const client = new TopstepXStreamingClient(opts);
  pipeTopstepXToDataService(client);
  execTopstepXClients.set(opts.connectionId, client);
  addExecTopstepXRef(opts.connectionId, ownerKey);
  return client;
}

export function getExecTopstepXClient(connectionId: number): TopstepXStreamingClient | undefined {
  return execTopstepXClients.get(connectionId);
}

export function releaseExecTopstepXClient(connectionId: number, owner: string): void {
  const shouldDisconnect = removeExecTopstepXRef(connectionId, owner);
  if (shouldDisconnect) {
    const client = execTopstepXClients.get(connectionId);
    if (client) {
      client.disconnect();
      client.removeAllListeners();
      execTopstepXClients.delete(connectionId);
    }
  }
}

export function getExecTopstepXClientStates(): { connectionId: number; state: TopstepXWSConnectionState }[] {
  const states: { connectionId: number; state: TopstepXWSConnectionState }[] = [];
  execTopstepXClients.forEach((client, id) => {
    states.push({ connectionId: id, state: client.connectionState });
  });
  return states;
}

export function getTopstepXMapSizes(): { active: number; activeRefs: number; exec: number; execRefs: number } {
  return {
    active: activeTopstepXClients.size,
    activeRefs: topstepxClientRefCounts.size,
    exec: execTopstepXClients.size,
    execRefs: execTopstepXRefCounts.size,
  };
}

function sweepOrphanedTopstepXClients() {
  activeTopstepXClients.forEach((client, id) => {
    if (client.connectionState === "disconnected" || client.connectionState === "closed") {
      if (!topstepxClientRefCounts.has(id) || topstepxClientRefCounts.get(id)!.size === 0) {
        client.removeAllListeners();
        activeTopstepXClients.delete(id);
        topstepxClientRefCounts.delete(id);
      }
    }
  });
  execTopstepXClients.forEach((client, id) => {
    if (client.connectionState === "disconnected" || client.connectionState === "closed") {
      if (!execTopstepXRefCounts.has(id) || execTopstepXRefCounts.get(id)!.size === 0) {
        client.removeAllListeners();
        execTopstepXClients.delete(id);
        execTopstepXRefCounts.delete(id);
      }
    }
  });
}

setInterval(sweepOrphanedTopstepXClients, 60_000);
