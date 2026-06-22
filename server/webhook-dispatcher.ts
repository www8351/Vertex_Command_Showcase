import { storage } from "./storage";

interface WebhookPayload {
  eventType: "drawdown_breach" | "sync_recovery" | "flatten_failed" | "risk_warning";
  severity: "critical" | "warning" | "info";
  accountName: string;
  accountId: number;
  title: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

interface WebhookConfig {
  discordUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  enabled?: boolean;
}

function getWebhookConfig(notificationPreferences: any): WebhookConfig {
  if (!notificationPreferences || typeof notificationPreferences !== "object") return {};
  return {
    discordUrl: notificationPreferences.discordWebhookUrl || undefined,
    telegramBotToken: notificationPreferences.telegramBotToken || undefined,
    telegramChatId: notificationPreferences.telegramChatId || undefined,
    enabled: notificationPreferences.webhookEnabled !== false,
  };
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
};

const EVENT_LABELS: Record<string, string> = {
  drawdown_breach: "DRAWDOWN BREACH",
  sync_recovery: "ORPHAN RECOVERY",
  flatten_failed: "FLATTEN FAILED",
  risk_warning: "RISK WARNING",
};

function formatDiscordEmbed(payload: WebhookPayload) {
  const color = payload.severity === "critical" ? 0xFF0000
    : payload.severity === "warning" ? 0xFFAA00
    : 0x3498DB;

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Account", value: payload.accountName, inline: true },
    { name: "Event", value: EVENT_LABELS[payload.eventType] || payload.eventType, inline: true },
    { name: "Severity", value: payload.severity.toUpperCase(), inline: true },
  ];

  if (payload.details) {
    if (payload.details.equity != null) {
      fields.push({ name: "Equity", value: `$${Number(payload.details.equity).toFixed(2)}`, inline: true });
    }
    if (payload.details.eodLimit != null) {
      fields.push({ name: "EOD Limit", value: `$${Number(payload.details.eodLimit).toFixed(2)}`, inline: true });
    }
    if (payload.details.riskPercent != null) {
      fields.push({ name: "Risk", value: `${(Number(payload.details.riskPercent) * 100).toFixed(1)}%`, inline: true });
    }
    if (payload.details.positionsClosed != null) {
      fields.push({ name: "Positions Closed", value: String(payload.details.positionsClosed), inline: true });
    }
    if (payload.details.ordersCancelled != null) {
      fields.push({ name: "Orders Cancelled", value: String(payload.details.ordersCancelled), inline: true });
    }
    if (payload.details.executionMs != null) {
      fields.push({ name: "Execution Time", value: `${payload.details.executionMs}ms`, inline: true });
    }
    if (payload.details.orphanedPositions) {
      fields.push({ name: "Orphaned Positions", value: String(payload.details.orphanedPositions), inline: false });
    }
  }

  return {
    embeds: [{
      title: `${SEVERITY_EMOJI[payload.severity] || "⚪"} ${payload.title}`,
      description: payload.message,
      color,
      fields,
      footer: { text: "Vertex Command Risk Engine" },
      timestamp: payload.timestamp,
    }],
  };
}

function formatTelegramMessage(payload: WebhookPayload): string {
  const emoji = SEVERITY_EMOJI[payload.severity] || "⚪";
  const label = EVENT_LABELS[payload.eventType] || payload.eventType;

  let text = `${emoji} <b>${label}</b>\n`;
  text += `<b>${payload.title}</b>\n\n`;
  text += `${payload.message}\n\n`;
  text += `📊 <b>Account:</b> ${payload.accountName}\n`;

  if (payload.details) {
    if (payload.details.equity != null) text += `💰 <b>Equity:</b> $${Number(payload.details.equity).toFixed(2)}\n`;
    if (payload.details.eodLimit != null) text += `🚫 <b>EOD Limit:</b> $${Number(payload.details.eodLimit).toFixed(2)}\n`;
    if (payload.details.riskPercent != null) text += `📈 <b>Risk:</b> ${(Number(payload.details.riskPercent) * 100).toFixed(1)}%\n`;
    if (payload.details.positionsClosed != null) text += `📉 <b>Positions Closed:</b> ${payload.details.positionsClosed}\n`;
    if (payload.details.ordersCancelled != null) text += `❌ <b>Orders Cancelled:</b> ${payload.details.ordersCancelled}\n`;
    if (payload.details.executionMs != null) text += `⏱ <b>Execution:</b> ${payload.details.executionMs}ms\n`;
    if (payload.details.orphanedPositions) text += `⚠️ <b>Orphaned:</b> ${payload.details.orphanedPositions}\n`;
  }

  text += `\n🕐 ${new Date(payload.timestamp).toLocaleString("he-IL", { timeZone: "America/New_York" })} ET`;
  return text;
}

async function sendDiscord(url: string, payload: WebhookPayload): Promise<void> {
  const body = formatDiscordEmbed(payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${res.status} ${text}`);
  }
}

async function sendTelegram(botToken: string, chatId: string, payload: WebhookPayload): Promise<void> {
  const text = formatTelegramMessage(payload);
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Telegram webhook failed: ${res.status} ${text}`);
  }
}

export async function dispatchWebhook(userId: number | null | undefined, payload: WebhookPayload): Promise<void> {
  if (!userId) return;

  try {
    const userSettings = await storage.getSettings(userId);
    if (!userSettings) return;

    const config = getWebhookConfig(userSettings.notificationPreferences);
    if (!config.enabled) return;

    const dispatches: Promise<void>[] = [];

    if (config.discordUrl) {
      dispatches.push(
        sendDiscord(config.discordUrl, payload).catch(err => {
          console.error(`[Webhook] Discord dispatch failed for user ${userId}:`, err.message);
        })
      );
    }

    if (config.telegramBotToken && config.telegramChatId) {
      dispatches.push(
        sendTelegram(config.telegramBotToken, config.telegramChatId, payload).catch(err => {
          console.error(`[Webhook] Telegram dispatch failed for user ${userId}:`, err.message);
        })
      );
    }

    if (dispatches.length > 0) {
      await Promise.allSettled(dispatches);
    }
  } catch (err: any) {
    console.error(`[Webhook] Fatal dispatch error for user ${userId}:`, err.message);
  }
}

export async function dispatchRiskIntervention(opts: {
  userId: number | null | undefined;
  accountName: string;
  accountId: number;
  eventType: "drawdown_breach" | "sync_recovery" | "flatten_failed";
  title: string;
  message: string;
  equity?: number;
  eodLimit?: number;
  riskPercent?: number;
  positionsClosed?: number;
  ordersCancelled?: number;
  executionMs?: number;
  orphanedPositions?: string;
}): Promise<void> {
  const payload: WebhookPayload = {
    eventType: opts.eventType,
    severity: opts.eventType === "flatten_failed" ? "critical" : "critical",
    accountName: opts.accountName,
    accountId: opts.accountId,
    title: opts.title,
    message: opts.message,
    details: {
      equity: opts.equity,
      eodLimit: opts.eodLimit,
      riskPercent: opts.riskPercent,
      positionsClosed: opts.positionsClosed,
      ordersCancelled: opts.ordersCancelled,
      executionMs: opts.executionMs,
      orphanedPositions: opts.orphanedPositions,
    },
    timestamp: new Date().toISOString(),
  };

  dispatchWebhook(opts.userId, payload).catch(() => {});
}

export async function testWebhookConfig(config: WebhookConfig): Promise<{ discord: boolean; telegram: boolean; errors: string[] }> {
  const errors: string[] = [];
  let discordOk = false;
  let telegramOk = false;

  const testPayload: WebhookPayload = {
    eventType: "risk_warning",
    severity: "info",
    accountName: "Test Account",
    accountId: 0,
    title: "Webhook Test",
    message: "This is a test notification from Vertex Command. If you see this, your webhook is configured correctly.",
    timestamp: new Date().toISOString(),
  };

  if (config.discordUrl) {
    try {
      await sendDiscord(config.discordUrl, testPayload);
      discordOk = true;
    } catch (err: any) {
      errors.push(`Discord: ${err.message}`);
    }
  }

  if (config.telegramBotToken && config.telegramChatId) {
    try {
      await sendTelegram(config.telegramBotToken, config.telegramChatId, testPayload);
      telegramOk = true;
    } catch (err: any) {
      errors.push(`Telegram: ${err.message}`);
    }
  }

  return { discord: discordOk, telegram: telegramOk, errors };
}
