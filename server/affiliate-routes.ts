import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import crypto from "crypto";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  storage.getUserById(req.session.userId).then(user => {
    if (!user || user.role !== "admin") return res.status(403).json({ message: "Admin access required" });
    next();
  }).catch(() => {
    res.status(500).json({ message: "Failed to verify admin access" });
  });
}

function generateReferralCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export async function generateUniqueReferralCode(userId: number): Promise<{ id: number; userId: number; code: string; createdAt: Date | null }> {
  for (let i = 0; i < 5; i++) {
    try {
      const code = generateReferralCode();
      return await storage.createReferralCode({ userId, code });
    } catch (err: any) {
      if (err?.code === "23505" && i < 4) continue;
      throw err;
    }
  }
}

export function registerAffiliateRoutes(app: Express) {
  app.get("/api/v1/affiliate/my-code", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      let code = await storage.getReferralCode(userId);
      if (!code) {
        code = await generateUniqueReferralCode(userId);
      }
      res.json(code);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to get referral code" });
    }
  });

  app.get("/api/v1/affiliate/my-referrals", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const myReferrals = await storage.getReferralsByReferrer(userId);
      const allUsers = await storage.getAllUsers();
      const usersMap = new Map(allUsers.map(u => [u.id, u]));

      const enriched = myReferrals.map(r => {
        const referred = usersMap.get(r.referredUserId);
        return {
          ...r,
          referredName: referred?.name || "Unknown",
          referredEmail: referred?.email || "",
        };
      });

      const totalReferred = myReferrals.length;
      const totalConverted = myReferrals.filter(r => r.status === "converted").length;
      const totalReward = myReferrals.reduce((sum, r) => sum + (r.rewardAmount || 0), 0);

      res.json({
        referrals: enriched,
        stats: { totalReferred, totalConverted, totalReward },
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to get referrals" });
    }
  });

  app.get("/api/v1/admin/affiliate/stats", requireAdmin, async (req, res) => {
    try {
      const allReferrals = await storage.getAllReferrals();
      const allCodes = await storage.getAllReferralCodes();
      const allUsers = await storage.getAllUsers();
      const usersMap = new Map(allUsers.map(u => [u.id, u]));

      const totalReferralCodes = allCodes.length;
      const totalReferrals = allReferrals.length;
      const totalConverted = allReferrals.filter(r => r.status === "converted").length;
      const totalRewardsGiven = allReferrals.reduce((sum, r) => sum + (r.rewardAmount || 0), 0);
      const pendingRewards = allReferrals.filter(r => r.status === "converted" && !r.rewardApplied).length;

      const topReferrers = allCodes.map(c => {
        const user = usersMap.get(c.userId);
        const userReferrals = allReferrals.filter(r => r.referrerUserId === c.userId);
        return {
          userId: c.userId,
          name: user?.name || "Unknown",
          email: user?.email || "",
          code: c.code,
          totalReferred: userReferrals.length,
          totalConverted: userReferrals.filter(r => r.status === "converted").length,
          totalReward: userReferrals.reduce((sum, r) => sum + (r.rewardAmount || 0), 0),
        };
      }).filter(r => r.totalReferred > 0).sort((a, b) => b.totalReferred - a.totalReferred);

      const recentReferrals = allReferrals.slice(0, 20).map(r => {
        const referrer = usersMap.get(r.referrerUserId);
        const referred = usersMap.get(r.referredUserId);
        return {
          ...r,
          referrerName: referrer?.name || "Unknown",
          referredName: referred?.name || "Unknown",
          referredEmail: referred?.email || "",
        };
      });

      res.json({
        stats: { totalReferralCodes, totalReferrals, totalConverted, totalRewardsGiven, pendingRewards },
        topReferrers,
        recentReferrals,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to get affiliate stats" });
    }
  });

  app.post("/api/v1/admin/affiliate/apply-reward/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

      const allReferrals = await storage.getAllReferrals();
      const referral = allReferrals.find(r => r.id === id);
      if (!referral) return res.status(404).json({ message: "Referral not found" });
      if (referral.status !== "converted") return res.status(400).json({ message: "Referral not converted yet" });
      if (referral.rewardApplied) return res.status(400).json({ message: "Reward already applied" });

      const referrerSub = await storage.getSubscription(referral.referrerUserId);
      if (referrerSub) {
        const currentEnd = referrerSub.currentPeriodEnd ? new Date(referrerSub.currentPeriodEnd) : new Date();
        const newEnd = new Date(Math.max(currentEnd.getTime(), Date.now()));
        newEnd.setDate(newEnd.getDate() + 30);
        await storage.updateSubscription(referrerSub.id, {
          currentPeriodEnd: newEnd,
          status: "active",
        });

        if (referrerSub.trialEndsAt) {
          const currentTrial = new Date(referrerSub.trialEndsAt);
          const newTrial = new Date(Math.max(currentTrial.getTime(), Date.now()));
          newTrial.setDate(newTrial.getDate() + 30);
          await storage.updateSubscription(referrerSub.id, {
            trialEndsAt: newTrial,
          });
        }
      }

      await storage.updateReferral(id, { rewardApplied: true });
      res.json({ success: true, reward: "free_month_added" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to apply reward" });
    }
  });
}
