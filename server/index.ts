import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import memorystore from "memorystore";
import rateLimit from "express-rate-limit";
import { PostgresStore } from "@acpr/rate-limit-postgresql";
import slowDown from "express-slow-down";
import helmet from "helmet";
import cors from "cors";
import crypto from "crypto";
import { registerRoutes } from "./routes";
import { ensurePlansSeeded } from "./billing-routes";
import { ensureLinkedAdminAccounts } from "./linked-users";
import { serveStatic } from "./static";
import { createServer } from "http";
import { testStripeConnection, getUncachableStripeClient } from "./stripeClient";
import { handleStripeWebhook } from "./webhookHandlers";
import { loadStripeKeyFromIntegration } from "./stripe-key-loader";
import { db, isMockDb } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { migrateCredentials } from "./migrate-credentials";
import { migrateCopyTradingTables } from "./migrate-copy-trading-tables";
import { validateEncryptionKeyOrDie } from "./encryption";
import { sanitizeValue } from "./sanitize";
import { startBackupScheduler } from "./backup";
import { startMarketQuotesRefresher } from "./market-quotes";
import { runStartupAudit } from "./dependency-audit";
import { log } from "./logger";
export { log };
import { logSecurityEvent, getClientIp } from "./security-events";
import { pushSystemError } from "./system-health-stream";

const app = express();
app.set("trust proxy", 1);

app.use((req, res, next) => {
  const maxHeaderSize = 16 * 1024;
  const rawHeaders = req.rawHeaders.join("");
  if (rawHeaders.length > maxHeaderSize) {
    return res.status(431).json({ message: "Request header fields too large" });
  }
  next();
});

const isDev = process.env.NODE_ENV !== "production";
const isProd = !isDev;

app.use(helmet({
  frameguard: { action: "sameorigin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://js.stripe.com",
        "https://*.replit.com",
        "https://*.replit.dev",
        "https://accounts.google.com/gsi/client",
        ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://accounts.google.com/gsi/style",
      ],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https://replit.com",
        "https://*.replit.com",
        "https://*.replit.dev",
        "https://*.stripe.com",
        "https://*.googleusercontent.com",
      ],
      connectSrc: [
        "'self'",
        "https://api.stripe.com",
        "https://*.stripe.network",
        "https://*.replit.com",
        "https://*.replit.dev",
        "https://accounts.google.com/gsi/",
        ...(isDev ? ["ws:", "wss:"] : []),
      ],
      frameSrc: [
        "'self'",
        "https://js.stripe.com",
        "https://hooks.stripe.com",
        "https://checkout.stripe.com",
        "https://*.stripe.network",
        "https://accounts.google.com/gsi/",
      ],
      fontSrc: [
        "'self'",
        "data:",
        "https://fonts.gstatic.com",
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", "https://checkout.stripe.com"],
      upgradeInsecureRequests: isDev ? null : [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: number;
    csrfToken: string;
  }
}

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ error: "Missing signature" });

  try {
    const stripe = await getUncachableStripeClient();
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // SECURITY: never process an unsigned/unverified event. Without the secret,
    // anyone could POST a forged checkout.session.completed to activate any plan.
    if (!endpointSecret) {
      console.error("STRIPE_WEBHOOK_SECRET not configured — rejecting webhook");
      pushSystemError("error", "stripe-webhook", "STRIPE_WEBHOOK_SECRET not configured");
      return res.status(500).json({ error: "Webhook not configured" });
    }

    const event = stripe.webhooks.constructEvent(req.body, sig as string, endpointSecret);

    await handleStripeWebhook(event);
    res.json({ received: true });
  } catch (err: any) {
    console.error("Webhook error:", err.message);
    pushSystemError("error", "stripe-webhook", `Webhook processing error: ${err.message}`);
    res.status(400).json({ error: "שגיאה בעיבוד webhook" });
  }
});

const CORS_EXEMPT_PATHS = ["/api/stripe/webhook", "/api/billing/webhook"];

function buildAllowedOrigins(): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [];

  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    for (const domain of replitDomains.split(",")) {
      const trimmed = domain.trim();
      if (trimmed) {
        origins.push(`https://${trimmed}`);
      }
    }
  }

  const customDomain = process.env.CUSTOM_DOMAIN;
  if (customDomain) {
    origins.push(`https://${customDomain.trim()}`);
  }

  // Split-deploy frontend origins (e.g. Vercel SPA calling this backend cross-origin).
  // Comma-separated list of exact origins, e.g. "https://vertex.vercel.app".
  const frontendOrigins = process.env.FRONTEND_ORIGINS;
  if (frontendOrigins) {
    for (const o of frontendOrigins.split(",")) {
      const trimmed = o.trim();
      if (trimmed) origins.push(trimmed);
    }
  }

  // Allow Vercel preview deployments (changing subdomains) when explicitly enabled.
  if (process.env.ALLOW_VERCEL_PREVIEWS === "true") {
    origins.push(/^https:\/\/[a-z0-9-]+\.vercel\.app$/);
  }

  if (origins.length === 0) {
    origins.push(/^https?:\/\/localhost(:\d+)?$/);
    if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
      const slug = process.env.REPL_SLUG;
      const owner = process.env.REPL_OWNER;
      const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedOwner = owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      origins.push(new RegExp(`^https://${escapedSlug}\\.${escapedOwner}\\.repl\\.co$`));
      origins.push(new RegExp(`^https://[a-f0-9-]+-[a-f0-9-]+-${escapedOwner}\\.replit\\.dev$`));
    }
    console.warn("CORS: No REPLIT_DOMAINS or CUSTOM_DOMAIN set; using fallback origins for development.");
  }

  return origins;
}

const allowedOrigins = buildAllowedOrigins();

const corsMiddleware = cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
});

app.use((req, res, next) => {
  if (CORS_EXEMPT_PATHS.some((p) => req.path === p)) {
    return next();
  }
  corsMiddleware(req, res, next);
});

const LARGE_BODY_PATTERN = /^\/api\/conversations\/\d+\/messages$/;

const jsonParser = express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

const largeJsonParser = express.json({
  limit: "50mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

app.use((req, res, next) => {
  if (LARGE_BODY_PATTERN.test(req.path)) {
    return largeJsonParser(req, res, next);
  }
  return jsonParser(req, res, next);
});

app.use(express.urlencoded({ extended: false, limit: "1mb", parameterLimit: 100 }));

const SANITIZE_SKIP_PATHS = ["/api/stripe/webhook", "/api/billing/webhook"];

app.use((req, _res, next) => {
  const isWriteMethod = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
  if (!isWriteMethod || req.body == null) {
    return next();
  }
  if (SANITIZE_SKIP_PATHS.some((p) => req.path === p)) {
    return next();
  }
  req.body = sanitizeValue(req.body);
  next();
});

const sessionStore = isMockDb
  ? new (memorystore(session))({ checkPeriod: 24 * 60 * 60 * 1000 })
  : new (connectPgSimple(session))({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
    });
app.use(
  session({
    store: sessionStore,
    secret: (() => {
      if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
      if (process.env.NODE_ENV === "production") {
        throw new Error("SESSION_SECRET environment variable is required in production");
      }
      return "vertex-capital-session-secret-dev";
    })(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // Cross-site (Vercel SPA → this backend) requires SameSite=None; Secure.
      // Same-origin/local dev stays Lax.
      sameSite: process.env.CROSS_SITE_COOKIES === "true" ? "none" : "lax",
    },
  })
);

const rateLimitStoreConfig = { connectionString: process.env.DATABASE_URL };
const pgStore = (key: string) =>
  isMockDb ? undefined : new PostgresStore(rateLimitStoreConfig, key);

const apiSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 50,
  delayMs: (used) => (used - 50) * 200,
  maxDelayMs: 5000,
  validate: { delayMs: false },
  store: pgStore("sd_api"),
});

const authSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 3,
  delayMs: (used) => Math.min(Math.pow(2, used - 3) * 500, 30000),
  maxDelayMs: 30000,
  validate: { delayMs: false },
  store: pgStore("sd_auth"),
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "יותר מדי ניסיונות, נסה שוב בעוד דקה" },
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: pgStore("rl_auth"),
  handler: (req, res) => {
    logSecurityEvent("rate_limit_hit", "warning", req.session?.userId || null, getClientIp(req), { path: req.originalUrl, limiter: "auth" });
    res.status(429).json({ message: "יותר מדי ניסיונות, נסה שוב בעוד דקה" });
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { message: "יותר מדי ניסיונות הרשמה, נסה שוב בעוד דקה" },
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: pgStore("rl_register"),
  handler: (req, res) => {
    logSecurityEvent("rate_limit_hit", "warning", null, getClientIp(req), { path: req.originalUrl, limiter: "register" });
    res.status(429).json({ message: "יותר מדי ניסיונות הרשמה, נסה שוב בעוד דקה" });
  },
});

const resetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { message: "יותר מדי ניסיונות איפוס, נסה שוב בעוד דקה" },
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: pgStore("rl_reset"),
  handler: (req, res) => {
    logSecurityEvent("rate_limit_hit", "warning", req.session?.userId || null, getClientIp(req), { path: req.originalUrl, limiter: "reset" });
    res.status(429).json({ message: "יותר מדי ניסיונות איפוס, נסה שוב בעוד דקה" });
  },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { message: "יותר מדי בקשות, נסה שוב בעוד דקה" },
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: pgStore("rl_api"),
  handler: (req, res) => {
    logSecurityEvent("rate_limit_hit", "warning", req.session?.userId || null, getClientIp(req), { path: req.originalUrl, limiter: "api" });
    res.status(429).json({ message: "יותר מדי בקשות, נסה שוב בעוד דקה" });
  },
});

app.use("/api/v1/auth/login", authSlowDown, authLimiter);
app.use("/api/v1/auth/register", authSlowDown, registerLimiter);
app.use("/api/v1/auth/forgot-password", authSlowDown, resetLimiter);
app.use("/api/v1/auth/reset-password", authSlowDown, resetLimiter);
app.use("/api/v1/auth/resend-verification", authSlowDown, authLimiter);
app.use("/api/", apiSlowDown, apiLimiter);

function ensureCsrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

const CSRF_EXEMPT_PATHS = [
  "/api/stripe/webhook",
  "/api/billing/webhook",
];

app.get("/api/v1/csrf-token", (req, res) => {
  const token = ensureCsrfToken(req);
  res.json({ csrfToken: token });
});

app.get("/api/csrf-token", (req, res) => {
  const token = ensureCsrfToken(req);
  res.json({ csrfToken: token });
});

app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }

  const fullPath = req.originalUrl.split("?")[0];

  if (fullPath === "/api/v1/signals" && req.method === "POST") {
    return next();
  }

  for (const exempt of CSRF_EXEMPT_PATHS) {
    if (fullPath === exempt || fullPath.startsWith(exempt + "/")) {
      return next();
    }
  }

  const token = req.headers["x-csrf-token"] as string | undefined;
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    logSecurityEvent("csrf_failure", "warning", req.session.userId || null, getClientIp(req), { path: req.originalUrl, method: req.method });
    return res.status(403).json({ message: "CSRF token missing or invalid" });
  }

  next();
});

import {
  register as promRegister,
  httpRequestDuration,
  httpRequestsTotal,
  startEventLoopMonitoring,
} from "./prometheus-metrics";

startEventLoopMonitoring();

app.use((req, res, next) => {
  if (req.path === "/metrics" || req.path === "/api/health") return next();
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = req.route?.path || req.path.replace(/\/\d+/g, "/:id").replace(/\/[a-f0-9-]{36}/g, "/:uuid");
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
});

app.get("/metrics", async (_req, res) => {
  try {
    res.set("Content-Type", promRegister.contentType);
    res.end(await promRegister.metrics());
  } catch (err) {
    res.status(500).end();
  }
});

const startTime = Date.now();
app.get("/api/health", async (_req, res) => {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {}

  let stripeOk = false;
  try {
    const stripe = await getUncachableStripeClient();
    await stripe.products.list({ limit: 1 });
    stripeOk = true;
  } catch {}

  const allHealthy = dbOk && stripeOk;
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const statusCode = dbOk ? 200 : 503;

  res.status(statusCode).json({
    status: allHealthy ? "healthy" : dbOk ? "degraded" : "unhealthy",
    uptime: uptimeSeconds,
    services: { database: dbOk, stripe: stripeOk },
    timestamp: new Date().toISOString(),
  });
});

const SENSITIVE_PATH_PREFIXES = [
  "/api/auth",
  "/api/billing",
  "/api/integrations/connections",
  "/api/v1/auth",
  "/api/v1/billing",
  "/api/v1/integrations/connections",
  "/api/v1/admin",
];

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const contentLength = res.getHeader("content-length");
      const responseSize = contentLength ? Number(contentLength) : 0;
      const isSensitive = SENSITIVE_PATH_PREFIXES.some(p => path.startsWith(p));
      const displayPath = isSensitive && isProd ? path.replace(/\/[^/]+$/, "/***") : path;
      const logLine = `${req.method} ${displayPath} ${res.statusCode} in ${duration}ms :: ${responseSize}b`;
      log(logLine);
    }
  });

  next();
});

(async () => {
  validateEncryptionKeyOrDie();
  await loadStripeKeyFromIntegration();
  await testStripeConnection();
  if (isMockDb) {
    log("[startup] Mock DB active — skipping plan seeding, account linking, and migrations.");
  } else {
    await ensurePlansSeeded();
    await ensureLinkedAdminAccounts();
    await migrateCredentials();
    await migrateCopyTradingTables();
  }

  startBackupScheduler();
  startMarketQuotesRefresher();
  await registerRoutes(httpServer, app);

  const COMPAT_SKIP_PREFIXES = ["/api/v1", "/api/stripe/webhook", "/api/billing/webhook", "/api/health", "/api/csrf-token"];
  app.use("/api", (req, res, next) => {
    const fullPath = req.originalUrl.split("?")[0];
    if (COMPAT_SKIP_PREFIXES.some(prefix => fullPath.startsWith(prefix))) {
      return next();
    }
    const newPath = req.originalUrl.replace(/^\/api\//, "/api/v1/");
    if (newPath !== req.originalUrl) {
      return res.redirect(307, newPath);
    }
    next();
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    console.error("Internal Server Error:", isProd ? err.message : err);

    if (res.headersSent) {
      return next(err);
    }

    if (isDev) {
      return res.status(status).json({
        message: err.message || "שגיאה פנימית",
        stack: err.stack,
      });
    }

    return res.status(status).json({ message: "שגיאה פנימית" });
  });

  app.use("/backups", (_req, res) => {
    res.status(403).json({ message: "Access denied" });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  if (process.env.NODE_ENV === "development") {
    runStartupAudit();
  }

  setInterval(async () => {
    try {
      const deleted = await storage.deleteOldSecurityEvents(90);
      if (deleted > 0) log(`Cleaned up ${deleted} security events older than 90 days`);
    } catch (err) {
      console.error("Security events cleanup error:", err);
    }
  }, 24 * 60 * 60 * 1000);

  const { syncPrometheusGauges } = await import("./latency-monitor");
  const { getAllWSClientStates, getSSEClientCount, getExecWSClientStates } = await import("./tradovate-websocket");
  const { getTopstepXClientStates, getExecTopstepXClientStates } = await import("./topstepx-streaming");

  const gaugeSync = setInterval(() => {
    try {
      const tradovateData = getAllWSClientStates();
      const topstepxData = getTopstepXClientStates();
      syncPrometheusGauges(
        {
          tradovate: tradovateData.filter(s => s.state === "connected").length,
          topstepx: topstepxData.filter(s => s.state === "connected").length,
          execTradovate: getExecWSClientStates().filter(s => s.state === "connected").length,
          execTopstepx: getExecTopstepXClientStates().filter(s => s.state === "connected").length,
        },
        getSSEClientCount(),
      );
    } catch {}
  }, 5000);
  gaugeSync.unref();

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: process.platform !== "win32",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
