import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { db } from "./db";
import { insertAccountSchema, insertWithdrawalSchema, insertFirmSchema, insertFirmTierSchema, insertBalanceHistorySchema, insertAlertSchema, balanceHistory, insertSettingsSchema } from "@shared/schema";
import { importedTrades } from "@shared/integrations-schema";
import { eq, asc, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
let _qrcodePromise: Promise<any> | null = null;
function getQRCode() {
  if (!_qrcodePromise) {
    _qrcodePromise = import("qrcode").then(mod => mod.default || mod);
  }
  return _qrcodePromise;
}
import { encrypt, decrypt } from "./encryption";
let _otplibPromise: Promise<any> | null = null;
function getOtpLib() {
  if (!_otplibPromise) {
    _otplibPromise = import("otplib").then(mod => mod.default || mod);
  }
  return _otplibPromise;
}

const totpLib = {
  generateSecret: async () => (await getOtpLib()).generateSecret() as string,
  check: async (token: string, secret: string) => {
    const result = (await getOtpLib()).verifySync({ token, secret });
    return result?.valid === true;
  },
  keyuri: async (account: string, issuer: string, secret: string) =>
    (await getOtpLib()).generateURI({ label: account, issuer, secret, strategy: "totp" }) as string,
};
let _googleClientPromise: Promise<any> | null = null;
function getGoogleClient() {
  if (!_googleClientPromise) {
    _googleClientPromise = import("google-auth-library").then(m => new m.OAuth2Client(process.env.GOOGLE_CLIENT_ID));
  }
  return _googleClientPromise;
}
import { sendVerificationEmail, sendPasswordResetEmail } from "./gmail";
import { resolveRules, computeAccountStatus, computeDrawdownInfo, computeTradingPriority, computeConsistencyFromTrades, computeAccountStatusFromTrades, computeAccountTradeStats } from "./rule-engine";
import { registerIntegrationRoutes } from "./integrations-routes";
import { registerBillingRoutes, requirePlanFeature, checkAccountLimit } from "./billing-routes";
import { registerAdminRoutes } from "./admin-routes";
import { registerMonitorRoutes } from "./monitor-routes";
import { registerHelpRoutes } from "./help-routes";
import { registerLatencyRoutes } from "./latency-monitor";
import { sanitizeCsvCell } from "./sanitize";
import { registerCopyTradingRoutes } from "./copy-trading-routes";
import { registerJournalRoutes } from "./journal-routes";
import { registerTradingRoutes } from "./trading-routes";
import { registerSignalRoutes } from "./signal-routes";
import { registerAffiliateRoutes, generateUniqueReferralCode } from "./affiliate-routes";
import { registerSystemHealthStreamRoutes } from "./system-health-stream";
import { registerPlaybookRoutes } from "./playbook-routes";
import { startCopyEngine } from "./copy-trading-engine";
import { startDataPipelineAutoConnect, onAccountRemoved } from "./data-pipeline-autoconnect";
import { logSecurityEvent, getClientIp } from "./security-events";
import { evaluateAccountsBatch, type AccountInput } from "./trailing-drawdown";
import { processEquityTick, getDrawdownStatusForAccounts, startEquityTickCleanup, backfillAllAccounts } from "./equity-tick-processor";
import { isLinkedUser } from "./linked-users";

async function verifyTurnstileToken(token: string, ip: string): Promise<boolean> {
  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

const registerSchema = z.object({
  name: z.string().min(1, "שם נדרש"),
  email: z.string().email("אימייל לא תקין"),
  password: z.string()
    .min(8, "הסיסמה חייבת להכיל לפחות 8 תווים")
    .regex(/[A-Z]/, "הסיסמה חייבת להכיל לפחות אות גדולה אחת")
    .regex(/[a-z]/, "הסיסמה חייבת להכיל לפחות אות קטנה אחת")
    .regex(/[^A-Za-z0-9]/, "הסיסמה חייבת להכיל לפחות סימן מיוחד אחד (!@#$%...)"),
});

const loginSchema = z.object({
  email: z.string().email("אימייל לא תקין"),
  password: z.string().min(1, "סיסמה נדרשת"),
});

const emailSchema = z.object({
  email: z.string().email("אימייל לא תקין"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "טוקן נדרש"),
  password: z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים"),
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

async function ensureAdminDeskPlan(userId: number): Promise<void> {
  try {
    const unlimitedPlan = await storage.getPlanByKey("unlimited");
    if (!unlimitedPlan) return;

    const existingSub = await storage.getSubscription(userId);
    if (existingSub && existingSub.planId === unlimitedPlan.id && existingSub.status === "active") {
      return;
    }

    if (existingSub) {
      await storage.updateSubscription(existingSub.id, {
        planId: unlimitedPlan.id,
        status: "active",
        trialEndsAt: null,
      });
      console.log(`[Admin] Updated user ${userId} subscription to Desk plan`);
    } else {
      await storage.createSubscription({
        userId,
        planId: unlimitedPlan.id,
        provider: "internal",
        status: "active",
        trialEndsAt: null,
        amount: 0,
        currency: "usd",
        billingCycle: "monthly",
      });
      console.log(`[Admin] Created Unlimited plan subscription for user ${userId}`);
    }
  } catch (err: any) {
    console.error(`[Admin] Failed to ensure Unlimited plan for user ${userId}:`, err.message);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Turnstile Config ─────────────────────────────────
  app.get("/api/v1/auth/turnstile-config", (_req, res) => {
    const siteKey = process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || "";
    const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || "";
    const enabled = !!(siteKey && secretKey);
    res.json({ siteKey: enabled ? siteKey : "", enabled });
  });

  // ─── Google Sign-In Config ────────────────────────────
  app.get("/api/v1/auth/google-config", (_req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    res.json({ clientId, enabled: !!clientId });
  });

  // ─── Auth ──────────────────────────────────────────
  app.post("/api/v1/auth/register", async (req, res) => {
    try {
      const turnstileToken = req.body.turnstileToken as string | undefined;
      if (process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY && process.env.CLOUDFLARE_TURNSTILE_SITE_KEY) {
        if (!turnstileToken) return res.status(403).json({ message: "נדרש אימות אנושי" });
        const valid = await verifyTurnstileToken(turnstileToken, getClientIp(req));
        if (!valid) return res.status(403).json({ message: "אימות אנושי נכשל. נסה שוב." });
      }
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "נתונים לא תקינים", errors: parsed.error.flatten() });
      const { name, email, password } = parsed.data;
      const referralCode = req.body.referralCode as string | undefined;

      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: "אימייל כבר קיים במערכת" });

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ name, email, passwordHash, role: "user", emailVerified: false, verificationToken: null, verificationTokenExpiresAt: null });

      const freePlan = await storage.getPlanByKey("free");
      if (freePlan) {
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 7);
        await storage.createSubscription({
          userId: user.id,
          planId: freePlan.id,
          provider: "internal",
          status: "trialing",
          trialEndsAt,
          amount: 0,
          currency: "usd",
          billingCycle: "monthly",
        });
      }

      try {
        await generateUniqueReferralCode(user.id);
      } catch (codeErr: any) {
        console.error("Failed to auto-create referral code:", codeErr.message);
      }

      if (referralCode) {
        try {
          const codeRecord = await storage.getReferralCodeByCode(referralCode);
          if (codeRecord && codeRecord.userId !== user.id) {
            await storage.createReferral({
              referrerUserId: codeRecord.userId,
              referredUserId: user.id,
              status: "registered",
            });
          }
        } catch (refErr: any) {
          console.error("Failed to track referral:", refErr.message);
        }
      }

      req.session.userId = user.id;
      await logSecurityEvent("register_success", "info", user.id, getClientIp(req), { email });
      res.status(201).json({
        id: user.id, name: user.name, email: user.email, role: user.role
      });
    } catch (err: any) {
      res.status(500).json({ message: "שגיאה בהרשמה" });
    }
  });

  app.get("/api/v1/auth/verify/:token", async (req, res) => {
    try {
      const user = await storage.getUserByVerificationToken(req.params.token);
      if (!user) {
        return res.redirect("/?verified=invalid");
      }
      if (user.verificationTokenExpiresAt && new Date(user.verificationTokenExpiresAt) < new Date()) {
        return res.redirect("/?verified=invalid");
      }
      await storage.verifyUser(user.id);
      res.redirect("/?verified=success");
    } catch (err: any) {
      res.redirect("/?verified=error");
    }
  });

  app.post("/api/v1/auth/resend-verification", async (req, res) => {
    try {
      const parsed = emailSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "אימייל נדרש", errors: parsed.error.flatten() });
      const { email } = parsed.data;

      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(404).json({ message: "משתמש לא נמצא" });
      if (user.emailVerified) return res.json({ message: "האימייל כבר אומת" });

      const newToken = crypto.randomBytes(32).toString("hex");
      const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.updateUserVerificationToken(user.id, newToken, newExpiry);

      try {
        await sendVerificationEmail(email, user.name, newToken);
      } catch (emailErr: any) {
        console.error("Failed to resend verification email:", emailErr?.message);
      }

      res.json({ message: "אימייל אימות נשלח מחדש" });
    } catch (err: any) {
      res.status(500).json({ message: "שגיאה בשליחה חוזרת" });
    }
  });

  app.post("/api/v1/auth/login", async (req, res) => {
    try {
      const turnstileToken = req.body.turnstileToken as string | undefined;
      if (process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY && process.env.CLOUDFLARE_TURNSTILE_SITE_KEY) {
        if (!turnstileToken) return res.status(403).json({ message: "נדרש אימות אנושי" });
        const valid = await verifyTurnstileToken(turnstileToken, getClientIp(req));
        if (!valid) return res.status(403).json({ message: "אימות אנושי נכשל. נסה שוב." });
      }
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "אימייל וסיסמה נדרשים", errors: parsed.error.flatten() });
      const { email, password } = parsed.data;

      const user = await storage.getUserByEmail(email);
      const clientIp = getClientIp(req);
      if (!user) {
        await logSecurityEvent("login_failed", "warning", null, clientIp, { reason: "unknown_email", email });
        return res.status(401).json({ message: "אימייל או סיסמה שגויים" });
      }

      if (user.lockedUntil) {
        if (new Date(user.lockedUntil) > new Date()) {
          const remainingMs = new Date(user.lockedUntil).getTime() - Date.now();
          const remainingMinutes = Math.ceil(remainingMs / 60000);
          await logSecurityEvent("login_failed", "warning", user.id, clientIp, { reason: "account_locked", email });
          return res.status(423).json({ message: "החשבון נעול עקב ניסיונות כושלים", lockedUntil: user.lockedUntil, remainingMinutes });
        }
        await storage.resetFailedLoginAttempts(user.id);
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        const updated = await storage.incrementFailedLoginAttempts(user.id);
        if (updated && updated.failedLoginAttempts >= 5) {
          const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
          await storage.lockAccount(user.id, lockUntil);
          await logSecurityEvent("account_locked", "critical", user.id, clientIp, { reason: "failed_login_attempts", attempts: updated.failedLoginAttempts });
          return res.status(423).json({ message: "החשבון ננעל ל-15 דקות עקב ניסיונות כושלים", lockedUntil: lockUntil, remainingMinutes: 15 });
        }
        await logSecurityEvent("login_failed", "warning", user.id, clientIp, { reason: "invalid_password", email, attempts: updated?.failedLoginAttempts });
        return res.status(401).json({ message: "אימייל או סיסמה שגויים" });
      }

      await storage.resetFailedLoginAttempts(user.id);

      if (user.totpEnabled) {
        const tempToken = crypto.randomBytes(32).toString("hex");
        (req.session as any).pending2faUserId = user.id;
        (req.session as any).pending2faToken = tempToken;
        (req.session as any).pending2faIssuedAt = Date.now();
        (req.session as any).pending2faAttempts = 0;
        return res.json({ requires2fa: true, tempToken });
      }

      if (user.role === "admin") {
        await ensureAdminDeskPlan(user.id);
      }

      req.session.userId = user.id;
      await logSecurityEvent("login_success", "info", user.id, clientIp, { email });
      res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl, onboardingCompleted: user.onboardingCompleted, isDemo: user.isDemo });
    } catch (err: any) {
      res.status(500).json({ message: "שגיאה בהתחברות" });
    }
  });

  // ─── Google Sign-In (GIS ID-token flow) ───────────────
  app.post("/api/v1/auth/google", async (req, res) => {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return res.status(503).json({ message: "התחברות עם גוגל אינה זמינה" });

      const credential = req.body.credential as string | undefined;
      if (!credential || typeof credential !== "string") {
        return res.status(400).json({ message: "חסר טוקן גוגל" });
      }

      const clientIp = getClientIp(req);

      // Verify the ID token against Google's public keys (audience = our client id)
      let payload: any;
      try {
        const client = await getGoogleClient();
        const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
        payload = ticket.getPayload();
      } catch {
        await logSecurityEvent("login_failed", "warning", null, clientIp, { reason: "google_token_invalid" });
        return res.status(401).json({ message: "אימות גוגל נכשל" });
      }

      if (!payload || !payload.sub || !payload.email) {
        return res.status(401).json({ message: "אימות גוגל נכשל" });
      }
      if (payload.email_verified === false) {
        return res.status(401).json({ message: "האימייל בגוגל אינו מאומת" });
      }

      const googleId = String(payload.sub);
      const email = String(payload.email).toLowerCase();
      const name = (payload.name as string) || email.split("@")[0];
      const picture = (payload.picture as string) || null;

      // 1) Match by googleId. 2) else by email → link. 3) else create new.
      let user = await storage.getUserByGoogleId(googleId);
      let isNew = false;

      if (!user) {
        const byEmail = await storage.getUserByEmail(email);
        if (byEmail) {
          user = (await storage.updateUser(byEmail.id, {
            googleId,
            avatarUrl: byEmail.avatarUrl || picture,
            emailVerified: true,
          })) || byEmail;
        }
      }

      if (!user) {
        const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
        user = await storage.createUser({
          name,
          email,
          passwordHash: randomHash,
          role: "user",
          emailVerified: true,
          googleId,
          avatarUrl: picture,
          verificationToken: null,
          verificationTokenExpiresAt: null,
        });
        isNew = true;

        const freePlan = await storage.getPlanByKey("free");
        if (freePlan) {
          const trialEndsAt = new Date();
          trialEndsAt.setDate(trialEndsAt.getDate() + 7);
          await storage.createSubscription({
            userId: user.id,
            planId: freePlan.id,
            provider: "internal",
            status: "trialing",
            trialEndsAt,
            amount: 0,
            currency: "usd",
            billingCycle: "monthly",
          });
        }
        try {
          await generateUniqueReferralCode(user.id);
        } catch (codeErr: any) {
          console.error("Failed to auto-create referral code:", codeErr.message);
        }
      }

      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        const remainingMinutes = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
        return res.status(423).json({ message: "החשבון נעול עקב ניסיונות כושלים", lockedUntil: user.lockedUntil, remainingMinutes });
      }

      if (user.role === "admin") {
        await ensureAdminDeskPlan(user.id);
      }

      req.session.userId = user.id;
      await logSecurityEvent(isNew ? "register_success" : "login_success", "info", user.id, clientIp, { email, method: "google" });
      res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl, onboardingCompleted: user.onboardingCompleted, isDemo: user.isDemo });
    } catch (err: any) {
      res.status(500).json({ message: "שגיאה בהתחברות עם גוגל" });
    }
  });

  app.post("/api/v1/auth/2fa/login-verify", async (req, res) => {
    try {
      const { code, tempToken } = req.body;
      if (!code || !tempToken) return res.status(400).json({ message: "Missing code or token" });

      const pendingUserId = (req.session as any).pending2faUserId;
      const pendingToken = (req.session as any).pending2faToken;
      const issuedAt = (req.session as any).pending2faIssuedAt || 0;
      const attempts = (req.session as any).pending2faAttempts || 0;

      if (!pendingUserId || pendingToken !== tempToken) {
        return res.status(401).json({ message: "Invalid or expired 2FA session" });
      }

      if (Date.now() - issuedAt > 5 * 60 * 1000) {
        delete (req.session as any).pending2faUserId;
        delete (req.session as any).pending2faToken;
        delete (req.session as any).pending2faIssuedAt;
        delete (req.session as any).pending2faAttempts;
        return res.status(401).json({ message: "2FA session expired. Please log in again." });
      }

      if (attempts >= 5) {
        delete (req.session as any).pending2faUserId;
        delete (req.session as any).pending2faToken;
        delete (req.session as any).pending2faIssuedAt;
        delete (req.session as any).pending2faAttempts;
        return res.status(429).json({ message: "Too many attempts. Please log in again." });
      }

      const user = await storage.getUserById(pendingUserId);
      if (!user || !user.totpSecret) return res.status(401).json({ message: "Invalid session" });

      const secret = decrypt(user.totpSecret);
      const isValid = await totpLib.check(code, secret);

      if (!isValid) {
        // Backup codes are stored as bcrypt hashes. Compare constant-time via bcrypt;
        // on match, consume (remove) that hash so each backup code is single-use.
        let backupMatched = false;
        if (user.totpBackupCodes) {
          const hashes: string[] = JSON.parse(decrypt(user.totpBackupCodes));
          for (let i = 0; i < hashes.length; i++) {
            if (await bcrypt.compare(code, hashes[i])) {
              hashes.splice(i, 1);
              await storage.updateUserTotp(user.id, user.totpSecret, true, encrypt(JSON.stringify(hashes)));
              backupMatched = true;
              break;
            }
          }
        }
        if (!backupMatched) {
          (req.session as any).pending2faAttempts = attempts + 1;
          return res.status(401).json({ message: "Invalid 2FA code" });
        }
      }

      delete (req.session as any).pending2faUserId;
      delete (req.session as any).pending2faToken;
      delete (req.session as any).pending2faIssuedAt;
      delete (req.session as any).pending2faAttempts;

      if (user.role === "admin") {
        await ensureAdminDeskPlan(user.id);
      }

      req.session.userId = user.id;
      res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl, onboardingCompleted: user.onboardingCompleted, isDemo: user.isDemo });
    } catch (err: any) {
      res.status(500).json({ message: "Error verifying 2FA code" });
    }
  });

  app.post("/api/v1/auth/2fa/setup", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
      const user = await storage.getUserById(req.session.userId);
      if (!user) return res.status(401).json({ message: "User not found" });
      if (user.totpEnabled) return res.status(400).json({ message: "2FA is already enabled" });

      const secret = await totpLib.generateSecret();
      const otpauth = await totpLib.keyuri(user.email, "Vertex Command", secret);
      const qrCodeDataUrl = await (await getQRCode()).toDataURL(otpauth);

      await storage.updateUserTotp(user.id, encrypt(secret), false, null);

      res.json({ secret, qrCode: qrCodeDataUrl, otpauth });
    } catch (err: any) {
      console.error("2FA setup error:", err);
      res.status(500).json({ message: "Error setting up 2FA" });
    }
  });

  app.post("/api/v1/auth/2fa/verify", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Code is required" });

      const user = await storage.getUserById(req.session.userId);
      if (!user || !user.totpSecret) return res.status(400).json({ message: "2FA setup not initiated" });
      if (user.totpEnabled) return res.status(400).json({ message: "2FA is already enabled" });

      const secret = decrypt(user.totpSecret);
      const isValid = await totpLib.check(code, secret);
      if (!isValid) return res.status(400).json({ message: "Invalid code. Please try again." });

      const backupCodes: string[] = [];
      for (let i = 0; i < 8; i++) {
        backupCodes.push(crypto.randomBytes(4).toString("hex"));
      }

      // SECURITY: store only bcrypt hashes (never the plaintext codes). The plaintext
      // is returned to the user once here and cannot be recovered from the DB afterward.
      const hashedCodes = await Promise.all(backupCodes.map(c => bcrypt.hash(c, 12)));
      await storage.updateUserTotp(user.id, user.totpSecret, true, encrypt(JSON.stringify(hashedCodes)));

      res.json({ success: true, backupCodes });
    } catch (err: any) {
      res.status(500).json({ message: "Error verifying 2FA" });
    }
  });

  app.post("/api/v1/auth/2fa/disable", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Code is required" });

      const user = await storage.getUserById(req.session.userId);
      if (!user || !user.totpEnabled || !user.totpSecret) return res.status(400).json({ message: "2FA is not enabled" });

      const secret = decrypt(user.totpSecret);
      const isValid = await totpLib.check(code, secret);
      if (!isValid) return res.status(400).json({ message: "Invalid code" });

      await storage.updateUserTotp(user.id, null, false, null);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Error disabling 2FA" });
    }
  });

  app.get("/api/v1/auth/2fa/status", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
      const user = await storage.getUserById(req.session.userId);
      if (!user) return res.status(401).json({ message: "User not found" });
      res.json({ enabled: user.totpEnabled });
    } catch (err: any) {
      res.status(500).json({ message: "Error checking 2FA status" });
    }
  });

  app.post("/api/v1/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ message: "שגיאה בהתנתקות" });
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/v1/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUserById(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl, onboardingCompleted: user.onboardingCompleted, isDemo: user.isDemo, totpEnabled: user.totpEnabled });
  });

  app.post("/api/v1/auth/forgot-password", async (req, res) => {
    try {
      const turnstileToken = req.body.turnstileToken as string | undefined;
      if (process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY && process.env.CLOUDFLARE_TURNSTILE_SITE_KEY) {
        if (!turnstileToken) return res.status(403).json({ message: "נדרש אימות אנושי" });
        const valid = await verifyTurnstileToken(turnstileToken, getClientIp(req));
        if (!valid) return res.status(403).json({ message: "אימות אנושי נכשל. נסה שוב." });
      }
      const parsed = emailSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "חסרה כתובת אימייל", errors: parsed.error.flatten() });
      const { email } = parsed.data;
      const user = await storage.getUserByEmail(email);
      if (!user) return res.json({ message: "אם האימייל קיים במערכת, נשלח אליו קישור לאיפוס סיסמה" });
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await storage.updateUserResetToken(user.id, token, expiresAt);
      await logSecurityEvent("password_reset_requested", "info", user.id, getClientIp(req), { email });
      try {
        await sendPasswordResetEmail(user.email, user.name, token);
      } catch (emailErr) {
        console.error("Failed to send reset email:", emailErr);
      }
      res.json({ message: "אם האימייל קיים במערכת, נשלח אליו קישור לאיפוס סיסמה" });
    } catch (err) {
      res.status(500).json({ message: "שגיאה בשליחת בקשת איפוס" });
    }
  });

  app.post("/api/v1/auth/reset-password", async (req, res) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "חסרים פרטים", errors: parsed.error.flatten() });
      const { token, password } = parsed.data;
      const user = await storage.getUserByResetToken(token);
      if (!user) return res.status(400).json({ message: "קישור לא תקין או שפג תוקפו" });
      if (user.resetTokenExpiresAt && new Date(user.resetTokenExpiresAt) < new Date()) {
        return res.status(400).json({ message: "קישור איפוס פג תוקף" });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await storage.updateUserPassword(user.id, passwordHash);
      await storage.updateUserResetToken(user.id, null, null);
      await storage.unlockAccount(user.id);
      await logSecurityEvent("password_reset_completed", "info", user.id, getClientIp(req), { email: user.email });
      res.json({ message: "הסיסמה עודכנה בהצלחה" });
    } catch (err) {
      res.status(500).json({ message: "שגיאה באיפוס הסיסמה" });
    }
  });

  // All routes below require auth
  app.use("/api/v1", (req, res, next) => {
    if (req.path.startsWith("/auth/")) return next();
    if (req.path.startsWith("/billing/webhook")) return next();
    if (req.path.startsWith("/public/")) return next();
    if (req.path.startsWith("/market/")) return next();
    if (req.path === "/signals" && req.method === "POST") return next();
    requireAuth(req, res, next);
  });

  // Demo user middleware — blocks all write operations for demo (read-only) users
  app.use("/api/v1", async (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (req.path === "/auth/login" || req.path === "/auth/logout") return next();
    if (!req.session.userId) return next();

    try {
      const user = await storage.getUserById(req.session.userId);
      if (user?.isDemo) {
        return res.status(403).json({ message: "demo_readonly", error: "חשבון דמו — מצב צפייה בלבד. לא ניתן לבצע שינויים." });
      }
      next();
    } catch {
      next();
    }
  });

  // Trial expiry middleware — blocks access when trial ended and no active subscription
  app.use("/api/v1", async (req, res, next) => {
    if (req.path.startsWith("/auth/")) return next();
    if (req.path.startsWith("/billing/")) return next();
    if (req.path.startsWith("/admin/")) return next();
    if (req.path.startsWith("/public/")) return next();
    if (!req.session.userId) return next();

    try {
      const user = await storage.getUserById(req.session.userId);
      if (user?.role === "admin") return next();

      const sub = await storage.getSubscription(req.session.userId);
      if (!sub) return res.status(402).json({ message: "trial_expired" });
      if (sub.status === "active") return next();
      if (sub.status === "trialing" && sub.trialEndsAt) {
        if (new Date(sub.trialEndsAt) > new Date()) return next();
        return res.status(402).json({ message: "trial_expired", trialEndsAt: sub.trialEndsAt });
      }
      if (sub.status === "past_due" || sub.status === "expired") {
        return res.status(402).json({ message: "trial_expired" });
      }
      next();
    } catch {
      next();
    }
  });

  registerIntegrationRoutes(app);
  registerBillingRoutes(app);
  registerAdminRoutes(app);
  registerHelpRoutes(app);
  registerCopyTradingRoutes(app);
  registerJournalRoutes(app);
  registerMonitorRoutes(app);
  registerTradingRoutes(app);
  registerSignalRoutes(app);
  registerLatencyRoutes(app);
  registerAffiliateRoutes(app);
  registerSystemHealthStreamRoutes(app);
  registerPlaybookRoutes(app);

  startCopyEngine();
  startDataPipelineAutoConnect();

  import("./reconciliation-daemon").then(({ runSyncRecovery }) => {
    setTimeout(() => {
      console.log("[Boot] Triggering post-startup sync recovery...");
      runSyncRecovery().catch(err => console.error("[Boot] Sync recovery failed:", err.message));
    }, 10_000);
  });

  // ─── Trailing Drawdown Evaluator ────────────────────
  app.post("/api/v1/drawdown-evaluator", requireAuth, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        accounts: z.array(z.object({
          accountId: z.string(),
          startingBalance: z.number().positive(),
          maxDrawdownLimit: z.number().positive(),
          equityData: z.array(z.object({
            timestamp: z.string(),
            equity: z.number(),
          })).min(1),
        })),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }
      const result = evaluateAccountsBatch(parsed.data.accounts);
      res.json(result);
    } catch (err: any) {
      console.error("[Drawdown] Evaluation error:", err.message);
      res.status(500).json({ error: "Evaluation failed" });
    }
  });

  // ─── Equity Ticks & Auto Drawdown ────────────────────
  app.get("/api/v1/equity-ticks/:accountId", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.accountId);
      if (isNaN(accountId)) return res.status(400).json({ error: "Invalid account ID" });

      const account = await storage.getAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (!await isLinkedUser(req.session.userId!, account.userId!)) return res.status(403).json({ error: "Access denied" });

      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

      const ticks = await storage.getEquityTicks(accountId, from, to, limit);
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('ETag', `"ticks-${accountId}-${ticks.length}-${Date.now()}"`);
      res.json(ticks);
    } catch (err: any) {
      console.error("[EquityTicks] Fetch error:", err.message);
      res.status(500).json({ error: "Failed to fetch equity ticks" });
    }
  });

  app.get("/api/v1/drawdown/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const statuses = await getDrawdownStatusForAccounts(userId);
      res.json(statuses);
    } catch (err: any) {
      console.error("[Drawdown] Status fetch error:", err.message);
      res.status(500).json({ error: "Failed to fetch drawdown status" });
    }
  });

  app.post("/api/v1/equity-ticks/record", requireAuth, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        accountId: z.number(),
        equity: z.number(),
        timestamp: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

      const account = await storage.getAccount(parsed.data.accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (!await isLinkedUser(req.session.userId!, account.userId!)) return res.status(403).json({ error: "Access denied" });

      const ts = parsed.data.timestamp ? new Date(parsed.data.timestamp) : undefined;
      const result = await processEquityTick(parsed.data.accountId, parsed.data.equity, ts);
      res.json(result);
    } catch (err: any) {
      console.error("[EquityTicks] Record error:", err.message);
      res.status(500).json({ error: "Failed to record equity tick" });
    }
  });

  startEquityTickCleanup();
  backfillAllAccounts();

  // ─── Public Investor Metrics ────────────────────────
  app.get("/api/v1/public/metrics", async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const totalUsers = allUsers.length;

      let totalMRR = 0;
      let activeSubscriptions = 0;

      for (const user of allUsers) {
        const sub = await storage.getSubscription(user.id);
        if (sub && sub.status === "active") {
          activeSubscriptions++;
          totalMRR += sub.billingCycle === "yearly" ? (sub.amount || 0) / 12 : (sub.amount || 0);
        }
      }

      res.json({
        totalUsers,
        activeSubscriptions,
        totalMRR: Math.round(totalMRR * 100) / 100,
      });
    } catch (err) {
      console.error("Failed to fetch public metrics:", err);
      res.status(500).json({ error: "Failed to fetch metrics" });
    }
  });

  // ─── Firms (global) ─────────────────────────────────
  app.get("/api/v1/firms", async (_req, res) => {
    const list = await storage.getFirms();
    const allTiers = await storage.getFirmTiers();
    const firmsWithTiers = list.map(f => ({
      ...f,
      tiers: allTiers.filter(t => t.firmId === f.id),
    }));
    res.json(firmsWithTiers);
  });

  app.post("/api/v1/firms", async (req, res) => {
    const user = await storage.getUserById(req.session.userId!);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "גישת מנהל נדרשת" });
    }
    try {
      const parsed = insertFirmSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
      const firm = await storage.createFirm(parsed.data);
      res.status(201).json({ ...firm, tiers: [] });
    } catch (err: any) {
      if (err?.code === '23505') return res.status(409).json({ message: "חברה עם שם זה כבר קיימת" });
      res.status(500).json({ message: "שגיאה ביצירת חברה" });
    }
  });

  app.patch("/api/v1/firms/:id", async (req, res) => {
    const user = await storage.getUserById(req.session.userId!);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "גישת מנהל נדרשת" });
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const partial = insertFirmSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: "Invalid data", errors: partial.error.flatten() });
    const updated = await storage.updateFirm(id, partial.data);
    if (!updated) return res.status(404).json({ message: "Firm not found" });
    const tiers = await storage.getFirmTiersByFirmId(id);
    res.json({ ...updated, tiers });
  });

  app.delete("/api/v1/firms/:id", async (req, res) => {
    const user = await storage.getUserById(req.session.userId!);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "גישת מנהל נדרשת" });
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const deleted = await storage.deleteFirm(id);
    if (!deleted) return res.status(404).json({ message: "Firm not found" });
    res.status(204).send();
  });

  // ─── Firm Tiers ─────────────────────────────────────
  app.get("/api/v1/firms/:firmId/tiers", async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    if (isNaN(firmId)) return res.status(400).json({ message: "Invalid ID" });
    const tiers = await storage.getFirmTiersByFirmId(firmId);
    res.json(tiers);
  });

  app.post("/api/v1/firm-tiers", async (req, res) => {
    const user = await storage.getUserById(req.session.userId!);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "גישת מנהל נדרשת" });
    }
    const parsed = insertFirmTierSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    const tier = await storage.createFirmTier(parsed.data);
    res.status(201).json(tier);
  });

  app.patch("/api/v1/firm-tiers/:id", async (req, res) => {
    const user = await storage.getUserById(req.session.userId!);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "גישת מנהל נדרשת" });
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const partial = insertFirmTierSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: "Invalid data", errors: partial.error.flatten() });
    const updated = await storage.updateFirmTier(id, partial.data);
    if (!updated) return res.status(404).json({ message: "Tier not found" });
    res.json(updated);
  });

  app.delete("/api/v1/firm-tiers/:id", async (req, res) => {
    const user = await storage.getUserById(req.session.userId!);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "גישת מנהל נדרשת" });
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const deleted = await storage.deleteFirmTier(id);
    if (!deleted) return res.status(404).json({ message: "Tier not found" });
    res.status(204).send();
  });

  app.get("/api/v1/community-stats", requireAuth, async (req, res) => {
    try {
      const allAccounts = await storage.getAllAccounts();
      const uniqueAccountIds = new Set(allAccounts.map(a => a.accountId));
      res.json({ totalConnections: uniqueAccountIds.size });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch community stats" });
    }
  });

  // ─── Accounts ──────────────────────────────────────
  app.get("/api/v1/accounts", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const accs = await storage.getAccounts(userId);
    const firmsList = await storage.getFirms();
    const allTiers = await storage.getFirmTiers();
    const firmsMap = Object.fromEntries(firmsList.map(f => [f.name, f]));

    const integrationAccounts = accs.filter(a => a.dataSource === 'integration');
    const tradeCountMap = new Map<number, number>();
    for (const intAcc of integrationAccounts) {
      const trades = await storage.getTradesByAccount(intAcc.id);
      tradeCountMap.set(intAcc.id, trades.length);
    }

    const statusUpdates: Promise<void>[] = [];
    const enriched = accs.map(acc => {
      const firm = firmsMap[acc.firm];
      const firmTiersList = firm ? allTiers.filter(t => t.firmId === firm.id) : [];
      const rules = resolveRules(acc, firm, firmTiersList);
      const accWithTradeCount: any = { ...acc };
      if (acc.dataSource === 'integration') {
        accWithTradeCount._tradeCount = tradeCountMap.get(acc.id) || 0;
      }
      const computedStatus = computeAccountStatus(accWithTradeCount, rules);
      const ddInfo = computeDrawdownInfo(acc, rules);
      if (computedStatus === 'violated' && acc.status !== 'violated') {
        statusUpdates.push(
          storage.updateAccount(acc.id, { status: 'violated' })
            .then(() => { console.log(`[Status] Account ${acc.id} (${acc.name}) marked as violated`); })
            .catch((err) => { console.error(`[Status] Failed to mark account ${acc.id} as violated:`, err.message); })
        );
      } else if (computedStatus === 'passed' && acc.status !== 'passed') {
        statusUpdates.push(
          storage.updateAccount(acc.id, { status: 'passed' })
            .then(() => { console.log(`[Status] Account ${acc.id} (${acc.name}) marked as passed`); })
            .catch((err) => { console.error(`[Status] Failed to mark account ${acc.id} as passed:`, err.message); })
        );
      }
      return { ...acc, computedStatus, drawdownInfo: ddInfo };
    });
    if (statusUpdates.length > 0) {
      await Promise.all(statusUpdates);
    }
    res.json(enriched);
  });

  app.get("/api/v1/accounts/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.userId!;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const account = await storage.getAccount(id);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (!await isLinkedUser(userId, account.userId!)) return res.status(403).json({ message: "Access denied" });

    const firm = await storage.getFirmByName(account.firm);
    const firmTiersList = firm ? await storage.getFirmTiersByFirmId(firm.id) : [];
    const rules = resolveRules(account, firm, firmTiersList);
    const accountTrades = await storage.getTradesByAccount(id);

    const computedStatus = computeAccountStatusFromTrades(account, rules, accountTrades);
    const ddInfo = computeDrawdownInfo(account, rules);

    // Rich analytics — powered by prop-calculator.ts engine. Always computed;
    // returns no_profit / zero stats for accounts with no imported trades.
    const consistency = computeConsistencyFromTrades(account, rules, accountTrades);
    const tradeStats = computeAccountTradeStats(accountTrades);

    const [history, accountAlerts, accountWithdrawals] = await Promise.all([
      storage.getBalanceHistory(id),
      storage.getAlertsByAccount(id),
      storage.getWithdrawalsByAccount(id),
    ]);

    res.json({
      ...account,
      computedStatus,
      drawdownInfo: ddInfo,
      consistency,
      tradeStats,
      firmRules: rules || null,
      history,
      alerts: accountAlerts,
      withdrawals: accountWithdrawals,
      trades: accountTrades,
    });
  });

  app.post("/api/v1/accounts", requireAuth, async (req, res) => {
    const userId = req.session.userId!;

    const user = await storage.getUserById(userId);
    if (user?.role !== "admin") {
      const limitCheck = await checkAccountLimit(userId);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          code: "plan_limit",
          feature: "max_accounts",
          requiredPlan: limitCheck.requiredPlan || "pro",
          message: `Account limit reached (${limitCheck.currentCount}/${limitCheck.maxAccounts})`,
          maxAccounts: limitCheck.maxAccounts,
          currentCount: limitCheck.currentCount,
        });
      }
    }

    if (req.body.firm) {
      const existingFirm = await storage.getFirmByName(req.body.firm);
      if (!existingFirm) {
        await storage.createFirm({ name: req.body.firm });
      }
    }
    const data = { ...req.body, userId, peakBalance: req.body.balance };
    const parsed = insertAccountSchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    const account = await storage.createAccount(parsed.data);
    await storage.createAuditEntry({ action: "create", entityType: "account", entityId: account.id, userId, metadata: parsed.data });
    res.status(201).json(account);
  });

  app.patch("/api/v1/accounts/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.userId!;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const oldAccount = await storage.getAccount(id);
    if (!oldAccount) return res.status(404).json({ message: "Account not found" });
    if (!await isLinkedUser(userId, oldAccount.userId!)) return res.status(403).json({ message: "Access denied" });

    const syncedProtectedFields = [
      "balance", "peakBalance", "size", "maxDrawdown", "trailingDrawdown",
      "externalAccountId", "integrationConnectionId", "dataSource",
    ];
    if (oldAccount.dataSource === "integration") {
      const attempted = syncedProtectedFields.filter(f => req.body[f] !== undefined);
      if (attempted.length > 0) {
        return res.status(400).json({
          message: "חשבון מסונכרן - לא ניתן לערוך שדות אלו ידנית. הנתונים מתעדכנים אוטומטית מהפלטפורמה.",
          protectedFields: attempted,
        });
      }
    }

    if (req.body.firm) {
      const existingFirm = await storage.getFirmByName(req.body.firm);
      if (!existingFirm) {
        await storage.createFirm({ name: req.body.firm });
      }
    }

    const partial = insertAccountSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: "Invalid data", errors: partial.error.flatten() });

    const updateData: any = { ...partial.data };
    if (updateData.balance !== undefined) {
      const drawdownType = oldAccount.drawdownType || 'static';
      const trailingStopType = oldAccount.trailingStopType || 'intraday';

      if (drawdownType === 'trailing' && trailingStopType === 'eod') {
        const today = new Date().toISOString().slice(0, 10);
        const lastPeakDate = oldAccount.lastPeakUpdateDate || '';
        const isNewTradingDay = today !== lastPeakDate;
        if (isNewTradingDay) {
          const currentPeak = oldAccount.peakBalance || oldAccount.size;
          const previousDayClose = oldAccount.balance;
          const newPeak = Math.max(currentPeak, previousDayClose);
          updateData.peakBalance = newPeak;
          updateData.lastPeakUpdateDate = today;
        }
      } else {
        const newPeak = Math.max(oldAccount.peakBalance || oldAccount.size, updateData.balance);
        updateData.peakBalance = newPeak;
      }

      if (updateData.balance !== oldAccount.balance && updateData.tradingDays === undefined) {
        updateData.tradingDays = (oldAccount.tradingDays || 0) + 1;
        const dayProfit = updateData.balance - oldAccount.balance;
        if (dayProfit > 0 && dayProfit > (oldAccount.topDayProfit || 0)) {
          updateData.topDayProfit = dayProfit;
        }
      }
    }

    const updated = await storage.updateAccount(id, updateData);
    if (!updated) return res.status(404).json({ message: "Account not found" });

    if (oldAccount && oldAccount.balance !== updated.balance) {
      const profit = updated.balance - updated.size;
      const useBuffer = updated.bufferEnabled !== false;
      const bufferMax = useBuffer ? (updated.maxDrawdown || 0) : 0;
      const currentBuffer = Math.min(Math.max(profit, 0), bufferMax);
      const targetProgress = updated.target ? Math.max(0, profit - bufferMax) / updated.target * 100 : 0;
      await storage.createBalanceSnapshot({
        accountId: id,
        date: new Date().toISOString().split('T')[0],
        balance: updated.balance,
        profit,
        buffer: currentBuffer,
        targetProgress: Math.min(targetProgress, 100),
        userId,
      });
    }

    await storage.createAuditEntry({ action: "update", entityType: "account", entityId: id, userId, metadata: { old: oldAccount, new: partial.data } });
    res.json(updated);
  });

  app.delete("/api/v1/accounts/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.userId!;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const account = await storage.getAccount(id);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (!await isLinkedUser(userId, account.userId!)) return res.status(403).json({ message: "Access denied" });

    if (account.integrationConnectionId && account.externalAccountId) {
      try {
        const extId = account.externalAccountId;
        await db.execute(sql`
          UPDATE integration_connections
          SET settings = jsonb_set(
            COALESCE(settings, '{}'::jsonb),
            '{excludedExternalIds}',
            (
              SELECT COALESCE(jsonb_agg(DISTINCT val), '[]'::jsonb)
              FROM jsonb_array_elements(
                COALESCE(settings->'excludedExternalIds', '[]'::jsonb) || ${JSON.stringify([extId])}::jsonb
              ) AS val
            )
          )
          WHERE id = ${account.integrationConnectionId}
        `);
        console.log(`[Accounts] Added ${extId} to excludedExternalIds for connection ${account.integrationConnectionId}`);
      } catch (err: any) {
        console.warn(`[Accounts] Failed to save exclusion for ${account.externalAccountId}:`, err.message);
      }
    }

    await storage.createAuditEntry({ action: "delete", entityType: "account", entityId: id, userId });
    const deleted = await storage.deleteAccount(id);
    if (!deleted) return res.status(404).json({ message: "Account not found" });
    if (account.integrationConnectionId) {
      onAccountRemoved(account.integrationConnectionId).catch(err => console.warn(`[DataPipeline] onAccountRemoved failed:`, err.message));
    }
    res.status(204).send();
  });

  // ─── Withdrawals ───────────────────────────────────
  app.get("/api/v1/withdrawals", async (req, res) => {
    const userId = req.session.userId!;
    const list = await storage.getWithdrawals(userId);
    res.json(list);
  });

  app.post("/api/v1/withdrawals", async (req, res) => {
    const userId = req.session.userId!;
    const data = { ...req.body, userId };
    const parsed = insertWithdrawalSchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    const withdrawal = await storage.createWithdrawal(parsed.data);
    await storage.createAuditEntry({ action: "create", entityType: "withdrawal", entityId: withdrawal.id, userId, metadata: parsed.data });
    res.status(201).json(withdrawal);
  });

  app.patch("/api/v1/withdrawals/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.userId!;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const existing = await storage.getWithdrawals(userId);
    if (!existing.find(w => w.id === id)) return res.status(404).json({ message: "Withdrawal not found" });
    const partial = insertWithdrawalSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: "Invalid data", errors: partial.error.flatten() });
    const updated = await storage.updateWithdrawal(id, partial.data);
    if (!updated) return res.status(404).json({ message: "Withdrawal not found" });
    await storage.createAuditEntry({ action: "update", entityType: "withdrawal", entityId: id, userId, metadata: partial.data });
    res.json(updated);
  });

  app.delete("/api/v1/withdrawals/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.userId!;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const existing = await storage.getWithdrawals(userId);
    if (!existing.find(w => w.id === id)) return res.status(404).json({ message: "Withdrawal not found" });
    const deleted = await storage.deleteWithdrawal(id);
    if (!deleted) return res.status(404).json({ message: "Withdrawal not found" });
    res.status(204).send();
  });

  // ─── Balance History ───────────────────────────────
  app.get("/api/v1/balance-history/:accountId", async (req, res) => {
    const accountId = parseInt(req.params.accountId);
    const userId = req.session.userId!;
    if (isNaN(accountId)) return res.status(400).json({ message: "Invalid ID" });
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (!await isLinkedUser(userId, account.userId!)) return res.status(403).json({ message: "Access denied" });
    const history = await storage.getBalanceHistory(accountId);
    res.json(history);
  });

  app.post("/api/v1/balance-history", async (req, res) => {
    const userId = req.session.userId!;
    const data = { ...req.body, userId };
    const parsed = insertBalanceHistorySchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    const snapshot = await storage.createBalanceSnapshot(parsed.data);
    res.status(201).json(snapshot);
  });

  // ─── Alerts ────────────────────────────────────────
  app.get("/api/v1/alerts", async (req, res) => {
    const userId = req.session.userId!;
    const list = await storage.getAlerts(userId);
    res.json(list);
  });

  app.get("/api/v1/alerts/unread", async (req, res) => {
    const userId = req.session.userId!;
    const list = await storage.getUnreadAlerts(userId);
    res.json(list);
  });

  app.post("/api/v1/alerts", async (req, res) => {
    const userId = req.session.userId!;
    const data = { ...req.body, userId };
    const parsed = insertAlertSchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    const alert = await storage.createAlert(parsed.data);
    res.status(201).json(alert);
  });

  app.patch("/api/v1/alerts/:id/read", async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.userId!;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const userAlerts = await storage.getAlerts(userId);
    if (!userAlerts.find(a => a.id === id)) return res.status(404).json({ message: "Alert not found" });
    const updated = await storage.markAlertRead(id);
    if (!updated) return res.status(404).json({ message: "Alert not found" });
    res.json(updated);
  });

  app.post("/api/v1/alerts/read-all", async (req, res) => {
    const userId = req.session.userId!;
    await storage.markAllAlertsRead(userId);
    res.json({ success: true });
  });

  app.delete("/api/v1/alerts/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.userId!;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const userAlerts = await storage.getAlerts(userId);
    if (!userAlerts.find(a => a.id === id)) return res.status(404).json({ message: "Alert not found" });
    const deleted = await storage.deleteAlert(id);
    if (!deleted) return res.status(404).json({ message: "Alert not found" });
    res.status(204).send();
  });

  app.post("/api/v1/alerts/delete-bulk", async (req, res) => {
    const userId = req.session.userId!;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids must be a non-empty array" });
    const numericIds = ids.map(Number).filter(n => !isNaN(n));
    if (numericIds.length === 0) return res.status(400).json({ message: "No valid IDs" });
    const userAlerts = await storage.getAlerts(userId);
    const userAlertIds = new Set(userAlerts.map(a => a.id));
    const ownedIds = numericIds.filter(id => userAlertIds.has(id));
    if (ownedIds.length === 0) return res.status(404).json({ message: "No matching alerts" });
    const count = await storage.deleteAlerts(ownedIds);
    res.json({ deleted: count });
  });

  // ─── Trading Priorities ──────────────────────────────
  app.get("/api/v1/trading-priorities", requirePlanFeature("priority_engine"), async (req, res) => {
    const userId = req.session.userId!;
    const accs = await storage.getAccounts(userId);
    const firmsList = await storage.getFirms();
    const allTiers = await storage.getFirmTiers();
    const firmsMap = Object.fromEntries(firmsList.map(f => [f.name, f]));

    const priorities = accs
      .filter(acc => acc.stage !== 'inactive' && acc.status !== 'violated')
      .map(acc => {
        const firm = firmsMap[acc.firm];
        const firmTiersList = firm ? allTiers.filter(t => t.firmId === firm.id) : [];
        const rules = resolveRules(acc, firm, firmTiersList);
        const profit = acc.balance - acc.size;
        const target = acc.target || 0;
        const consistencyRule = acc.consistencyRule || rules?.consistencyPercentage || 0;
        const topDayProfit = acc.topDayProfit || 0;

        const ddInfo = computeDrawdownInfo(acc, rules);
        const bufferAdj = acc.bufferEnabled !== false ? Math.max(0, profit - (ddInfo.trailingAmount || 0)) : profit;
        const distanceToTarget = target > 0 ? Math.max(0, target - bufferAdj) : 0;
        const consistencyRisk = profit > 0 && consistencyRule > 0 ? (topDayProfit / profit) * 100 : 0;

        const { score, recommendation, drawdownRisk } = computeTradingPriority(acc, rules);

        return {
          id: acc.id,
          accountId: acc.accountId,
          name: acc.name,
          firm: acc.firm,
          tier: acc.tier,
          stage: acc.stage,
          profit,
          distanceToTarget,
          consistencyRisk: Math.round(consistencyRisk * 10) / 10,
          drawdownRisk: Math.round(drawdownRisk * 10) / 10,
          score,
          recommendation,
        };
      })
      .sort((a, b) => b.score - a.score);

    res.json(priorities);
  });

  // ─── Monthly Reports ──────────────────────────────
  app.get("/api/v1/monthly-reports", requirePlanFeature("exports"), async (req, res) => {
    const userId = req.session.userId!;
    const existingReports = await storage.getMonthlyReports(userId);
    
    const trades = await storage.getTradesByUser(userId);
    if (trades.length > 0) {
      const monthlyMap = new Map<string, { profit: number; trades: number }>();
      for (const t of trades) {
        const date = t.closedAt || t.openedAt || t.importedAt;
        if (!date) continue;
        const d = new Date(date);
        if (isNaN(d.getTime())) continue;
        const month = d.toISOString().substring(0, 7);
        const entry = monthlyMap.get(month) || { profit: 0, trades: 0 };
        entry.profit += (t.realizedPnl || 0);
        entry.trades++;
        monthlyMap.set(month, entry);
      }
      
      const existingMonths = new Set(existingReports.map(r => r.month));
      for (const [month, data] of monthlyMap.entries()) {
        if (!existingMonths.has(month)) {
          await storage.createMonthlyReport({
            month,
            totalProfit: Math.round(data.profit * 100) / 100,
            totalWithdrawals: 0,
            accountsActive: 0,
            accountsPassedStage: 0,
            accountsFailed: 0,
            bestAccount: null,
            worstAccount: null,
            metadataJson: null,
            userId,
          });
        }
      }
      
      const updatedReports = await storage.getMonthlyReports(userId);
      return res.json(updatedReports);
    }
    
    res.json(existingReports);
  });

  // ─── Account Equity Curve (per account) ──────────────────────────────
  app.get("/api/v1/trades/monthly-pnl", async (req, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    
    const userAccounts = await storage.getAccounts(userId);
    if (userAccounts.length === 0) return res.json([]);

    const trades = await storage.getTradesByUser(userId);
    const now = new Date();
    const today = now.toISOString().substring(0, 10);

    const result = userAccounts.map(acc => {
      const startSize = acc.size || 0;
      const startDate = acc.createdAt ? new Date(acc.createdAt).toISOString().substring(0, 10) : today;
      const accountTrades = trades.filter(t => t.accountId === acc.id);

      const points: { day: string; balance: number }[] = [];
      points.push({ day: startDate, balance: startSize });

      if (accountTrades.length > 0) {
        const dailyPnl = new Map<string, number>();
        for (const t of accountTrades) {
          const date = t.closedAt || t.openedAt || t.importedAt;
          if (!date) continue;
          const d = new Date(date);
          if (isNaN(d.getTime())) continue;
          const day = d.toISOString().substring(0, 10);
          dailyPnl.set(day, (dailyPnl.get(day) || 0) + (t.realizedPnl || 0));
        }
        const sortedDays = Array.from(dailyPnl.entries()).sort(([a], [b]) => a.localeCompare(b));
        let runningBalance = startSize;
        for (const [day, pnl] of sortedDays) {
          runningBalance += pnl;
          points.push({ day, balance: Math.round(runningBalance * 100) / 100 });
        }
      }

      const lastPoint = points[points.length - 1];
      const currentBalance = acc.balance || 0;
      if (lastPoint.day !== today || Math.abs(lastPoint.balance - currentBalance) > 0.01) {
        points.push({ day: today, balance: Math.round(currentBalance * 100) / 100 });
      }

      return {
        accountId: acc.id,
        accountName: acc.name || acc.accountId,
        startSize,
        currentBalance: Math.round(currentBalance * 100) / 100,
        data: points,
      };
    });
    
    res.json(result);
  });

  app.get("/api/v1/equity-curve", async (req, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const userAccounts = await storage.getAccounts(userId);
    if (userAccounts.length === 0) return res.json([]);

    const result = await Promise.all(userAccounts.map(async (acc) => {
      const startSize = acc.size || 0;
      const currentBalance = acc.balance || 0;
      const target = acc.target || 0;
      const maxDrawdown = acc.maxDrawdown || 0;

      const trades = await db.select({
        realizedPnl: importedTrades.realizedPnl,
        closedAt: importedTrades.closedAt,
        openedAt: importedTrades.openedAt,
      }).from(importedTrades)
        .where(eq(importedTrades.accountId, acc.id!))
        .orderBy(asc(importedTrades.openedAt));

      const points: { timestamp: string; balance: number }[] = [];

      const startDate = acc.createdAt ? new Date(acc.createdAt).toISOString() : new Date().toISOString();
      points.push({ timestamp: startDate, balance: startSize });

      let runningBalance = startSize;
      for (const trade of trades) {
        const tradeTime = trade.closedAt || trade.openedAt;
        if (tradeTime && trade.realizedPnl != null) {
          runningBalance += trade.realizedPnl;
          points.push({
            timestamp: new Date(tradeTime).toISOString(),
            balance: Math.round(runningBalance * 100) / 100,
          });
        }
      }

      if (points.length > 0) {
        const lastPoint = points[points.length - 1];
        if (Math.abs(lastPoint.balance - currentBalance) > 0.01) {
          points.push({ timestamp: new Date().toISOString(), balance: Math.round(currentBalance * 100) / 100 });
        }
      }

      return {
        accountId: acc.id,
        accountName: acc.name || acc.accountId,
        startSize,
        currentBalance: Math.round(currentBalance * 100) / 100,
        target,
        maxDrawdown,
        data: points,
      };
    }));

    res.json(result);
  });

  app.get("/api/v1/trades/stats", async (req, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const trades = await storage.getTradesByUser(userId);
    if (trades.length === 0) {
      return res.json({ tradeWinRate: 0, profitFactor: 0, dayWinRate: 0, avgWin: 0, avgLoss: 0, totalTrades: 0, winTrades: 0, lossTrades: 0, totalDays: 0, winDays: 0 });
    }

    const winTrades = trades.filter(t => (t.realizedPnl || 0) > 0);
    const lossTrades = trades.filter(t => (t.realizedPnl || 0) < 0);
    const tradeWinRate = trades.length > 0 ? Math.round((winTrades.length / trades.length) * 1000) / 10 : 0;

    const grossProfit = winTrades.reduce((s, t) => s + (t.realizedPnl || 0), 0);
    const grossLoss = Math.abs(lossTrades.reduce((s, t) => s + (t.realizedPnl || 0), 0));
    const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 999 : 0;

    const dailyPnl = new Map<string, number>();
    for (const t of trades) {
      const date = t.closedAt || t.openedAt || t.importedAt;
      if (!date) continue;
      const d = new Date(date);
      if (isNaN(d.getTime())) continue;
      const day = d.toISOString().substring(0, 10);
      dailyPnl.set(day, (dailyPnl.get(day) || 0) + (t.realizedPnl || 0));
    }
    const totalDays = dailyPnl.size;
    const winDays = Array.from(dailyPnl.values()).filter(v => v > 0).length;
    const dayWinRate = totalDays > 0 ? Math.round((winDays / totalDays) * 1000) / 10 : 0;

    const avgWin = winTrades.length > 0 ? Math.round((grossProfit / winTrades.length) * 100) / 100 : 0;
    const avgLoss = lossTrades.length > 0 ? Math.round((grossLoss / lossTrades.length) * 100) / 100 : 0;

    res.json({
      tradeWinRate, profitFactor, dayWinRate,
      avgWin, avgLoss,
      totalTrades: trades.length, winTrades: winTrades.length, lossTrades: lossTrades.length,
      totalDays, winDays,
    });
  });

  app.get("/api/v1/trades/calendar", async (req, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const month = (req.query.month as string) || new Date().toISOString().substring(0, 7);
    const accountIdParam = req.query.accountId as string | undefined;

    const userAccounts = await storage.getAccounts(userId);
    if (userAccounts.length === 0) return res.json({ days: {}, weeklyTotals: {}, monthTotal: 0, monthTrades: 0 });

    const filteredAccounts = accountIdParam && accountIdParam !== "all"
      ? userAccounts.filter(a => a.id === parseInt(accountIdParam))
      : userAccounts;

    const allTrades = await storage.getTradesByUser(userId);
    const accountIds = new Set(filteredAccounts.map(a => a.id));
    const trades = allTrades.filter(t => accountIds.has(t.accountId));

    const days: Record<string, { pnl: number; trades: number }> = {};
    let monthTotal = 0;
    let monthTrades = 0;

    for (const t of trades) {
      const date = t.closedAt || t.openedAt || t.importedAt;
      if (!date) continue;
      const d = new Date(date);
      if (isNaN(d.getTime())) continue;
      const day = d.toISOString().substring(0, 10);
      if (!day.startsWith(month)) continue;

      if (!days[day]) days[day] = { pnl: 0, trades: 0 };
      days[day].pnl += t.realizedPnl || 0;
      days[day].trades += 1;
      monthTotal += t.realizedPnl || 0;
      monthTrades += 1;
    }

    Object.keys(days).forEach(day => {
      days[day].pnl = Math.round(days[day].pnl * 100) / 100;
    });

    const weeklyTotals: Record<number, { pnl: number; days: number }> = {};
    const firstDay = new Date(`${month}-01T00:00:00Z`);
    for (const [day, data] of Object.entries(days)) {
      const d = new Date(`${day}T00:00:00Z`);
      const dayOfMonth = d.getUTCDate();
      const startDow = firstDay.getUTCDay();
      const weekNum = Math.floor((dayOfMonth + startDow - 1) / 7) + 1;
      if (!weeklyTotals[weekNum]) weeklyTotals[weekNum] = { pnl: 0, days: 0 };
      weeklyTotals[weekNum].pnl += data.pnl;
      weeklyTotals[weekNum].days += 1;
    }
    Object.keys(weeklyTotals).forEach(w => {
      weeklyTotals[parseInt(w)].pnl = Math.round(weeklyTotals[parseInt(w)].pnl * 100) / 100;
    });

    const totalSize = filteredAccounts.reduce((s, a) => s + (a.size || 0), 0);

    res.json({
      days,
      weeklyTotals,
      monthTotal: Math.round(monthTotal * 100) / 100,
      monthTrades,
      totalSize,
    });
  });

  // ─── Economic Calendar (ForexFactory) ─────────────
  const ECON_CACHE_TTL = 60 * 60 * 1000;
  const ECON_CACHE_DIR = path.join(process.cwd(), ".cache");
  const econCalendarMemCache: Record<string, { data: any[]; fetchedAt: number }> = {};

  function getEconDiskCachePath(key: string) {
    return path.join(ECON_CACHE_DIR, `econ_${key}.json`);
  }

  function loadEconDiskCache(key: string): { data: any[]; fetchedAt: number } | null {
    try {
      const filePath = getEconDiskCachePath(key);
      if (fs.existsSync(filePath)) {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return raw;
      }
    } catch {}
    return null;
  }

  function saveEconDiskCache(key: string, data: any[], fetchedAt: number) {
    try {
      if (!fs.existsSync(ECON_CACHE_DIR)) fs.mkdirSync(ECON_CACHE_DIR, { recursive: true });
      fs.writeFileSync(getEconDiskCachePath(key), JSON.stringify({ data, fetchedAt }));
    } catch {}
  }

  async function fetchEconCalendarWithRetry(feedKey: string, retries = 3): Promise<any[]> {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
      try {
        const jsonResp = await fetch(`https://nfs.faireconomy.media/ff_calendar_${feedKey}.json`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.forexfactory.com/",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://www.forexfactory.com",
          },
          signal: AbortSignal.timeout(10000),
        });
        if (jsonResp.status === 429) {
          console.log(`[EconCalendar] Rate limited (attempt ${attempt + 1}/${retries}), retrying...`);
          continue;
        }
        if (!jsonResp.ok) throw new Error(`HTTP ${jsonResp.status}`);
        return await jsonResp.json();
      } catch (err: any) {
        if (attempt === retries - 1) throw err;
      }
    }
    throw new Error("All retries failed");
  }

  app.get("/api/v1/economic-calendar", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });

    const period = (req.query.period as string) || "thisweek";
    const validPeriods = ["thisweek", "nextweek"];
    const feedKey = validPeriods.includes(period) ? period : "thisweek";

    const now = Date.now();
    const memCached = econCalendarMemCache[feedKey];
    if (memCached && (now - memCached.fetchedAt) < ECON_CACHE_TTL) {
      return res.json(memCached.data);
    }

    const diskCached = loadEconDiskCache(feedKey);
    if (diskCached && (now - diskCached.fetchedAt) < ECON_CACHE_TTL) {
      econCalendarMemCache[feedKey] = diskCached;
      return res.json(diskCached.data);
    }

    try {
      const rawEvents: any[] = await fetchEconCalendarWithRetry(feedKey);

      const events = rawEvents.map((e: any) => ({
        title: e.title || "",
        country: e.country || "",
        date: e.date || "",
        impact: e.impact || "Low",
        forecast: e.forecast || "",
        previous: e.previous || "",
      }));

      econCalendarMemCache[feedKey] = { data: events, fetchedAt: now };
      saveEconDiskCache(feedKey, events, now);
      console.log(`[EconCalendar] Fetched ${events.length} events for ${feedKey} from ForexFactory`);
      res.json(events);
    } catch (err: any) {
      console.error("[EconCalendar] Error fetching:", err.message);
      if (diskCached) {
        econCalendarMemCache[feedKey] = diskCached;
        return res.json(diskCached.data);
      }
      res.json([]);
    }
  });

  // ─── Audit Log ─────────────────────────────────────
  app.get("/api/v1/audit-log", async (req, res) => {
    const user = await storage.getUserById(req.session.userId!);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "גישת מנהל נדרשת" });
    }
    const log = await storage.getAuditLog();
    res.json(log);
  });

  // ─── Settings ──────────────────────────────────────
  app.get("/api/v1/settings", async (req, res) => {
    const userId = req.session.userId!;
    const s = await storage.getSettings(userId);
    res.json(s || { theme: "dark", defaultView: "grouped" });
  });

  app.put("/api/v1/settings", async (req, res) => {
    const userId = req.session.userId!;
    // SECURITY: whitelist allowed fields; never spread raw req.body into the DB write.
    const parsed = insertSettingsSchema.omit({ userId: true }).partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", details: parsed.error.errors });
    const s = await storage.upsertSettings({ ...parsed.data, userId });
    res.json(s);
  });

  app.get("/api/v1/market/quotes", async (req: Request, res: Response) => {
    try {
      const { getQuotes } = await import("./market-quotes");
      const raw = (req.query.symbols as string) || "NQ,ES,GC,CL,RTY,YM";
      const symbols = raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 16);

      const quotes = await getQuotes(symbols);
      res.set("Cache-Control", "public, max-age=30");
      res.json({
        quotes,
        fetchedAt: Date.now(),
        delayMinutes: 15,
        source: "yahoo",
      });
    } catch (err: any) {
      console.error("[MarketQuotes] Route error:", err.message);
      res.status(503).json({ message: "Market data unavailable", quotes: [] });
    }
  });

  app.get("/api/v1/settings/webhooks", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const s = await storage.getSettings(userId);
    const prefs = (s?.notificationPreferences as any) || {};
    res.json({
      webhookEnabled: prefs.webhookEnabled ?? false,
      discordWebhookUrl: prefs.discordWebhookUrl ? "••••" + prefs.discordWebhookUrl.slice(-8) : null,
      telegramBotToken: prefs.telegramBotToken ? "••••" + prefs.telegramBotToken.slice(-6) : null,
      telegramChatId: prefs.telegramChatId || null,
      hasDiscord: !!prefs.discordWebhookUrl,
      hasTelegram: !!(prefs.telegramBotToken && prefs.telegramChatId),
    });
  });

  app.put("/api/v1/settings/webhooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { webhookEnabled, discordWebhookUrl, telegramBotToken, telegramChatId } = req.body;

      if (discordWebhookUrl && typeof discordWebhookUrl === "string" && discordWebhookUrl.length > 0) {
        try {
          const parsed = new URL(discordWebhookUrl);
          const validHosts = ["discord.com", "discordapp.com"];
          if (parsed.protocol !== "https:" || !validHosts.includes(parsed.hostname) || !parsed.pathname.startsWith("/api/webhooks/")) {
            return res.status(400).json({ error: "Invalid Discord webhook URL. Must be https://discord.com/api/webhooks/..." });
          }
        } catch {
          return res.status(400).json({ error: "Invalid Discord webhook URL format" });
        }
      }

      if (telegramBotToken && typeof telegramBotToken === "string" && telegramBotToken.length > 0) {
        if (!/^\d+:[A-Za-z0-9_-]+$/.test(telegramBotToken)) {
          return res.status(400).json({ error: "Invalid Telegram bot token format" });
        }
      }

      if (telegramChatId && typeof telegramChatId === "string" && telegramChatId.length > 0) {
        if (!/^-?\d+$/.test(telegramChatId)) {
          return res.status(400).json({ error: "Invalid Telegram chat ID format" });
        }
      }

      const s = await storage.getSettings(userId);
      const existing = (s?.notificationPreferences as any) || {};

      const updated: Record<string, any> = { ...existing, webhookEnabled: !!webhookEnabled };
      if (discordWebhookUrl !== undefined) updated.discordWebhookUrl = discordWebhookUrl || null;
      if (telegramBotToken !== undefined) updated.telegramBotToken = telegramBotToken || null;
      if (telegramChatId !== undefined) updated.telegramChatId = telegramChatId || null;

      await storage.upsertSettings({ userId, notificationPreferences: updated });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Webhook] Save error:", err.message);
      res.status(500).json({ error: "Failed to save webhook settings" });
    }
  });

  app.post("/api/v1/settings/webhooks/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const s = await storage.getSettings(userId);
      const prefs = (s?.notificationPreferences as any) || {};

      if (!prefs.discordWebhookUrl && !(prefs.telegramBotToken && prefs.telegramChatId)) {
        return res.status(400).json({ error: "No webhook channels configured" });
      }

      const { testWebhookConfig } = await import("./webhook-dispatcher");
      const result = await testWebhookConfig({
        discordUrl: prefs.discordWebhookUrl,
        telegramBotToken: prefs.telegramBotToken,
        telegramChatId: prefs.telegramChatId,
        enabled: true,
      });
      res.json(result);
    } catch (err: any) {
      console.error("[Webhook] Test error:", err.message);
      res.status(500).json({ error: "Webhook test failed" });
    }
  });

  // ─── Analytics Gateway ──────────────────────────────
  app.get("/api/v1/analytics/:endpoint", requireAuth, async (req: Request, res: Response) => {
    const analyticsUrl = process.env.ANALYTICS_URL || "http://localhost:8100";
    const endpoint = req.params.endpoint;
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const userId = req.session.userId!;

    try {
      const url = `${analyticsUrl}/api/analytics/${endpoint}?user_id=${userId}${queryString ? "&" + queryString : ""}`;
      const upstream = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000),
      });

      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        res.status(504).json({ error: "Analytics service timeout" });
      } else {
        console.error("[Analytics Gateway]", err.message);
        res.status(502).json({ error: "Analytics service unavailable" });
      }
    }
  });

  // ─── Export ────────────────────────────────────────
  app.get("/api/v1/export/:type", requirePlanFeature("exports"), async (req, res) => {
    const userId = req.session.userId!;
    const type = req.params.type;
    let data: any[] = [];
    let filename = "";

    if (type === "accounts") {
      data = await storage.getAccounts(userId);
      filename = "accounts";
    } else if (type === "withdrawals") {
      data = await storage.getWithdrawals(userId);
      filename = "withdrawals";
    } else if (type === "balance-history") {
      const accountId = parseInt(req.query.accountId as string);
      if (!isNaN(accountId)) {
        data = await storage.getBalanceHistory(accountId);
      }
      filename = "balance-history";
    } else {
      return res.status(400).json({ message: "Invalid export type" });
    }

    if (data.length === 0) {
      return res.status(404).json({ message: "No data to export" });
    }

    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(","),
      ...data.map(row => headers.map(h => {
        const val = (row as any)[h];
        if (val === null || val === undefined) return "";
        const sanitized = String(sanitizeCsvCell(String(val)));
        return sanitized.includes(",") || sanitized.includes('"') ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
      }).join(","))
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}-${new Date().toISOString().split('T')[0]}.csv`);
    res.send("\uFEFF" + csvRows.join("\n"));
  });

  app.get("/api/v1/export/system-spec-pdf", requirePlanFeature("exports"), async (req, res) => {
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "A4", margin: 50, lang: "he" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=VERTEX_COMMAND_System_Spec.pdf");
    doc.pipe(res);

    const firms = await storage.getFirms();
    const allTiers = await storage.getFirmTiers();

    const PAGE_W = 595.28 - 100;
    const addTitle = (text: string, size = 22) => {
      doc.fontSize(size).font("Helvetica-Bold").text(text, { align: "center" });
      doc.moveDown(0.5);
    };
    const addHeading = (text: string) => {
      doc.moveDown(0.8);
      doc.fontSize(14).font("Helvetica-Bold").text(text, { align: "left" });
      doc.moveTo(50, doc.y).lineTo(50 + PAGE_W, doc.y).strokeColor("#6366f1").lineWidth(1).stroke();
      doc.moveDown(0.4);
    };
    const addBody = (text: string) => {
      doc.fontSize(10).font("Helvetica").text(text, { align: "left", lineGap: 4 });
    };
    const addBullet = (text: string) => {
      doc.fontSize(10).font("Helvetica").text(`  •  ${text}`, { align: "left", lineGap: 3 });
    };
    const addTableRow = (cols: string[], widths: number[], bold = false) => {
      const y = doc.y;
      const font = bold ? "Helvetica-Bold" : "Helvetica";
      let x = 50;
      cols.forEach((col, i) => {
        doc.fontSize(9).font(font).text(col, x + 4, y + 4, { width: widths[i] - 8, align: "left" });
        x += widths[i];
      });
      const maxH = Math.max(18, ...cols.map((col, i) => doc.heightOfString(col, { width: widths[i] - 8, fontSize: 9 }) + 8));
      let rx = 50;
      cols.forEach((_, i) => {
        doc.rect(rx, y, widths[i], maxH).strokeColor("#ddd").lineWidth(0.5).stroke();
        rx += widths[i];
      });
      doc.y = y + maxH;
    };

    // Title page
    doc.moveDown(6);
    doc.fontSize(32).font("Helvetica-Bold").text("VERTEX COMMAND", { align: "center" });
    doc.fontSize(16).font("Helvetica").text("Trading Command Center", { align: "center" });
    doc.moveDown(1);
    doc.fontSize(12).font("Helvetica").text("System Specification Document", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#666").text(`Generated: ${new Date().toISOString().split("T")[0]}`, { align: "center" });
    doc.fillColor("#000");
    doc.moveDown(4);
    doc.fontSize(11).font("Helvetica").text("Prop Trading Account Management System", { align: "center" });
    doc.text("Multi-user authentication, firm rule engine, trailing drawdown,", { align: "center" });
    doc.text("withdrawal lifecycle, balance history, alerts & analytics.", { align: "center" });

    // Page 2 - Architecture
    doc.addPage();
    addTitle("System Architecture", 18);

    addHeading("1. Technology Stack");
    const stackWidths = [150, PAGE_W - 150];
    addTableRow(["Layer", "Technology"], stackWidths, true);
    addTableRow(["Frontend", "React 18 + TypeScript, Vite, Tailwind CSS v4, shadcn/ui"], stackWidths);
    addTableRow(["Backend", "Express.js, Node.js"], stackWidths);
    addTableRow(["Database", "PostgreSQL + Drizzle ORM"], stackWidths);
    addTableRow(["Auth", "Sessions (express-session + connect-pg-simple)"], stackWidths);
    addTableRow(["Email", "Gmail API (Replit Integration)"], stackWidths);
    addTableRow(["Charts", "Recharts"], stackWidths);
    addTableRow(["Animations", "Framer Motion"], stackWidths);
    addTableRow(["Routing", "wouter"], stackWidths);
    addTableRow(["State", "TanStack Query (React Query)"], stackWidths);

    addHeading("2. Data Model (10 Tables)");
    addBullet("users - User accounts with email verification");
    addBullet("firms - Trading firm configurations and rules");
    addBullet("firm_tiers - Account types/sizes per firm with specific rules");
    addBullet("accounts - Trading accounts with balance, drawdown, status tracking");
    addBullet("withdrawals - Withdrawal lifecycle (pending > approved > paid)");
    addBullet("balance_history - Daily balance snapshots for charts");
    addBullet("alerts - System notifications per account");
    addBullet("monthly_reports - Aggregated monthly performance data");
    addBullet("audit_log - Full action audit trail with metadata");
    addBullet("settings - User preferences (theme, view mode)");

    addHeading("3. Security");
    addBullet("Passwords: bcrypt hash, min 8 chars + uppercase + lowercase + special char");
    addBullet("Email verification required before login (24h token expiry)");
    addBullet("PostgreSQL-backed sessions");
    addBullet("Full per-user data isolation on all endpoints");
    addBullet("Zod validation on all API inputs");
    addBullet("Audit log for all create/update/delete operations");

    // Page 3 - Account Fields
    doc.addPage();
    addTitle("Account Data Model", 18);

    addHeading("4. Account Fields");
    const acctWidths = [120, 70, PAGE_W - 190];
    addTableRow(["Field", "Type", "Description"], acctWidths, true);
    const acctFields = [
      ["accountId", "varchar", "Unique ID (VX-XXXX)"],
      ["name", "text", "Account display name"],
      ["firm", "text", "Trading firm name"],
      ["tier", "text", "Firm tier/account type"],
      ["stage", "text", "phase1 / phase2 / funded / payout"],
      ["size", "real", "Initial account size ($)"],
      ["balance", "real", "Current balance ($)"],
      ["target", "real", "Profit target ($)"],
      ["maxDrawdown", "real", "Maximum drawdown amount"],
      ["drawdownType", "text", "static or trailing"],
      ["trailingDrawdown", "real", "Trailing drawdown amount"],
      ["consistencyRule", "real", "Max single-day profit % of total"],
      ["topDayProfit", "real", "Highest single-day profit (auto-tracked)"],
      ["tradingDays", "integer", "Trading days count (auto-incremented)"],
      ["bufferEnabled", "boolean", "Whether buffer-before-target is active"],
      ["peakBalance", "real", "Highest balance reached (auto-tracked)"],
      ["status", "text", "Computed status (healthy/risk/violated/etc)"],
    ];
    acctFields.forEach(row => addTableRow(row, acctWidths));

    // Page 4 - Business Logic
    doc.addPage();
    addTitle("Business Logic Engine", 18);

    addHeading("5. Account Status (Auto-Computed)");
    const statusWidths = [130, PAGE_W - 130];
    addTableRow(["Status", "Condition"], statusWidths, true);
    addTableRow(["violated", "Distance to floor < 10% of drawdown"], statusWidths);
    addTableRow(["drawdown_risk", "Distance to floor < 30% of drawdown"], statusWidths);
    addTableRow(["consistency_risk", "Top day / total profit > consistency rule %"], statusWidths);
    addTableRow(["ready_to_withdraw", "Buffer-adjusted profit >= target"], statusWidths);
    addTableRow(["near_target", "Buffer-adjusted profit >= 80% of target"], statusWidths);
    addTableRow(["buffer_building", "Profit > 0 but < drawdown (when buffer enabled)"], statusWidths);
    addTableRow(["healthy", "Default — no risk detected"], statusWidths);

    addHeading("6. Quick Balance Update");
    addBullet("User enters daily P&L (profit or loss for today)");
    addBullet("System calculates: new balance = current balance + daily P&L");
    addBullet("Auto-increments trading days counter");
    addBullet("Auto-updates top day profit if this is the highest day");
    addBullet("Auto-updates peak balance for trailing drawdown");
    addBullet("Creates balance history snapshot for charts");

    addHeading("7. Trailing Drawdown");
    addBullet("Floor = max(size - drawdown, peakBalance - drawdown)");
    addBullet("Follows peak balance upward — never decreases");
    addBullet("Distance to floor shown as real-time progress bar");

    addHeading("8. Buffer Before Target");
    addBullet("Can be enabled/disabled per individual account");
    addBullet("When ON: profit must first fill buffer (= drawdown amount), then counts toward target");
    addBullet("When OFF: all profit counts directly toward target");
    addBullet("Affects status calculations, trading priorities, and target progress display");

    addHeading("9. Trading Priorities (Scoring 0-100)");
    addBullet("trade (50): Normal — safe to trade");
    addBullet("light_trading (85): Near target or consistency risk");
    addBullet("avoid (25): High drawdown risk (>50%)");
    addBullet("do_not_trade (10): Critical drawdown risk (>70%)");
    addBullet("ready_to_withdraw (100): Profit target reached");

    // Page 5 - Firms
    doc.addPage();
    addTitle("Trading Firms & Tiers", 18);

    addHeading("10. Configured Firms");

    for (const firm of firms) {
      const tiers = allTiers.filter(t => t.firmId === firm.id);
      doc.moveDown(0.3);
      doc.fontSize(12).font("Helvetica-Bold").text(`${firm.name} (${tiers.length} tiers)`, { align: "left" });
      doc.moveDown(0.2);

      if (tiers.length > 0) {
        const tw = [130, 55, 60, 55, 55, 55, PAGE_W - 410];
        addTableRow(["Tier", "Min Days", "Consist%", "Daily DD", "Total DD", "Wait", "Stage"], tw, true);
        for (const t of tiers) {
          if (doc.y > 700) { doc.addPage(); }
          addTableRow([
            t.name,
            String(t.minTradingDays || 0),
            String(t.consistencyPercentage || 0) + "%",
            (t.dailyDrawdown || 0) + "%",
            (t.totalDrawdown || 0) + "%",
            String(t.withdrawalWaitDays || 0) + "d",
            t.withdrawalAllowedStage || "funded"
          ], tw);
        }
      }
    }

    // Page 6 - API
    doc.addPage();
    addTitle("API Endpoints (35 Routes)", 18);

    addHeading("11. Authentication (6 endpoints)");
    const apiW = [80, 200, PAGE_W - 280];
    addTableRow(["Method", "Endpoint", "Description"], apiW, true);
    addTableRow(["POST", "/api/v1/auth/register", "Register with email verification"], apiW);
    addTableRow(["GET", "/api/v1/auth/verify/:token", "Verify email token"], apiW);
    addTableRow(["POST", "/api/v1/auth/resend-verification", "Resend verification email"], apiW);
    addTableRow(["POST", "/api/v1/auth/login", "Login (requires verified email)"], apiW);
    addTableRow(["POST", "/api/v1/auth/logout", "Destroy session"], apiW);
    addTableRow(["GET", "/api/v1/auth/me", "Get current user"], apiW);

    addHeading("12. Firms & Tiers (8 endpoints)");
    addTableRow(["Method", "Endpoint", "Description"], apiW, true);
    addTableRow(["GET", "/api/v1/firms", "List all firms with tiers"], apiW);
    addTableRow(["POST", "/api/v1/firms", "Create firm"], apiW);
    addTableRow(["PATCH", "/api/v1/firms/:id", "Update firm"], apiW);
    addTableRow(["DELETE", "/api/v1/firms/:id", "Delete firm + tiers"], apiW);
    addTableRow(["POST", "/api/v1/firm-tiers", "Create tier"], apiW);
    addTableRow(["PATCH", "/api/v1/firm-tiers/:id", "Update tier"], apiW);
    addTableRow(["DELETE", "/api/v1/firm-tiers/:id", "Delete tier"], apiW);

    addHeading("13. Accounts (5 endpoints)");
    addTableRow(["Method", "Endpoint", "Description"], apiW, true);
    addTableRow(["GET", "/api/v1/accounts", "List with computed status & drawdown"], apiW);
    addTableRow(["GET", "/api/v1/accounts/:id", "Detail with history, alerts, withdrawals"], apiW);
    addTableRow(["POST", "/api/v1/accounts", "Create account"], apiW);
    addTableRow(["PATCH", "/api/v1/accounts/:id", "Update (auto-increments trading days)"], apiW);
    addTableRow(["DELETE", "/api/v1/accounts/:id", "Delete account"], apiW);

    doc.addPage();
    addHeading("14. Withdrawals & History (7 endpoints)");
    addTableRow(["Method", "Endpoint", "Description"], apiW, true);
    addTableRow(["GET/POST", "/api/v1/withdrawals", "List / create withdrawal"], apiW);
    addTableRow(["PATCH/DEL", "/api/v1/withdrawals/:id", "Update / delete withdrawal"], apiW);
    addTableRow(["GET", "/api/v1/balance-history/:accountId", "Get balance snapshots"], apiW);
    addTableRow(["POST", "/api/v1/balance-history", "Add manual snapshot"], apiW);
    addTableRow(["GET", "/api/v1/monthly-reports", "Monthly performance reports"], apiW);

    addHeading("15. Alerts & System (9 endpoints)");
    addTableRow(["Method", "Endpoint", "Description"], apiW, true);
    addTableRow(["GET", "/api/v1/alerts", "List all alerts"], apiW);
    addTableRow(["GET", "/api/v1/alerts/unread", "Unread alerts only"], apiW);
    addTableRow(["POST", "/api/v1/alerts", "Create alert"], apiW);
    addTableRow(["PATCH", "/api/v1/alerts/:id/read", "Mark as read"], apiW);
    addTableRow(["POST", "/api/v1/alerts/read-all", "Mark all read"], apiW);
    addTableRow(["DELETE", "/api/v1/alerts/:id", "Delete alert"], apiW);
    addTableRow(["GET", "/api/v1/audit-log", "Audit trail"], apiW);
    addTableRow(["GET/PUT", "/api/v1/settings", "User preferences"], apiW);
    addTableRow(["GET", "/api/v1/export/:type", "CSV export (accounts/withdrawals)"], apiW);

    addHeading("16. Trading Insights (1 endpoint)");
    addTableRow(["Method", "Endpoint", "Description"], apiW, true);
    addTableRow(["GET", "/api/v1/trading-priorities", "Scored account list with recommendations"], apiW);

    // Page 7 - UI
    doc.addPage();
    addTitle("User Interface", 18);

    addHeading("17. Pages & Navigation");
    addBullet("Auth Page: Login / Register with email verification + password strength indicator");
    addBullet("Dashboard: Overview cards, charts (AreaChart, PieChart), account summaries");
    addBullet("Accounts Table: Sortable, filterable, with inline status badges & progress bars");
    addBullet("Account Detail: Full metrics, 4 progress bars (buffer/target/consistency/drawdown)");
    addBullet("Trading Priorities: Scored table with color-coded recommendations");
    addBullet("Withdrawals: Lifecycle management (pending > approved > paid)");
    addBullet("Analytics: Monthly reports with performance data");
    addBullet("Settings: Firm/tier management (dialog-based), theme toggle, CSV export");

    addHeading("18. Mobile Optimization");
    addBullet("Full RTL Hebrew interface");
    addBullet("Bottom navigation bar with 5 tabs (auto-hides on keyboard open)");
    addBullet("Dialog-based forms (no inline forms that cause keyboard jumping)");
    addBullet("Dynamic viewport units (dvh) for iOS compatibility");
    addBullet("interactive-widget=resizes-visual meta tag");
    addBullet("Safe area insets for notch devices");

    addHeading("19. Data Export");
    addBullet("Accounts CSV: All account fields with current metrics");
    addBullet("Withdrawals CSV: Full withdrawal history");
    addBullet("System Spec PDF: This document");

    // Footer
    doc.moveDown(3);
    doc.fontSize(9).fillColor("#999").text("VERTEX COMMAND — Trading Command Center", { align: "center" });
    doc.text("Generated automatically from live system data", { align: "center" });
    doc.fillColor("#000");

    doc.end();
  });

  app.get("/api/v1/reports/account-pdf", requirePlanFeature("exports"), async (req, res) => {
    try {
    const userId = req.session.userId!;
    const accountId = parseInt(req.query.accountId as string);
    const tab = (req.query.tab as string) || "performance";
    const dateFrom = (req.query.dateFrom as string) || "";
    const dateTo = (req.query.dateTo as string) || "";

    const validTabs = ["performance", "orders", "positionHistory", "cashHistory", "fills", "balanceHistory"];
    if (!validTabs.includes(tab)) {
      return res.status(400).json({ message: `Invalid tab. Must be one of: ${validTabs.join(", ")}` });
    }

    if (!accountId || isNaN(accountId)) {
      return res.status(400).json({ message: "accountId required" });
    }

    const account = await storage.getAccount(accountId);
    if (!account || !await isLinkedUser(userId, account.userId!)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=account-report-${accountId}-${tab}.pdf`);
    doc.pipe(res);

    const PAGE_W = 595.28 - 100;

    const addTitle = (text: string, size = 18) => {
      doc.fontSize(size).font("Helvetica-Bold").text(text, { align: "center" });
      doc.moveDown(0.5);
    };
    const addHeading = (text: string) => {
      doc.moveDown(0.6);
      doc.fontSize(12).font("Helvetica-Bold").text(text, { align: "left" });
      doc.moveTo(50, doc.y).lineTo(50 + PAGE_W, doc.y).strokeColor("#6366f1").lineWidth(1).stroke();
      doc.moveDown(0.3);
    };
    const addRow = (cols: string[], widths: number[], bold = false) => {
      const y = doc.y;
      const font = bold ? "Helvetica-Bold" : "Helvetica";
      let x = 50;
      cols.forEach((col, i) => {
        doc.fontSize(8).font(font).text(col, x + 3, y + 3, { width: widths[i] - 6, align: "left" });
        x += widths[i];
      });
      const maxH = Math.max(16, ...cols.map((col, i) => doc.heightOfString(col, { width: widths[i] - 6, fontSize: 8 }) + 6));
      let rx = 50;
      cols.forEach((_, i) => {
        doc.rect(rx, y, widths[i], maxH).strokeColor("#ddd").lineWidth(0.5).stroke();
        rx += widths[i];
      });
      doc.y = y + maxH;
    };
    const fmtCur = (v: number | null | undefined) => v != null ? `$${Number(v).toFixed(2)}` : "—";
    const fmtDate = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleDateString() : "—";

    addTitle("VERTEX COMMAND — Account Report");
    doc.fontSize(10).font("Helvetica").text(`Account: ${account.name} (${account.accountId})`, { align: "center" });
    doc.fontSize(9).fillColor("#666").text(`Generated: ${new Date().toISOString().split("T")[0]}`, { align: "center" });
    if (dateFrom || dateTo) {
      doc.text(`Period: ${dateFrom || "—"} to ${dateTo || "—"}`, { align: "center" });
    }
    doc.fillColor("#000");
    doc.moveDown(1);

    if (tab === "performance" || tab === "orders" || tab === "positionHistory" || tab === "fills") {
      let entries = await storage.getJournalEntries(userId, {
        accountId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });

      if (tab === "positionHistory") {
        entries = entries.filter(e => e.closedAt);
      } else if (tab === "fills") {
        entries = entries.filter(e => e.entryPrice && e.exitPrice);
      }

      if (tab === "performance") {
        addHeading("Performance Summary");
        const wins = entries.filter(e => (e.realizedPnl || 0) > 0);
        const losses = entries.filter(e => (e.realizedPnl || 0) < 0);
        const totalWins = wins.reduce((s, e) => s + (e.realizedPnl || 0), 0);
        const totalLosses = Math.abs(losses.reduce((s, e) => s + (e.realizedPnl || 0), 0));
        const netPnl = entries.reduce((s, e) => s + (e.realizedPnl || 0), 0);

        const sw = [PAGE_W / 2, PAGE_W / 2];
        addRow(["Metric", "Value"], sw, true);
        addRow(["Total Trades", String(entries.length)], sw);
        addRow(["Win Rate", entries.length > 0 ? `${((wins.length / entries.length) * 100).toFixed(1)}%` : "0%"], sw);
        addRow(["Avg Win", fmtCur(wins.length > 0 ? totalWins / wins.length : 0)], sw);
        addRow(["Avg Loss", fmtCur(losses.length > 0 ? totalLosses / losses.length : 0)], sw);
        addRow(["Profit Factor", totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : totalWins > 0 ? "∞" : "0"], sw);
        addRow(["Best Trade", fmtCur(entries.length > 0 ? Math.max(...entries.map(e => e.realizedPnl || 0)) : 0)], sw);
        addRow(["Worst Trade", fmtCur(entries.length > 0 ? Math.min(...entries.map(e => e.realizedPnl || 0)) : 0)], sw);
        addRow(["Net P/L", fmtCur(netPnl)], sw);
      }

      addHeading(tab === "performance" ? "Trade Details" : tab === "orders" ? "Orders" : tab === "positionHistory" ? "Position History" : "Fills");
      const cw = [70, 50, 45, 65, 65, 65, 70, 65];
      addRow(["Symbol", "Side", "Qty", "Entry", "Exit", "P/L", "Opened", "Closed"], cw, true);
      for (const e of entries.slice(0, 100)) {
        if (doc.y > 750) doc.addPage();
        addRow([
          e.symbol || "—",
          e.side?.toUpperCase() || "—",
          String(e.quantity ?? "—"),
          e.entryPrice != null ? Number(e.entryPrice).toFixed(2) : "—",
          e.exitPrice != null ? Number(e.exitPrice).toFixed(2) : "—",
          fmtCur(e.realizedPnl),
          fmtDate(e.openedAt),
          fmtDate(e.closedAt),
        ], cw);
      }
    } else if (tab === "cashHistory") {
      addHeading("Cash History");
      let withdrawals = await storage.getWithdrawalsByAccount(accountId);
      if (dateFrom) withdrawals = withdrawals.filter(w => w.dateRequested >= dateFrom);
      if (dateTo) withdrawals = withdrawals.filter(w => w.dateRequested <= dateTo);

      const cw = [PAGE_W * 0.25, PAGE_W * 0.25, PAGE_W * 0.25, PAGE_W * 0.25];
      addRow(["Date", "Type", "Amount", "Status"], cw, true);
      for (const w of withdrawals) {
        if (doc.y > 750) doc.addPage();
        addRow([w.dateRequested, "Withdrawal", fmtCur(w.amount), w.status], cw);
      }
    } else if (tab === "balanceHistory") {
      addHeading("Account Balance History");
      let history = await storage.getBalanceHistory(accountId);
      if (dateFrom) history = history.filter(b => b.date >= dateFrom);
      if (dateTo) history = history.filter(b => b.date <= dateTo);

      const cw = [PAGE_W * 0.2, PAGE_W * 0.2, PAGE_W * 0.2, PAGE_W * 0.2, PAGE_W * 0.2];
      addRow(["Date", "Balance", "Profit", "Equity", "Daily P/L"], cw, true);
      for (const b of history) {
        if (doc.y > 750) doc.addPage();
        addRow([b.date, fmtCur(b.balance), fmtCur(b.profit), fmtCur(b.equity), fmtCur(b.dailyPnl)], cw);
      }
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#999").text("VERTEX COMMAND — Account Report", { align: "center" });
    doc.fillColor("#000");
    doc.end();
    } catch (err: any) {
      console.error("[PDF] Account report error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to generate PDF report" });
      }
    }
  });

  return httpServer;
}
