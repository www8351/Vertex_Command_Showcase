import { storage } from "./storage";
import { decryptCredentials } from "./encryption";
import {
  tradovateAuth,
  tradovateGetPositions,
  tradovateGetContract,
} from "./tradovate-client";
import {
  topstepxAuthExport,
  topstepxGetPositions,
} from "./topstepx-client";
import type { CopyTradingGroup, CopyTradingFollower } from "@shared/copy-trading-schema";

export interface PositionSnapshot {
  contractId: string;
  symbol: string;
  netPos: number;
  price?: number;
}

export interface ProviderAuth {
  providerKey: string;
  token: string;
  isLive?: boolean;
  userId?: number;
  connectionId?: number;
}

export const SUPPORTED_COPY_PROVIDERS = ["tradovate", "topstepx"];

export interface ResolvedConnection {
  providerKey: string;
  creds: Record<string, any>;
  userId: number;
  connectionId: number;
}

export interface ResolvedAccountInfo {
  externalAccountId: string;
  accountId: string;
  name: string;
  size: number;
  balance: number;
  maxDrawdown: number | null;
}

export async function resolveMasterConnection(group: CopyTradingGroup): Promise<ResolvedConnection | null> {
  if (group.masterConnectionId) {
    const copyConn = await storage.getCopyTradingConnection(group.masterConnectionId);
    if (!copyConn) return null;
    if (!SUPPORTED_COPY_PROVIDERS.includes(copyConn.provider)) return null;
    let creds: Record<string, any> = {};
    try { creds = copyConn.encryptedCredentials ? decryptCredentials(copyConn.encryptedCredentials) : {}; } catch { return null; }
    return { providerKey: copyConn.provider, creds, userId: copyConn.userId, connectionId: copyConn.id };
  }
  const masterAccount = await storage.getAccount(group.masterAccountId);
  if (!masterAccount?.integrationConnectionId) return null;
  const connection = await storage.getConnection(masterAccount.integrationConnectionId);
  if (!connection) return null;
  const provider = await storage.getProvider(connection.providerId);
  if (!provider || !SUPPORTED_COPY_PROVIDERS.includes(provider.key)) return null;
  let creds: Record<string, any> = {};
  try { creds = connection.encryptedCredentials ? decryptCredentials(connection.encryptedCredentials) : {}; } catch { return null; }
  return { providerKey: provider.key, creds, userId: connection.userId, connectionId: connection.id };
}

export async function resolveFollowerConnection(follower: CopyTradingFollower): Promise<ResolvedConnection | null> {
  if (follower.followerConnectionId) {
    const copyConn = await storage.getCopyTradingConnection(follower.followerConnectionId);
    if (!copyConn) return null;
    if (!SUPPORTED_COPY_PROVIDERS.includes(copyConn.provider)) return null;
    let creds: Record<string, any> = {};
    try { creds = copyConn.encryptedCredentials ? decryptCredentials(copyConn.encryptedCredentials) : {}; } catch { return null; }
    return { providerKey: copyConn.provider, creds, userId: copyConn.userId, connectionId: copyConn.id };
  }
  const followerAccount = await storage.getAccount(follower.followerAccountId);
  if (!followerAccount?.integrationConnectionId) return null;
  const followerConn = await storage.getConnection(followerAccount.integrationConnectionId);
  if (!followerConn) return null;
  const followerProvider = await storage.getProvider(followerConn.providerId);
  if (!followerProvider || !SUPPORTED_COPY_PROVIDERS.includes(followerProvider.key)) return null;
  let creds: Record<string, any> = {};
  try { creds = followerConn.encryptedCredentials ? decryptCredentials(followerConn.encryptedCredentials) : {}; } catch { return null; }
  return { providerKey: followerProvider.key, creds, userId: followerConn.userId, connectionId: followerConn.id };
}

export async function resolveMasterAccountInfo(group: CopyTradingGroup): Promise<ResolvedAccountInfo | null> {
  if (group.masterConnectionId) {
    const connAccount = await storage.getCopyTradingConnectionAccount(group.masterAccountId);
    if (!connAccount) return null;
    return {
      externalAccountId: connAccount.externalAccountId,
      accountId: connAccount.externalAccountName || connAccount.externalAccountId,
      name: connAccount.externalAccountName || connAccount.externalAccountId,
      size: 0,
      balance: 0,
      maxDrawdown: null,
    };
  }
  const account = await storage.getAccount(group.masterAccountId);
  if (!account) return null;
  if (account.status === 'sync_failed') {
    console.log(`[ProviderCore] חשבון מאסטר ${account.name} בסטטוס sync_failed — חוסם`);
    return null;
  }
  return {
    externalAccountId: account.externalAccountId || account.accountId,
    accountId: account.accountId,
    name: account.name,
    size: account.size,
    balance: account.balance,
    maxDrawdown: account.maxDrawdown,
  };
}

export async function resolveFollowerAccountInfo(follower: CopyTradingFollower): Promise<ResolvedAccountInfo | null> {
  if (follower.followerConnectionId) {
    const connAccount = await storage.getCopyTradingConnectionAccount(follower.followerAccountId);
    if (!connAccount) return null;
    return {
      externalAccountId: connAccount.externalAccountId,
      accountId: connAccount.externalAccountName || connAccount.externalAccountId,
      name: connAccount.externalAccountName || connAccount.externalAccountId,
      size: 0,
      balance: 0,
      maxDrawdown: null,
    };
  }
  const account = await storage.getAccount(follower.followerAccountId);
  if (!account) return null;
  if (account.status === 'sync_failed') {
    console.log(`[ProviderCore] חשבון עוקב ${account.name} בסטטוס sync_failed — חוסם`);
    return null;
  }
  return {
    externalAccountId: account.externalAccountId || account.accountId,
    accountId: account.accountId,
    name: account.name,
    size: account.size,
    balance: account.balance,
    maxDrawdown: account.maxDrawdown,
  };
}

export async function authenticateProvider(
  providerKey: string,
  creds: Record<string, any>,
  forceRefresh = false,
): Promise<ProviderAuth | null> {
  try {
    if (providerKey === "tradovate") {
      if (creds.accessToken) {
        return { providerKey, token: creds.accessToken, isLive: creds.environment === "live" };
      }
      const auth = await tradovateAuth(
        creds.username, creds.password,
        creds.cid ? parseInt(creds.cid) : undefined, creds.secret || creds.sec
      );
      return { providerKey, token: auth.token, isLive: auth.isLive };
    } else if (providerKey === "topstepx") {
      const auth = await topstepxAuthExport(creds.userName || creds.username, creds.apiKey, forceRefresh);
      return { providerKey, token: auth.token };
    }
    return null;
  } catch (err: any) {
    console.error(`[ProviderCore] שגיאת אימות ${providerKey}:`, err.message);
    return null;
  }
}

export async function getProviderPositions(
  auth: ProviderAuth,
  externalAccountId: string
): Promise<PositionSnapshot[]> {
  if (auth.providerKey === "tradovate") {
    const numericId = parseInt(externalAccountId);
    if (!numericId) return [];
    const positions = await tradovateGetPositions(auth.token, numericId, auth.isLive || false);
    const snapshots: PositionSnapshot[] = [];
    for (const pos of positions) {
      if (pos.netPos !== 0) {
        const contract = await tradovateGetContract(auth.token, pos.contractId, auth.isLive || false);
        snapshots.push({
          contractId: String(pos.contractId),
          symbol: contract?.name || `Contract#${pos.contractId}`,
          netPos: pos.netPos,
          price: pos.netPrice || undefined,
        });
      }
    }
    return snapshots;
  } else if (auth.providerKey === "topstepx") {
    const numericId = parseInt(externalAccountId);
    if (!numericId) return [];
    const positions = await topstepxGetPositions(auth.token, numericId);
    return positions
      .filter(p => p.netPosition !== 0)
      .map(p => ({
        contractId: String(p.contractId),
        symbol: p.symbol || `Contract#${p.contractId}`,
        netPos: p.netPosition,
        price: p.averagePrice || undefined,
      }));
  }
  return [];
}
