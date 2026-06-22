import type { Express, Request, Response } from "express";
import { tradovateData, type AccountState } from "./tradovate-data-service";
import { storage } from "./storage";

/**
 * Raw Tradovate/TopstepX state passthrough.
 *
 * No risk logic, no derivation — flatten the in-memory snapshots maintained by
 * `tradovateData` into JSON the monitor UI / copy engine can consume.
 *
 * Maps in AccountState are converted to arrays so the wire format is plain JSON.
 *
 * SECURITY: `:id` is a broker (Tradovate) account id, the key in the shared
 * in-memory `tradovateData` store — global across all users. Every route must
 * verify the requesting user owns (or is linked to the owner of) that broker
 * account before returning its positions/orders/fills, otherwise any logged-in
 * user can read any account by iterating ids (IDOR).
 */

function serializeAccountState(state: AccountState) {
  return {
    account: state.account,
    positions: Array.from(state.positions.values()),
    orders: Array.from(state.orders.values()),
    recentFills: state.recentFills,
  };
}

function requireAuth(req: Request, res: Response, next: () => void): void {
  if (!req.session?.userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  next();
}

/**
 * Broker account ids the user is allowed to see = the `externalAccountId`s of
 * their own + linked accounts. `storage.getAccounts` already resolves linked
 * user ids, so this respects the existing account-linking model.
 */
async function getOwnedBrokerAccountIds(userId: number): Promise<Set<number>> {
  const accounts = await storage.getAccounts(userId);
  const ids = new Set<number>();
  for (const acc of accounts) {
    if (acc.externalAccountId == null) continue;
    const n = Number.parseInt(String(acc.externalAccountId), 10);
    if (Number.isFinite(n)) ids.add(n);
  }
  return ids;
}

/** Parse + ownership-check the `:id` param. Returns the id, or null after sending an error response. */
async function resolveOwnedAccountId(req: Request, res: Response): Promise<number | null> {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ message: "Invalid account id" });
    return null;
  }
  const owned = await getOwnedBrokerAccountIds(req.session!.userId!);
  if (!owned.has(id)) {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }
  return id;
}

export function registerMonitorRoutes(app: Express): void {
  app.get("/api/monitor/accounts", requireAuth, async (req, res) => {
    const owned = await getOwnedBrokerAccountIds(req.session!.userId!);
    const accounts = tradovateData.getAllAccounts().filter(a => owned.has(a.accountId));
    res.json(accounts);
  });

  app.get("/api/monitor/account/:id", requireAuth, async (req, res) => {
    const id = await resolveOwnedAccountId(req, res);
    if (id === null) return;
    const state = tradovateData.getAccountState(id);
    if (!state) {
      return res.status(404).json({ message: "Account not tracked" });
    }
    res.json(serializeAccountState(state));
  });

  app.get("/api/monitor/account/:id/positions", requireAuth, async (req, res) => {
    const id = await resolveOwnedAccountId(req, res);
    if (id === null) return;
    res.json(tradovateData.getPositions(id));
  });

  app.get("/api/monitor/account/:id/orders", requireAuth, async (req, res) => {
    const id = await resolveOwnedAccountId(req, res);
    if (id === null) return;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(tradovateData.getOrders(id, status as any));
  });

  app.get("/api/monitor/account/:id/fills", requireAuth, async (req, res) => {
    const id = await resolveOwnedAccountId(req, res);
    if (id === null) return;
    const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    res.json(tradovateData.getRecentFills(id, Number.isFinite(limit) ? limit : 50));
  });
}
