import { storage } from "./storage";
import { db } from "./db";
import { accounts } from "@shared/schema";
import { integrationConnections, importedTrades, syncJobs, syncLogs } from "@shared/integrations-schema";
import { balanceHistory, alerts, withdrawals, equityTicks } from "@shared/schema";
import { journalEntries } from "@shared/journal-schema";
import { eq, inArray } from "drizzle-orm";

export async function getLinkedUserIds(userId: number): Promise<number[]> {
  return storage.getLinkedUserIds(userId);
}

export async function isLinkedUser(sessionUserId: number, resourceUserId: number): Promise<boolean> {
  if (sessionUserId === resourceUserId) return true;
  const linkedIds = await storage.getLinkedUserIds(sessionUserId);
  return linkedIds.includes(resourceUserId);
}

export async function mergeDuplicateData(primaryUserId: number, linkedUserId: number): Promise<{ mergedAccounts: number; deletedAccounts: number; deletedConnections: number }> {
  const mergedAccountIds: number[] = [];
  const deletedAccountIds: number[] = [];
  const deletedConnIds: number[] = [];

  await db.transaction(async (tx) => {
    const primaryAccounts = await tx.select().from(accounts).where(eq(accounts.userId, primaryUserId));
    const linkedAccountsList = await tx.select().from(accounts).where(eq(accounts.userId, linkedUserId));

    for (const linkedAcc of linkedAccountsList) {
      if (!linkedAcc.externalAccountId) continue;
      const duplicate = primaryAccounts.find(pa =>
        pa.externalAccountId === linkedAcc.externalAccountId &&
        pa.integrationConnectionId !== null &&
        linkedAcc.integrationConnectionId !== null &&
        pa.dataSource === linkedAcc.dataSource
      );
      if (duplicate) {
        await tx.update(importedTrades).set({ accountId: duplicate.id }).where(eq(importedTrades.accountId, linkedAcc.id));
        await tx.update(balanceHistory).set({ accountId: duplicate.id }).where(eq(balanceHistory.accountId, linkedAcc.id));
        await tx.update(alerts).set({ accountId: duplicate.id }).where(eq(alerts.accountId, linkedAcc.id));
        await tx.update(equityTicks).set({ accountId: duplicate.id }).where(eq(equityTicks.accountId, linkedAcc.id));
        await tx.update(journalEntries).set({ accountId: duplicate.id }).where(eq(journalEntries.accountId, linkedAcc.id));
        await tx.update(withdrawals).set({ accountId: duplicate.id }).where(eq(withdrawals.accountId, linkedAcc.id));
        await tx.delete(accounts).where(eq(accounts.id, linkedAcc.id));
        mergedAccountIds.push(duplicate.id);
        deletedAccountIds.push(linkedAcc.id);
      }
    }

    const primaryConns = await tx.select().from(integrationConnections).where(eq(integrationConnections.userId, primaryUserId));
    const linkedConns = await tx.select().from(integrationConnections).where(eq(integrationConnections.userId, linkedUserId));

    for (const linkedConn of linkedConns) {
      const duplicate = primaryConns.find(pc =>
        pc.providerId === linkedConn.providerId
      );
      if (duplicate) {
        await tx.update(accounts).set({ integrationConnectionId: duplicate.id }).where(eq(accounts.integrationConnectionId, linkedConn.id));
        await tx.delete(syncLogs).where(
          inArray(syncLogs.syncJobId,
            tx.select({ id: syncJobs.id }).from(syncJobs).where(eq(syncJobs.connectionId, linkedConn.id))
          )
        );
        await tx.delete(syncJobs).where(eq(syncJobs.connectionId, linkedConn.id));
        await tx.delete(integrationConnections).where(eq(integrationConnections.id, linkedConn.id));
        deletedConnIds.push(linkedConn.id);
      }
    }
  });

  return {
    mergedAccounts: mergedAccountIds.length,
    deletedAccounts: deletedAccountIds.length,
    deletedConnections: deletedConnIds.length,
  };
}

export async function ensureLinkedAdminAccounts(): Promise<void> {
  const PRIMARY_USER_ID = 1;
  const LINKED_USER_ID = 3;

  try {
    const existingLinks = await storage.getLinkedUsers();
    const alreadyLinked = existingLinks.some(l =>
      (l.primaryUserId === PRIMARY_USER_ID && l.linkedUserId === LINKED_USER_ID) ||
      (l.primaryUserId === LINKED_USER_ID && l.linkedUserId === PRIMARY_USER_ID)
    );

    if (!alreadyLinked) {
      await storage.createLinkedUser({
        primaryUserId: PRIMARY_USER_ID,
        linkedUserId: LINKED_USER_ID,
      });
      console.log(`[linked-users] Seeded link between user ${PRIMARY_USER_ID} and user ${LINKED_USER_ID}`);
    } else {
      console.log(`[linked-users] Link between user ${PRIMARY_USER_ID} and user ${LINKED_USER_ID} already exists`);
    }

    const result = await mergeDuplicateData(PRIMARY_USER_ID, LINKED_USER_ID);
    if (result.mergedAccounts > 0 || result.deletedConnections > 0) {
      console.log(`[linked-users] Merged duplicates: ${result.mergedAccounts} accounts, ${result.deletedConnections} connections`);
    } else {
      console.log(`[linked-users] No duplicate data to merge`);
    }
  } catch (error) {
    console.error("[linked-users] Error seeding linked admin accounts:", error);
  }
}
