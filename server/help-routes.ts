import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requirePlanFeature } from "./billing-routes";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { getEngineStatus, getEngineMapSizes } from "./copy-trading-engine";
import { getLastAuditResult } from "./dependency-audit";
import { apiQueue } from "./api-queue";
import { getLatencyStoreSize } from "./latency-monitor";
import { getTopstepXMapSizes } from "./topstepx-streaming";
import { getTradovateMapSizes } from "./tradovate-websocket";
import { getEquityMapSizes } from "./equity-tick-processor";
import { getConnectionAccountCacheSize } from "./trading-routes";

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(4000),
  })).max(20).optional().default([]),
});

let _openaiPromise: Promise<any> | null = null;
function getOpenAIClient() {
  if (!_openaiPromise) {
    _openaiPromise = import("openai").then(mod => {
      const OpenAI = mod.default || mod;
      return new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
    });
  }
  return _openaiPromise;
}

const SYSTEM_PROMPT = `אתה העוזר של Vertex Command — פלטפורמת ניהול חשבונות פרופ טריידינג.

## כללי תשובה
- זהה את השפה של ההודעה וענה באותה שפה (עברית, אנגלית, ערבית, ספרדית)
- ענה בקצרה ובנקודות. לא פסקאות ארוכות.
- השתמש בשפה פשוטה ויומיומית — לא טקסט אקדמי
- תן דוגמאות מספריות כשרלוונטי
- אם יש שלבים — מספר אותם (1, 2, 3)
- בסוף כל תשובה שאל: "צריך עוד עזרה?" (בשפת המשתמש)
- אל תמציא מידע. אם לא בטוח — אמור "לא בטוח, כדאי לבדוק עם התמיכה"

## על המערכת
- ניהול חשבונות מחברות פרופ: FTMO, Topstep, Apex, TakeProfit, Lucid, The Funded Trader ועוד
- מעקב: באלאנס, רווח/הפסד, דראודאון, ימי מסחר, עקביות, משיכות
- מנוע חוקים אוטומטי — מחשב סטטוס: בריא / בסיכון / מוכן למשיכה
- חיבור API: TopstepX, Tradovate, CSV Import
- קופי טריידינג — העתקת עסקאות בין חשבונות
- יומן מסחר — תיעוד עסקאות, פסיכולוגיה, ניתוח ביצועים

## איך להשתמש במערכת
- **דאשבורד** → סיכום כל החשבונות, מצב כללי
- **מה לסחור היום** → המערכת ממליצה באיזה חשבון לסחור לפי חוקי החברה
- **משיכות** → מעקב בקשות משיכה (ממתין → אושר → שולם)
- **אינטגרציות** → חיבור API לחברות, סנכרון אוטומטי
- **קופי טריידינג** → הגדרת קבוצה + חשבונות שעוקבים
- **יומן** → רישום עסקאות, תגיות, הערות, מצב רוח
- **ניתוח** → גרפים, win rate, P&L לפי סמל/יום
- **תוכניות** → Free, Pro ($29), Trader ($79), Desk ($199)

## מושגים בקצרה
- **דראודאון** = ההפסד המקסימלי המותר. סטטי = מהגודל ההתחלתי. צף = נע עם הרווח.
- **עקביות** = לא יותר מ-X% רווח ביום אחד מתוך הכולל
- **Phase 1/2** = שלבי מבחן לפני חשבון ממומן
- **Funded** = חשבון ממומן, מסחר אמיתי
- **Payout** = משיכת רווחים

## חוקי חברות (בקצרה)
- FTMO: דראודאון יומי 5%, מקסימלי 10%, יעד 10%
- Topstep: דראודאון צף 2-4%, בלי יומי, מינימום 2 ימי מסחר
- Apex: דראודאון צף, 9 תיקים
- TakeProfit: דראודאון 0-4%, 5 תיקים
- Lucid: דראודאון 0-4%, 12 תיקים`;

export function registerHelpRoutes(app: Express): void {
  app.get("/api/v1/system/status", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const services: { name: string; status: "operational" | "degraded" | "down"; latency?: number; detail?: string }[] = [];
    const startTime = Date.now();

    try {
      const dbStart = Date.now();
      await db.execute(sql`SELECT 1`);
      services.push({ name: "database", status: "operational", latency: Date.now() - dbStart });
    } catch {
      services.push({ name: "database", status: "down", detail: "Cannot connect to database" });
    }

    services.push({ name: "api_server", status: "operational", latency: Date.now() - startTime });

    try {
      if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        services.push({ name: "ai_assistant", status: "operational" });
      } else {
        services.push({ name: "ai_assistant", status: "degraded", detail: "API key not configured" });
      }
    } catch {
      services.push({ name: "ai_assistant", status: "down" });
    }

    try {
      const engineStatus = getEngineStatus();
      services.push({
        name: "copy_engine",
        status: "operational",
        detail: `${engineStatus.activeGroups} active group(s)`,
      });
    } catch {
      services.push({ name: "copy_engine", status: "down", detail: "Engine not responding" });
    }

    try {
      const connResult = await db.execute(sql`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'connected') as connected FROM integration_connections`);
      const row = (connResult as any).rows?.[0] || { total: 0, connected: 0 };
      const total = Number(row.total || 0);
      const connected = Number(row.connected || 0);
      if (total === 0) {
        services.push({ name: "broker_connections", status: "operational", detail: "No connections configured" });
      } else if (connected === total) {
        services.push({ name: "broker_connections", status: "operational", detail: `${connected}/${total} connected` });
      } else if (connected > 0) {
        services.push({ name: "broker_connections", status: "degraded", detail: `${connected}/${total} connected` });
      } else {
        services.push({ name: "broker_connections", status: "down", detail: `0/${total} connected` });
      }
    } catch {
      services.push({ name: "broker_connections", status: "operational" });
    }

    const audit = getLastAuditResult();
    if (audit) {
      const auditStatus = audit.status === "healthy" ? "operational" : audit.status === "warning" ? "degraded" : audit.status === "critical" ? "down" : "degraded";
      services.push({
        name: "dependency_health",
        status: auditStatus,
        detail: audit.status === "unknown"
          ? "Audit pending or failed"
          : `${audit.total} vulnerabilities (${audit.critical} critical, ${audit.high} high)`,
      });
    } else {
      services.push({ name: "dependency_health", status: "degraded", detail: "Audit not yet run" });
    }

    const overall = services.some(s => s.status === "down") ? "down" : services.some(s => s.status === "degraded") ? "degraded" : "operational";

    res.json({
      overall,
      services,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/v1/system/memory", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const mem = process.memoryUsage();
    const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;

    res.json({
      process: {
        rss_mb: toMB(mem.rss),
        heapTotal_mb: toMB(mem.heapTotal),
        heapUsed_mb: toMB(mem.heapUsed),
        external_mb: toMB(mem.external),
        arrayBuffers_mb: toMB(mem.arrayBuffers || 0),
      },
      maps: {
        apiQueue: apiQueue.getMapSizes(),
        latencyStore: getLatencyStoreSize(),
        copyEngine: getEngineMapSizes(),
        topstepx: getTopstepXMapSizes(),
        tradovate: getTradovateMapSizes(),
        equity: getEquityMapSizes(),
        connectionAccountCache: getConnectionAccountCacheSize(),
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/api/v1/help/chat", requirePlanFeature("ai_chatbot"), async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || "נתונים לא תקינים" });
      }
      const { message, history } = parsed.data;

      const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: message },
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = await (await getOpenAIClient()).chat.completions.create({
        model: "gpt-5-nano",
        messages: chatMessages,
        stream: true,
        max_completion_tokens: 8192,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error in help chat:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "שגיאה בעיבוד ההודעה" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process message" });
      }
    }
  });
}
