import { storage } from "./storage";
import {
  resolveMasterConnection,
  resolveFollowerConnection,
  resolveMasterAccountInfo,
  resolveFollowerAccountInfo,
  authenticateProvider,
  getProviderPositions,
} from "./provider-core";
import { flattenAccount, flattenTradovate, flattenTopstepX } from "./risk-enforcer";
import { pushSystemError } from "./system-health-stream";
import { dispatchRiskIntervention } from "./webhook-dispatcher";
import { reconciliationRuns, orphansDetected } from "./prometheus-metrics";

let isReconciling = false;

export async function runSyncRecovery(): Promise<void> {
  if (isReconciling) {
    console.log("[Reconciliation] Already running, skipping duplicate trigger");
    return;
  }

  isReconciling = true;
  const startMs = Date.now();
  let groupsScanned = 0;
  let orphansFound = 0;
  let orphansFlattened = 0;

  try {
    console.log("[Reconciliation] Starting sync recovery scan...");

    const groups = await storage.getActiveCopyGroups();
    if (groups.length === 0) {
      console.log("[Reconciliation] No active copy groups, nothing to reconcile");
      return;
    }

    for (const group of groups) {
      try {
        await reconcileGroup(group);
        groupsScanned++;
      } catch (err: any) {
        console.error(`[Reconciliation] Error reconciling group ${group.id} "${group.name}":`, err.message);
        pushSystemError("error", "reconciliation", `Group ${group.id} reconciliation error: ${err.message}`);
      }
    }

    const elapsed = Date.now() - startMs;
    reconciliationRuns.inc({ result: orphansFound > 0 ? "orphans_found" : "clean" });
    orphansDetected.set(orphansFound);
    console.log(
      `[Reconciliation] Scan complete — ${groupsScanned} groups scanned, ` +
      `${orphansFound} orphans found, ${orphansFlattened} flattened in ${elapsed}ms`
    );
  } catch (err: any) {
    reconciliationRuns.inc({ result: "error" });
    console.error("[Reconciliation] Fatal error during sync recovery:", err.message);
    pushSystemError("error", "reconciliation", `Fatal: ${err.message}`);
  } finally {
    isReconciling = false;
  }

  async function reconcileGroup(group: any): Promise<void> {
    const masterConn = await resolveMasterConnection(group);
    if (!masterConn) {
      console.warn(`[Reconciliation] Cannot resolve master connection for group ${group.id}`);
      return;
    }

    const masterAccountInfo = await resolveMasterAccountInfo(group);
    if (!masterAccountInfo) {
      console.warn(`[Reconciliation] Cannot resolve master account info for group ${group.id}`);
      return;
    }

    const masterAuth = await authenticateProvider(masterConn.providerKey, masterConn.creds);
    if (!masterAuth) {
      console.warn(`[Reconciliation] Master auth failed for group ${group.id}`);
      return;
    }

    const masterPositions = await getProviderPositions(masterAuth, masterAccountInfo.externalAccountId);

    if (masterPositions.length > 0) {
      return;
    }

    console.log(`[Reconciliation] Master flat for group ${group.id} "${group.name}" — checking followers`);

    const followers = await storage.getCopyFollowers(group.id);
    if (followers.length === 0) return;

    const followerResults = await Promise.allSettled(
      followers.map(async (follower) => {
        const fConn = await resolveFollowerConnection(follower);
        if (!fConn) return { follower, positions: [], skipped: true };

        const fAccountInfo = await resolveFollowerAccountInfo(follower);
        if (!fAccountInfo) return { follower, positions: [], skipped: true };

        const fAuth = await authenticateProvider(fConn.providerKey, fConn.creds);
        if (!fAuth) return { follower, positions: [], skipped: true };

        const positions = await getProviderPositions(fAuth, fAccountInfo.externalAccountId);
        return { follower, fConn, fAccountInfo, fAuth, positions, skipped: false };
      })
    );

    for (const result of followerResults) {
      if (result.status === "rejected") {
        console.error(`[Reconciliation] Follower position fetch failed:`, result.reason?.message || result.reason);
        continue;
      }

      const { follower, fConn, fAccountInfo, fAuth, positions, skipped } = result.value;
      if (skipped || positions.length === 0) continue;

      orphansFound++;
      const positionSummary = positions.map(p => `${p.symbol}:${p.netPos}`).join(", ");
      console.warn(
        `[Reconciliation] ORPHAN detected — follower ${fAccountInfo!.name} (account ${follower.followerAccountId}) ` +
        `holds [${positionSummary}] while master is flat`
      );

      const resolvedUserId = group.userId ?? undefined;
      try {
        const flattenStartMs = Date.now();
        let flatResult: { positionsClosed: number; ordersCancelled: number; errors: string[] };

        if (!follower.followerConnectionId) {
          const account = await storage.getAccount(follower.followerAccountId);
          if (!account) {
            console.error(`[Reconciliation] Internal account ${follower.followerAccountId} not found for flatten`);
            continue;
          }
          flatResult = await flattenAccount(account);
        } else {
          const errors: string[] = [];
          let positionsClosed = 0;
          let ordersCancelled = 0;

          if (fConn!.providerKey === "tradovate") {
            const r = await flattenTradovate(
              fConn!.creds,
              fAccountInfo!.externalAccountId,
              fAccountInfo!.accountId,
              errors
            );
            positionsClosed = r.positionsClosed;
            ordersCancelled = r.ordersCancelled;
          } else if (fConn!.providerKey === "topstepx") {
            const r = await flattenTopstepX(
              fConn!.creds,
              fAccountInfo!.externalAccountId,
              errors
            );
            positionsClosed = r.positionsClosed;
            ordersCancelled = r.ordersCancelled;
          } else {
            errors.push(`Unsupported provider: ${fConn!.providerKey}`);
          }

          flatResult = { positionsClosed, ordersCancelled, errors };
        }

        const executionMs = Date.now() - flattenStartMs;

        const account = !follower.followerConnectionId
          ? await storage.getAccount(follower.followerAccountId)
          : null;

        await storage.createRiskIntervention({
          accountId: follower.followerAccountId,
          userId: resolvedUserId,
          triggerTimestamp: new Date(),
          triggerType: "sync_recovery",
          hwm: 0,
          currentEquity: 0,
          eodLimit: 0,
          riskPercent: 0,
          positionsClosed: flatResult.positionsClosed,
          ordersCancelled: flatResult.ordersCancelled,
          status: flatResult.errors.length > 0 ? "partial" : "completed",
          errorMessage: flatResult.errors.length > 0
            ? `Orphan recovery: ${flatResult.errors.join("; ")}`
            : `Orphan recovery: master flat, closed ${flatResult.positionsClosed} position(s)`,
          executionMs,
          completedAt: new Date(),
        });

        await storage.createAlert({
          accountId: follower.followerAccountId,
          type: "risk_intervention",
          severity: "critical",
          title: `Sync Recovery: ${fAccountInfo!.name}`,
          message: `Orphaned position recovery. Master was flat but follower held [${positionSummary}]. ` +
            `Closed ${flatResult.positionsClosed} position(s), cancelled ${flatResult.ordersCancelled} order(s).`,
          userId: resolvedUserId,
        });

        dispatchRiskIntervention({
          userId: resolvedUserId,
          accountName: fAccountInfo!.name,
          accountId: follower.followerAccountId,
          eventType: "sync_recovery",
          title: `Sync Recovery: ${fAccountInfo!.name}`,
          message: `Orphaned position recovery. Master flat, follower held [${positionSummary}].`,
          positionsClosed: flatResult.positionsClosed,
          ordersCancelled: flatResult.ordersCancelled,
          executionMs,
          orphanedPositions: positionSummary,
        });

        if (flatResult.errors.length > 0) {
          console.warn(`[Reconciliation] Flatten partial for ${fAccountInfo!.name}:`, flatResult.errors);
        } else {
          orphansFlattened++;
          console.log(
            `[Reconciliation] Flatten complete — ${fAccountInfo!.name}: ` +
            `${flatResult.positionsClosed} pos closed, ${flatResult.ordersCancelled} orders cancelled (${executionMs}ms)`
          );
        }
      } catch (flatErr: any) {
        console.error(`[Reconciliation] Flatten failed for ${fAccountInfo!.name}:`, flatErr.message);
        pushSystemError("error", "reconciliation", `Flatten failed for ${fAccountInfo!.name}: ${flatErr.message}`);

        dispatchRiskIntervention({
          userId: resolvedUserId,
          accountName: fAccountInfo!.name,
          accountId: follower.followerAccountId,
          eventType: "flatten_failed",
          title: `Flatten Failed: ${fAccountInfo!.name}`,
          message: `Orphan recovery flatten failed: ${flatErr.message}`,
          orphanedPositions: positionSummary,
        });
      }
    }
  }
}

export function isReconciliationRunning(): boolean {
  return isReconciling;
}
