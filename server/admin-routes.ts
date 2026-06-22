import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { apiQueue } from "./api-queue";
import { runBackup, listBackups, getBackupStatus, cleanupOldBackups } from "./backup";
import { logSecurityEvent, getClientIp } from "./security-events";
import { mergeDuplicateData } from "./linked-users";

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  storage.getUserById(req.session.userId).then(user => {
    if (!user || user.role !== "admin") return res.status(403).json({ message: "גישת מנהל נדרשת" });
    next();
  });
}

export function registerAdminRoutes(app: Express) {
  app.get("/api/v1/admin/users", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const sanitized = allUsers.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      emailVerified: u.emailVerified,
      failedLoginAttempts: u.failedLoginAttempts,
      lockedUntil: u.lockedUntil,
      totpEnabled: u.totpEnabled,
    }));
    res.json(sanitized);
  });

  app.post("/api/v1/admin/users/:id/unlock", requireAdmin, async (req, res) => {
    try {
      const targetId = parseInt(req.params.id);
      if (isNaN(targetId)) return res.status(400).json({ code: "invalid_id", message: "Invalid user ID" });

      const user = await storage.getUserById(targetId);
      if (!user) return res.status(404).json({ code: "not_found", message: "User not found" });

      await storage.unlockAccount(targetId);
      await logSecurityEvent("account_unlocked", "info", req.session.userId!, getClientIp(req), { targetUserId: targetId, targetEmail: user.email, action: "admin_unlock" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error unlocking user:", error);
      res.status(500).json({ code: "server_error", message: "Failed to unlock user" });
    }
  });

  app.get("/api/v1/admin/billing", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const plans = await storage.getPlans();
    const subscriptionData: any[] = [];

    for (const user of allUsers) {
      const sub = await storage.getSubscription(user.id);
      const plan = sub ? plans.find(p => p.id === sub.planId) : plans.find(p => p.key === "free");
      subscriptionData.push({
        userId: user.id,
        userName: user.name,
        email: user.email,
        planName: plan?.name || "Free",
        planKey: plan?.key || "free",
        status: sub?.status || "none",
        amount: sub?.amount || 0,
        billingCycle: sub?.billingCycle || null,
        trialEndsAt: sub?.trialEndsAt || null,
      });
    }

    res.json(subscriptionData);
  });

  app.get("/api/v1/admin/integrations/health", requireAdmin, async (_req, res) => {
    const providers = await storage.getProviders();
    const health = providers.map(p => ({
      id: p.id,
      key: p.key,
      name: p.name,
      active: p.active,
      status: "operational",
    }));
    res.json(health);
  });

  app.patch("/api/v1/admin/users/:id/role", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({ role: z.enum(["user", "admin"]) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ code: "invalid_role", message: "Invalid role" });

      const targetId = parseInt(req.params.id);
      if (isNaN(targetId)) return res.status(400).json({ code: "invalid_id", message: "Invalid user ID" });

      if (targetId === req.session.userId && parsed.data.role !== "admin") {
        return res.status(400).json({ code: "self_demotion", message: "Cannot demote yourself" });
      }

      const updated = await storage.updateUserRole(targetId, parsed.data.role);
      if (!updated) return res.status(404).json({ code: "not_found", message: "User not found" });

      await logSecurityEvent("admin_role_change", "critical", req.session.userId!, getClientIp(req), { targetUserId: targetId, targetEmail: updated.email, newRole: parsed.data.role, targetName: updated.name });
      res.json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role });
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ code: "server_error", message: "Failed to update role" });
    }
  });

  app.patch("/api/v1/admin/users/:id/plan", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({ planKey: z.string() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ code: "invalid_plan", message: "Invalid plan key" });

      const targetId = parseInt(req.params.id);
      if (isNaN(targetId)) return res.status(400).json({ code: "invalid_id", message: "Invalid user ID" });

      const targetUser = await storage.getUserById(targetId);
      if (!targetUser) return res.status(404).json({ code: "not_found", message: "User not found" });

      const plan = await storage.getPlanByKey(parsed.data.planKey);
      if (!plan) return res.status(400).json({ code: "invalid_plan", message: "Plan not found" });

      const existingSub = await storage.getSubscription(targetId);

      if (existingSub) {
        const cycle = existingSub.billingCycle || "monthly";
        const amount = cycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
        await storage.updateSubscription(existingSub.id, {
          planId: plan.id,
          status: "active",
          amount,
          billingCycle: cycle,
          trialEndsAt: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
        });
      } else {
        await storage.createSubscription({
          userId: targetId,
          planId: plan.id,
          provider: "admin",
          status: "active",
          billingCycle: "monthly",
          amount: plan.monthlyPrice,
          currency: "usd",
          cancelAtPeriodEnd: false,
        });
      }

      await logSecurityEvent("admin_plan_change", "info", req.session.userId!, getClientIp(req), { targetUserId: targetId, targetEmail: targetUser.email, newPlan: parsed.data.planKey, planName: plan.name });
      res.json({ success: true, userId: targetId, planKey: parsed.data.planKey, planName: plan.name });
    } catch (error) {
      console.error("Error changing user plan:", error);
      res.status(500).json({ code: "server_error", message: "Failed to change plan" });
    }
  });

  app.get("/api/v1/admin/accounts", requireAdmin, async (_req, res) => {
    try {
      const allAccounts = await storage.getAllAccounts();
      const allUsers = await storage.getAllUsers();
      const allConnections = await storage.getAllConnections();
      const providers = await storage.getProviders();
      const usersMap = Object.fromEntries(allUsers.map(u => [u.id, u]));
      const connectionsMap = Object.fromEntries(allConnections.map(c => [c.id, c]));
      const providersMap = Object.fromEntries(providers.map(p => [p.id, p]));

      const enriched = allAccounts.map(a => {
        const user = usersMap[a.userId];
        const conn = a.integrationConnectionId ? connectionsMap[a.integrationConnectionId] : null;
        const provider = conn ? providersMap[conn.providerId] : null;
        return {
          id: a.id,
          accountId: a.accountId,
          accountName: a.accountId,
          userId: a.userId,
          userName: user?.name || "Unknown",
          userEmail: user?.email || "",
          status: a.status || "healthy",
          balance: a.balance,
          dataSource: a.dataSource,
          brokerKey: provider?.key || (a.dataSource === "manual" ? "manual" : "unknown"),
          brokerName: provider?.name || (a.dataSource === "manual" ? "Manual" : "Unknown"),
          connectionId: a.integrationConnectionId,
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching admin accounts:", error);
      res.status(500).json({ code: "server_error", message: "Failed to fetch accounts" });
    }
  });

  app.delete("/api/v1/admin/accounts/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ code: "invalid_id", message: "Invalid account ID" });

      const deleted = await storage.deleteAccount(id);
      if (!deleted) return res.status(404).json({ code: "not_found", message: "Account not found" });

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting account:", error);
      res.status(500).json({ code: "server_error", message: "Failed to delete account" });
    }
  });

  app.post("/api/v1/admin/accounts/bulk-delete", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        ids: z.array(z.number()).optional(),
        brokerKey: z.string().optional(),
        all: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ code: "invalid_data", message: "Invalid request" });

      let deletedCount = 0;

      if (parsed.data.all) {
        const allAccounts = await storage.getAllAccounts();
        const allIds = allAccounts.map(a => a.id);
        deletedCount = await storage.bulkDeleteAccounts(allIds);
      } else if (parsed.data.brokerKey) {
        const allAccounts = await storage.getAllAccounts();
        const allConnections = await storage.getAllConnections();
        const providers = await storage.getProviders();
        const provider = providers.find(p => p.key === parsed.data.brokerKey);

        if (parsed.data.brokerKey === "manual") {
          const manualIds = allAccounts.filter(a => a.dataSource === "manual").map(a => a.id);
          deletedCount = await storage.bulkDeleteAccounts(manualIds);
        } else if (provider) {
          const brokerConnectionIds = allConnections.filter(c => c.providerId === provider.id).map(c => c.id);
          const brokerAccountIds = allAccounts.filter(a => a.integrationConnectionId && brokerConnectionIds.includes(a.integrationConnectionId)).map(a => a.id);
          deletedCount = await storage.bulkDeleteAccounts(brokerAccountIds);
        }
      } else if (parsed.data.ids && parsed.data.ids.length > 0) {
        deletedCount = await storage.bulkDeleteAccounts(parsed.data.ids);
      }

      res.json({ success: true, deletedCount });
    } catch (error) {
      console.error("Error bulk deleting accounts:", error);
      res.status(500).json({ code: "server_error", message: "Failed to bulk delete accounts" });
    }
  });

  app.patch("/api/v1/admin/accounts/:id/status", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ code: "invalid_id", message: "Invalid account ID" });

      const schema = z.object({ status: z.enum(["healthy", "suspended"]) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ code: "invalid_status", message: "Invalid status" });

      const updated = await storage.updateAccountStatus(id, parsed.data.status);
      if (!updated) return res.status(404).json({ code: "not_found", message: "Account not found" });

      res.json({ success: true, status: updated.status });
    } catch (error) {
      console.error("Error updating account status:", error);
      res.status(500).json({ code: "server_error", message: "Failed to update account status" });
    }
  });

  app.get("/api/v1/admin/metrics", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const plans = await storage.getPlans();

    let totalMRR = 0;
    let activeSubscriptions = 0;
    let trialSubscriptions = 0;

    for (const user of allUsers) {
      const sub = await storage.getSubscription(user.id);
      if (sub) {
        if (sub.status === "active") {
          activeSubscriptions++;
          totalMRR += sub.billingCycle === "yearly" ? (sub.amount || 0) / 12 : (sub.amount || 0);
        } else if (sub.status === "trialing") {
          trialSubscriptions++;
        }
      }
    }

    res.json({
      totalUsers: allUsers.length,
      verifiedUsers: allUsers.filter(u => u.emailVerified).length,
      activeSubscriptions,
      trialSubscriptions,
      totalMRR: Math.round(totalMRR * 100) / 100,
      planDistribution: plans.map(p => ({ name: p.name, key: p.key })),
    });
  });

  app.get("/api/v1/admin/security-events", requireAdmin, async (req, res) => {
    try {
      const severity = req.query.severity as string | undefined;
      const eventType = req.query.eventType as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const filters = {
        severity: severity && severity !== "all" ? severity : undefined,
        eventType: eventType && eventType !== "all" ? eventType : undefined,
        limit,
        offset,
      };

      const [events, total] = await Promise.all([
        storage.getSecurityEvents(filters),
        storage.getSecurityEventCount({ severity: filters.severity, eventType: filters.eventType }),
      ]);

      const allUsers = await storage.getAllUsers();
      const usersMap = Object.fromEntries(allUsers.map(u => [u.id, { name: u.name, email: u.email }]));

      const enriched = events.map(e => ({
        ...e,
        userName: e.userId ? usersMap[e.userId]?.name || null : null,
        userEmail: e.userId ? usersMap[e.userId]?.email || null : null,
      }));

      res.json({ events: enriched, total, limit, offset });
    } catch (error) {
      console.error("Error fetching security events:", error);
      res.status(500).json({ code: "server_error", message: "Failed to fetch security events" });
    }
  });

  app.get("/api/v1/admin/api-queue/status", requireAdmin, async (_req, res) => {
    res.json(apiQueue.getStatus());
  });

  const updateQueueConfigSchema = z.object({
    maxRequestsPerSecond: z.number().min(1).max(100).optional(),
    maxConcurrent: z.number().min(1).max(50).optional(),
  });

  app.patch("/api/v1/admin/api-queue/:provider/config", requireAdmin, async (req, res) => {
    const { provider } = req.params;
    const knownProviders = apiQueue.getKnownProviders();
    if (!knownProviders.includes(provider)) {
      return res.status(400).json({ message: `Unknown provider. Valid providers: ${knownProviders.join(", ")}` });
    }
    const parsed = updateQueueConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid config", errors: parsed.error.flatten() });
    }
    apiQueue.updateConfig(provider, parsed.data);
    const status = apiQueue.getProviderStatus(provider);
    res.json(status);
  });

  app.get("/api/v1/admin/backups", requireAdmin, async (_req, res) => {
    try {
      const backups = listBackups();
      const status = getBackupStatus();
      res.json({ backups, status });
    } catch (error: any) {
      console.error("Error listing backups:", error);
      res.status(500).json({ code: "server_error", message: "Failed to list backups" });
    }
  });

  app.post("/api/v1/admin/backup", requireAdmin, async (_req, res) => {
    try {
      const result = await runBackup();
      cleanupOldBackups();
      res.json({ success: true, backup: result });
    } catch (error: any) {
      console.error("Error creating backup:", error);
      res.status(500).json({ code: "backup_failed", message: "Backup failed" });
    }
  });

  app.get("/api/v1/admin/linked-users", requireAdmin, async (_req, res) => {
    try {
      const links = await storage.getLinkedUsers();
      const allUsers = await storage.getAllUsers();
      const usersMap = Object.fromEntries(allUsers.map(u => [u.id, { name: u.name, email: u.email, role: u.role }]));
      const enriched = links.map(l => ({
        ...l,
        primaryUser: usersMap[l.primaryUserId] || null,
        linkedUser: usersMap[l.linkedUserId] || null,
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching linked users:", error);
      res.status(500).json({ code: "server_error", message: "Failed to fetch linked users" });
    }
  });

  app.post("/api/v1/admin/linked-users", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        primaryUserId: z.number(),
        linkedUserId: z.number(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ code: "invalid_data", message: "Invalid data" });

      if (parsed.data.primaryUserId === parsed.data.linkedUserId) {
        return res.status(400).json({ code: "same_user", message: "Cannot link a user to themselves" });
      }

      const primaryUser = await storage.getUserById(parsed.data.primaryUserId);
      const linkedUser = await storage.getUserById(parsed.data.linkedUserId);
      if (!primaryUser) return res.status(404).json({ code: "not_found", message: "Primary user not found" });
      if (!linkedUser) return res.status(404).json({ code: "not_found", message: "Linked user not found" });

      if (primaryUser.role !== "admin" || linkedUser.role !== "admin") {
        return res.status(400).json({ code: "not_admin", message: "Both users must be admins to create a link" });
      }

      const existingLinks = await storage.getLinkedUsers();
      const alreadyLinked = existingLinks.some(l =>
        (l.primaryUserId === parsed.data.primaryUserId && l.linkedUserId === parsed.data.linkedUserId) ||
        (l.primaryUserId === parsed.data.linkedUserId && l.linkedUserId === parsed.data.primaryUserId)
      );
      if (alreadyLinked) {
        return res.status(409).json({ code: "already_linked", message: "Users are already linked" });
      }

      const link = await storage.createLinkedUser(parsed.data);
      await logSecurityEvent("admin_link_users", "info", req.session.userId!, getClientIp(req), {
        primaryUserId: parsed.data.primaryUserId,
        linkedUserId: parsed.data.linkedUserId,
      });
      res.status(201).json(link);
    } catch (error) {
      console.error("Error creating linked user:", error);
      res.status(500).json({ code: "server_error", message: "Failed to create link" });
    }
  });

  app.delete("/api/v1/admin/linked-users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ code: "invalid_id", message: "Invalid ID" });
      const deleted = await storage.deleteLinkedUser(id);
      if (!deleted) return res.status(404).json({ code: "not_found", message: "Link not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting linked user:", error);
      res.status(500).json({ code: "server_error", message: "Failed to delete link" });
    }
  });

  app.post("/api/v1/admin/linked-users/merge-duplicates", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        primaryUserId: z.number(),
        linkedUserId: z.number(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ code: "invalid_data", message: "Invalid data" });
      const { primaryUserId, linkedUserId } = parsed.data;

      const result = await mergeDuplicateData(primaryUserId, linkedUserId);

      await logSecurityEvent("admin_merge_duplicates", "info", req.session.userId!, getClientIp(req), {
        primaryUserId, linkedUserId, ...result,
      });

      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Error merging duplicates:", error);
      res.status(500).json({ code: "server_error", message: "Failed to merge duplicates" });
    }
  });
}
