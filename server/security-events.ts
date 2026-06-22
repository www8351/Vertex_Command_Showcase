import { storage } from "./storage";
import type { InsertSecurityEvent } from "@shared/schema";

export type SecurityEventType =
  | "login_success"
  | "login_failed"
  | "account_locked"
  | "account_unlocked"
  | "password_reset_requested"
  | "password_reset_completed"
  | "admin_role_change"
  | "admin_plan_change"
  | "csrf_failure"
  | "rate_limit_hit"
  | "register_success"
  | "credential_access"
  | "2fa_enabled"
  | "2fa_disabled";

export type SecuritySeverity = "info" | "warning" | "critical";

export async function logSecurityEvent(
  eventType: SecurityEventType,
  severity: SecuritySeverity,
  userId: number | null,
  ipAddress: string | null,
  details?: Record<string, any>,
): Promise<void> {
  try {
    const event: InsertSecurityEvent = {
      eventType,
      severity,
      userId,
      ipAddress,
      details: details || null,
    };
    await storage.createSecurityEvent(event);
  } catch (err) {
    console.error("Failed to log security event:", err);
  }
}

export function getClientIp(req: { ip?: string; headers?: Record<string, any> }): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip || "unknown";
}
