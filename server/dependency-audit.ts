import { exec } from "child_process";
import { readFile, unlink } from "fs/promises";
import { log } from "./logger";

export interface AuditResult {
  total: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  lastCheck: string;
  status: "healthy" | "warning" | "critical" | "unknown";
}

let lastAuditResult: AuditResult | null = null;

export function getLastAuditResult(): AuditResult | null {
  return lastAuditResult;
}

function makeUnknownResult(): AuditResult {
  return { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0, lastCheck: new Date().toISOString(), status: "unknown" };
}

function parseAuditJson(raw: string): AuditResult {
  const data = JSON.parse(raw);

  if (data?.error) {
    return makeUnknownResult();
  }

  const v = data?.metadata?.vulnerabilities || {};
  const total = Number(v.total ?? -1);

  if (total < 0) {
    return makeUnknownResult();
  }

  const critical = Number(v.critical || 0);
  const high = Number(v.high || 0);
  const moderate = Number(v.moderate || 0);
  const low = Number(v.low || 0);
  const info = Number(v.info || 0);

  let status: AuditResult["status"] = "healthy";
  if (critical > 0 || high > 0) status = "critical";
  else if (moderate > 0) status = "warning";
  else if (total > 0) status = "warning";

  return { total, critical, high, moderate, low, info, lastCheck: new Date().toISOString(), status };
}

export function runStartupAudit(): void {
  log("Running dependency vulnerability scan in background...", "audit");

  const auditFile = `/tmp/npm-audit-result-${Date.now()}.json`;

  exec(`bash scripts/audit.sh "${auditFile}"`, { cwd: process.cwd(), timeout: 60000 }, async (error, _stdout, _stderr) => {
    if (error && error.killed) {
      lastAuditResult = makeUnknownResult();
      log("Dependency scan: Timed out", "audit");
      return;
    }

    try {
      const raw = await readFile(auditFile, "utf-8");
      lastAuditResult = parseAuditJson(raw);
    } catch {
      lastAuditResult = makeUnknownResult();
      log("Dependency scan: Failed to read audit results", "audit");
      return;
    }

    try { await unlink(auditFile); } catch {}

    if (lastAuditResult.status === "critical") {
      log(`⚠ Dependency scan: ${lastAuditResult.critical} critical, ${lastAuditResult.high} high vulnerabilities found!`, "audit");
    } else if (lastAuditResult.status === "warning") {
      log(`⚡ Dependency scan: ${lastAuditResult.total} vulnerabilities (none high/critical)`, "audit");
    } else if (lastAuditResult.status === "healthy") {
      log("✓ Dependency scan: No known vulnerabilities", "audit");
    } else {
      log("Dependency scan: Could not determine results", "audit");
    }
  });
}
